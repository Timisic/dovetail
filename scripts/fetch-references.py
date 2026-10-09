#!/usr/bin/env python3
"""Download pinned source snapshots without executing upstream code or hooks."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "references" / "manifest.json"
SOURCES = ROOT / "references" / "sources"
LICENSE_NAME = re.compile(r"^(licen[sc]e|copying|copyright|notice)([._-].*)?$", re.I)


def git(repo, *args, capture=False):
    # Existing environment authentication may be used for reads; never create credentials.
    return subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", "-C", str(repo), *args],
        check=True, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"}, timeout=180,
    ).stdout


def inventory(directory):
    result = {}
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory).as_posix()
        if relative == "SOURCE.json":
            continue
        if path.is_symlink():
            result[relative] = {"symlink": os.readlink(path)}
        elif path.is_file():
            result[relative] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    return result


def fetch(item):
    destination = SOURCES / item["id"]
    if destination.exists():
        provenance = destination / "SOURCE.json"
        data = json.loads(provenance.read_text()) if provenance.is_file() else {}
        if (data.get("repository") == item["repository"] and
                data.get("commit") == item["commit"] and
                data.get("paths") == item["paths"] and
                data.get("files") == inventory(destination)):
            print(f'{item["id"]}: verified existing snapshot {item["commit"]}', flush=True)
            return
        raise RuntimeError(f"Existing snapshot differs: {destination}; move it aside to rebuild.")
    with tempfile.TemporaryDirectory(prefix=".fetch-", dir=SOURCES) as temporary:
        temporary = Path(temporary)
        bare = temporary / "git"
        subprocess.run(["git", "init", "--bare", "--template=", str(bare)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        git(bare, "fetch", "--depth=1", "--no-tags", item["repository"], item["commit"])
        resolved = git(bare, "rev-parse", "FETCH_HEAD^{commit}", capture=True).decode().strip()
        if resolved != item["commit"]:
            raise RuntimeError(f"Commit mismatch for {item['id']}")
        files = git(bare, "ls-tree", "-r", "--name-only", "-z", resolved, capture=True)
        files = files.decode().rstrip("\0").split("\0")
        licenses = [p for p in files if LICENSE_NAME.match(PurePosixPath(p).name)]
        # Keep upstream root documentation and all license notices even for partial snapshots.
        docs = [p for p in files if "/" not in p and p.lower().startswith("readme")]
        for prefix in item["paths"]:
            if prefix != "." and not any(p == prefix or p.startswith(prefix + "/") for p in files):
                raise RuntimeError(f"Requested path is missing in {item['id']}: {prefix}")
        selected = [] if item["paths"] == ["."] else sorted(set(item["paths"] + licenses + docs))
        archive = temporary / "source.tar"
        with archive.open("wb") as output:
            subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-C", str(bare),
                            "archive", "--format=tar", resolved, *selected],
                           stdout=output, check=True, timeout=180)
        staged = temporary / "snapshot"
        staged.mkdir()
        with tarfile.open(archive) as source:
            source.extractall(staged, filter="data")
        data = {**item, "license_files": licenses, "files": inventory(staged)}
        (staged / "SOURCE.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        staged.rename(destination)
        print(f'{item["id"]}: ready {resolved}; {len(data["files"])} files; '
              f'{len(licenses)} license notices', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ids", nargs="*", help="Optional reference IDs; default: all")
    args = parser.parse_args()
    items = json.loads(MANIFEST.read_text())["references"]
    unknown = set(args.ids) - {item["id"] for item in items}
    if unknown:
        parser.error("Unknown reference IDs: " + ", ".join(sorted(unknown)))
    SOURCES.mkdir(parents=True, exist_ok=True)
    for item in items:
        if not args.ids or item["id"] in args.ids:
            fetch(item)


if __name__ == "__main__":
    main()

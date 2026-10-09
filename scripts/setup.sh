#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
node -e 'const [a,b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 19)) { console.error("Pi requires Node >=22.19.0"); process.exit(1); }'
npm ci --prefix "$project_root/tooling/pi" --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org/ --cache="$project_root/.local/npm-cache"
bash "$project_root/scripts/pi" --version

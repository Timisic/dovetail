---
name: verify-dovetail
description: Verify Dovetail's Pi CLI lifecycle and one-tool lesson using isolated RPC and Node behavioral tests after product changes.
---

## Launch

From the Dovetail repository, use Node >=22.19.0 and the installed Pi 1.1.0 in `tooling/pi`. If that installation is missing, run `bash scripts/setup.sh`. Do not install root dependencies.

Run `node test/verify.mjs`. In this checkout the helper launches `/workspace/dovetail/scripts/pi --offline --no-mcp --mode rpc --no-session --no-extensions --no-prompt-templates --no-themes --no-context-files --provider openai --model gpt-4.1 -e /workspace/dovetail --skill /workspace/dovetail/skills/dovetail`. It resolves the checkout path automatically elsewhere. It sets only PATH and an isolated PI_CODING_AGENT_DIR. It does not change HOME or use credentials. A successful `get_commands` response confirms readiness. The helper closes each child it starts.

## Doctor

Run `./scripts/pi --version`. Expect `1.1.0`. If RPC reports extension loading errors, inspect `.local/verification/rpc-transcript.json` before driving again.

## Drive

Run these commands from the repository:

```bash
mkdir -p .local/verification
node --test --test-reporter=tap test/*.test.mjs > .local/verification/tests.tap
node test/verify.mjs
```

Follow [the one-tool feature map](features/tool-call.md). The Node tests exercise actual learner code and the actual installed Pi extension loader. The RPC helper drives the real installed CLI. It sends only discovery, message inspection, and known `/dovetail` lifecycle commands. An acknowledged prompt alone is insufficient; the helper asserts visible messages, checkpoint files, preserved source, and absence of extension errors and model turns.

The loader tests invoke the registered context handler before and after a same-turn apply, checking fresh source/check facts, one valid hidden request-local teaching message, unchanged input and other messages, no teaching `sendMessage`, and removal while paused or invalid. This is loader-level context evidence; the CLI helper does not run a model turn or exercise the model request conversion.

## Evidence

Keep `.local/verification/tests.tap`, `rpc-transcript.json`, `rpc-checkpoint.json`, and `rpc-agent.mjs`. The transcript includes requests and responses. The helper saves the checkpoint and learner source before removing temporary workspace state. Tests prove tool invocation, arguments, expected versus actual failure, snippet application, syntax feedback, answer assistance, pause/resume, stale edits, cancellation, timeout, and sentinel preservation.

Retain `review-before.tap` and `review-after.tap` from the prior review and `hash-after.tap` from source comparison verification. Version 1 checkpoints are validated before read-only in-memory migration to version 2; the old check is cleared while active/paused mode, assistance and source bytes survive. Resume records a genuine executed snapshot. Malformed legacy/new and unknown-version checkpoints remain errors without resetting files. A same-length editor change with restored timestamps is rejected and marks the saved check stale; an edit during execution stays stale across a disk-only restart. Storage regressions preserve legacy `.tmp` files and abandoned stages through successful saves and retry. Actual child-process preloads pause filesystem operations for SIGKILL before initial publication and after root visibility. Another preload holds the source staging write until a real filesystem watcher has written an external edit; apply must then reject, preserve editor bytes and checkpoint, clean its owned stage, and allow retry. These checks do not prove strict cross-process compare-and-swap or power-loss durability.

This proof does not measure teaching quality or drive an interactive TUI or Mac. Choosing model metadata for offline CLI startup is not a model request. Check the transcript for `agent_start` and `extension_error`; neither is allowed. Do not add ordinary chat prompts to this verifier.

## Cleanup

The helper stops only its recorded child and removes only its generated temporary directory in `finally`, including failed runs. It preserves evidence. Node tests remove their own temporary directories. Do not remove `.local/verification`. Confirm the four evidence files remain after the helper exits. Never drive two Pi processes in the same learner workspace.

## Helpers

`test/verify.mjs` is executable. Run `./test/verify.mjs` or `node test/verify.mjs`. It uses Node built-ins and the installed repository CLI. `npm test` and `npm run verify` invoke the same checks without installing anything. Maintain this map when command behavior changes; `/maintain-verification-skill` is the upstream maintenance workflow when available.

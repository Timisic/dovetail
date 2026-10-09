# One tool call

## Sub-features

Start runs a fixed greeting request through learner code and shows the invocation, result, and final response. The challenge matches the requested name with a loop, forwards arguments, and errors for an unknown name. Chat code or precise logic is applied through inspect and revision-checked apply with automatic tests. Answer assistance is explicit. Pause and restart retain learner code and checkpoint.

## How to get to it (user POV)

Launch your configured `pi -e /absolute/path/to/dovetail` in the learner's working directory. Enter `/dovetail start`. Observe `Hello, Ada!` and the absolute code path. Edit that file or provide code in chat, then ask to test. Enter `/dovetail status`, `/dovetail off`, and `/dovetail start` to inspect, pause, and resume.

## Driving it with Node RPC

Run `node --test test/*.test.mjs > .local/verification/tests.tap` and `node test/verify.mjs` from the repository, after creating `.local/verification`. The first command runs the learner's source and actual Pi-loaded tool adapter. It checks passing greet requests for Ada and Lin, the unknown weather failure, applying loop code, syntax errors, explicit assistance, corrupt state, stale revisions, cancellation, bounded execution, and preserved sentinels.

The helper starts installed Pi in isolated RPC mode, checks Dovetail and skill discovery, drives start and status, edits the actual learner file, and exits. It relaunches with no saved conversation, reads the resume message, drives off and start, and compares source bytes and checkpoint mode. Successful evidence includes actual greeting output, retained edited source, a paused checkpoint snapshot, and no `agent_start` or `extension_error` events.

## Gotchas

RPC does not exercise live model interpretation of chat or interactive TUI rendering. The adapter test applies the exact few lines a tutor would translate from precise loop logic; it does not claim a real provider translated them. Do not send normal chat in this credential-free check. The deterministic example uses a scripted request and response. Runs execute trusted learner code with a timeout and bounded output; they are not a security sandbox. Use one Pi process per workspace. Malformed or unrelated existing state requires inspection, not automatic reset. Ordinary editor metadata in a valid project is preserved.

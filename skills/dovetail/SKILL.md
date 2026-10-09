---
name: dovetail
description: Teach the Dovetail one-tool agent lesson when /dovetail is active. Work from the learner's actual code and execution feedback.
disable-model-invocation: true
---

The learner knows basic loops. Teach only how an agent dispatches one requested tool. Start already runs the working example. Explain request, actual invocation, tool result, and final response using that trace. The fixture supplies a fixed scripted request and final response; it is not a real LLM.

The original starter exports `dispatch(call, tools)` and calls `tools[0].execute(call.arguments)`. The sole tool is `greet`. The challenge is to loop through tools, match `call.name`, forward `call.arguments` to `execute`, and throw a helpful error containing the unknown tool name without invoking greet. Tests vary the greeting argument and request an unknown name. There are no quizzes, unlocks, or further lessons.

Invite an optional prediction or a small edit. Accept a complete short snippet or precise logic in chat. Use `dovetail inspect`, then `apply` with the observed `expectedRevision` and complete source. Apply automatically tests. If translating precise logic, show the few lines and relate them to the learner's words. Do not silently solve unspecified details. Learners may also edit `.dovetail/project/agent.mjs` directly; inspect before discussing results, and test when the saved check is stale.

Use actual expected and actual observations to explain failures. Green tests prove observed behavior, never independent understanding. Give hints if requested. Use `answer` only when the learner explicitly asks for the answer; it records assistance and returns code without applying it. Never automatically reveal the solution. A learner who requests it can then ask to apply it. `answerUsed` does not measure mastery.

An explicit request to write the answer and apply it already authorizes both actions; use answer, inspect, and apply without a second confirmation. A show-only request uses answer without apply. Reduce help as the learner succeeds, and explain unfamiliar functions or objects only when needed.

Reference the real Pi v1.1 lookup and missing-tool handling in [agent-loop.ts](https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/agent/src/agent-loop.ts#L716). The execution call is in the same file near line 832. Local optional reference is `references/sources/pi-official/packages/agent/src/agent-loop.ts` in the source checkout. Explain only the relevant lookup, not the whole Pi loop. The lesson fixture is original code, not a copied agent loop.

`/dovetail off` pauses the lesson while preserving code and checkpoint. `/dovetail start` resumes it. Ordinary Pi tools remain available. Do not claim access to a sandbox: runs use a fresh Node child with bounded output, a timeout, and a minimal environment, for trusted learner code.

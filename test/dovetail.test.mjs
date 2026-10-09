import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Dovetail } from '../src/dovetail.mjs';
import { loadExtensions } from '../tooling/pi/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';

const solution = 'export async function dispatch(call, tools) {\n  for (const tool of tools) {\n    if (tool.name === call.name) return tool.execute(call.arguments);\n  }\n  throw new Error(`Unknown tool: ${call.name}`);\n}\n';
async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'dovetail-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return { cwd, owner: new Dovetail(cwd), agent: join(cwd, '.dovetail/project/agent.mjs'), state: join(cwd, '.dovetail/project/checkpoint.json') };
}

test('working example, actionable failed challenge, learner code and stale editor conflict', async t => {
  const { owner, agent } = await workspace(t);
  assert.equal(await owner.perform('status'), null);
  const started = await owner.perform('start');
  assert.deepEqual(started.example.observations[0].actual, { invocations: [{ name: 'greet', arguments: { name: 'Ada' } }], result: 'Hello, Ada!' });
  const failed = await owner.perform('test');
  assert.equal(failed.result.passed, false);
  assert.deepEqual(failed.result.observations[2].expected, { invocations: [], error: 'an error mentioning weather' });
  assert.deepEqual(failed.result.observations[2].actual, { invocations: [{ name: 'greet', arguments: { name: 'Ada' } }], result: 'Hello, Ada!' });
  const applied = await owner.perform('apply', { expectedRevision: failed.revision, source: solution });
  assert.equal(applied.result.passed, true);
  assert.equal((await owner.perform('start')).state.lastCheck.kind, 'test');
  assert.deepEqual(applied.result.observations[1].actual, { invocations: [{ name: 'greet', arguments: { name: 'Lin' } }], result: 'Hello, Lin!' });
  assert.deepEqual(applied.result.observations[2].actual, { invocations: [], error: 'Unknown tool: weather' });
  await writeFile(agent, solution + '\n');
  assert.equal((await owner.perform('inspect')).checkedCurrentSource, false);
  await assert.rejects(owner.perform('apply', { expectedRevision: applied.revision, source: 'broken' }), /Source changed/);
  assert.equal(await readFile(agent, 'utf8'), solution + '\n');
});

test('syntax feedback, explicit answer, repeated entry and disk-only resume', async t => {
  const { cwd, owner, agent } = await workspace(t);
  const started = await owner.perform('start');
  const syntax = await owner.perform('apply', { expectedRevision: started.revision, source: 'export function dispatch( {' });
  assert.equal(syntax.result.passed, false);
  assert.match(syntax.result.error, /SyntaxError/);
  const answer = await owner.perform('answer');
  assert.equal(answer.state.answerUsed, true);
  assert.match(answer.answer, /Unknown tool:/);
  assert.equal(await readFile(agent, 'utf8'), 'export function dispatch( {');
  await owner.perform('start');
  const resumed = await new Dovetail(cwd).perform('inspect');
  assert.equal(resumed.source, 'export function dispatch( {');
  assert.equal(resumed.state.answerUsed, true);
  await writeFile(join(cwd, '.dovetail/project/.DS_Store'), 'keep');
  const fixed = await owner.perform('apply', { expectedRevision: resumed.revision, source: answer.answer });
  assert.equal(fixed.result.passed, true);
  assert.equal((await owner.perform('off')).state.mode, 'paused');
  await assert.rejects(owner.perform('test'), /paused/);
  assert.equal((await new Dovetail(cwd).perform('start')).source, answer.answer);
  assert.equal(await readFile(join(cwd, '.dovetail/project/.DS_Store'), 'utf8'), 'keep');
});

test('hardcoded response fails actual invocation checks; execution is bounded', async t => {
  const { owner } = await workspace(t);
  let view = await owner.perform('start');
  view = await owner.perform('apply', { expectedRevision: view.revision, source: "export function dispatch() { return 'Hello, Ada!'; }" });
  assert.equal(view.result.passed, false);
  assert.deepEqual(view.result.observations[0].actual, { invocations: [], result: 'Hello, Ada!' });
  view = await owner.perform('apply', { expectedRevision: view.revision, source: 'export function dispatch() { while (true) {} }' });
  assert.equal(view.result.error, 'Execution timed out after 2 seconds.');
  view = await owner.perform('apply', { expectedRevision: view.revision, source: 'export function dispatch() { while (true) console.log("x".repeat(20000)); }' });
  assert.equal(view.result.error, 'Execution exceeded the output limit.');
});

test('corrupt state and unrelated or symlinked directories preserve sentinels', async t => {
  const { cwd, owner, state } = await workspace(t);
  await owner.perform('start');
  await writeFile(state, '{broken');
  await assert.rejects(new Dovetail(cwd).perform('start'), /not reset/);
  assert.equal(await readFile(state, 'utf8'), '{broken');
  await writeFile(state, 'null');
  await assert.rejects(owner.perform('status'), /not reset/);
  assert.equal(await readFile(state, 'utf8'), 'null');
  for (const kind of ['unrelated', 'directory-link', 'file-link']) {
    const isolated = await workspace(t);
    const target = join(isolated.cwd, 'sentinel');
    await writeFile(target, 'keep');
    if (kind === 'directory-link') await symlink(isolated.cwd, join(isolated.cwd, '.dovetail'));
    else if (kind === 'unrelated') { await mkdir(join(isolated.cwd, '.dovetail')); await writeFile(join(isolated.cwd, '.dovetail/notes'), 'keep'); }
    else { await isolated.owner.perform('start'); await rm(isolated.agent); await symlink(target, isolated.agent); }
    await assert.rejects(isolated.owner.perform('start'), /invalid/);
    assert.equal(await readFile(target, 'utf8'), 'keep');
    if (kind === 'unrelated') assert.equal(await readFile(join(isolated.cwd, '.dovetail/notes'), 'utf8'), 'keep');
  }
});

test('actual Pi loader adapter applies precise loop logic and pauses only its own tool/context', async t => {
  const { cwd } = await workspace(t);
  const loaded = await loadExtensions([fileURLToPath(new URL('../extension.ts', import.meta.url))], cwd);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  let active = ['read', 'bash'];
  const messages = [];
  loaded.runtime.getActiveTools = () => active;
  loaded.runtime.setActiveTools = value => { active = value; };
  loaded.runtime.sendMessage = (message, options) => messages.push({ message, options });
  const ctx = { cwd };
  const event = name => extension.handlers.get(name)[0]({}, ctx);
  const command = argument => extension.commands.get('dovetail').handler(argument, ctx);
  const invoke = args => extension.tools.get('dovetail').definition.execute('local-verification', args, undefined, undefined, ctx);
  await event('session_start');
  assert.deepEqual(active, ['read', 'bash']);
  assert.equal(await new Dovetail(cwd).perform('status'), null);
  await command('start');
  assert.deepEqual(active, ['read', 'bash', 'dovetail']);
  const inspected = await invoke({ action: 'inspect' });
  const applied = await invoke({ action: 'apply', expectedRevision: inspected.details.revision, source: solution });
  assert.equal(applied.details.result.passed, true);
  assert.equal(applied.details.state.answerUsed, false);
  const context = await event('before_agent_start');
  assert.equal(context.message.display, false);
  const facts = JSON.parse(context.message.content.split('Current facts:\n')[1]);
  assert.equal(facts.source, solution);
  assert.equal(facts.state.lastCheck.passed, true);
  const user = { role: 'user', content: 'test my loop', timestamp: 1 };
  const old = { role: 'custom', customType: 'dovetail-teaching', content: 'old facts', display: false, timestamp: 2 };
  const current = { role: 'custom', ...context.message, timestamp: 3 };
  const conversation = { messages: [old, user, current] };
  const filter = () => extension.handlers.get('context')[0](conversation, ctx);
  assert.deepEqual((await filter()).messages, [user, current]);
  await command('off');
  assert.deepEqual(active, ['read', 'bash']);
  assert.equal(await event('before_agent_start'), undefined);
  assert.deepEqual((await filter()).messages, [user]);
  assert.equal((await new Dovetail(cwd).perform('status')).state.mode, 'paused');
  assert.equal(messages.at(-1).message.display, true);
  assert.deepEqual(messages.at(-1).options, { triggerTurn: false });
  const other = await workspace(t);
  await writeFile(join(other.cwd, 'sentinel'), 'keep');
  await extension.commands.get('dovetail').handler('start', { cwd: other.cwd });
  assert.match(messages.at(-1).message.content, /Workspace changed/);
  assert.equal(await readFile(join(other.cwd, 'sentinel'), 'utf8'), 'keep');
  assert.equal(await other.owner.perform('status'), null);
});

test('cancellation stops learner code, and editing during a run reports a stale observation', async t => {
  const { owner, agent } = await workspace(t);
  let view = await owner.perform('start');
  const slow = 'export async function dispatch(call, tools) { await new Promise(r => setTimeout(r, 400)); return tools[0].execute(call.arguments); }';
  view = await owner.perform('apply', { expectedRevision: view.revision, source: slow });
  const controller = new AbortController();
  const cancelled = owner.perform('run', {}, controller.signal);
  const abort = setTimeout(() => controller.abort(), 100);
  assert.equal((await cancelled).result.error, 'Execution cancelled.');
  clearTimeout(abort);
  const running = owner.perform('run');
  const edit = setTimeout(() => { void writeFile(agent, solution); }, 100);
  const observed = await running;
  clearTimeout(edit);
  assert.equal(observed.result.passed, true);
  assert.equal(observed.source, solution);
  assert.equal(observed.checkedCurrentSource, false);
});

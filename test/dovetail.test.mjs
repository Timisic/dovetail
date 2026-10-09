import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, symlink, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { watch, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
  assert.equal(started.state.version, 2);
  assert.equal(Object.hasOwn(started, 'revision'), false);
  assert.deepEqual(started.example.observations[0].actual, { invocations: [{ name: 'greet', arguments: { name: 'Ada' } }], result: 'Hello, Ada!' });
  const failed = await owner.perform('test');
  assert.equal(failed.result.passed, false);
  assert.deepEqual(failed.result.observations[2].expected, { invocations: [], error: 'an error mentioning weather' });
  assert.deepEqual(failed.result.observations[2].actual, { invocations: [{ name: 'greet', arguments: { name: 'Ada' } }], result: 'Hello, Ada!' });
  const applied = await owner.perform('apply', { expectedSource: failed.source, source: solution });
  assert.equal(applied.result.passed, true);
  assert.deepEqual((await owner.perform('start')).state.lastCheck, applied.state.lastCheck);
  assert.deepEqual(applied.result.observations[1].actual, { invocations: [{ name: 'greet', arguments: { name: 'Lin' } }], result: 'Hello, Lin!' });
  assert.deepEqual(applied.result.observations[2].actual, { invocations: [], error: 'Unknown tool: weather' });
  await utimes(agent, 1700000000, 1700000000);
  const metadata = await stat(agent);
  const edited = solution.replace('Unknown', 'Missing');
  await writeFile(agent, edited);
  await utimes(agent, metadata.atime, metadata.mtime);
  const afterEdit = await stat(agent);
  assert.equal(afterEdit.size, metadata.size);
  assert.equal(afterEdit.ino, metadata.ino);
  assert.equal(afterEdit.mtimeMs, metadata.mtimeMs);
  assert.equal((await owner.perform('inspect')).checkedCurrentSource, false);
  await assert.rejects(owner.perform('apply', { expectedSource: applied.source, source: 'broken' }), /Source changed/);
  assert.equal(await readFile(agent, 'utf8'), edited);
});

test('syntax feedback, explicit answer, repeated entry and disk-only resume', async t => {
  const { cwd, owner, agent } = await workspace(t);
  const started = await owner.perform('start');
  const syntax = await owner.perform('apply', { expectedSource: started.source, source: 'export function dispatch( {' });
  assert.equal(syntax.result.passed, false);
  assert.match(syntax.result.error, /SyntaxError/);
  const answer = await owner.perform('answer');
  assert.equal(answer.state.answerUsed, true);
  assert.match(answer.answer, /Unknown tool:/);
  assert.equal(await readFile(agent, 'utf8'), 'export function dispatch( {');
  const restarted = await owner.perform('start');
  assert.equal(restarted.example.passed, false);
  assert.match(restarted.example.error, /SyntaxError/);
  const resumed = await new Dovetail(cwd).perform('inspect');
  assert.equal(resumed.source, 'export function dispatch( {');
  assert.equal(resumed.state.answerUsed, true);
  await writeFile(join(cwd, '.dovetail/project/.DS_Store'), 'keep');
  const fixed = await owner.perform('apply', { expectedSource: resumed.source, source: answer.answer });
  assert.equal(fixed.result.passed, true);
  assert.equal((await owner.perform('off')).state.mode, 'paused');
  await assert.rejects(owner.perform('test'), /paused/);
  assert.equal((await new Dovetail(cwd).perform('start')).source, answer.answer);
  assert.equal(await readFile(join(cwd, '.dovetail/project/.DS_Store'), 'utf8'), 'keep');
});

test('hardcoded response fails actual invocation checks; execution is bounded', async t => {
  const { owner } = await workspace(t);
  let view = await owner.perform('start');
  view = await owner.perform('apply', { expectedSource: view.source, source: "export function dispatch() { return 'Hello, Ada!'; }" });
  assert.equal(view.result.passed, false);
  assert.deepEqual(view.result.observations[0].actual, { invocations: [], result: 'Hello, Ada!' });
  view = await owner.perform('apply', { expectedSource: view.source, source: 'export function dispatch() { while (true) {} }' });
  assert.equal(view.result.error, 'Execution timed out after 2 seconds.');
  view = await owner.perform('apply', { expectedSource: view.source, source: 'export function dispatch() { while (true) console.log("x".repeat(20000)); }' });
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

test('valid legacy checkpoints migrate in memory and preserve mode, assistance and source bytes', async t => {
  for (const mode of ['paused', 'active']) {
    const { cwd, owner, agent, state } = await workspace(t);
    await owner.perform('start');
    const bytes = Buffer.from(solution.replaceAll('\n', '\r\n') + ' \r\n');
    await writeFile(agent, bytes);
    const legacy = JSON.stringify({ version: 1, lesson: 'tool-call', mode, answerUsed: true,
      lastCheck: { hash: 'a'.repeat(64), passed: true, kind: 'test' } });
    await writeFile(state, legacy);
    const migrated = { version: 2, lesson: 'tool-call', mode, answerUsed: true, lastCheck: null };
    for (const action of ['status', 'inspect']) {
      const view = await new Dovetail(cwd).perform(action);
      assert.deepEqual(view.state, migrated);
      assert.equal(view.source, bytes.toString());
      assert.equal(view.checkedCurrentSource, false);
      assert.equal(await readFile(state, 'utf8'), legacy, 'read-only migration does not publish');
      assert.deepEqual(await readFile(agent), bytes);
    }
    const resumed = await new Dovetail(cwd).perform('start');
    assert.equal(resumed.example.passed, true);
    assert.deepEqual(resumed.state, { ...migrated, mode: 'active',
      lastCheck: { source: bytes.toString(), passed: true, kind: 'run' } });
    assert.deepEqual(JSON.parse(await readFile(state, 'utf8')), resumed.state);
    assert.deepEqual(await readFile(agent), bytes);
  }
});

test('malformed legacy and new checkpoints and unknown versions fail without resetting files', async t => {
  const { cwd, owner, agent, state } = await workspace(t);
  const started = await owner.perform('start');
  const source = await readFile(agent);
  const base = { lesson: 'tool-call', mode: 'active', answerUsed: false };
  const check = { passed: true, kind: 'test' };
  for (const invalid of [
    { ...base, version: 1, lastCheck: { ...check, hash: 'bad' } },
    { ...base, version: 1, lastCheck: { ...check, hash: ['a'.repeat(64)] } },
    { ...base, version: 2, lastCheck: { ...check, hash: 'a'.repeat(64) } },
    { ...base, version: 2, lastCheck: { ...check, source: started.source, passed: 'true' } },
    { ...base, version: 3, lastCheck: null },
  ]) {
    const checkpoint = JSON.stringify(invalid);
    await writeFile(state, checkpoint);
    await assert.rejects(new Dovetail(cwd).perform('start'), /not reset/);
    assert.equal(await readFile(state, 'utf8'), checkpoint);
    assert.deepEqual(await readFile(agent), source);
  }
});

test('actual Pi loader projects fresh same-turn facts once and pauses only its own tool/context', async t => {
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
  const user = { role: 'user', content: 'test my loop', timestamp: 1 };
  const unrelated = { role: 'custom', customType: 'other-extension', content: 'keep', display: false, timestamp: 2 };
  const turnStart = extension.handlers.get('before_agent_start')?.[0];
  const oldContent = turnStart ? (await turnStart({}, ctx)).message.content : 'old facts';
  const old = { role: 'custom', customType: 'dovetail-teaching', content: oldContent, display: false, timestamp: 3 };
  const conversation = { messages: [old, user, unrelated, { ...old, timestamp: 4 }] };
  const context = messages => extension.handlers.get('context')[0]({ messages }, ctx);
  const first = await context(conversation.messages);
  assert.deepEqual(first.messages.slice(0, -1), [user, unrelated]);
  assert.equal(first.messages.at(-1).role, 'custom');
  assert.equal(first.messages.at(-1).customType, 'dovetail-teaching');
  assert.equal(first.messages.at(-1).display, false);
  assert.equal(typeof first.messages.at(-1).timestamp, 'number');
  const starterFacts = JSON.parse(first.messages.at(-1).content.split('Current facts:\n')[1]);
  assert.notEqual(starterFacts.source, solution);
  const inspected = await invoke({ action: 'inspect' });
  const applied = await invoke({ action: 'apply', expectedSource: inspected.details.source, source: solution });
  assert.equal(applied.details.result.passed, true);
  assert.equal(applied.details.state.answerUsed, false);
  const visibleCount = messages.length;
  const updated = await context(first.messages);
  assert.deepEqual(updated.messages.slice(0, -1), [user, unrelated]);
  assert.equal(updated.messages.filter(message => message.customType === 'dovetail-teaching').length, 1);
  const skill = await readFile(new URL('../skills/dovetail/SKILL.md', import.meta.url), 'utf8');
  assert.equal(updated.messages.at(-1).content.split('\nCurrent facts:\n')[0], skill);
  const facts = JSON.parse(updated.messages.at(-1).content.split('Current facts:\n')[1]);
  assert.equal(facts.source, solution);
  assert.equal(facts.state.lastCheck.source, applied.details.source);
  assert.equal(Object.hasOwn(facts, 'revision'), false);
  assert.equal(facts.state.lastCheck.passed, true);
  assert.equal(facts.checkedCurrentSource, true);
  assert.equal(extension.handlers.has('before_agent_start'), false);
  assert.equal(messages.length, visibleCount, 'request context is not sent to session history');
  assert.deepEqual(conversation.messages, [old, user, unrelated, { ...old, timestamp: 4 }]);
  assert.notEqual(first.messages.at(-1).content, updated.messages.at(-1).content);
  await command('off');
  assert.deepEqual(active, ['read', 'bash']);
  assert.deepEqual((await context(updated.messages)).messages, [user, unrelated]);
  assert.equal((await new Dovetail(cwd).perform('status')).state.mode, 'paused');
  assert.equal(messages.at(-1).message.display, true);
  assert.deepEqual(messages.at(-1).options, { triggerTurn: false });
  const other = await workspace(t);
  await writeFile(join(other.cwd, 'sentinel'), 'keep');
  await extension.commands.get('dovetail').handler('start', { cwd: other.cwd });
  assert.match(messages.at(-1).message.content, /Workspace changed/);
  assert.equal(await readFile(join(other.cwd, 'sentinel'), 'utf8'), 'keep');
  assert.equal(await other.owner.perform('status'), null);
  await writeFile(join(cwd, '.dovetail/project/agent.mjs'), 'export function dispatch( {');
  await command('start');
  assert.match(messages.at(-1).message.content, /SyntaxError/);
  assert.equal(await readFile(join(cwd, '.dovetail/project/agent.mjs'), 'utf8'), 'export function dispatch( {');
  await writeFile(join(cwd, '.dovetail/project/checkpoint.json'), '{invalid');
  assert.deepEqual((await context(updated.messages)).messages, [user, unrelated]);
  assert.deepEqual(active, ['read', 'bash']);
  assert.match(messages.at(-1).message.content, /not reset/);
});

test('cancellation stops learner code, and editing during a run reports a stale observation', async t => {
  const { cwd, owner, agent, state } = await workspace(t);
  let view = await owner.perform('start');
  const slow = 'export async function dispatch(call, tools) { await new Promise(r => setTimeout(r, 400)); return tools[0].execute(call.arguments); }';
  view = await owner.perform('apply', { expectedSource: view.source, source: slow });
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
  assert.equal(observed.state.lastCheck.source, slow);
  assert.equal(JSON.parse(await readFile(state, 'utf8')).lastCheck.source, slow);
  const restarted = await new Dovetail(cwd).perform('inspect');
  assert.equal(restarted.source, solution);
  assert.equal(restarted.state.lastCheck.source, slow);
  assert.equal(restarted.checkedCurrentSource, false);
});

test('legacy temporary sentinels and abandoned stages do not block saves or retries', async t => {
  const { cwd, owner, agent, state } = await workspace(t);
  const started = await owner.perform('start');
  await writeFile(state + '.tmp', 'old checkpoint temporary');
  await writeFile(agent + '.tmp', 'old source temporary');
  const abandoned = join(cwd, '.dovetail/project/agent.mjs.tmp-abandoned');
  await mkdir(abandoned);
  await writeFile(join(abandoned, 'payload'), 'abandoned source');
  assert.equal((await owner.perform('off')).state.mode, 'paused');
  await new Dovetail(cwd).perform('start');
  const applied = await owner.perform('apply', { expectedSource: started.source, source: solution });
  assert.equal(applied.result.passed, true);
  assert.equal((await owner.perform('answer')).state.answerUsed, true);
  assert.equal((await owner.perform('run')).result.passed, true);
  assert.equal((await owner.perform('test')).result.passed, true);
  assert.equal((await new Dovetail(cwd).perform('inspect')).source, solution);
  assert.equal(await readFile(state + '.tmp', 'utf8'), 'old checkpoint temporary');
  assert.equal(await readFile(agent + '.tmp', 'utf8'), 'old source temporary');
  assert.equal(await readFile(join(abandoned, 'payload'), 'utf8'), 'abandoned source');
});

test('a source-stage creation editor write is rejected without changing its source or checkpoint', async t => {
  const { cwd, owner, agent, state } = await workspace(t);
  const started = await owner.perform('start');
  const checkpoint = await readFile(state, 'utf8');
  const edited = 'export function dispatch() { return "external editor change"; }';
  const preload = join(cwd, 'preload.mjs');
  await writeFile(preload, `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const agent = ${JSON.stringify(agent)};
const write = fs.writeFile;
fs.writeFile = async (path, ...args) => {
  const result = await write(path, ...args);
  if (String(path) === agent + '.tmp' || (String(path).startsWith(agent + '.tmp-') && String(path).endsWith('/payload'))) {
    process.send({ type: 'staged' });
    await new Promise(resolve => process.once('message', resolve));
  }
  return result;
};
syncBuiltinESMExports();
`);
  let sawEdit = false;
  let watcher;
  const editorWrite = new Promise(resolve => {
    watcher = watch(join(agent, '..'), (event, name) => {
      if (event === 'rename' && (name === 'agent.mjs.tmp' || name?.startsWith('agent.mjs.tmp-')) && !sawEdit) {
        writeFileSync(agent, edited);
        sawEdit = true;
        resolve();
      }
    });
  });
  const child = spawn(process.execPath, ['--import', preload, '--input-type=module', '-e', `
import { Dovetail } from ${JSON.stringify(fileURLToPath(new URL('../src/dovetail.mjs', import.meta.url)))};
try {
  await new Dovetail(${JSON.stringify(cwd)}).perform('apply', ${JSON.stringify({ expectedSource: started.source, source: solution })});
  process.send({ type: 'applied' });
} catch (error) { process.send({ type: 'rejected', error: error.message }); }
process.disconnect();
`], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const closed = once(child, 'close');
  let errors = '';
  child.stderr.on('data', bytes => { errors += bytes; });
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Source staging instrumentation timed out')), 5000); });
  t.after(() => { clearTimeout(timer); watcher.close(); child.kill('SIGKILL'); });
  const [[staged]] = await Promise.race([Promise.all([once(child, 'message'), editorWrite]), deadline]);
  assert.equal(staged.type, 'staged');
  assert.equal(sawEdit, true, 'actual filesystem watcher edited on staging creation');
  assert.equal(await readFile(agent, 'utf8'), edited);
  const outcome = once(child, 'message');
  child.send('resume');
  const [result] = await Promise.race([outcome, deadline]);
  await closed;
  clearTimeout(timer);
  watcher.close();
  assert.equal(errors, '');
  assert.equal(result.type, 'rejected');
  assert.match(result.error, /Source changed/);
  assert.equal(await readFile(agent, 'utf8'), edited);
  assert.equal(await readFile(state, 'utf8'), checkpoint);
  assert.deepEqual((await readdir(join(agent, '..'))).filter(name => name.startsWith('agent.mjs.tmp-')), []);
  const retry = await owner.perform('apply', { expectedSource: (await owner.perform('inspect')).source, source: solution });
  assert.equal(retry.result.passed, true);
});

test('killed bootstrap leaves either no published root or a complete restartable project', async t => {
  for (const point of ['staged-source', 'published-root']) {
    await t.test(point, async t => {
      const { cwd, owner, agent } = await workspace(t);
      const marker = join(cwd, 'interrupted');
      const preload = join(cwd, 'preload.mjs');
      await writeFile(preload, `
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const point = ${JSON.stringify(point)};
const marker = ${JSON.stringify(marker)};
const root = ${JSON.stringify(join(cwd, '.dovetail'))};
const pause = async () => { writeFileSync(marker, 'ready'); await new Promise(() => {}); };
const write = fs.writeFile;
fs.writeFile = async (path, ...args) => {
  const result = await write(path, ...args);
  if (point === 'staged-source' && String(path).endsWith('/agent.mjs')) await pause();
  return result;
};
for (const name of ['mkdir', 'rename']) {
  const operation = fs[name];
  fs[name] = async (...args) => {
    const result = await operation(...args);
    if (point === 'published-root' && String(args[name === 'rename' ? 1 : 0]) === root) await pause();
    return result;
  };
}
syncBuiltinESMExports();
setInterval(() => {}, 1000);
`);
      let child;
      let ready;
      const waiting = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Bootstrap instrumentation did not reach ' + point)), 5000);
        ready = watch(cwd, (_event, name) => {
          if (name === 'interrupted') { clearTimeout(timer); resolve(); }
        });
        t.after(() => clearTimeout(timer));
      });
      t.after(() => { ready.close(); child?.kill('SIGKILL'); });
      child = spawn(process.execPath, ['--import', preload, '--input-type=module', '-e',
        `import { Dovetail } from ${JSON.stringify(fileURLToPath(new URL('../src/dovetail.mjs', import.meta.url)))}; await new Dovetail(${JSON.stringify(cwd)}).perform('start');`], { stdio: ['ignore', 'ignore', 'pipe'] });
      let errors = '';
      child.stderr.on('data', bytes => { errors += bytes; });
      await waiting;
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
      ready.close();
      assert.equal(errors, '');
      if (point === 'staged-source') {
        assert.equal(await owner.perform('status'), null, 'partial stage was never published');
      } else {
        const published = await owner.perform('inspect');
        assert.equal(published.state.mode, 'active');
        assert.equal(published.state.lastCheck, null);
        assert.match(published.source, /export.*dispatch/);
      }
      const restarted = await new Dovetail(cwd).perform('start');
      assert.equal(restarted.example.passed, true);
      assert.equal(await readFile(agent, 'utf8'), restarted.source);
    });
  }
});

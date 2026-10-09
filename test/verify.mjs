#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'dovetail rpc-'));
const evidence = join(root, '.local/verification');
await mkdir(evidence, { recursive: true });
const transcript = [];
let child;
async function launch() {
  child = spawn(join(root, 'scripts/pi'), ['--offline', '--no-mcp', '--mode', 'rpc', '--no-session', '--no-extensions', '--no-prompt-templates', '--no-themes', '--no-context-files', '--provider', 'openai', '--model', 'gpt-4.1', '-e', root, '--skill', join(root, 'skills/dovetail')], {
    cwd: scratch, env: { PATH: process.env.PATH, PI_CODING_AGENT_DIR: join(scratch, 'config') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let index = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    transcript.push({ output: line });
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'response' && pending.has(event.id)) pending.get(event.id)(event);
  });
  child.stderr.on('data', bytes => transcript.push({ stderr: String(bytes) }));
  child.on('error', error => transcript.push({ processError: error.message }));
  return command => new Promise((resolve, reject) => {
    const id = `verify-${++index}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timed out: ${command.type}`)); }, 15000);
    pending.set(id, event => { clearTimeout(timer); pending.delete(id); event.success ? resolve(event) : reject(new Error(JSON.stringify(event))); });
    const record = { id, ...command };
    transcript.push({ input: record });
    child.stdin.write(JSON.stringify(record) + '\n');
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGTERM');
  await stopped;
}
try {
  let rpc = await launch();
  const commands = await rpc({ type: 'get_commands' });
  assert(commands.data.commands.some(command => command.name === 'dovetail'), 'Dovetail command loaded');
  assert(commands.data.commands.some(command => command.name === 'skill:dovetail'), 'Teaching skill discovered');
  await assert.rejects(readFile(join(scratch, '.dovetail/project/agent.mjs')), { code: 'ENOENT' });
  await rpc({ type: 'prompt', message: '/dovetail start' });
  let messages = await rpc({ type: 'get_messages' });
  assert.match(JSON.stringify(messages.data), /Hello, Ada!/);
  await rpc({ type: 'prompt', message: '/dovetail status' });
  const agent = join(scratch, '.dovetail/project/agent.mjs');
  const edited = (await readFile(agent, 'utf8')) + '\n';
  await writeFile(agent, edited);
  await stop();
  rpc = await launch();
  await rpc({ type: 'get_commands' });
  assert.equal(await readFile(agent, 'utf8'), edited, 'No-session restart preserves learner code');
  messages = await rpc({ type: 'get_messages' });
  assert.match(JSON.stringify(messages.data), /已从文件恢复/);
  assert.match(JSON.stringify(messages.data), /代码已改变/);
  await rpc({ type: 'prompt', message: '/dovetail off' });
  const checkpoint = JSON.parse(await readFile(join(scratch, '.dovetail/project/checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.mode, 'paused');
  assert.equal(await readFile(agent, 'utf8'), edited);
  await rpc({ type: 'prompt', message: '/dovetail start' });
  assert.equal(JSON.parse(await readFile(join(scratch, '.dovetail/project/checkpoint.json'), 'utf8')).mode, 'active');
  assert.equal(await readFile(agent, 'utf8'), edited);
  const events = transcript.filter(item => item.output).map(item => { try { return JSON.parse(item.output); } catch { return {}; } });
  assert.deepEqual(events.filter(event => ['extension_error', 'agent_start'].includes(event.type)), []);
  assert(!transcript.some(item => item.stderr?.match(/failed to load|skill.*warning|error loading/i)), 'No loader diagnostics');
  await writeFile(join(evidence, 'rpc-checkpoint.json'), JSON.stringify(checkpoint, null, 2));
  await writeFile(join(evidence, 'rpc-agent.mjs'), edited);
  console.log('PASS actual Pi 1.1 RPC package/skill discovery, start/status/off, disk-only resume, no agent turn.');
} finally {
  await stop();
  await writeFile(join(evidence, 'rpc-transcript.json'), JSON.stringify(transcript, null, 2));
  await rm(scratch, { recursive: true, force: true });
  console.log(`Evidence retained at ${evidence}`);
}

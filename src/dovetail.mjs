import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = name => new URL(`../lesson/${name}.mjs`, import.meta.url);
const invalid = () => new Error('Dovetail data is incomplete or invalid. Inspect .dovetail before retrying; it was not reset.');
async function exists(path, directory = false) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw invalid();
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function atomic(path, value, beforePublish) {
  const stage = await mkdtemp(`${path}.tmp-`);
  try {
    const payload = join(stage, 'payload');
    await writeFile(payload, value, { flag: 'wx' });
    await beforePublish?.();
    await rename(payload, path);
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export class Dovetail {
  constructor(cwd) { this.cwd = realpath(cwd); this.queue = Promise.resolve(); }
  perform(action, args = {}, signal) {
    const operation = this.queue.then(() => this.operate(action, args, signal));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async load() {
    this.root = join(await this.cwd, '.dovetail');
    this.project = join(this.root, 'project');
    if (!await exists(this.root, true)) return null;
    if (!await exists(this.project, true)) throw invalid();
    this.agent = join(this.project, 'agent.mjs');
    this.checkpoint = join(this.project, 'checkpoint.json');
    if (!await exists(this.agent) || !await exists(this.checkpoint)) throw invalid();
    let state;
    try { state = JSON.parse(await readFile(this.checkpoint, 'utf8')); }
    catch { throw invalid(); }
    if (!state || typeof state !== 'object' || ![1, 2].includes(state.version) || state.lesson !== 'tool-call' || !['active', 'paused'].includes(state.mode)
      || typeof state.answerUsed !== 'boolean' || (state.lastCheck !== null &&
        (!state.lastCheck || (state.version === 1
          ? typeof state.lastCheck.hash !== 'string' || !/^[a-f0-9]{64}$/.test(state.lastCheck.hash)
          : typeof state.lastCheck.source !== 'string') || typeof state.lastCheck.passed !== 'boolean'
          || !['run', 'test'].includes(state.lastCheck.kind)))) throw invalid();
    if (state.version === 1) state = { ...state, version: 2, lastCheck: null };
    const source = await readFile(this.agent, 'utf8');
    return { state, source, checkedCurrentSource: state.lastCheck?.source === source };
  }
  async save(state) { await atomic(this.checkpoint, `${JSON.stringify(state, null, 2)}\n`); }
  async evaluate(source, kind, signal) {
    return new Promise(resolve => {
      const child = spawn(process.execPath, [fileURLToPath(fixture('runner')), kind], {
        cwd: this.project, env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', errors = '', failure;
      const cancel = () => { failure = 'Execution cancelled.'; child.kill('SIGKILL'); };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(() => { failure = 'Execution timed out after 2 seconds.'; child.kill('SIGKILL'); }, 2000);
      const collect = (target, bytes) => {
        if (target === 'out') output = (output + bytes).slice(0, 32769); else errors = (errors + bytes).slice(0, 32769);
        if (output.length + errors.length > 32768) { failure = 'Execution exceeded the output limit.'; child.kill('SIGKILL'); }
      };
      child.stdout.on('data', bytes => collect('out', bytes));
      child.stderr.on('data', bytes => collect('err', bytes));
      child.on('error', error => { failure = error.message; });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        let result;
        try { result = JSON.parse(output); } catch {}
        resolve(failure || code !== 0 || !result ? { passed: false, error: failure ?? `Runner exited ${code}: ${errors.slice(0, 1000) || output.slice(0, 1000)}`, observations: [] } : result);
      });
      child.stdin.end(source);
    });
  }
  async operate(action, args, signal) {
    if (signal?.aborted) throw new Error('Execution cancelled.');
    let view = await this.load();
    if (action === 'status' || action === 'inspect') return view;
    if (action === 'start') {
      if (!view) {
        const stage = await mkdtemp(join(await this.cwd, '.dovetail-init-'));
        try {
          const project = join(stage, 'project');
          await mkdir(project);
          await writeFile(join(project, 'agent.mjs'), await readFile(fixture('starter')), { flag: 'wx' });
          await writeFile(join(project, 'checkpoint.json'), JSON.stringify({ version: 2, lesson: 'tool-call', mode: 'active', lastCheck: null, answerUsed: false }), { flag: 'wx' });
          if (await exists(this.root, true)) throw invalid();
          await rename(stage, this.root);
        } finally { await rm(stage, { recursive: true, force: true }); }
        view = await this.load();
      }
      view.state.mode = 'active';
      await this.save(view.state);
      const example = await this.evaluate(view.source, 'run', signal);
      view.state.lastCheck ??= { source: view.source, passed: example.passed, kind: 'run' };
      await this.save(view.state);
      return { ...await this.load(), example };
    }
    if (!view) throw new Error('Start with /dovetail start.');
    if (action === 'off') { view.state.mode = 'paused'; await this.save(view.state); return view; }
    if (view.state.mode !== 'active') throw new Error('Dovetail is paused. Use /dovetail start to resume.');
    if (action === 'answer') {
      view.state.answerUsed = true;
      await this.save(view.state);
      return { ...view, answer: await readFile(fixture('answer'), 'utf8') };
    }
    if (action === 'apply') {
      if (args.expectedSource !== view.source) throw new Error('Source changed. Inspect again and apply using the source you read.');
      if (typeof args.source !== 'string' || args.source.length > 8000) throw new Error('Provide the complete short agent.mjs source (up to 8000 characters).');
      await atomic(this.agent, args.source, async () => {
        const current = await this.load();
        if (!current || args.expectedSource !== current.source) throw new Error('Source changed. Inspect again and apply using the source you read.');
        if (current.state.mode !== 'active') throw new Error('Dovetail is paused. Use /dovetail start to resume.');
      });
      view = await this.load();
    } else if (!['run', 'test'].includes(action)) throw new Error('Unknown Dovetail action.');
    const kind = action === 'run' ? 'run' : 'test';
    const result = await this.evaluate(view.source, kind, signal);
    view.state.lastCheck = { source: view.source, passed: result.passed, kind };
    await this.save(view.state);
    return { ...await this.load(), result };
  }
}

export function describe(view) {
  if (!view) return 'Dovetail has no project yet. Use /dovetail start.';
  return JSON.stringify(view, null, 2);
}

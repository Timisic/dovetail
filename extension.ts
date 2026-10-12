import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Dovetail, challengeSolved, describe } from './src/dovetail.mjs';

const comparison = '\n\nThe full check passed for the current source. Compare it with Pi v1.1 packages/agent/src/agent-loop.ts near line 716 and the execution near line 832: https://github.com/earendil-works/pi/blob/abe508e1b89912adde45528136c3221eb69acdd7/packages/agent/src/agent-loop.ts#L716 Pi looks up a tool and returns an error result when the lookup misses. Ask for a reflection in three parts: context, decision, and consequences. Record it with reflect.';

export default function (pi: ExtensionAPI) {
  let owner: Dovetail;
  const get = async (ctx: { cwd: string }) => {
    const cwd = await realpath(ctx.cwd);
    if (owner && await owner.cwd !== cwd) throw new Error('Workspace changed. Restart Pi in the intended workspace before using Dovetail.');
    return owner ??= new Dovetail(cwd);
  };
  const availability = (active: boolean) => {
    const tools = pi.getActiveTools();
    if (tools.includes('dovetail') !== active) pi.setActiveTools([
      ...tools.filter(name => name !== 'dovetail'), ...(active ? ['dovetail'] : [])]);
  };
  const visible = (content: string) => pi.sendMessage({ customType: 'dovetail', content, display: true }, { triggerTurn: false });
  const checkLabel = view => {
    const check = view.state.lastCheck;
    const stale = view.checkedCurrentSource ? '' : '，代码已改变，请重新测试';
    if (!check) return '未检查';
    if (check.kind !== 'test') return `已看演示，完整检查尚未通过${stale}`;
    return `完整检查 ${check.passed ? '通过' : '未通过'}${stale}`;
  };
  const summary = async (service: Dovetail, view) => !view ? '尚未开始。输入 /dovetail start。' :
    `Dovetail ${view.state.mode === 'active' ? '进行中' : '已暂停'}。\n代码文件：${join(await service.cwd, '.dovetail/project/agent.mjs')}\n最近检查：${checkLabel(view)}。${view.state.answerUsed ? '\n已查看过答案。' : ''}${view.state.reflection ? '\n已记录反思。' : ''}`;
  const traceOf = (title, report) => !report ? '' : `\n${title}：\n` + (report.observations ?? []).map(item =>
    `请求 ${item.request.name}(${JSON.stringify(item.request.arguments)})\n实际调用 ${JSON.stringify(item.actual.invocations)}\n工具结果 ${item.actual.error ?? item.actual.result}\n最终回复 ${item.finalResponse}`).join('\n')
    + (report.error ? `\n${report.error}` : '') + (report.stdout ? `\n标准输出 ${report.stdout}` : '') + (report.stderr ? `\n标准错误 ${report.stderr}` : '');

  pi.registerCommand('dovetail', {
    description: 'Start, inspect status, or pause the tool-call lesson',
    handler: async (args, ctx) => {
      try {
        const action = args.trim() || 'start';
        if (!['start', 'status', 'off'].includes(action)) throw new Error('Use /dovetail start|status|off.');
        const service = await get(ctx);
        const view = await service.perform(action);
        availability(view?.state.mode === 'active');
        const solved = challengeSolved(view);
        const trace = view?.result ? traceOf(view.result.passed ? '完整检查' : '完整检查（未通过）', view.result) : traceOf('演示（不是成绩）', view?.example);
        const nudge = action !== 'start' ? '' : solved
          ? (view.state.reflection ? '\n完整检查已通过。可以对照 Pi 的 agent-loop.ts（查找约第 716 行，执行约第 832 行）。' : '\n完整检查已通过。可以对照 Pi 的 agent-loop.ts（查找约第 716 行，执行约第 832 行）。留下三段记录：情境、决定、后果。')
          : view?.result ? '\n上面是完整检查。成绩只看这次结果是否通过。'
          : view?.example?.passed ? '\n演示请求这次走通了。它还不是成绩，需要完整检查。'
          : '\n演示请求没有被当前代码正确处理。先预测实际调用，再改代码。完整检查通过才算完成。';
        visible(await summary(service, view) + trace + nudge);
      } catch (error) { visible(String(error.message)); }
    },
  });
  pi.registerTool({
    name: 'dovetail', label: 'Dovetail', defaultActive: false, executionMode: 'sequential',
    description: 'Inspect the lesson, record a prediction, run the demo, run the full check, apply source, record a reflection, or return the answer after a prediction or failed attempt when the learner asks.',
    parameters: Type.Object({
      action: Type.Union(['inspect', 'predict', 'run', 'test', 'apply', 'answer', 'reflect'].map(value => Type.Literal(value))),
      expectedSource: Type.Optional(Type.String()), source: Type.Optional(Type.String()),
      prediction: Type.Optional(Type.String()),
      context: Type.Optional(Type.String()), decision: Type.Optional(Type.String()), consequences: Type.Optional(Type.String()),
    }),
    async execute(_id, args, signal, _update, ctx) {
      try {
        const service = await get(ctx);
        const view = await service.perform(args.action, args, signal);
        const text = args.action === 'inspect' ? describe(view) : view?.answer ??
          await summary(service, view) + '\n' + describe(view?.result ?? view);
        return { content: [{ type: 'text', text }], details: view };
      } catch (error) { return { content: [{ type: 'text', text: String(error.message) }], details: {}, isError: true }; }
    },
  });
  pi.on('session_start', async (_event, ctx) => {
    try {
      const service = await get(ctx);
      const view = await service.perform('status');
      availability(view?.state.mode === 'active');
      if (view) visible('Dovetail 已从文件恢复。\n' + await summary(service, view));
    } catch (error) { availability(false); visible(String(error.message)); }
  });
  pi.on('context', async (event, ctx) => {
    let content;
    try {
      const skill = await readFile(new URL('./skills/dovetail/SKILL.md', import.meta.url), 'utf8');
      const view = await (await get(ctx)).perform('status');
      if (view?.state.mode === 'active') content = skill + '\nCurrent facts:\n' + describe(view) + (challengeSolved(view) ? comparison : '');
    } catch (error) { visible(String(error.message)); }
    availability(content !== undefined);
    const teaching = message => message.role === 'custom' && message.customType === 'dovetail-teaching';
    const messages = event.messages.filter(message => !teaching(message));
    if (content !== undefined) messages.push({
      role: 'custom', customType: 'dovetail-teaching', content, display: false, timestamp: Date.now(),
    });
    return { messages };
  });
}

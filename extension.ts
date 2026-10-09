import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Dovetail, describe } from './src/dovetail.mjs';

export default function (pi: ExtensionAPI) {
  let owner: Dovetail;
  const get = async (ctx: { cwd: string }) => {
    const cwd = await realpath(ctx.cwd);
    if (owner && await owner.cwd !== cwd) throw new Error('Workspace changed. Restart Pi in the intended workspace before using Dovetail.');
    return owner ??= new Dovetail(cwd);
  };
  const availability = (active: boolean) => pi.setActiveTools([
    ...pi.getActiveTools().filter(name => name !== 'dovetail'), ...(active ? ['dovetail'] : [])]);
  const visible = (content: string) => pi.sendMessage({ customType: 'dovetail', content, display: true }, { triggerTurn: false });
  const summary = async (service: Dovetail, view) => !view ? '尚未开始。输入 /dovetail start。' :
    `Dovetail ${view.state.mode === 'active' ? '进行中' : '已暂停'}。\n代码文件：${join(await service.cwd, '.dovetail/project/agent.mjs')}\n最近检查：${!view.state.lastCheck ? '未检查' : `${view.state.lastCheck.kind} ${view.state.lastCheck.passed ? '通过' : '未通过'}${view.checkedCurrentSource ? '' : '，代码已改变，请重新测试'}`}。${view.state.answerUsed ? '\n已查看过答案。' : ''}`;

  pi.registerCommand('dovetail', {
    description: 'Start, inspect status, or pause the one-tool lesson',
    handler: async (args, ctx) => {
      try {
        const action = args.trim() || 'start';
        if (!['start', 'status', 'off'].includes(action)) throw new Error('Use /dovetail start|status|off.');
        const service = await get(ctx);
        const view = await service.perform(action);
        availability(view?.state.mode === 'active');
        const status = await summary(service, view);
        const trace = view?.example ? '\n固定脚本请求（不是实时模型）：\n' + view.example.observations.map(item =>
          `请求 ${item.request.name}(${JSON.stringify(item.request.arguments)})\n实际调用 ${JSON.stringify(item.actual.invocations)}\n工具结果 ${item.actual.error ?? item.actual.result}\n最终回复 ${item.finalResponse}`).join('\n') + (view.example.error ? view.example.error : '') : '';
        visible(status + trace + (action === 'start' ? '\n现在用循环按 call.name 找到工具，把 call.arguments 交给 execute；找不到时抛出包含工具名的错误。可以先猜结果、直接编辑文件，或在聊天中给出代码或明确逻辑。' : ''));
      } catch (error) { visible(String(error.message)); }
    },
  });
  pi.registerTool({
    name: 'dovetail', label: 'Dovetail', defaultActive: false, executionMode: 'sequential',
    description: 'Inspect, run, test, or apply the learner’s one-tool dispatcher. Return the answer only when explicitly requested.',
    parameters: Type.Object({
      action: Type.Union(['inspect', 'run', 'test', 'apply', 'answer'].map(value => Type.Literal(value))),
      expectedRevision: Type.Optional(Type.String()), source: Type.Optional(Type.String()),
    }),
    async execute(_id, args, signal, _update, ctx) {
      try {
        const service = await get(ctx);
        const view = await service.perform(args.action, args, signal);
        const text = args.action === 'inspect' ? describe(view) : view?.answer ??
          await summary(service, view) + '\n' + describe(view?.result);
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
  pi.on('before_agent_start', async (_event, ctx) => {
    try {
      const view = await (await get(ctx)).perform('status');
      availability(view?.state.mode === 'active');
      if (view?.state.mode === 'active') return { message: {
      customType: 'dovetail-teaching', display: false,
      content: await readFile(new URL('./skills/dovetail/SKILL.md', import.meta.url), 'utf8') + '\nCurrent facts:\n' + describe(view),
      } };
    } catch (error) { availability(false); visible(String(error.message)); }
  });
  pi.on('context', async (event, ctx) => {
    let active = false;
    try { active = (await (await get(ctx)).perform('status'))?.state.mode === 'active'; } catch {}
    const teaching = message => message.role === 'custom' && message.customType === 'dovetail-teaching';
    const latest = active ? event.messages.findLastIndex(teaching) : -1;
    return { messages: event.messages.filter((message, index) => !teaching(message) || index === latest) };
  });
}

export async function dispatch(call, tools) {
  for (const tool of tools) {
    if (tool.name === call.name) {
      return tool.execute(call.arguments);
    }
  }
  throw new Error(`Unknown tool: ${call.name}`);
}

export async function dispatch(call, tools) {
  return tools[0].execute(call.arguments);
}

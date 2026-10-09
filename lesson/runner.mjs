import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(0, 'utf8');
const cases = process.argv[2] === 'run'
  ? [{ name: 'greet', arguments: { name: 'Ada' } }]
  : [{ name: 'greet', arguments: { name: 'Ada' } }, { name: 'greet', arguments: { name: 'Lin' } }, { name: 'weather', arguments: { name: 'Ada' } }];
const observations = [];
try {
  const { dispatch } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const request of cases) {
    const invocations = [];
    const tools = [{ name: 'greet', async execute(args) {
      invocations.push({ name: 'greet', arguments: structuredClone(args) });
      return `Hello, ${args.name}!`;
    } }];
    let result, error;
    try { result = await dispatch(request, tools); }
    catch (failure) { error = String(failure.message ?? failure); }
    const actual = { invocations, ...(error === undefined ? { result } : { error }) };
    const expected = request.name === 'greet'
      ? { invocations: [{ name: 'greet', arguments: request.arguments }], result: `Hello, ${request.arguments.name}!` }
      : { invocations: [], error: 'an error mentioning weather' };
    let passed = false;
    try {
      if (request.name === 'greet') assert.deepEqual(actual, expected);
      else { assert.deepEqual(invocations, []); assert.match(error ?? '', /weather/); }
      passed = true;
    } catch {}
    observations.push({ request, expected, actual, passed,
      finalResponse: error === undefined ? `The tool returned: ${result}` : `Tool request failed: ${error}` });
  }
  process.stdout.write(JSON.stringify({ passed: observations.every(item => item.passed), observations }));
} catch (failure) {
  process.stdout.write(JSON.stringify({ passed: false, error: `${failure.name}: ${failure.message}`, observations }));
}

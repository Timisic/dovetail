import { readFileSync, writeSync } from 'node:fs';

function assertEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('mismatch');
}

const source = readFileSync(0, 'utf8');
const cases = process.argv[2] === 'demo'
  ? [{ name: 'echo', arguments: { text: 'ping' } }]
  : [
      { name: 'greet', arguments: { name: 'Ada' } },
      { name: 'greet', arguments: { name: 'Lin' } },
      { name: 'echo', arguments: { text: 'ping' } },
      { name: 'weather', arguments: { name: 'Ada' } },
      { name: 'calendar', arguments: { name: 'Ada' } },
    ];

function tap(stream) {
  const original = stream.write;
  let buf = '';
  stream.write = function (chunk, ...rest) {
    buf += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    return original.call(this, chunk, ...rest);
  };
  return () => {
    const value = buf;
    buf = '';
    return value;
  };
}

function publish(payload) {
  writeSync(3, JSON.stringify(payload));
}

const takeOut = tap(process.stdout);
const takeErr = tap(process.stderr);
const observations = [];
try {
  const { dispatch } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  takeOut();
  takeErr();
  for (const request of cases) {
    const invocations = [];
    const tools = [
      { name: 'greet', async execute(args) {
        invocations.push({ name: 'greet', arguments: structuredClone(args) });
        return `Hello, ${args.name}!`;
      } },
      { name: 'echo', async execute(args) {
        invocations.push({ name: 'echo', arguments: structuredClone(args) });
        return String(args.text);
      } },
    ];
    let result, error;
    try { result = await dispatch(request, tools); }
    catch (failure) { error = String(failure.message ?? failure); }
    const stdout = takeOut();
    const stderr = takeErr();
    const actual = { invocations, ...(error === undefined ? { result } : { error }) };
    const expected = request.name === 'greet'
      ? { invocations: [{ name: 'greet', arguments: request.arguments }], result: `Hello, ${request.arguments.name}!` }
      : request.name === 'echo'
        ? { invocations: [{ name: 'echo', arguments: request.arguments }], result: String(request.arguments.text) }
        : { invocations: [], error: `an error mentioning ${request.name}` };
    let passed = false;
    try {
      if (request.name === 'greet' || request.name === 'echo') assertEqual(actual, expected);
      else {
        assertEqual(invocations, []);
        if (!(error ?? '').includes(request.name)) throw new Error('missing name');
      }
      passed = true;
    } catch {}
    observations.push({
      request, expected, actual, passed, stdout, stderr,
      finalResponse: error === undefined ? `The tool returned: ${result}` : `Tool request failed: ${error}`,
    });
  }
  publish({ passed: observations.every(item => item.passed), observations });
} catch (failure) {
  publish({ passed: false, error: `${failure.name}: ${failure.message}`, observations, stdout: takeOut(), stderr: takeErr() });
}

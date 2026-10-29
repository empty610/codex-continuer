import localTls from '../../server/local-tls.cjs';

// Install the transport mock before runtime captures its configuration.
localTls.requestOptions = () => ({});
let calls = 0;
localTls.fetchLocal = async () => { calls++; throw Error('fixture network failure'); };
const runtime = await import('../../plugin/runtime.js');
let blocked = 0;
for (const action of [() => runtime.ensureService(), () => runtime.openWidget({ automatic: true })]) {
  try { await action(); } catch (error) { if (error.code === 'EXIT_REQUESTED') blocked++; }
}
const before = calls;
try { await runtime.openWidget(); } catch {}
console.log(JSON.stringify({ blocked, before, after: calls }));

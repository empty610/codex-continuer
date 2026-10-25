import { CodexRpc } from '../server/rpc.js';
const rpc = new CodexRpc();
try {
  await rpc.connect();
  const result = await rpc.call('account/rateLimits/read');
  const limits = Object.values(result.rateLimitsByLimitId || {}).filter(Boolean);
  if (!limits.length && result.rateLimits) limits.push(result.rateLimits);
  console.log(JSON.stringify({ connected: true, limits: limits.map(l => ({ id: l.limitId, primaryUsed: l.primary?.usedPercent, secondaryUsed: l.secondary?.usedPercent, reset: l.primary?.resetsAt })) }, null, 2));
  const threads = await rpc.call('thread/list', { limit: 1 });
  console.log(JSON.stringify({ threadListReadable: Array.isArray(threads.data), hasThreads: threads.data.length > 0 }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rpc.close(); }

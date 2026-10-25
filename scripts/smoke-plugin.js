// Read-only installed-package check. Never starts a model turn or creates a task.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || '.');
const child = spawn(process.execPath, [resolve(root, 'plugin/mcp-server.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
let sequence = 0;
const waiting = new Map();
const lines = createInterface({ input: child.stdout });
lines.on('line', line => { const response = JSON.parse(line); waiting.get(response.id)?.(response); });
function call(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`Timeout: ${method}`)); }, 40000);
    waiting.set(id, response => { clearTimeout(timer); waiting.delete(id); response.error ? reject(Error(response.error.message)) : resolve(response.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
try {
  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'continuer-smoke', version: '1' } });
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const list = await call('tools/list');
  const result = await call('tools/call', { name: 'continuer_status', arguments: {} });
  if (result.isError) throw Error(result.content[0].text);
  const status = JSON.parse(result.content[0].text);
  console.log(JSON.stringify({ version: init.serverInfo.version, tools: list.tools.length, connection: status.connection.status, quotaAvailable: !!status.quota, managedTasks: status.tasks.length, pendingApprovals: status.pendingApprovals }, null, 2));
} finally { child.stdin.end(); lines.close(); child.kill(); }

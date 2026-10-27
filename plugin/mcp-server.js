import { createInterface } from 'node:readline';
import { tools, dispatch } from './tools.js';
import * as runtime from './runtime.js';
import config from '../server/config.cjs';

const write = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const input = createInterface({ input: process.stdin });
input.on('line', async line => {
  let message;
  try { if (line.length > 100000) throw new Error('Request too large'); message = JSON.parse(line); }
  catch { write({ id: null, error: { code: -32700, message: 'Invalid JSON request' } }); return; }
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    write({ id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); return;
  }
  if (message.id == null) return;
  try {
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codex-continuer', version: config.version }, instructions: 'Continuer manages only explicitly created/imported tasks. Read status without starting tasks. Creating work, resuming, enabling monitoring or scheduling, and changing execution policy require the user to operate the native widget. MCP cannot authorize these actions. The widget is a native companion window that follows Codex, not a modification to Codex UI. Never approve a task permission request on the user’s behalf.' };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools };
    else if (message.method === 'tools/call') {
      try {
        const data = await dispatch(message.params?.name, message.params?.arguments || {}, runtime);
        result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
    } else { write({ id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }
    write({ id: message.id, result });
  } catch (error) { write({ id: message.id, error: { code: -32603, message: error.message } }); }
});

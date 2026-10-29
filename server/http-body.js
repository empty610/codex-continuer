import { message as textMessage } from '../public/message.js';
// Decode across network chunk boundaries; never replace a split UTF-8 codepoint.
import { ClientError } from './http-policy.js';
export async function readJsonBody(req) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decode = (chunk, options) => { try { return decoder.decode(chunk, options); } catch { throw new ClientError(textMessage("error.invalid_utf8")); } };
  let content = '', bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 160000) throw new ClientError(textMessage("error.request_too_large"));
    content += decode(chunk, { stream: true });
    if (content.length > 40000) throw new ClientError(textMessage("error.request_too_large"));
  }
  content += decode();
  if (content.length > 40000) throw new ClientError(textMessage("error.request_too_large"));
  let result;
  try { result = content ? JSON.parse(content) : {}; } catch { throw new ClientError(textMessage("error.invalid_json")); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ClientError(textMessage("error.json_object_required"));
  return result;
}

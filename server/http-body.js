// Decode across network chunk boundaries; never replace a split UTF-8 codepoint.
import { ClientError } from './http-policy.js';
export async function readJsonBody(req) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decode = (chunk, options) => { try { return decoder.decode(chunk, options); } catch { throw new ClientError('请求正文不是有效 UTF-8'); } };
  let content = '', bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 160000) throw new ClientError('请求过大');
    content += decode(chunk, { stream: true });
    if (content.length > 40000) throw new ClientError('请求过大');
  }
  content += decode();
  if (content.length > 40000) throw new ClientError('请求过大');
  let result;
  try { result = content ? JSON.parse(content) : {}; } catch { throw new ClientError('请求正文不是有效 JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ClientError('请求正文必须为 JSON 对象');
  return result;
}

// Decode across network chunk boundaries; never replace a split UTF-8 codepoint.
export async function readJsonBody(req) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let content = '', bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 160000) throw new Error('请求过大');
    content += decoder.decode(chunk, { stream: true });
    if (content.length > 40000) throw new Error('请求过大');
  }
  content += decoder.decode();
  if (content.length > 40000) throw new Error('请求过大');
  const result = content ? JSON.parse(content) : {};
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('请求正文必须为 JSON 对象');
  return result;
}

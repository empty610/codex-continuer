import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';

const files = new Map([
  ['/', 'index.html'], ['/widget', 'widget.html'],
  ...['app.js', 'widget.js', 'access.js', 'view-lifecycle.js', 'task-mode.js', 'task-details.js', 'approval-details.js', 'storage-status.js', 'quota-display.js', 'rhine-readout.js', 'style.css', 'widget.css', 'favicon.svg', 'rhine-signal-loop.svg'].map(file => ['/' + file, file]),
]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// Cache only requested, whitelisted files. Metadata invalidates edited assets;
// a browser revalidation can return 304 instead of another identical body.
export function createStaticAssets(root) {
  const cache = new Map();
  return async (req, res, url) => {
    const name = files.get(url.pathname);
    if (req.method !== 'GET' || !name) return false;
    const file = resolve(root, 'public', name), info = await stat(file);
    const signature = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    let entry = cache.get(name);
    if (!entry || entry.signature !== signature) {
      entry = { signature };
      entry.pending = readFile(file).then(content => {
        entry.content = content; entry.etag = '"' + createHash('sha256').update(content).digest('hex') + '"';
        return entry;
      }).catch(error => { if (cache.get(name) === entry) cache.delete(name); throw error; });
      cache.set(name, entry);
    }
    await entry.pending;
    const headers = { 'Content-Type': types[extname(name)] + '; charset=utf-8', 'Cache-Control': 'no-cache', ETag: entry.etag };
    if (req.headers['if-none-match']?.split(',').some(value => value.trim().replace(/^W\//, '') === entry.etag || value.trim() === '*')) { res.writeHead(304, headers); res.end(); }
    else { res.writeHead(200, headers); res.end(entry.content); }
    return true;
  };
}

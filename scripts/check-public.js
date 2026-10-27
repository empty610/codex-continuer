import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicFiles } from './source-files.js';
export function checkPublic(root = '.') {
  const failures = [], files = publicFiles(root);
  const patterns = [
    ['local Bearer credential', /\bBearer\s+[a-f0-9]{64}\b/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['API credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/],
    ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})/],
    ['personal home path', /[A-Za-z]:[\\/]Users[\\/](?!Public\b|Default\b)[^\\/\s"'<>`%]+/i],
  ];
  for (const file of files) {
    if (/(?:^|\/)(?:runtime\.json|tls-[^/]+\.json|access-[^/]+\.token|\.env(?:\.[^/]+)?)$|\.(?:pfx|p12)$/i.test(file)) { failures.push(file + ': private runtime file'); continue; }
    if (/\.(png|ico)$/.test(file)) continue;
    const text = readFileSync(join(root, file), 'utf8');
    for (const [kind, pattern] of patterns) if (pattern.test(text)) failures.push(file + ': ' + kind);
    if (/\b01[a-f0-9]{6}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/i.test(text)) failures.push(file + ': live conversation identifier');
  }
  const provenance = JSON.parse(readFileSync(join(root, 'third_party/rhine/UPSTREAM.json'), 'utf8'));
  for (const [file, info] of Object.entries(provenance.files)) if (createHash('sha256').update(readFileSync(join(root, 'third_party/rhine', file))).digest('hex') !== info.sha256) failures.push('Upstream source changed: ' + file);
  if (failures.length) throw Error(failures.join('\n'));
  return { files: files.length, upstreamFiles: Object.keys(provenance.files).length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkPublic(process.argv[2] || '.'), null, 2));

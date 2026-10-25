import { cpSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { publicFiles } from './source-files.js';
import { checkPublic } from './check-public.js';
export function buildSource(root, destination) {
  checkPublic(root);
  if (existsSync(destination)) throw Error('Choose an empty source destination: ' + destination);
  mkdirSync(destination, { recursive: true }); const hashes = {};
  for (const file of publicFiles(root)) { const target = join(destination, file); mkdirSync(dirname(target), { recursive: true }); cpSync(join(root, file), target); hashes[file] = createHash('sha256').update(readFileSync(target)).digest('hex'); }
  const manifest = { version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, sourceId: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), files: hashes };
  writeFileSync(join(destination, 'source-manifest.json'), JSON.stringify(manifest, null, 2)); return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildSource(resolve('.'), resolve(process.argv[2] || 'dist/source/codex-continuer')), null, 2));

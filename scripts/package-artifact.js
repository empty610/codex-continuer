import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, lstatSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { dirname, basename, join, resolve, relative, isAbsolute } from 'node:path';
import config from '../server/config.cjs';

function fileHash(file) {
  const fd = openSync(file, 'r'), buffer = Buffer.alloc(65536), hash = createHash('sha256');
  try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}

export function sealArtifact(directory) {
  const files = {};
  const visit = path => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = join(path, item.name), name = relative(directory, file).replaceAll('\\', '/');
      if (item.isSymbolicLink()) throw new Error(`Artifact contains a symbolic link: ${name}`);
      if (item.isDirectory()) visit(file);
      else if (name !== 'artifact-manifest.json') files[name] = fileHash(file);
    }
  };
  visit(directory);
  const manifest = { version: config.version, buildId: config.fingerprint(directory), protocolVersion: config.protocolVersion, schemaVersion: config.schemaVersion, files };
  writeFileSync(join(directory, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2));
  verifyArtifact(directory); return manifest;
}
export function verifyArtifact(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'artifact-manifest.json'), 'utf8'));
  if (manifest.buildId !== config.fingerprint(directory)) throw new Error('Runtime build fingerprint mismatch');
  const found = new Set();
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name), name = relative(directory, file).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) throw new Error('Artifact symlink is not allowed');
      if (entry.isDirectory()) visit(file);
      else if (name !== 'artifact-manifest.json') {
        if (!manifest.files[name] || fileHash(file) !== manifest.files[name]) throw new Error(`Artifact checksum mismatch: ${name}`);
        found.add(name);
      }
    }
  };
  visit(directory);
  if (found.size !== Object.keys(manifest.files).length) throw new Error('Artifact file missing');
  return manifest;
}
export function publishArtifact(stage, destination, allowedRoot = dirname(destination)) {
  stage = resolve(stage); destination = resolve(destination);
  if (dirname(stage) !== dirname(destination) || !basename(stage).startsWith('.codex-continuer-stage-') || basename(destination) !== 'codex-continuer') throw new Error('Unsafe artifact paths');
  const previous = destination + '.previous';
  const checkedRoot = realpathSync(allowedRoot);
  const inside = path => { const name = relative(checkedRoot, realpathSync(path)); if (name.startsWith('..') || isAbsolute(name)) throw new Error('Artifact path escapes the intended workspace'); };
  inside(dirname(stage));
  for (const path of [stage, destination, previous]) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Refusing to replace a symbolic link');
  verifyArtifact(stage);
  if (existsSync(previous)) throw new Error('A previous interrupted publication needs inspection');
  if (existsSync(destination)) renameSync(destination, previous);
  try { renameSync(stage, destination); }
  catch (error) { if (existsSync(previous)) renameSync(previous, destination); throw error; }
  // These exact sibling paths were checked above; no runtime/user-data directories.
  if (existsSync(previous)) { inside(previous); rmSync(previous, { recursive: true, force: true }); }
}

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
for (const folder of ['server', 'public', 'plugin', 'desktop', 'scripts']) {
  for (const file of readdirSync(folder).filter(f => /\.(c?js)$/.test(f))) {
    const path = join(folder, file);
    const r = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
}
console.log('All JavaScript syntax checks passed.');

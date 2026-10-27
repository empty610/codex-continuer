const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');

if (process.argv[2] !== '--child') {
  const child = spawn(process.execPath, [__filename, '--child'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(process.argv[2], JSON.stringify({ pid: child.pid }));
}
setInterval(() => {}, 1000);

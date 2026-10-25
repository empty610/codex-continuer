const { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, truncateSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { formatWithOptions } = require('node:util');
const MAX_LOG_BYTES = 1024 * 1024;
function rotateFile(file, maximum = MAX_LOG_BYTES, backups = 3) {
  if (!existsSync(file) || statSync(file).size < maximum) return false;
  for (let index = backups - 1; index >= 1; index--) if (existsSync(`${file}.${index}`)) copyFileSync(`${file}.${index}`, `${file}.${index + 1}`);
  copyFileSync(file, file + '.1');
  // Keep the open file handle valid for native stdout/stderr writers on Windows.
  truncateSync(file, 0); return true;
}
function rotateLogs(directory) {
  mkdirSync(directory, { recursive: true });
  for (const name of readdirSync(directory).filter(name => name.endsWith('.log'))) {
    try { rotateFile(join(directory, name)); } catch { /* A locked diagnostic must not stop scheduling. */ }
  }
}
function installLogs(directory, name) {
  mkdirSync(directory, { recursive: true });
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const line = `${new Date().toISOString()} ${level.toUpperCase()} ${formatWithOptions({ depth: 4, maxStringLength: 16000 }, ...args).slice(0, 16000)}\n`;
      try { const file = join(directory, `${name}-${level === 'log' ? 'stdout' : 'stderr'}.log`); rotateFile(file); appendFileSync(file, line, { mode: 0o600 }); } catch {}
      if (process.stdout.isTTY) original(...args);
    };
  }
}
module.exports = { MAX_LOG_BYTES, rotateFile, rotateLogs, installLogs };

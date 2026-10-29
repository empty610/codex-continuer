import { MessageError, message as textMessage } from '../public/message.js';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { alive } from './health.js';

export async function acquireLease(directory, name) {
  mkdirSync(directory, { recursive: true });
  const canonical = realpathSync.native(directory);
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const key = createHash('sha256').update(identity).update('\0').update(name).digest('hex');
  // libuv uses FILE_FLAG_FIRST_PIPE_INSTANCE on Windows. The OS closes the
  // exclusive handle after a crash; no stale-path deletion owns exclusion.
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\continuer-${key}` : process.platform === 'linux' ? `\0continuer-${key}` : null;
  if (!address) throw new MessageError(textMessage("error.lease_platform"));
  const guard = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    const failed = error => reject(error.code === 'EADDRINUSE' ? new MessageError(textMessage("error.lease_conflict")) : error);
    guard.once('error', failed);
    guard.listen(address, () => { guard.off('error', failed); resolve(); });
  });
  const file = join(canonical, `${name}.lock`), leaseId = randomUUID();
  try {
    // Respect a running pre-upgrade service that does not own the pipe yet.
    if (existsSync(file)) {
      let previous;
      try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new MessageError(textMessage("error.lease_corrupt")); }
      if (!Number.isInteger(previous.pid) || alive(previous.pid)) throw new MessageError(textMessage("error.lease_conflict"));
    }
    writeFileSync(file, JSON.stringify({ pid: process.pid, leaseId, startedAt: Date.now() }), { mode: 0o600 });
  } catch (error) { await new Promise(resolve => guard.close(resolve)); throw error; }
  guard.unref();
  let released;
  return () => {
    if (released) return released;
    try { if (JSON.parse(readFileSync(file, 'utf8')).leaseId === leaseId) unlinkSync(file); } catch {}
    released = new Promise(resolve => guard.close(resolve));
    return released;
  };
}

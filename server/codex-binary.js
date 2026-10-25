import { existsSync } from 'node:fs';
import { join } from 'node:path';
export function rpcBinary(env = process.env, platform = process.platform, arch = process.arch) {
  if (env.CODEX_BINARY) return { command: env.CODEX_BINARY, prefix: [] };
  const npmScript = join(env.APPDATA || '', 'npm/node_modules/@openai/codex/bin/codex.js');
  const triple = arch === 'arm64' ? 'aarch64' : 'x86_64';
  const native = join(env.APPDATA || '', `npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-${arch}/vendor/${triple}-pc-windows-msvc/bin/codex.exe`);
  if (platform === 'win32' && existsSync(native)) return { command: native, prefix: [] };
  if (platform === 'win32' && existsSync(npmScript)) return { command: process.execPath, prefix: [npmScript] };
  return { command: 'codex', prefix: [] };
}

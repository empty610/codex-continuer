import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpcBinary } from '../server/codex-binary.js';
import { queueBinary } from '../server/queue-sender.js';
export function doctor({ run = execFileSync, env = process.env, platform = process.platform, arch = process.arch, node = process.versions.node } = {}) {
  const cli = rpcBinary(env, platform, arch), queue = queueBinary(env);
  const probe = (command, args) => { try { return { available: true, output: String(run(command, args, { windowsHide: true, encoding: 'utf8', timeout: 8000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] })).trim() }; } catch { return { available: false }; } };
  const version = probe(cli.command, [...cli.prefix, '--version']);
  const appServer = probe(cli.command, [...cli.prefix, 'app-server', '--help']);
  const plugins = probe(cli.command, [...cli.prefix, 'plugin', '--help']);
  const queueHelp = probe(queue, ['queue', '--help']);
  const [major, minor] = node.split('.').map(Number);
  const result = { platform, arch, node, supportedPlatform: platform === 'win32' && arch === 'x64', supportedNode: major > 22 || major === 22 && minor >= 12,
    cliVersion: version.output?.split('\n')[0].slice(0, 160) || 'unavailable', appServer: appServer.available, plugins: plugins.available,
    queue: queueHelp.available && /--thread\b/.test(queueHelp.output) && /--message\b/.test(queueHelp.output), modelCalls: 0, messagesSent: 0,
    protocolBaseline: '0.153.2', validationScope: 'Capability probes do not prove account login, quota recovery or future protocol compatibility.' };
  result.ready = result.supportedPlatform && result.supportedNode && result.appServer && result.plugins;
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const result = doctor(); console.log(JSON.stringify(result, null, 2)); if (process.argv.includes('--strict') && !result.ready) process.exitCode = 1; }

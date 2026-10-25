// Shared authenticated transport for the PowerShell browser/stop launchers.
const demo = process.argv.includes('--demo');
process.env.CONTINUER_PORT = process.env.PORT || (demo ? '4318' : process.env.CONTINUER_PORT || '4317');
process.env.CONTINUER_DEMO = demo ? '1' : '';
const runtime = await import('./runtime.js');
try {
  if (process.argv[2] === 'stop') {
    let state;
    try { state = await runtime.request('/api/state'); }
    catch (error) { if (error.cause?.code === 'ECONNREFUSED') { console.log('Continuer is not running.'); process.exit(0); } throw error; }
    const { resolve } = await import('node:path');
    const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
    if (state.app !== 'codex-continuer' || typeof state.diagnostics?.dataDir !== 'string' || normalize(state.diagnostics.dataDir) !== normalize(runtime.dataDir)) throw Error('端口服务不属于当前 Continuer 数据目录');
    await runtime.request('/api/shutdown', {}); console.log('Continuer stopped.');
  } else if (process.argv[2] === 'url') {
    await runtime.ensureService();
    process.stdout.write(runtime.origin + '/#access=' + runtime.readAccessToken());
  } else throw Error('Usage: node plugin/control.js url|stop [--demo]');
} catch (error) { console.error(error.message); process.exitCode = 1; }

// Shared pinned transport for the PowerShell native/start/stop launchers.
const demo = process.argv.includes('--demo');
process.env.CONTINUER_PORT = process.env.PORT || (demo ? '4318' : process.env.CONTINUER_PORT || '4317');
process.env.CONTINUER_DEMO = demo ? '1' : '';
const runtime = await import('./runtime.js');
const { default: exitState } = await import('../server/exit-state.cjs');
try {
  if (process.argv[2] === 'stop') {
    let state;
    try { state = await runtime.request('/api/state'); }
    catch (error) { if (error.code === 'TLS_IDENTITY_MISSING' || error.cause?.code === 'ECONNREFUSED') { console.log('Continuer is not running.'); process.exit(0); } throw error; }
    const { resolve } = await import('node:path');
    const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
    if (state.app !== 'codex-continuer' || typeof state.diagnostics?.dataDir !== 'string' || normalize(state.diagnostics.dataDir) !== normalize(runtime.dataDir)) throw Error('端口服务不属于当前 Continuer 数据目录');
    await runtime.request('/api/shutdown', {}); console.log('Continuer stopped.');
  } else if (process.argv[2] === 'open' || process.argv[2] === 'start') {
    exitState.clear(runtime.dataDir, demo);
    if (process.argv[2] === 'open') console.log(JSON.stringify(await runtime.openWidget()));
    else { await runtime.ensureService(); console.log('Continuer started in observation mode.'); }
  } else if (process.argv[2] === 'url') throw Error('浏览器凭据链接已停用，请运行 node plugin/open.js 打开原生挂件。');
  else throw Error('Usage: node plugin/control.js open|start|stop [--demo]');
} catch (error) { console.error(error.message); process.exitCode = 1; }

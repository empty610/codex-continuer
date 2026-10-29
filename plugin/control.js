// Shared pinned transport for the PowerShell native/start/stop launchers.
const demo = process.argv.includes('--demo');
process.env.CONTINUER_PORT = process.env.PORT || (demo ? '4318' : process.env.CONTINUER_PORT || '4317');
process.env.CONTINUER_DEMO = demo ? '1' : '';
const runtime = await import('./runtime.js');
try {
  if (process.argv[2] === 'stop') {
    const result = await runtime.stopService();
    console.log(result.stopped ? 'Continuer stopped.' : 'Continuer is not running.');
  } else if (process.argv[2] === 'open' || process.argv[2] === 'start') {
    if (process.argv[2] === 'open') console.log(JSON.stringify(await runtime.openWidget()));
    else { await runtime.startService(); console.log('Continuer started in observation mode.'); }
  } else if (process.argv[2] === 'url') throw Error('浏览器凭据链接已停用，请运行 node plugin/open.js 打开原生挂件。');
  else throw Error('Usage: node plugin/control.js open|start|stop [--demo]');
} catch (error) { console.error(error.message); process.exitCode = 1; }

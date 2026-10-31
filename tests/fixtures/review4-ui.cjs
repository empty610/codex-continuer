const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = process.env.CONTINUER_TEST_REVIEW4_DIR;
if (!directory) throw Error('Isolated UI test directory required');
app.setPath('userData', path.join(directory, 'profile'));
app.on('window-all-closed', () => {});
const root = path.resolve(__dirname, '../..'), threadId = '77777777-7777-4777-8777-777777777777';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const initial = () => ({ app: 'codex-continuer', version: '0.5.1', buildId: 'fixture', protocolVersion: 4,
  settings: { enabled: false, language: 'zh', pollSeconds: 30, minimumRemaining: 5, maxRounds: 20, maxWakeSends: 8 },
  connection: { status: 'connected' }, tasks: [], approvals: [], history: [], logs: [] });
let win, server, state = initial();
const imports = [], results = [], errors = [];
const persist = result => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
app.whenReady().then(async () => {
  try {
    const { createStaticAssets } = await import('../../server/static-assets.js');
    const serve = createStaticAssets(root);
    server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/fixture/')) {
        const page = url.pathname.endsWith('page') ? 'index.html' : 'widget.html';
        const html = fs.readFileSync(path.join(root, 'public', page), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
      }
      if (url.pathname.startsWith('/api/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        if (url.pathname === '/api/import') {
          const input = JSON.parse(body); imports.push(input);
          state.tasks.push({ id: 'fixture-monitor', threadId, name: 'Fixture chat', mode: 'quota-wake',
            continuous: input.startMonitoring, status: input.startMonitoring ? 'monitoring' : 'paused', sentCount: 0, detailRevision: 1 });
        }
        const result = url.pathname === '/api/threads' ? { data: [{ id: threadId, name: 'Fixture chat', cwd: 'E:\\fixture' }], nextCursor: null } : state;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return;
      }
      try { if (await serve(req, res, url)) return; } catch {}
      res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const surface of ['page', 'widget']) {
      state = initial(); imports.length = 0;
      win = new BrowserWindow({ show: false, width: surface === 'page' ? 1100 : 432, height: surface === 'page' ? 850 : 720,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
      await win.loadURL(`http://127.0.0.1:${server.address().port}/fixture/${surface}`);
      await win.webContents.executeJavaScript(`(async () => {
        Object.defineProperty(document,'hidden',{value:false,configurable:true});
        window.createSource = () => { const source={close(){}}; window.testFeed=source; setTimeout(()=>source.onmessage({data:${JSON.stringify(JSON.stringify(state))}}),0); return source; };
        ${surface === 'widget' ? `const desktop={expanded:true,visible:true,follow:false,compactSize:256,panelSize:{width:414,height:702}};
          window.continuerDesktop={onState(callback){window.desktopListener=callback;},async control(){return {...desktop};}};` : ''}
        await import('/${surface === 'page' ? 'app' : 'widget'}.js');
      })()`);
      const evaluate = code => win.webContents.executeJavaScript(code);
      const until = async code => { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(40); } throw Error('DOM timeout: ' + code); };
      const feed = () => evaluate(`window.testFeed.onmessage({data:${JSON.stringify(JSON.stringify(state))}})`);
      if (surface === 'page') {
        await until("!!document.querySelector('#main .page-heading')");
        await evaluate("document.querySelector('#nav [data-page=settings]').click()");
        await until("!!document.querySelector('#settings-form')");
        await evaluate("document.querySelector('[name=maxWakeSends]').value='11'; window.selectedInterval=document.querySelector('[name=pollSeconds]'); undefined");
        state.settings.pollSeconds = 45; await feed();
        const synced = await evaluate("({value:selectedInterval.value,submitted:new FormData(document.querySelector('#settings-form')).get('pollSeconds'),draft:document.querySelector('[name=maxWakeSends]').value})");
        assert.deepEqual(synced, { value: '45', submitted: '45', draft: '11' });
        await evaluate("selectedInterval.value='60'"); state.settings.pollSeconds = 35; await feed();
        assert.equal(await evaluate("selectedInterval.value"), '60');
        assert.equal(await evaluate("[...selectedInterval.options].some(o=>o.value==='35')"), true);
        assert.deepEqual(await evaluate("[...selectedInterval.options].map(o=>o.value)"), ['10', '15', '30', '35', '45', '60', '90']);
        await evaluate("selectedInterval.value='45'");
        for (const language of ['en', 'zh']) {
          state.settings.language = language; await feed();
          assert.equal(await evaluate("document.querySelector('[name=pollSeconds]').value"), '45');
          assert.equal(await evaluate("document.querySelector('[name=maxWakeSends]').value"), '11');
        }
        await evaluate("document.querySelector('#nav [data-page=overview]').click(); document.querySelector('[data-action=import]').click()");
        await until("!!document.querySelector('[data-action=choose-thread]')"); await evaluate("document.querySelector('[data-action=choose-thread]').click()");
      } else {
        await until(`!!document.querySelector('#session-select option[value="${threadId}"]')`);
        await evaluate(`document.querySelector('#session-select').value='${threadId}'; document.querySelector('#session-select').dispatchEvent(new Event('change')); document.querySelector('#add-session').click()`);
      }
      await until("!!document.querySelector('#import-form [name=startMonitoring]')");
      assert.equal(await evaluate("document.querySelector('[name=startMonitoring]').checked"), false);
      assert.equal(await evaluate("document.querySelector('[name=startMonitoring]').parentElement.textContent.includes('加入后开始监测')"), true);
      await evaluate("document.querySelector('[name=startMonitoring]').checked=true; document.querySelector('[name=note]').value='Local note'; document.querySelector('[name=continuationMessage]').value='Continue this'");
      assert.equal(await evaluate("document.querySelector('[name=startMonitoring]').getClientRects().length > 0"), true);
      state.settings.language = 'en'; await feed();
      assert.equal(await evaluate("document.querySelector('[name=startMonitoring]').checked"), true);
      assert.equal(await evaluate("document.querySelector('[name=startMonitoring]').parentElement.textContent.includes('Start monitoring after adding')"), true);
      await evaluate("document.querySelector('#import-form').requestSubmit()");
      await until("!document.querySelector('#modal').open");
      assert.equal(imports.length, 1);
      assert.deepEqual(imports[0], { threadId, note: 'Local note', continuationMessage: 'Continue this', startMonitoring: true });
      results.push({ surface, import: imports[0], defaultPaused: true, checkboxPreservedAcrossLanguage: true });
      win.destroy(); win = null;
    }
    persist({ passed: true, results });
  } catch (error) { persist({ error: error.stack, errors }); process.exitCode = 1; }
  finally { win?.destroy(); if (server) await new Promise(resolve => server.close(resolve)); app.exit(process.exitCode || 0); }
});
setTimeout(() => { persist({ error: 'UI fixture timed out', errors }); app.exit(2); }, 20000);

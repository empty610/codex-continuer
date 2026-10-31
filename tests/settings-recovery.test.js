import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Manager } from '../server/manager.js';
import { initialState } from '../server/state-lifecycle.js';
import { pageView, widgetView } from './fixtures/widget-view.js';

for (const [surface, createView] of [['page', pageView], ['widget', widgetView]]) {
  test(`${surface} restores backup settings before saving an unrelated field`, async () => {
    const current = initialState(false), backup = initialState(false);
    current.settings.maxWakeSends = 8; backup.settings.maxWakeSends = 3;
    const rpc = new EventEmitter(); rpc.ready = false;
    const manager = new Manager(rpc, { load: () => current, save() {}, status: () => ({ backupAvailable: true }),
      restoreBackup: prepare => { const state = structuredClone(backup); prepare(state); return state; },
    }, { demo: true });
    const view = createView({ request: async (path, options) => {
      if (path.startsWith('/api/threads')) return { data: [], nextCursor: null };
      if (path === '/api/storage/recover') manager.recoverStorage(JSON.parse(options.body).source);
      if (path === '/api/settings') manager.updateSettings(JSON.parse(options.body));
      return manager.snapshot();
    } });
    await view.flush(); view.message(0, manager.snapshot());
    if (surface === 'widget') view.desktop({ expanded: true, visible: true }); else await view.page('settings');
    assert.equal(Number(view.element('#settings-form [name=maxWakeSends]').value), 8);
    view.element('#settings-form [name=minimumRemaining]').value = '17';
    manager.storageFailure(Error('Fixture disk failure')); view.message(0, manager.snapshot());
    if (surface === 'page') await view.page('overview');
    await view.action('storage-backup');
    if (surface === 'page') await view.page('settings');
    assert.equal(Number(view.element('#settings-form [name=maxWakeSends]').value), 3);
    assert.equal(Number(view.element('#settings-form [name=minimumRemaining]').value), backup.settings.minimumRemaining);
    await view.submit('settings-form', { pollSeconds: '60' });
    assert.deepEqual(JSON.parse(view.apiCalls.find(call => call.path === '/api/settings').options.body), { pollSeconds: 60 });
    assert.equal(manager.state.settings.maxWakeSends, 3);
    assert.equal(manager.state.settings.pollSeconds, 60);
    assert.equal(manager.state.settings.enabled, false);
    view.visible(false); if (surface === 'widget') view.desktop({ visible: false });
  });

  test(`${surface} keeps drafts while updating clean fields and submits only edits`, async () => {
    let state = { ...initialState(false), connection: { status: 'connected' }, approvals: [], version: '0.5.1', buildId: 'fixture' };
    const view = createView({ request: async (path, options) => {
      if (path.startsWith('/api/threads')) return { data: [], nextCursor: null };
      if (path === '/api/settings') state = { ...state, settings: { ...state.settings, ...JSON.parse(options.body) } };
      return state;
    } });
    await view.flush(); view.message(0, state);
    if (surface === 'widget') view.desktop({ expanded: true, visible: true }); else await view.page('settings');
    view.element('#settings-form [name=pollSeconds]').value = '60';
    state = { ...state, settings: { ...state.settings, maxWakeSends: 3 } };
    view.message(0, state);
    assert.equal(String(view.element('#settings-form [name=pollSeconds]').value), '60');
    assert.equal(Number(view.element('#settings-form [name=maxWakeSends]').value), 3);
    const values = Object.fromEntries(['minimumRemaining', 'pollSeconds', 'maxRounds', 'maxWakeSends']
      .map(key => [key, view.element(`#settings-form [name=${key}]`).value]));
    await view.submit('settings-form', values);
    assert.deepEqual(JSON.parse(view.apiCalls.find(call => call.path === '/api/settings').options.body), { pollSeconds: 60 });
    state = { ...state, settings: { ...state.settings, pollSeconds: 15 } }; view.message(0, state);
    assert.equal(Number(view.element('#settings-form [name=pollSeconds]').value), 15, 'Saved edits must become clean');
    view.visible(false); if (surface === 'widget') view.desktop({ visible: false });
  });
}

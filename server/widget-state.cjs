const { join, resolve } = require('node:path');

function widgetState(dataDir, port, demo = false) {
  const prefix = demo ? 'demo-' : '';
  return {
    profile: join(dataDir, `${prefix}desktop-profile`),
    preferences: join(dataDir, `${prefix}widget-preferences.json`),
    status: join(dataDir, `${prefix}widget-status.json`),
    identity: { dataDir, demo, origin: `https://127.0.0.1:${port}` },
  };
}

function matchesWidgetIdentity(actual, expected, platform = process.platform) {
  if (!actual || typeof actual.dataDir !== 'string' || actual.demo !== expected.demo || actual.origin !== expected.origin) return false;
  const normalized = value => platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  return normalized(actual.dataDir) === normalized(expected.dataDir);
}

module.exports = { widgetState, matchesWidgetIdentity };

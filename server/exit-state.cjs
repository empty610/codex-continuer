const { existsSync, mkdirSync, writeFileSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const marker = (directory, demo) => join(directory, demo ? 'quit-demo.request' : 'quit.request');
const requested = (directory, demo = false) => existsSync(marker(directory, demo));
function mark(directory, demo = false) { mkdirSync(directory, { recursive: true }); writeFileSync(marker(directory, demo), 'User exited Continuer\n', { mode: 0o600 }); }
function clear(directory, demo = false) { try { unlinkSync(marker(directory, demo)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
module.exports = { requested, mark, clear };

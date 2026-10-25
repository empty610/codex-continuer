import { openWidget } from './runtime.js';
try { console.log(JSON.stringify(await openWidget({ automatic: process.argv.includes('--auto') }))); }
catch (error) { console.error(error.message); process.exitCode = 1; }

const { writeFileSync } = require('node:fs');

writeFileSync(process.env.CONTINUER_TEST_LAUNCHER_PID_FILE, JSON.stringify({ pid: process.pid }));
setInterval(() => {}, 1000);

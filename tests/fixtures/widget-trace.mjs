import http from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';

const trace = process.env.CONTINUER_TEST_TRACE_FILE;
const original = http.createServer;
http.createServer = (options, listener) => original(options, (req, res) => {
  appendFileSync(trace, JSON.stringify(req.url) + '\n');
  res.on('finish', () => appendFileSync(trace + '.responses', JSON.stringify({ path: req.url, status: res.statusCode, authenticated: !!req.headers.authorization }) + '\n'));
  return listener(req, res);
});
syncBuiltinESMExports();

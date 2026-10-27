import http from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';

const trace = process.env.CONTINUER_TEST_TRACE_FILE;
const routes = ['/api/health', '/api/state', '/api/events', '/api/threads', '/widget.html', '/widget.css', '/widget.js', '/rhine-signal-loop.svg'];
// The test observes route categories, not arbitrary request text or queries.
const routeLabel = url => routes.find(route => url === route || url.startsWith(route + '?')) || 'other';
const original = http.createServer;
http.createServer = (options, listener) => original(options, (req, res) => {
  const route = routeLabel(req.url);
  appendFileSync(trace, JSON.stringify(route) + '\n');
  res.on('finish', () => appendFileSync(trace + '.responses', JSON.stringify({ path: route, status: res.statusCode, authenticated: !!req.headers.authorization }) + '\n'));
  return listener(req, res);
});
syncBuiltinESMExports();

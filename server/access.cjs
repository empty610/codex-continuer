const { randomBytes, timingSafeEqual } = require('node:crypto');
const { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

function credentialPath(directory, demo = false) { return join(directory, demo ? 'access-demo.token' : 'access-live.token'); }
function readToken(directory, demo = false) {
  const file = credentialPath(directory, demo);
  if (!existsSync(file)) return null;
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128) throw Error('本地访问凭据文件无效，请停止服务后检查数据目录');
  const token = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('本地访问凭据文件无效，请停止服务后检查数据目录');
  return token;
}
function createToken(directory, demo = false) {
  const previous = readToken(directory, demo);
  if (previous) return previous;
  mkdirSync(directory, { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileSync(credentialPath(directory, demo), token + '\n', { mode: 0o600, flag: 'wx' });
  return token;
}
function authorized(req, token) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(header)) return false;
  return timingSafeEqual(Buffer.from(header.slice(7)), Buffer.from(token));
}
module.exports = { credentialPath, readToken, createToken, authorized };

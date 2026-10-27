const { X509Certificate } = require('node:crypto');
const { existsSync, lstatSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const https = require('node:https');
const tls = require('node:tls');

const identityPath = (directory, demo = false) => join(directory, demo ? 'tls-demo.json' : 'tls-live.json');
function certificate(pem) {
  const value = new X509Certificate(pem), now = Date.now();
  if (!value.checkIP('127.0.0.1') || now < Date.parse(value.validFrom) || now >= Date.parse(value.validTo)) throw Error('本地服务证书无效或已过期，请停止服务后检查数据目录');
  return value;
}
function readIdentity(directory, demo = false) {
  const file = identityPath(directory, demo);
  if (!existsSync(file)) return null;
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) throw Error('本地服务证书文件无效');
  const identity = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof identity.certificate !== 'string' || typeof identity.pfx !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(identity.pfx)) throw Error('本地服务证书文件无效');
  certificate(identity.certificate);
  return identity;
}
async function serverOptions(directory, demo, password) {
  let identity = readIdentity(directory, demo);
  if (!identity) {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, 'create-tls.ps1'), '-DataDir', directory, ...(demo ? ['-Demo'] : [])], { windowsHide: true, timeout: 15000, maxBuffer: 32768 });
    identity = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    certificate(identity.certificate);
    // Service lease owns creation. Never overwrite a damaged/existing identity.
    tls.createSecureContext({ pfx: Buffer.from(identity.pfx, 'base64'), passphrase: password });
    writeFileSync(identityPath(directory, demo), JSON.stringify(identity), { flag: 'wx', mode: 0o600, flush: true });
  }
  const options = { pfx: Buffer.from(identity.pfx, 'base64'), passphrase: password, minVersion: 'TLSv1.2' };
  // Bind the public pin and private key envelope before opening any listener.
  const context = tls.createSecureContext(options);
  const actual = context.context.getCertificate();
  if (!actual || !new X509Certificate(actual).raw.equals(certificate(identity.certificate).raw)) throw Error('本地服务证书与私钥不匹配');
  return options;
}
function matchesCertificate(pem, expected) {
  try { return certificate(pem).raw.equals(certificate(expected).raw); } catch { return false; }
}
function requestOptions(directory, demo = false) {
  const identity = readIdentity(directory, demo);
  if (!identity) throw Object.assign(Error('缺少本地服务证书，请先启动新版 Continuer'), { code: 'TLS_IDENTITY_MISSING' });
  const pinned = certificate(identity.certificate);
  return { ca: identity.certificate, rejectUnauthorized: true, minVersion: 'TLSv1.2', checkServerIdentity: (host, peer) => tls.checkServerIdentity(host, peer) || (peer.raw?.equals(pinned.raw) ? undefined : Error('本地服务证书不匹配')) };
}
// Fetch-shaped response for shared launchers/tests, with no ambient CA trust,
// redirects, unbounded body, or credentials written before a verified handshake.
function fetchLocal(url, options = {}, identityOptions) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== '127.0.0.1' || target.username || target.password) return Promise.reject(Error('Invalid local HTTPS destination'));
  return new Promise((resolve, reject) => {
    const req = https.request(target, { ...identityOptions, agent: false, method: options.method || 'GET', headers: options.headers, signal: options.signal }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { const error = Error('本地响应超过长度限制'); reject(error); res.destroy(error); } else chunks.push(chunk); });
      res.on('error', reject); res.on('aborted', () => reject(Error('本地响应被中断')));
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.statusCode !== 304) return reject(Error('本地服务重定向被拒绝'));
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: new Headers(Object.entries(res.headers).flatMap(([key,value]) => Array.isArray(value) ? value.map(v => [key,v]) : value == null ? [] : [[key,String(value)]])), text: async () => body, json: async () => JSON.parse(body) });
      });
    });
    req.on('error', error => reject(Error('本地安全连接失败：' + error.message, { cause: error })));
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}
module.exports = { identityPath, readIdentity, serverOptions, requestOptions, matchesCertificate, fetchLocal };

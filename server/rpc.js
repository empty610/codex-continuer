import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import config from './config.cjs';
import { rpcBinary } from './codex-binary.js';

// stdio only: credentials stay in the Codex CLI's own authentication store.
export class CodexRpc extends EventEmitter {
  constructor({ spawnProcess = spawn } = {}) { super(); this.spawnProcess = spawnProcess; }
  pending = new Map();
  sequence = 0;
  ready = false;
  async connect() {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async open() {
    const { command, prefix } = rpcBinary();
    const args = [...prefix, 'app-server'];
    const child = this.spawnProcess(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const fail = (error) => {
      if (this.child !== child) return;
      this.ready = false;
      this.child = null;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
      this.pending.clear();
      this.emit('disconnect', error.message);
    };
    child.on('error', fail);
    child.on('exit', (code) => fail(new Error(`Codex 进程已退出 (${code})`)));
    child.stdin.on('error', fail);
    // Do not expose stderr: extensions can log credential-bearing diagnostics.
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method) {
        this.emit(msg.id == null ? 'notification' : 'request', msg);
      } else {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        msg.error ? pending.reject(Object.assign(new Error(msg.error.message), { rpcError: msg.error })) : pending.resolve(msg.result);
      }
    });
    try {
      await this.call('initialize', { clientInfo: { name: 'codex_continuer', title: 'Codex Continuer', version: config.version }, capabilities: { experimentalApi: false } });
      if (this.child !== child) throw new Error('Codex 连接已失效');
      this.send({ method: 'initialized' });
      this.ready = true;
    } catch (error) { child.kill(); throw error; }
  }
  send(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex 未连接');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 请求超时，请检查连接`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close() {
    const child = this.child;
    if (!child) return;
    this.child = null; this.ready = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex 连接已关闭')); }
    this.pending.clear();
    // EOF permits app-server to close its sessions before the bounded fallback.
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 2000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  }
}

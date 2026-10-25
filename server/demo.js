import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export class DemoRpc extends EventEmitter {
  ready = true;
  used = 68;
  timers = new Map();
  async connect() { this.ready = true; }
  async call(method, p = {}) {
    if (method === 'account/rateLimits/read') return { rateLimitsByLimitId: { codex: { limitId: 'codex', planType: 'plus', primary: { usedPercent: this.used, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7380 }, secondary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 192600 } } } };
    if (method === 'thread/start') return { thread: { id: randomUUID() } };
    if (method === 'thread/read' || method === 'thread/resume') return { thread: { id: p.threadId, name: '示例会话', cwd: 'E:\\projects\\demo', status: { type: 'idle' } } };
    if (method === 'thread/list') return { data: [{ id: 'demo-existing-thread', name: '个人知识库', cwd: 'E:\\projects\\knowledge', preview: '为个人知识库添加全文搜索' }], nextCursor: null };
    if (method === 'turn/interrupt') {
      for (const timer of this.timers.get(p.threadId) || []) clearTimeout(timer);
      this.emit('notification', { method: 'turn/completed', params: { threadId: p.threadId, turn: { id: p.turnId, status: 'interrupted' } } }); return {};
    }
    if (method === 'turn/start') {
      const turnId = randomUUID();
      const emit = (method, data) => this.emit('notification', { method, params: { threadId: p.threadId, turnId, ...data } });
      const steps = ['梳理项目结构与目标', '实现核心功能', '运行测试并验证结果'];
      const timers = [];
      emit('turn/started', { turn: { id: turnId, status: 'inProgress' } });
      for (let i = 0; i < 3; i++) timers.push(setTimeout(() => {
        emit('turn/plan/updated', { plan: steps.map((step, j) => ({ step, status: j < i ? 'completed' : j === i ? 'inProgress' : 'pending' })) });
        emit('item/started', { item: { type: 'commandExecution', id: randomUUID() } });
      }, i * 4000 + 300));
      timers.push(setTimeout(() => {
        emit('turn/plan/updated', { plan: steps.map(step => ({ step, status: 'completed' })) });
        emit('item/completed', { item: { type: 'agentMessage', text: JSON.stringify({ status: 'done', summary: '演示流程完成：三个计划步骤已模拟验证，未修改项目文件。' }) } });
        emit('turn/completed', { turn: { id: turnId, status: 'completed' } });
      }, 12500));
      this.timers.set(p.threadId, timers);
      return { turn: { id: turnId } };
    }
    return {};
  }
  send() {}
  close() { for (const timers of this.timers.values()) for (const timer of timers) clearTimeout(timer); }
}

export function demoState() {
  const now = Date.now();
  return {
    settings: { enabled: true, pollSeconds: 30, minimumRemaining: 5, maxRounds: 20, maxWakeSends: 20 },
    tasks: [
      { id: 'demo-1', name: '个人知识库', cwd: 'E:\\Projects\\knowledge-hub', prompt: '完成个人知识库的全文搜索，并验证搜索结果。', continuous: true, status: 'paused', activity: '全文索引已建立，等待继续验证搜索结果', rounds: 2, plan: [{ step: '建立全文索引', status: 'completed' }, { step: '接入搜索界面', status: 'completed' }, { step: '验证搜索结果', status: 'pending' }], output: '', createdAt: now, updatedAt: now },
      { id: 'demo-2', name: '设计系统 · 组件文档', cwd: 'E:\\Projects\\design-system', prompt: '为组件库补充使用文档与示例。', continuous: false, status: 'paused', activity: '已完成 Button 和 Input，等待继续', rounds: 1, plan: [{ step: '基础组件文档', status: 'completed' }, { step: '布局组件文档', status: 'pending' }, { step: '交互示例', status: 'pending' }, { step: '校验文档', status: 'pending' }], output: '', createdAt: now, updatedAt: now },
      { id: 'demo-3', name: 'API 服务 · 单元测试', cwd: 'E:\\Projects\\api-service', prompt: '完善 API 服务的单元测试。', continuous: false, status: 'completed', activity: '演示记录：测试用例已补齐', rounds: 3, plan: [{ step: '编写用例', status: 'completed' }, { step: '运行验证', status: 'completed' }], output: '', createdAt: now, updatedAt: now },
    ],
    logs: [{ id: 'l1', time: now, type: 'info', message: '演示模式已启动，所有额度与工作记录均为模拟数据' }, { id: 'l2', time: now - 180000, type: 'success', message: 'API 服务 · 单元测试：模拟工作已完成' }],
    history: Array.from({ length: 24 }, (_, i) => ({ time: now - (23 - i) * 300000, values: [{ id: 'codex', used: 18 + Math.floor(i * 2.17) }] })),
  };
}

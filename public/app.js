import { t as tr, systemText, setFormError, locale, setLanguage, staticInterface, refreshLocalizedContent, defaultContinuation } from './i18n.js';
import { TaskDetails } from './task-details.js';
import { accessHeaders } from './access.js';
import { VisibleFeed, setHtml } from './view-lifecycle.js';
import { ApprovalDetails } from './approval-details.js';
import { storageNotice } from './storage-status.js';
import { taskMode, wakeExplanation } from './task-mode.js';
const paths = {
 overview: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
 tasks: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 3h6v4H9zM8 12h8M8 16h5"/>',
 chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
 logs: '<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4"/>',
 settings: '<path d="m9 3-1 3-3 1-1 4 2 2v3l3 2 3-1 3 1 3-2v-3l2-2-1-4-3-1-1-3z"/><circle cx="12" cy="11" r="3"/>',
 shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
 sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
 refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
 plus: '<path d="M12 5v14M5 12h14"/>',
 arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
 play: '<path d="m8 5 11 7-11 7z"/>',
 pause: '<path d="M8 5v14M16 5v14"/>',
 clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 bolt: '<path d="m13 2-9 12h7l-1 8L21 9h-8z"/>',
 folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
 check: '<path d="m5 12 4 4L19 6"/>',
 close: '<path d="m6 6 12 12M6 18 18 6"/>',
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>',
 import: '<path d="M4 14v6h16v-6M12 3v12m-5-5 5 5 5-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.tasks}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const applyStaticLanguage = staticInterface(document);
const $ = selector => document.querySelector(selector);
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const labels = () => ({ overview: tr('概览'), tasks: tr('工作任务'), quota: tr('额度监测'), logs: tr('活动日志'), settings: tr('设置') });
const statusLabels = () => ({ queued: tr('排队中'), waiting: tr('等待额度'), starting: tr('准备中'), running: tr('进行中'), pausing: tr('暂停中'), paused: tr('已暂停'), blocked: tr('需要关注'), failed: tr('执行失败'), completed: tr('已完成'), approval: tr('等待授权') });
const taskLabel=t=>t.status==="monitoring" ? tr("监测中") : t.waitReason==="desktop" ? tr("等待发送通道") : t.status==='waiting' && ['writer','thread'].includes(t.waitReason) ? tr('等待会话') : statusLabels()[t.status] || t.status;
const active = ['running', 'starting', 'approval', 'pausing'];
const taskDetails = new TaskDetails(api, () => { if (!document.hidden && selectedTask) renderDetail(selectedTask); }, error => toast(systemText(error.message)));
const approvalDetails = new ApprovalDetails(api, () => render());
let modalRenderer = null, importList = null;
let state, page = 'overview', filter = 'all', selectedTask, toastTimer, streamAlive = true;
const main = $('#main');
const modal = $('#modal');
const time = value => value ? new Date(value).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
function relative(value) { const sec = Math.max(0, Math.round((Date.now() - value) / 1000)); return sec < 60 ? tr('刚刚') : sec < 3600 ? tr`${Math.floor(sec / 60)} 分钟前` : tr`${Math.floor(sec / 3600)} 小时前`; }
function resetLabel(value) { if (!value) return tr('恢复时间未知'); const diff = Math.max(0, value * 1000 - Date.now()); if (!diff) return tr('等待额度刷新确认'); const h = Math.floor(diff / 3600000), m = Math.ceil(diff % 3600000 / 60000); return tr`${h >= 24 ? tr`${Math.floor(h / 24)} 天 ${h % 24} 小时` : h ? tr`${h} 小时 ${m} 分钟` : tr`${m} 分钟`}后重置`; }
function allBuckets() { const values = Object.values(state.quota?.rateLimitsByLimitId || {}).filter(Boolean); return values.length ? values : state.quota?.rateLimits ? [state.quota.rateLimits] : []; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
async function api(path, body) {
  const response = await fetch(path, { credentials: 'omit', redirect: 'error', headers: { ...accessHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || tr('请求失败')); return data;
}
function toggle(on, action, label, id = '') { return `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-action="${action}" data-id="${id}"></button>`; }
function badge(task) { return `<span class="badge ${task.status}">${esc(taskLabel(task))}</span>`; }
function heading(title, description, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">YOUR WORK, CONTINUED.</div><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="actions">${actions}</div></div>`; }
const newButton = () => tr`<button class="primary" data-action="new">${icon('plus')}新建工作</button>`;
const refreshButton = () => tr`<button data-action="refresh">${icon('refresh')}刷新额度</button>`;
function empty(title, text, button = false) { return `<div class="empty">${icon('folder')}<h3>${title}</h3>${text}${button ? `<div>${newButton()}</div>` : ''}</div>`; }
function quotaCard(window, title, color = '') {
  const valid = Number.isFinite(window?.usedPercent);
  const remaining = valid ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null;
  return `<article class="card stat"><div class="stat-head"><span>${esc(title)}</span>${icon('clock')}</div><div class="stat-number ${color}">${remaining === null ? '—' : Math.round(remaining)}<small>${remaining === null ? tr('数据未知') : tr('% 剩余')}</small></div><div class="meter ${remaining !== null && remaining < state.settings.minimumRemaining ? 'orange' : color}"><span style="width:${remaining ?? 0}%"></span></div><div class="stat-foot"><span>${remaining === null ? tr('等待账户数据') : resetLabel(window.resetsAt)}</span><span>${remaining === null ? '' : tr`已用 ${Math.round(window.usedPercent)}%`}</span></div></article>`;
}
function stats() {
  const bucket = allBuckets().find(b => b.limitId === 'codex') || allBuckets()[0];
  const running = state.tasks.filter(t => active.includes(t.status)).length;
  const continuous = state.tasks.filter(t => t.continuous && t.status !== 'completed').length;
  const windowName = (w, fallback) => w?.windowDurationMins ? (w.windowDurationMins >= 1440 ? tr`${w.windowDurationMins / 1440} 天额度` : tr`${w.windowDurationMins / 60} 小时额度`) : fallback;
  return tr`<div class="stats">${quotaCard(bucket?.primary, windowName(bucket?.primary, tr('短期额度')), 'purple')}${quotaCard(bucket?.secondary, windowName(bucket?.secondary, tr('长期额度')), 'green')}<article class="card stat"><div class="stat-head"><span>进行中的工作</span>${icon('tasks')}</div><div class="stat-number">${running}<small>/ ${state.tasks.filter(t => t.status !== 'completed').length} 个工作</small></div><div class="mini-steps">${Array.from({ length: 10 }, (_, i) => `<span class="${i < running ? 'filled' : ''}"></span>`).join('')}</div><div class="stat-foot"><span>${running ? tr('正在推进项目目标') : tr('准备好继续下一步')}</span><span>串行执行</span></div></article><article class="card stat"><div class="stat-head"><span>持续工作已开启</span>${icon('bolt')}</div><div class="stat-number purple">${continuous}<small>个工作</small></div><div class="mini-steps">${Array.from({ length: 10 }, (_, i) => `<span class="${i < continuous ? 'filled' : ''}"></span>`).join('')}</div><div class="stat-foot"><span>额度恢复后自动接续</span>${icon('arrow')}</div></article></div>`;
}
function banner() { return tr`<div class="banner"><div class="banner-icon">${icon('bolt')}</div><div><h3>${state.settings.enabled ? tr('让工作持续向前') : tr('自动调度已暂停')}</h3><p>${state.settings.enabled ? tr('监测可用额度，在合适的时刻接续每一项工作。') : tr('当前轮次继续执行，新轮次将等待你重新开启调度。')}</p></div><span class="banner-label">自动调度</span>${toggle(state.settings.enabled, 'scheduler', tr('自动调度'))}</div>`; }
function tasksPanel(full = false) {
  const list = state.tasks.filter(t => filter !== 'continuous' || t.continuous);
  return tr`<div class="card ${full ? 'full-tasks' : ''}"><div class="tabs">${[['all', tr('全部工作')], ['continuous', tr('持续工作')]].map(([value, label]) => `<button class="tab ${value === filter ? 'active' : ''}" data-filter="${value}">${label}${value === 'all' ? ` <span class="pill">${state.tasks.length}</span>` : ''}</button>`).join('')}</div>${list.length ? `<div class="task-list">${list.map(taskCard).join('')}</div>` : empty(tr('这里还没有工作'), tr('添加项目目标，让每一次额度都用在进展上。'), true)}<div class="card-bottom">${icon('shield')}已完成的工作自动清除；需授权时等待你的决定</div></div>`;
}
function taskCard(t) {
  const mode = taskMode(t, state.settings);
  return tr`<article class="task"><div class="task-top"><div class="task-icon">${icon('folder')}</div><div class="task-info"><button class="task-title" data-action="detail" data-id="${t.id}">${esc(t.name)}</button><div class="task-path" title="${esc(t.cwd)}">${esc(t.cwd)}</div></div>${badge(t)}</div>${mode.wake ? tr`<p class="monitor-note"><strong>监测备注</strong><span>${esc(t.notePreview ?? t.note ?? tr('未填写')) || tr('未填写')}</span>${t.noteTruncated ? tr('<small>更多内容见详情</small>') : ''}</p>` : ''}<div class="task-progress"><div class="meter ${t.status === 'completed' ? 'green' : ''}"><span style="width:${t.progress ?? 0}%"></span></div><span>${mode.progress || (t.progress === null ? tr('无计划') : `${t.progress}%`)}</span></div><div class="task-path">${esc(mode.counter)}</div><div class="task-activity" title="${esc(systemText(t.activity))}">${esc(systemText(t.activity))}</div><div class="task-bottom"><div class="task-auto">${toggle(t.continuous, 'continuous', `${t.name}${mode.continuous}`, t.id)}${mode.continuous}</div><div class="task-controls"><button class="text-button" data-action="detail" data-id="${t.id}">查看详情</button>${t.status === 'completed' ? '' : `<button class="text-button" data-action="${active.includes(t.status) || ['monitoring', 'waiting', 'queued'].includes(t.status) ? 'pause' : 'resume'}" data-id="${t.id}">${active.includes(t.status) || ['monitoring', 'waiting', 'queued'].includes(t.status) ? mode.pause : mode.resume} ${icon(active.includes(t.status) ? 'pause' : 'play')}</button>`}</div></div></article>`;
}
function flowPanel() { return tr`<article class="card side-panel"><div class="section-head"><h2>持续工作策略</h2><span class="pill">${state.settings.enabled ? tr('已启用') : tr('已暂停')}</span></div><div class="flow"><span class="flow-icon">${icon('chart')}</span><div><strong>持续监测额度</strong><p>每 ${state.settings.pollSeconds} 秒同步，实时接收更新</p></div></div><div class="flow"><span class="flow-icon">${icon('clock')}</span><div><strong>额度不足，保留现场</strong><p>保存会话，等待所有额度窗口恢复</p></div></div><div class="flow"><span class="flow-icon">${icon('play')}</span><div><strong>恢复后，按模式接续</strong><p>剩余额度 ≥ ${state.settings.minimumRemaining}% 时自动续作</p></div></div><p class="help-note">直接执行：完成、阻塞或达到 ${state.settings.maxRounds} 轮时停止。原聊天：${esc(wakeExplanation)}每条记录累计最多发送 ${state.settings.maxWakeSends} 次。</p><button class="text-button" style="margin-top:13px" data-page="settings">调整工作策略 ${icon('arrow')}</button></article>`; }
function recentPanel() { return tr`<article class="card side-panel"><div class="section-head"><h2>最近活动</h2><button class="text-button" data-page="logs">全部 ${icon('arrow')}</button></div>${state.logs.slice(0, 3).map(log => `<div class="log-preview"><i class="status-dot" style="background:${log.type === 'warning' ? 'var(--orange)' : log.type === 'success' ? 'var(--green)' : 'var(--purple)'}"></i><div><p>${esc(systemText(log.message))}</p><time>${relative(log.time)}</time></div></div>`).join('') || tr('<p class="help-note">开始第一项工作后，活动会记录在这里。</p>')}</article>`; }
function chart() {
  const data = state.history.map(h => ({ time: h.time, value: h.values.find(v => v.id === 'codex')?.used ?? h.values[0]?.used })).filter(h => Number.isFinite(h.value));
  if (data.length < 2) return tr`<article class="card trend-panel"><h2>额度使用趋势</h2><div class="empty">收集到至少两个额度样本后显示趋势</div></article>`;
  const width = 900, start = data[0].time, duration = data.at(-1).time - start || 1;
  const points = data.map(d => `${((d.time - start) / duration * width).toFixed(2)},${(104 - Math.max(0, Math.min(100, d.value)) * .92).toFixed(2)}`).join(' ');
  return tr`<article class="card trend-panel"><div class="chart-heading"><h2>额度使用趋势</h2><span class="chart-legend"><i></i>短期额度 · 已使用比例</span></div><svg class="chart" viewBox="0 0 940 115" preserveAspectRatio="none" role="img" aria-label="近期已使用额度趋势"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#9cad78" stop-opacity=".2"/><stop offset="100%" stop-color="#9cad78" stop-opacity=".01"/></linearGradient></defs>${[12, 58, 104].map((y, i) => `<line x1="0" y1="${y}" x2="900" y2="${y}" stroke="var(--line)" stroke-dasharray="4 5"/><text x="910" y="${y + 3}">${100 - i * 50}%</text>`).join('')}<polygon points="0,104 ${points} 900,104" fill="url(#chart-fill)"/><polyline points="${points}" fill="none" stroke="var(--purple)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="chart-times"><span>${time(start)}</span><span>${time(start + duration / 2)}</span><span>${time(data.at(-1).time)}</span></div></article>`;
}
function alerts() {
  let html = storageNotice(state, esc);
  if (state.demo) html += tr`<div class="notice demo">${icon('info')}演示模式 · 模拟额度与任务，不执行真实项目<div class="actions"><button class="small" data-action="exhaust">模拟耗尽</button><button class="small" data-action="recover">模拟恢复</button></div></div>`;
  if (state.connection.status !== 'connected') html += tr`<div class="notice">${icon('info')} ${esc(systemText(state.connection.message))}。请先在终端运行 codex login，确认 CLI 可用后刷新。额度未知时不会自动执行。</div>`;
  for (const a of approvalDetails.readAll(state.approvals)) html += tr`<div class="card approval"><h3>操作等待授权</h3><p>${esc(a.reason)}</p><pre class="detail-output">${esc(a.command || a.method)}\n${esc(a.cwd)}</pre>${a.requiresDetails ? tr('<p>完整授权内容尚未加载，请刷新重试；加载完成后可允许操作。</p>') : ''}<div class="actions"><button class="primary small" data-action="approve" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}" ${a.requiresDetails ? 'disabled' : ''}>允许本次</button><button class="small" data-action="decline" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}">拒绝</button></div></div>`;
  return html;
}
function settings() { const s = state.settings; return tr`${heading(tr('设置'), tr('按照你的工作节奏，安排每一次继续。'))}<form id="settings-form"><div class="card settings-card"><div class="setting-row"><div><h3>自动调度</h3><p>关闭后不再启动新轮次，正在进行的轮次会继续。</p></div>${toggle(s.enabled, 'scheduler', tr('自动调度'))}</div><div class="setting-row"><div><h3>额度同步间隔</h3><p>10–90 秒，接收实时事件并定期校验；额度有效期仍为 90 秒。</p></div><select name="pollSeconds">${[...new Set([10, 15, 30, 60, 90, s.pollSeconds])].sort((a, b) => a - b).map(n => tr`<option value="${n}" ${s.pollSeconds === n ? 'selected' : ''}>${n} 秒</option>`).join('')}</select></div><div class="setting-row"><div><h3>恢复阈值</h3><p>所有返回的额度窗口剩余比例达到此值，才允许启动。</p></div><div><input name="minimumRemaining" type="number" min="1" max="99" value="${s.minimumRemaining}" required aria-label="恢复阈值"> %</div></div><div class="setting-row"><div><h3>直接执行轮次上限</h3><p>仅用于新建工作的自动执行；到限等待手动继续。</p></div><div><input name="maxRounds" type="number" min="1" max="100" value="${s.maxRounds}" required aria-label="直接执行轮次上限"> 轮</div></div><div class="setting-row"><div><h3>原聊天发送次数上限</h3><p>每条监测记录累计计数，暂停或重新开启不清零。到限停止；提高上限后手动开启监测。</p></div><div><input name="maxWakeSends" type="number" min="1" max="100" value="${s.maxWakeSends}" required aria-label="原聊天发送次数上限"> 次</div></div><div class="setting-row"><div><h3>本地连接</h3><p>使用本机 Codex 登录状态与默认模型，凭据由 Codex CLI 管理。<br>工作在项目目录沙箱内进行；请求额外权限时需单独批准。</p></div><span class="badge ${state.connection.status === 'connected' ? 'completed' : 'waiting'}">${state.connection.status === 'connected' ? tr('已连接') : tr('未连接')}</span></div></div><div class="settings-actions"><button class="primary" type="submit">保存设置</button><span class="form-error" id="settings-error"></span></div></form><p class="subtitle">本地服务需持续运行，关机或休眠期间不执行。关闭页面不影响后台服务；原生挂件提供系统托盘；随 Codex 启动：${state.diagnostics?.autostart.watcherRunning ? tr('监听器运行中') : state.diagnostics?.autostart.enabled === false ? tr('已关闭') : tr('监听器未运行或状态未知')}。<br>构建 ${esc(state.buildId || '')} · 协议 ${state.protocolVersion} · <button type="button" class="text-button" data-action="health">运行诊断</button></p>`; }
function render() {
  if (!state || document.hidden) return;
  const languageChanged = setLanguage(state.settings.language || 'zh'); applyStaticLanguage();
  if (languageChanged && modalRenderer && modal.open) refreshLocalizedContent($('#modal-body'), modalRenderer, true);
  const draft = languageChanged && page === 'settings' && $('#settings-form') ? new FormData($('#settings-form')) : null;
  $('#app-version').textContent = `v${state.version} · ${state.buildId.slice(0, 8)}`;
  $('#nav-count').textContent = state.tasks.filter(t => t.status !== 'completed').length;
  $('#breadcrumb-current').textContent = labels()[page];
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const connected = state.connection.status === 'connected' && streamAlive;
  $('#connection').textContent = !streamAlive ? tr('本地服务断开') : state.demo ? tr('演示连接') : connected ? tr('本地服务已连接') : tr('等待 Codex 连接');
  $('#connection').classList.toggle('off', !connected);
  $('#footer-status').textContent = !streamAlive ? tr('本地服务断开，正在重连') : state.demo ? tr('演示模式 · 模拟数据') : connected ? tr('Codex App Server 已连接') : tr('等待连接 Codex CLI');
  $('#footer-update').textContent = tr`每 ${state.settings.pollSeconds} 秒同步 · ${state.sampledAt ? tr`更新于 ${time(state.sampledAt)}` : tr('额度数据未知')}`;
  // Preserve form input while background events arrive.
  if (!languageChanged && page === 'settings' && $('#settings-form')) {
    const control = $('#settings-form .switch');
    control.classList.toggle('on', state.settings.enabled);
    control.setAttribute('aria-checked', String(state.settings.enabled));
    return;
  }
  let html;
  if (page === 'overview') html = tr`${heading(tr('工作概览'), tr('掌握每一份额度，让每一个项目稳步向前。'), refreshButton() + newButton())}${alerts()}${banner()}${stats()}<div class="content-grid"><section><div class="section-head"><h2>我的工作 <span class="pill">${state.tasks.length}</span></h2><button class="text-button" data-action="import">${icon('import')}导入会话</button></div>${tasksPanel()}${chart()}</section><aside class="right-column">${flowPanel()}${recentPanel()}</aside></div>`;
  else if (page === 'tasks') html = `${heading(tr('工作任务'), tr('目标、进度、下一步，在这里井然有序。'), tr`<button data-action="import">${icon('import')}导入会话</button>${newButton()}`)}${alerts()}${tasksPanel(true)}`;
  else if (page === 'quota') html = tr`${heading(tr('额度监测'), tr('同步账户可用额度，准确掌握下一次出发的时间。'), refreshButton())}${alerts()}${allBuckets().length ? allBuckets().map(b => `<div class="section-head"><h2>${esc(b.limitName || b.limitId || 'Codex')} <span class="pill">${esc(b.planType || tr('账户额度'))}</span></h2></div><div class="quota-grid">${quotaCard(b.primary, tr('主要额度窗口'), 'purple')}${quotaCard(b.secondary, tr('次要额度窗口'), 'green')}</div>`).join('<br>') : empty(tr('额度暂不可用'), tr('连接已登录的 Codex CLI 后显示真实额度。'))}${chart()}<p class="subtitle">重置时间来自服务端，仅作参考。系统会读取恢复后的新样本，再决定是否继续工作。</p>`;
  else if (page === 'logs') html = `${heading(tr('活动日志'), tr('显示最近 50 条活动；导出可获取最多 300 条。'), tr('<button data-action="export">导出日志</button>'))}<div class="card">${state.logs.length ? tr`<table class="log-table"><thead><tr><th>时间</th><th>类型</th><th>活动</th></tr></thead><tbody>${state.logs.map(l => `<tr><td>${new Date(l.time).toLocaleDateString(locale())} ${time(l.time)}</td><td><span class="badge ${l.type === 'success' ? 'completed' : l.type === 'warning' ? 'waiting' : ''}">${({ success: tr('成功'), warning: tr('关注'), info: tr('信息') })[l.type]}</span></td><td>${esc(systemText(l.message))}</td></tr>`).join('')}</tbody></table>` : empty(tr('暂无活动记录'), tr('添加工作后，调度记录将显示在这里。'))}</div>`;
  else html = settings();
  setHtml(main, html);
  if (draft) for (const [name, value] of draft) { const input = $('#settings-form').elements.namedItem(name); if (input) input.value = value; }
  if (modal.open && selectedTask) renderDetail(selectedTask);
}
function openModal(html) { modalRenderer = null; importList = null; selectedTask = null; $('#modal-body').innerHTML = html; if (!modal.open) modal.showModal(); }
function openLocalized(render) { openModal(''); modalRenderer = render; refreshLocalizedContent($('#modal-body'), render); }
function modalHead(title) { return tr`<div class="modal-head"><h2>${title}</h2><button class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></div>`; }
function newTask() { openLocalized(() => tr`${modalHead(tr('新建工作'))}<p class="subtitle">给项目一个明确目标，Continuer 帮你接续进展。</p><form id="task-form"><label class="form-field">工作名称<input name="name" maxlength="120" placeholder="例如：完善个人知识库搜索" required autofocus></label><label class="form-field">项目目录<input name="cwd" placeholder="E:\\Projects\\my-project" required><small>填写本机现有目录的绝对路径，Codex 将在此目录工作。</small></label><label class="form-field">工作目标<textarea name="prompt" maxlength="12000" placeholder="描述需要完成的功能与验收标准…" required></textarea></label><label class="check-label"><input name="continuous" type="checkbox" checked>持续工作，额度恢复后自动继续</label><p class="subtitle">创建后加入队列；额度充足且调度开启时开始执行。</p><div class="form-error" id="modal-error"></div><div class="modal-actions"><button type="button" data-action="close">取消</button><button class="primary" type="submit">创建工作 ${icon('arrow')}</button></div></form>`); }
function renderDetail(id) {
  const summary = state.tasks.find(t => t.id === id); if (!summary) { modal.close(); selectedTask = null; return; }
  const t = taskDetails.read(summary);
  const mode = taskMode(t, state.settings);
  $('#modal-body').innerHTML = tr`${modalHead(esc(t.name))}${badge(t)}<p class="subtitle">${esc(t.cwd)}</p><p class="detail-summary">${esc(mode.description)}</p>${mode.wake ? tr`<p class="detail-summary"><strong>续作消息</strong><br>${esc(t.continuationMessage?.trim() || defaultContinuation(state.settings.language))}</p><p class="subtitle">${esc(wakeExplanation)}</p>` : tr`<h3>计划进度 ${t.progress === null ? tr('· 暂无计划') : `· ${t.progress}%`}</h3><ul class="detail-plan">${(t.plan || []).map(s => `<li class="${s.status}">${icon(s.status === 'completed' ? 'check' : s.status === 'inProgress' ? 'play' : 'clock')}${esc(s.step)}</li>`).join('')}</ul><p class="subtitle">计划百分比仅表示已完成步骤比例。</p>`}<p class="subtitle">当前状态：${esc(systemText(t.activity))} · ${esc(mode.counter)}</p>${t.threadId ? tr`<p class="subtitle">会话：${esc(t.threadId)}</p>` : ''}${!mode.wake ? tr`<h3>本轮输出</h3>${t.outputTruncated ? tr('<p class="subtitle">输出较长，仅保留末尾预览；完整内容请在原 Codex 会话查看。</p>') : ''}<pre class="detail-output">${esc(t.output || tr('尚无输出'))}</pre>` : ''}<div class="modal-actions">${!active.includes(t.status) && t.status !== 'completed' ? `<button data-action="complete" data-id="${t.id}">${mode.complete}</button>` : ''}<button class="primary" data-action="close">关闭</button></div>`;
}
async function importModal(cursor = null, append = false) {
  if (!append) {
    const list = { data: [], nextCursor: null, loading: true, error: null };
    const render = () => tr`${modalHead(tr('导入 Codex 会话'))}<p class="subtitle">选择需要管理的本机会话。导入后先保持暂停。</p><div id="thread-list">${list.loading && !list.data.length ? tr('<div class="loading">正在读取会话…</div>') : list.data.map(t => tr`<div class="thread-option"><div><strong>${esc(t.name || t.preview || tr('未命名会话'))}</strong><small>${esc(t.cwd || t.id)}</small></div><button class="small" data-action="choose-thread" data-id="${esc(t.id)}">选择</button></div>`).join('') || tr('<p class="subtitle">没有可导入的会话</p>')}</div><div id="thread-more">${list.nextCursor ? tr`<button class="text-button" data-action="more-threads" data-cursor="${esc(list.nextCursor)}" ${list.loading ? 'disabled' : ''}>加载更多</button>` : ''}</div><div class="form-error" id="modal-error">${esc(systemText(list.error?.message || ''))}</div>`;
    openLocalized(render); importList = { list, render };
  }
  const current = importList;
  if (!current) return;
  current.list.loading = true; current.list.error = null;
  refreshLocalizedContent($('#modal-body'), current.render);
  try {
    const result = await api(`/api/threads${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (modalRenderer !== current.render || !modal.open) return;
    const remaining = 300 - (append ? current.list.data.length : 0);
    current.list.data = [...(append ? current.list.data : []), ...result.data.slice(0, remaining)];
    current.list.nextCursor = result.nextCursor && remaining > result.data.length ? result.nextCursor : null;
  } catch (error) { current.list.error = error; }
  finally {
    current.list.loading = false;
    if (modalRenderer === current.render && modal.open) refreshLocalizedContent($('#modal-body'), current.render);
  }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.page) { page = button.dataset.page; render(); return; }
  if (button.dataset.filter) { filter = button.dataset.filter; render(); return; }
  const { action, id, token } = button.dataset; if (!action) return;
  try {
    if (action === 'close') { modal.close(); selectedTask = null; return; }
    if (action === 'new') { newTask(); return; }
    if (action === 'health') { const health = await api('/api/health'); openLocalized(() => `${modalHead(tr('运行诊断'))}<pre class="detail-output">${esc(JSON.stringify(health, null, 2))}</pre>`); return; }
    if (action === 'detail') { openModal(''); selectedTask = id; renderDetail(id); return; }
    if (action === 'import') { await importModal(); return; }
    if (action === 'more-threads') { await importModal(button.dataset.cursor, true); return; }
    if (action === 'choose-thread') { openLocalized(() => tr`${modalHead(tr('监测原聊天额度'))}<form id="import-form" data-id="${esc(id)}"><label class="form-field">续作消息（可选）<textarea name="continuationMessage" maxlength="12000" placeholder="留空发送：继续；例如：优先完成测试，遇到阻塞时说明原因"></textarea><small>额度恢复时发送给原聊天；每次恢复使用此消息。</small></label><label class="form-field">监测备注（可选，仅本地保存）<textarea name="note" maxlength="12000"></textarea></label><p class="subtitle">导入后保持暂停。${esc(wakeExplanation)}</p><div id="modal-error" class="form-error"></div><div class="modal-actions"><button type="button" data-action="close">取消</button><button class="primary">导入会话</button></div></form>`); return; }
    if (action === 'export') { const logs = await api('/api/logs'); const blob = new Blob([JSON.stringify(logs.logs, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'continuer-logs.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
    button.disabled = true;
    if (action === 'storage-retry' || action === 'storage-backup') { state = await api('/api/storage/recover', { source: action === 'storage-backup' ? 'backup' : 'retry' }); toast(tr('恢复完成，调度保持关闭')); }
    else if (action === 'refresh') { state = await api('/api/refresh', {}); toast(state.connection.status === 'connected' ? tr('额度已同步') : tr('连接未成功，请查看提示')); }
    else if (action === 'scheduler') { state = await api('/api/settings', { enabled: !state.settings.enabled }); toast(state.settings.enabled ? tr('自动调度已开启') : tr('自动调度已暂停')); }
    else if (action === 'continuous') { state = await api(`/api/tasks/${id}`, { action, value: !state.tasks.find(t => t.id === id).continuous }); }
    else if (['pause', 'resume', 'complete'].includes(action)) { const wake = state.tasks.find(t => t.id === id)?.mode === 'quota-wake'; state = await api(`/api/tasks/${id}`, { action }); toast(wake ? (action === 'resume' ? tr('额度监测已开启') : action === 'complete' ? tr('监测已结束并移除') : tr('额度监测已暂停')) : (action === 'resume' ? tr('工作已加入队列') : action === 'complete' ? tr('已标记完成') : tr('已请求暂停'))); }
    else if (action === 'approve' || action === 'decline') { if (action === 'approve' && !approvalDetails.ready(state.approvals.find(item => String(item.id) === id && item.detailToken === token))) throw Error(tr('请先等待完整授权内容加载')); state = await api('/api/approval', { id, token, decision: action === 'approve' ? 'accept' : 'decline' }); }
    else if (action === 'exhaust' || action === 'recover') { state = await api('/api/demo/quota', { exhausted: action === 'exhaust' }); toast(action === 'exhaust' ? tr('模拟额度已耗尽') : tr('模拟额度已恢复')); }
    render();
  } catch (error) { toast(systemText(error.message)); } finally { button.disabled = false; }
});
document.addEventListener('submit', async event => {
  const form = event.target; event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"],button.primary'); submit.disabled = true;
  try {
    if (form.id === 'task-form') { state = await api('/api/tasks', { ...values, continuous: values.continuous === 'on' }); modal.close(); toast(tr('工作已创建')); }
    else if (form.id === 'import-form') { state = await api('/api/import', { ...values, threadId: form.dataset.id }); modal.close(); toast(tr('会话已导入，监测保持暂停')); }
    else if (form.id === 'settings-form') { state = await api('/api/settings', Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))); document.activeElement?.blur(); toast(tr('设置已保存')); }
    render();
  } catch (error) { const errorEl = form.querySelector('.form-error'); if (errorEl) setFormError(errorEl, error.message); else toast(systemText(error.message)); }
  finally { submit.disabled = false; }
});
$('#language').addEventListener('change', async event => { const input = event.target; input.disabled = true; try { state = await api('/api/settings', { language: input.value }); render(); } catch (error) { toast(systemText(error.message)); applyStaticLanguage(); } finally { input.disabled = false; } });
$('#theme').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('continuer-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); });
if (localStorage.getItem('continuer-theme') === 'dark') document.body.classList.add('dark');
modal.addEventListener('close', () => { if (modal.open) return; modalRenderer = null; importList = null; selectedTask = null; taskDetails.clear(); });
const stream = new VisibleFeed({ visible: () => !document.hidden, receive: data => { streamAlive = true; state = data; render(); }, error: () => { streamAlive = false; if (state) render(); else setHtml(main, tr('<div class="notice">本地服务连接失败，正在自动重连。请确认 npm start 仍在运行。</div>')); } });
document.addEventListener('visibilitychange', () => { stream.sync(); if (!document.hidden) render(); });
window.addEventListener('pagehide', () => stream.close());
window.addEventListener('pageshow', () => stream.sync());
stream.sync();

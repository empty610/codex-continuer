import { t as tr, systemText, setFormError, locale, setLanguage, staticInterface, refreshLocalizedContent, defaultContinuation } from './i18n.js';
import { TaskDetails } from './task-details.js';
import { accessHeaders } from './access.js';
import { VisibleFeed, LazyResource, setHtml } from './view-lifecycle.js';
import { ApprovalDetails } from './approval-details.js';
import { storageNotice } from './storage-status.js';
import { taskMode, wakeExplanation } from './task-mode.js';
import { quotaWindow, resetCountdown } from './quota-display.js';
import { pixelText } from './rhine-readout.js';
const applyStaticLanguage = staticInterface(document);
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bridge = window.continuerDesktop;
const labels = () => ({ queued: tr('排队中'), waiting: tr('等待额度'), starting: tr('准备中'), running: tr('进行中'), pausing: tr('暂停中'), paused: tr('已暂停'), blocked: tr('需要关注'), failed: tr('执行失败'), completed: tr('已完成'), approval: tr('等待授权') });
const taskLabel=t=>t.status==="monitoring" ? tr("监测中") : t.waitReason==="desktop" ? tr("等待发送通道") : t.status==='waiting' && ['writer','thread'].includes(t.waitReason) ? tr('等待会话') : labels()[t.status] || t.status;
const busy = ["monitoring", 'queued', 'waiting', 'starting', 'running', 'approval', 'pausing'];
const QUOTA_CYCLE_MS = 12000, QUOTA_TRANSITION_MS = 1000;
const taskDetails = new TaskDetails(api, () => { if (viewVisible() && detailId && $('#modal').open) detail(detailId); }, error => toast(systemText(error.message)));
const approvalDetails = new ApprovalDetails(api, () => render());
let lastDesktopLanguage, desktopPreferenceError = null, rendererAnnounced = false, rendererReady = false;
let modalRenderer = null, sessionModal = null;
let state, connected = true, settingsInitialized = false, lastPixelCountdown, timer, detailId;
let sessionItems = [], sessionCursor = null, sessionLoading = false, sessionError = null, lastSessionRead = 0, lastSessionAttempt = 0;
let windowSlot='primary', carouselTimer, swapTimer, refreshTimer, gaugeTimer, panelTimer, nativeVisible=!bridge, compactPixels=256;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const animation = new LazyResource(loadRhineAnimation);
function viewVisible() { return !document.hidden && nativeVisible; }
async function loadRhineAnimation() {
  const response=await fetch('/rhine-signal-loop.svg');
  if(!response.ok) throw Error(tr('Rhine 动画资源读取失败'));
  const source=new DOMParser().parseFromString(await response.text(),'image/svg+xml');
  if(source.querySelector('parsererror')) throw Error(tr('Rhine 动画资源无效'));
  $('#rhine-art').replaceChildren(document.importNode(source.documentElement,true));
  // Start the overlay on the same render frame as the SVG's 60-second cycle.
  $('#mini').classList.add('has-art');
  updateMotion();
}
function updateMotion() {
  const motion = viewVisible() && document.body.classList.contains('collapsed') ? 'running' : 'paused';
  if ($('#mini').dataset.motion !== motion) $('#mini').dataset.motion = motion;
}
function syncActivity() {
  const compact = document.body.classList.contains('collapsed'), visible = viewVisible();
  const active=compact && visible && !!state?.sampledAt;
  if (compact && visible && state) {
    if (!gaugeTimer) gaugeTimer = setInterval(renderGauge, 1000);
    if (!animation.loaded) void animation.ensure().catch(error => toast(systemText(error.message)));
  } else { clearInterval(gaugeTimer); gaugeTimer = null; }
  if (!compact && visible && state) {
    if (!panelTimer) panelTimer = setInterval(() => { render(); refreshSessionsIfNeeded(); }, 30000);
  } else { clearInterval(panelTimer); panelTimer = null; }
  if(active && !carouselTimer) {
    windowSlot='primary'; renderGauge();
    carouselTimer=setInterval(() => {
      clearTimeout(swapTimer); clearTimeout(refreshTimer);
      if(reducedMotion.matches) { windowSlot=windowSlot==='primary'?'secondary':'primary'; renderGauge(); return; }
      $('#mini').classList.remove('is-refreshing');
      $('#mini').classList.add('is-refreshing');
      // Change the quota, label and reset together at the opacity minimum.
      swapTimer=setTimeout(() => { windowSlot=windowSlot==='primary'?'secondary':'primary'; renderGauge(); },QUOTA_TRANSITION_MS / 2);
      refreshTimer=setTimeout(() => $('#mini').classList.remove('is-refreshing'),QUOTA_TRANSITION_MS);
    },QUOTA_CYCLE_MS);
  } else if(!active && carouselTimer) {
    clearInterval(carouselTimer); clearTimeout(swapTimer); clearTimeout(refreshTimer); carouselTimer=null;
    $('#mini').classList.remove('is-refreshing');
  }
  updateMotion();
}
function refreshSessionsIfNeeded() {
  if (viewVisible() && !document.body.classList.contains('collapsed') && document.activeElement !== $('#session-select') && !$('#modal').open
    && Date.now() - Math.max(lastSessionRead, lastSessionAttempt) >= 60000) void readSessions();
}
function syncView() {
  stream.sync();
  if (state && viewVisible()) render(); else syncActivity();
}
function selectedSession() { return sessionItems.find(t => t.id === $('#session-select').value); }
function renderSessionOptions() {
  const select = $('#session-select'), chosen = select.value || localStorage.getItem('continuer-selected-session') || '';
  const placeholder = sessionError && !sessionItems.length ? tr('会话暂不可用') : sessionItems.length ? tr('选择当前要管理的对话…') : !lastSessionRead && !sessionError ? tr('正在读取已有对话…') : tr('暂无本地 Codex 对话');
  setHtml(select, `<option value="">${placeholder}</option>` + sessionItems.map(t => `<option value="${esc(t.id)}">${esc((t.name || t.preview || t.id).slice(0, 90))}</option>`).join(''));
  select.value = sessionItems.some(t => t.id === chosen) ? chosen : '';
  $('#session-more').hidden = !sessionCursor;
  $('#session-more').disabled = sessionLoading;
  updateSessionSelection();
}
function updateSessionSelection() {
  const t = selectedSession();
  const managed = t && state?.tasks.find(task => task.threadId === t.id);
  $('#add-session').disabled = !t;
  $('#add-session').textContent = managed ? tr('查看已加入的工作') : tr('加入我的工作');
  $('#session-preview').textContent = sessionError ? tr`读取失败：${systemText(sessionError.message)}，请点击「↻ 对话」重试。` : t ? `${t.cwd || tr('未提供项目目录')}${t.updatedAt ? tr` · ${new Date(t.updatedAt * 1000).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 更新` : ''}` : tr('按最近更新排序，选择你正在进行的对话。');
}
async function readSessions(more = false) {
  if (sessionLoading) return;
  sessionLoading = true;
  sessionError = null;
  lastSessionAttempt = Date.now();
  const chosen = $('#session-select').value || localStorage.getItem('continuer-selected-session') || '';
  renderSessionOptions();
  try {
    const result = await api('/api/threads' + (more && sessionCursor ? `?cursor=${encodeURIComponent(sessionCursor)}` : ''));
    const retained = sessionItems.find(t => t.id === ($('#session-select').value || chosen));
    sessionItems = [...new Map([...(more ? sessionItems : []), ...(result.data || []), ...(!more && retained && !(result.data || []).some(t => t.id === retained.id) ? [retained] : [])].map(t => [t.id, t])).values()].slice(0, 300);
    sessionCursor = sessionItems.length < 300 ? result.nextCursor : null;
    lastSessionRead = Date.now();
  } catch (error) { sessionError = error; }
  finally { sessionLoading = false; renderSessionOptions(); }
}
const clock = t => t ? new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const percent = w => Number.isFinite(w?.usedPercent) ? Math.max(0, Math.min(100, 100 - w.usedPercent)) : null;
function reset(t) { if (!t) return tr('恢复时间未知'); const m = Math.ceil((t * 1000 - Date.now()) / 60000); return m <= 0 ? tr('等待恢复确认') : m >= 1440 ? tr`${Math.floor(m / 1440)} 天 ${Math.floor(m % 1440 / 60)} 小时后重置` : m >= 60 ? tr`${Math.floor(m / 60)} 小时 ${m % 60} 分钟后重置` : tr`${m} 分钟后重置`; }
function windowName(w, fallback) { const m = w?.windowDurationMins; return m ? m >= 1440 ? tr`${m / 1440} 天额度` : tr`${m / 60} 小时额度` : fallback; }
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(timer); timer = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
async function api(path, body) { const r = await fetch(path, { signal: AbortSignal.timeout(35000), credentials: 'omit', redirect: 'error', headers: { ...accessHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Continuer-Client': '1' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) }); const data = await r.json(); if (!r.ok) throw Error(data.error || tr('请求失败')); return data; }
function card(w, title) { const p = percent(w); return `<article class="quota"><div class="caption">${esc(title)}</div><strong>${p === null ? '—' : Math.round(p)}<small>${p === null ? tr('未知') : tr('% 剩余')}</small></strong><div class="meter"><i style="width:${p ?? 0}%"></i></div><div class="reset">${reset(w?.resetsAt)}</div></article>`; }
function renderGauge() {
  if (!state || document.hidden || !nativeVisible || !document.body.classList.contains('collapsed')) return;
  const reading = quotaWindow(state, windowSlot, connected);
  const available = reading.remaining !== null;
  const setText=(selector,value) => { const element=$(selector),text=String(value); if(element.textContent!==text) element.textContent=text; };
  setText('#mini-quota',available ? Math.round(reading.remaining) : '—');
  setText('#mini-reset',resetCountdown(reading.resetsAt));
  const countdown=$('#mini-reset').textContent;
  const numeric=/^\d/.test(countdown);
  $('#mini-reset').classList.toggle('visually-empty',numeric);
  if(numeric && countdown!==lastPixelCountdown) {
    const pixels=pixelText(countdown.replace(tr('天'),'d'));
    const scale=Math.min(1.9,104/pixels.width);
    $('#mini-reset-pixels').setAttribute('d',pixels.path);
    $('#mini-reset-pixels').setAttribute('transform',`translate(${128-pixels.width*scale/2} 176) scale(${scale})`);
  } else if(!numeric && countdown!==lastPixelCountdown) $('#mini-reset-pixels').setAttribute('d','');
  lastPixelCountdown=countdown;
  const windowLabel=windowSlot==='primary'?tr('五小时'):tr('七天');
  setText('#mini-window',tr`${windowLabel}可用额度`);
  setText('#mini-reset-label',tr('距离重置'));
  $('#mini').dataset.window=windowSlot;
  $('#quota-dot-primary').classList.toggle('selected',windowSlot==='primary');
  $('#quota-dot-secondary').classList.toggle('selected',windowSlot==='secondary');
  $('#mini').classList.toggle('offline', !available);
  $('#mini').title = tr`${available ? tr`${windowLabel}可用额度 ${Math.round(reading.remaining)}%，重置倒计时 ${resetCountdown(reading.resetsAt)}` : tr`${windowLabel}额度数据待同步`}。点击展开，拖动移动；Ctrl + 滚轮调整大小。`;
  $('#gauge-readout').setAttribute('aria-label',$('#mini').title);
}
function render() {
  if (!state) return;
  const languageChanged = setLanguage(state.settings.language || 'zh'); applyStaticLanguage();
  if ($('#error').dataset.sourceMessage) setFormError($('#error'), $('#error').dataset.sourceMessage);
  if (languageChanged && modalRenderer && $('#modal').open) refreshLocalizedContent($('#modal-body'), modalRenderer, true);
  if (bridge && !rendererAnnounced) {
    rendererAnnounced = true;
    bridge.control('renderer-ready').then(result => { rendererReady = true; applyDesktop(result); stream.sync(); }).catch(error => { rendererAnnounced = false; toast(systemText(error.message)); });
  }
  if (bridge && rendererReady && lastDesktopLanguage !== (state.settings.language || 'zh')) {
    const value = state.settings.language || 'zh'; lastDesktopLanguage = value;
    void bridge.control('language', value).catch(error => { lastDesktopLanguage = undefined; toast(systemText(error.message)); });
  }
  renderGauge();
  if(!viewVisible() || document.body.classList.contains('collapsed')) { syncActivity(); return; }
  const buckets = Object.values(state.quota?.rateLimitsByLimitId || {}).filter(Boolean);
  if (!buckets.length && state.quota?.rateLimits) buckets.push(state.quota.rateLimits);
  const stale = !state.sampledAt || Date.now() - state.sampledAt > 90000;
  setHtml($('#quotas'), (buckets.length ? buckets : [{}]).map(b => card(b.primary, (buckets.length > 1 ? `${b.limitName || b.limitId} · ` : '') + windowName(b.primary, tr('短期额度'))) + card(b.secondary, windowName(b.secondary, tr('长期额度')))).join(''));
  $('#updated').textContent = state.sampledAt ? tr`${clock(state.sampledAt)} 同步` : tr('等待同步');
  $('#health').textContent = desktopPreferenceError ? tr`挂件设置未保存：${desktopPreferenceError}` : !connected ? tr('本地服务断开，正在重连。') : state.demo ? tr('演示模式 · 模拟额度与任务，不执行真实项目') : state.connection.status !== 'connected' ? systemText(state.connection.message) : stale ? tr('额度样本已过期，等待刷新后再调度。') : tr('已连接 Codex · 实时事件 + 定期同步');
  setHtml($('#storage-status'), storageNotice(state, esc));
  $('#scheduler').checked = state.settings.enabled;
  $('.scheduler').classList.toggle('paused', !state.settings.enabled);
  $('#scheduler-note').textContent = state.settings.enabled ? tr`剩余额度 ≥ ${state.settings.minimumRemaining}% 时自动接续` : tr('调度已暂停 · 当前轮次仍会继续');
  $('#count').textContent = state.tasks.length;
  setHtml($('#tasks'), state.tasks.map(t => tr`<article class="task"><div class="task-top"><button class="task-title" data-action="detail" data-id="${esc(t.id)}">${esc(t.name)}</button><span class="badge ${esc(t.status)}">${esc(taskLabel(t))}</span></div><div class="path" title="${esc(t.cwd)}">${esc(t.cwd)}</div>${taskMode(t, state.settings).wake ? tr`<p class="monitor-note"><strong>监测备注</strong><span>${esc(t.notePreview ?? t.note ?? tr('未填写')) || tr('未填写')}</span>${t.noteTruncated ? tr('<small>更多内容见详情</small>') : ''}</p>` : ''}<div class="progress"><div class="meter"><i style="width:${Number.isFinite(t.progress) ? t.progress : 0}%"></i></div><span>${taskMode(t, state.settings).wake ? tr('原聊天中查看') : t.progress == null ? tr('无计划') : `${t.progress}%`}</span></div><p class="activity" title="${esc(systemText(t.activity))}">${esc(systemText(t.activity))}</p><p class="hint">${esc(taskMode(t, state.settings).counter)}</p><div class="task-bottom"><label><input type="checkbox" data-continuous="${esc(t.id)}" ${t.continuous ? 'checked' : ''}>${taskMode(t, state.settings).continuous}</label><div><button data-action="detail" data-id="${esc(t.id)}">详情</button>${t.status !== 'completed' ? `<button data-action="${busy.includes(t.status) ? 'pause' : 'resume'}" data-id="${esc(t.id)}">${busy.includes(t.status) ? taskMode(t, state.settings).pause : taskMode(t, state.settings).resume}</button>` : ''}</div></div></article>`).join('') || tr('<p class="empty">还没有工作<br>选择上方对话加入管理，或新建工作。</p>'));
  setHtml($('#approvals'), approvalDetails.readAll(state.approvals).map(a => tr`<div class="approval"><strong>操作等待授权</strong><p class="hint">${esc(a.reason)}</p><pre>${esc(a.command || a.method)}\n${esc(a.cwd)}</pre>${a.requiresDetails ? tr('<p>完整授权内容尚未加载，请刷新重试。</p>') : ''}<button data-action="approve" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}" ${a.requiresDetails ? 'disabled' : ''}>允许本次</button><button data-action="decline" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}">拒绝</button></div>`).join(''));
  setHtml($('#logs'), state.logs.slice(0, 10).map(l => `<div class="log"><time>${clock(l.time)}</time><span>${esc(systemText(l.message))}</span></div>`).join('') || tr('<p class="hint">暂无活动</p>'));
  if (!settingsInitialized) { for (const key of ['minimumRemaining', 'pollSeconds', 'maxRounds', 'maxWakeSends']) $(`#settings-form [name=${key}]`).value = state.settings[key]; settingsInitialized = true; }
  refreshSessionsIfNeeded();
  renderSessionOptions();
  syncActivity();
  if ($('#modal').open && detailId) {
    if (state.tasks.some(t => t.id === detailId)) detail(detailId);
    else { $('#modal').close(); detailId = null; }
  }
}
function open(title, html) { modalRenderer = null; sessionModal = null; detailId = null; $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; setFormError($('#error'), ''); if (!$('#modal').open) $('#modal').showModal(); }
function openLocalized(render) {
  open('', '');
  modalRenderer = () => { const view = render(); $('#modal-title').textContent = view.title; return view.html; };
  refreshLocalizedContent($('#modal-body'), modalRenderer);
}

function detail(id) {
  const summary = state.tasks.find(t => t.id === id); if (!summary) return;
  const t = taskDetails.read(summary);
  const mode = taskMode(t, state.settings);
  $('#modal-title').textContent = t.name;
  $('#modal-body').innerHTML = `<p class="detail-summary">${esc(mode.description)}</p><p class="hint">${esc(t.cwd)}<br>${esc(taskLabel(t))} · ${esc(mode.counter)}</p>${mode.wake ? tr`<p class="detail-summary"><strong>续作消息</strong><br>${esc(t.continuationMessage?.trim() || defaultContinuation(state.settings.language))}</p><p class="hint">${esc(wakeExplanation)}</p>` : `<ol class="steps">${(t.plan || []).map(s => `<li>${s.status === 'completed' ? '✓' : s.status === 'inProgress' ? '◉' : '○'} ${esc(s.step)}</li>`).join('')}</ol>`}<p class="detail-summary">${esc(systemText(t.activity))}</p>${!mode.wake && t.outputTruncated ? tr('<p class="hint">输出较长，仅保留末尾预览；完整内容请在原 Codex 会话查看。</p>') : ''}${!mode.wake && t.output ? `<pre>${esc(t.output)}</pre>` : ''}${t.status !== 'completed' ? `<button data-action="complete" data-id="${esc(id)}">${mode.complete}</button>` : ''}`;
}
async function sessions(cursor, append = false) {
  if (!append) {
    const list = { data: [], nextCursor: null, loading: true, error: null };
    openLocalized(() => {
      const options = list.data.map(t => `<button class="session" data-action="select-session" data-id="${esc(t.id)}">${esc(t.name || t.preview || t.id)}<small>${esc(t.cwd)}</small></button>`).join('');
      const empty = list.loading ? tr('<p class="hint">正在读取本机会话…</p>') : list.error ? tr('<p class="hint">会话暂不可用</p>') : tr('<p class="hint">没有可导入的会话</p>');
      const more = list.nextCursor ? tr`<button id="more" data-action="more" data-cursor="${esc(list.nextCursor)}" ${list.loading ? 'disabled' : ''}>加载更多</button>` : '';
      const retry = list.error ? tr('<button data-action="import">重试</button>') : '';
      return { title: tr('导入已有会话'), html: (options || empty) + more + retry };
    });
    sessionModal = { list, render: modalRenderer };
  }
  const current = sessionModal;
  if (!current) return;
  current.list.loading = true; current.list.error = null; setFormError($('#error'), '');
  refreshLocalizedContent($('#modal-body'), current.render);
  try {
    const result = await api('/api/threads' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
    if (modalRenderer !== current.render || !$('#modal').open) return;
    const remaining = 300 - (append ? current.list.data.length : 0);
    current.list.data = [...(append ? current.list.data : []), ...(result.data || []).slice(0, remaining)];
    current.list.nextCursor = remaining > (result.data || []).length ? result.nextCursor : null;
  } catch (error) {
    current.list.error = error;
    if (modalRenderer === current.render && $('#modal').open) setFormError($('#error'), error.message);
  } finally {
    current.list.loading = false;
    if (modalRenderer === current.render && $('#modal').open) refreshLocalizedContent($('#modal-body'), current.render);
  }
}


document.addEventListener('click', async e => { const b = e.target.closest('[data-action]'); if (!b) return; const { action, id, token } = b.dataset; try {
  if (action === 'sessions-refresh' || action === 'sessions-more') { await readSessions(action === 'sessions-more'); return; }
  if (action === 'add-session') {
    const t = selectedSession(); if (!t) return;
    const managed = state.tasks.find(task => task.threadId === t.id);
    if (managed) { open(tr('工作详情'), ''); detailId = managed.id; detail(managed.id); return; }
    openLocalized(() => ({ title: tr('监测原聊天额度'), html: tr`<form id="import-form" data-id="${esc(t.id)}"><strong>${esc(t.name || t.preview || tr('Codex 对话'))}</strong><p class="hint">${esc(t.cwd)}</p><label>续作消息（可选）<textarea name="continuationMessage" maxlength="12000" placeholder="留空发送：继续；例如：优先完成测试，遇到阻塞时说明原因"></textarea><small>额度恢复时发送给原聊天；每次恢复使用此消息。</small></label><label>监测备注（可选，仅本地保存）<textarea name="note" maxlength="12000" placeholder="例如：待继续的项目名称"></textarea></label><p class="hint">加入后保持暂停。${esc(wakeExplanation)}</p><button class="primary" type="submit">加入我的工作</button></form>` })); return;
  }
  if (action === 'new') { openLocalized(() => ({ title: tr('新建工作'), html: tr`<form id="new-form"><label>工作名称<input name="name" required maxlength="120" placeholder="例如：完成个人知识库搜索"></label><label>项目目录<span class="directory"><input name="cwd" required placeholder="E:\\Projects\\my-project">${bridge ? tr('<button type="button" data-action="pick">选择</button>') : ''}</span></label><label>目标与验收标准<textarea name="prompt" required maxlength="12000" placeholder="描述需要完成的功能和验证方式…"></textarea></label><label class="check"><input name="continuous" type="checkbox" checked>持续工作，额度恢复后自动继续</label><p class="hint">创建后进入执行队列。需要额外权限时会等待你确认。</p><button class="primary" type="submit">创建并加入队列</button></form>` })); return; }
  if (action === 'detail') { open(tr('工作详情'), ''); detailId = id; detail(id); return; }
  if (action === 'pick') { const path = await bridge.pickDirectory(); if (path) $('#new-form [name=cwd]').value = path; return; }
  if (action === 'import' || action === 'more') { await sessions(b.dataset.cursor, action === 'more'); return; }
  if (action === 'select-session') { openLocalized(() => ({ title: tr('监测原聊天额度'), html: tr`<form id="import-form" data-id="${esc(id)}"><label>续作消息（可选）<textarea name="continuationMessage" maxlength="12000" placeholder="留空发送：继续；例如：优先完成测试，遇到阻塞时说明原因"></textarea><small>额度恢复时发送给原聊天；每次恢复使用此消息。</small></label><label>监测备注（可选，仅本地保存）<textarea name="note" maxlength="12000"></textarea></label><p class="hint">导入后保持暂停。${esc(wakeExplanation)}</p><button class="primary" type="submit">导入会话</button></form>` })); return; }
  b.disabled = true;
  if (action === 'storage-retry' || action === 'storage-backup') { state = await api('/api/storage/recover', { source: action === 'storage-backup' ? 'backup' : 'retry' }); toast(tr('恢复完成，调度保持关闭')); }
  else if (action === 'refresh') { state = await api('/api/refresh', {}); toast(tr('额度同步请求已完成')); }
  else if (['pause', 'resume', 'complete'].includes(action)) state = await api(`/api/tasks/${encodeURIComponent(id)}`, { action });
  else if (action === 'approve' || action === 'decline') { if (action === 'approve' && !approvalDetails.ready(state.approvals.find(item => String(item.id) === id && item.detailToken === token))) throw Error(tr('请先等待完整授权内容加载')); state = await api('/api/approval', { id, token, decision: action === 'approve' ? 'accept' : 'decline' }); }
  render();
} catch (error) { if ($('#modal').open) setFormError($('#error'), error.message); else toast(systemText(error.message)); } finally { b.disabled = false; } });
document.addEventListener('change', async e => { const input = e.target; try { if (input.id === 'language') { input.disabled = true; try { state = await api('/api/settings', { language: input.value }); } finally { input.disabled = false; } } else if (input.id === 'scheduler') state = await api('/api/settings', { enabled: input.checked }); else if (input.dataset.continuous) state = await api(`/api/tasks/${encodeURIComponent(input.dataset.continuous)}`, { action: 'continuous', value: input.checked }); else if (input.id === 'follow') { applyDesktop(await bridge.control('follow', input.checked)); return; } else return; render(); } catch (error) { toast(systemText(error.message)); render(); } });
document.addEventListener('submit', async e => { e.preventDefault(); const form = e.target, values = Object.fromEntries(new FormData(form)), button = form.querySelector('[type=submit]'); button.disabled = true; setFormError($('#error'), ''); try { if (form.id === 'new-form') state = await api('/api/tasks', { ...values, continuous: values.continuous === 'on' }); else if (form.id === 'import-form') state = await api('/api/import', { threadId: form.dataset.id, note: values.note, continuationMessage: values.continuationMessage }); else if (form.id === 'settings-form') state = await api('/api/settings', Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))); if (form.id !== 'settings-form') $('#modal').close(); render(); toast(tr('已保存')); } catch (error) { if ($('#modal').open) setFormError($('#error'), error.message); else toast(systemText(error.message)); } finally { button.disabled = false; } });
function setSize(value) {
  compactPixels=Math.max(160,Math.min(420,Math.round(Number(value)||256)));
  document.documentElement.style.setProperty('--compact-size',`${compactPixels}px`);
  $('#compact-size').value=compactPixels; $('#compact-size-value').textContent=`${compactPixels} px`;
}
let nativeTransition,transitionAcknowledged;
function acknowledgeTransition() {
  if(!bridge || !nativeTransition || transitionAcknowledged===nativeTransition.id) return;
  const id=nativeTransition.id;
  transitionAcknowledged=id;
  void bridge.control('transition-ready',id).then(result=>{if(nativeTransition?.id===id) applyDesktop(result);}).catch(error=>toast(systemText(error.message)));
}
function applyDesktop(s) {
  desktopPreferenceError = s.preferenceError || null;
  if (desktopPreferenceError) toast(tr`挂件设置未保存：${desktopPreferenceError}`);
  nativeTransition=s.transition;
  const expanded=nativeTransition ? nativeTransition.fromExpanded : s.expanded;
  if(s.panelSize) {
    document.documentElement.style.setProperty('--panel-width',`${s.panelSize.width}px`);
    document.documentElement.style.setProperty('--panel-height',`${s.panelSize.height}px`);
  }
  document.body.classList.toggle('collapsed',!expanded);
  $('#mini').setAttribute('aria-expanded',String(expanded));
  document.body.classList.toggle('is-switching',!!s.transitioning);
  $('#follow').checked=s.follow; nativeVisible=!!s.visible; setSize(s.compactSize);
  syncView();
  if(nativeTransition && (reducedMotion.matches || Number(getComputedStyle($('.shell')).opacity)<=.001)) acknowledgeTransition();
}
$('.shell').addEventListener('transitionend',event=>{
  if(event.target===$('.shell') && event.propertyName==='opacity' && Number(getComputedStyle($('.shell')).opacity)<=.001) acknowledgeTransition();
});
async function setExpanded(expanded) {
  $('#modal').close();
  if(bridge) { try { applyDesktop(await bridge.control('expand',expanded)); } catch(error) { toast(systemText(error.message)); } }
  else { document.body.classList.toggle('collapsed',!expanded); $('#mini').setAttribute('aria-expanded',String(expanded)); syncView(); }
}
let pointerDrag=null,dragSequence=0;
let pointerResult=Promise.resolve({ moved:false });
$('#mini').addEventListener('pointerdown',e => {
  if(e.button!==0 || !e.isPrimary || pointerDrag) return;
  const drag={id:e.pointerId,session:++dragSequence,x:e.screenX,y:e.screenY,moved:false};
  pointerDrag=drag;
  $('#mini').setPointerCapture(e.pointerId);
  drag.started=bridge ? bridge.control('drag-start',drag.session).catch(error => { toast(systemText(error.message)); return {ok:false}; }) : Promise.resolve({ok:true});
});
$('#mini').addEventListener('pointermove',e => {
  if(bridge || !pointerDrag || pointerDrag.id!==e.pointerId) return;
  if(Math.hypot(e.screenX-pointerDrag.x,e.screenY-pointerDrag.y)>6) pointerDrag.moved=true;
});
function endPointer(e,cancelled=false) {
  if(!pointerDrag || (e && pointerDrag.id!==e.pointerId)) return;
  const drag=pointerDrag; pointerDrag=null;
  if($('#mini').hasPointerCapture(drag.id)) $('#mini').releasePointerCapture(drag.id);
  pointerResult=drag.started.then(async started => {
    const result=bridge && started.ok ? await bridge.control('drag-end',{id:drag.session,cancelled}) : {moved:drag.moved};
    return {moved:result.moved || cancelled};
  }).catch(error => { toast(systemText(error.message)); return {moved:true}; });
}
$('#mini').addEventListener('pointerup',e => endPointer(e));
$('#mini').addEventListener('pointercancel',e => endPointer(e,true));
$('#mini').addEventListener('lostpointercapture',e => endPointer(e,true));
window.addEventListener('blur',() => endPointer(null,true));
$('#mini').onclick=async e => { e.preventDefault(); const result=await pointerResult; pointerResult=Promise.resolve({moved:false}); if(!result.moved) void setExpanded(true); };
$('#mini').addEventListener('keydown',e => { if(e.key==='Enter'||e.key===' ') { e.preventDefault(); void setExpanded(true); } });
$('#mini').addEventListener('wheel',e => { if(!e.ctrlKey) return; e.preventDefault(); if(!pointerDrag) void changeSize(compactPixels+(e.deltaY<0?16:-16)); },{passive:false});
async function changeSize(value) {
  setSize(value);
  if(bridge) { try { applyDesktop(await bridge.control('compact-size',compactPixels)); } catch(error) { toast(systemText(error.message)); } }
  else localStorage.setItem('continuer-compact-size',String(compactPixels));
}
$('#compact-size').addEventListener('input',e => { void changeSize(e.target.value); });
$('#collapse').onclick=() => { void setExpanded(false); };
if(bridge) {
  bridge.onState(applyDesktop); bridge.control('state').then(applyDesktop).catch(e=>toast(e.message));
  $('#quit').onclick=()=>bridge.control('quit');
  $('#reset-position').onclick=()=>bridge.control('reset-position').then(()=>toast(tr('挂件位置已重置')));
} else { document.body.classList.add('browser'); setSize(Number(localStorage.getItem('continuer-compact-size'))||256); }
document.addEventListener('visibilitychange',syncView);
$('#session-select').onchange = () => { localStorage.setItem('continuer-selected-session', $('#session-select').value); updateSessionSelection(); };
$('#close').onclick = () => $('#modal').close(); $('#modal').addEventListener('close', () => { if ($('#modal').open) return; modalRenderer = null; sessionModal = null; detailId = null; taskDetails.clear(); });
if (localStorage.getItem('continuer-rhine-theme') === 'light') document.body.classList.add('light');
$('#theme').onclick = () => { document.body.classList.toggle('light'); localStorage.setItem('continuer-rhine-theme', document.body.classList.contains('light') ? 'light' : 'dark'); };
const stream = new VisibleFeed({ visible: viewVisible, bootstrap: () => !!bridge && !rendererReady, receive: data => { connected = true; state = data; render(); }, error: () => { connected = false; if (state) render(); else $('#health').textContent = tr('本地服务连接失败，正在重连…'); } });
window.addEventListener('pagehide', () => { stream.close(); nativeVisible = false; syncActivity(); });
window.addEventListener('pageshow', () => { if (!bridge) nativeVisible = true; syncView(); });
stream.sync();

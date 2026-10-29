import { newTaskForm, monitorImportForm } from './task-forms.js';
import { t as tr, systemText, setFormError, locale, setLanguage, staticInterface, refreshLocalizedContent } from './i18n.js';
import { TaskDetails } from './task-details.js';
import { createApiClient } from './api-client.js';
import { escapeHtml as esc } from './html.js';
import { icon } from './icons.js';
import { taskCardHtml, taskDetailHtml, isTaskActive, toggle } from './task-view.js';
import { VisibleFeed, setHtml } from './view-lifecycle.js';
import { ApprovalDetails } from './approval-details.js';
import { storageNotice } from './storage-status.js';
import { wakeExplanation, continuationEditor } from './task-mode.js';

export function mountPage(environment = globalThis) {
  const { document, window, localStorage, Date, FormData, AbortSignal, DOMParser, getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval, fetch, Blob, URL } = environment;
  const api = createApiClient({ request: (...args) => fetch(...args) });
  const applyStaticLanguage = staticInterface(document);
  const $ = selector => document.querySelector(selector);
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const labels = () => ({ overview: tr("ui.overview"), tasks: tr("ui.work"), quota: tr("ui.quota_monitor"), logs: tr("ui.activity_log"), settings: tr("ui.settings") });
  const taskDetails = new TaskDetails(api, () => { if (!document.hidden && selectedTask) renderDetail(selectedTask); }, error => toast(systemText(error)));
  const approvalDetails = new ApprovalDetails(api, () => render());
  let modalRenderer = null, importList = null;
  let state, page = 'overview', filter = 'all', selectedTask, toastTimer, streamAlive = true;
  const main = $('#main');
  const modal = $('#modal');
  const time = value => value ? new Date(value).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  function relative(value) { const sec = Math.max(0, Math.round((Date.now() - value) / 1000)); return sec < 60 ? tr("ui.just_now") : sec < 3600 ? tr("ui.min_ago", { p0: Math.floor(sec / 60) }) : tr("ui.h_ago", { p0: Math.floor(sec / 3600) }); }
  function resetLabel(value) { if (!value) return tr("ui.reset_time_unknown"); const diff = Math.max(0, value * 1000 - Date.now()); if (!diff) return tr("ui.waiting_for_fresh_quota_confirmation"); const h = Math.floor(diff / 3600000), m = Math.ceil(diff % 3600000 / 60000); return tr("ui.until_reset", { p0: h >= 24 ? tr("ui.d_h", { p0: Math.floor(h / 24), p1: h % 24 }) : h ? tr("ui.h_min", { p0: h, p1: m }) : tr("ui.min", { p0: m }) }); }
  function allBuckets() { const values = Object.values(state.quota?.rateLimitsByLimitId || {}).filter(Boolean); return values.length ? values : state.quota?.rateLimits ? [state.quota.rateLimits] : []; }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
  function heading(title, description, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">YOUR WORK, CONTINUED.</div><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="actions">${actions}</div></div>`; }
  const newButton = () => `<button class="primary" data-action="new">${icon('plus')}${tr("ui.new_work")}</button>`;
  const refreshButton = () => `<button data-action="refresh">${icon('refresh')}${tr("ui.refresh_quota")}</button>`;
  function empty(title, text, button = false) { return `<div class="empty">${icon('folder')}<h3>${title}</h3>${text}${button ? `<div>${newButton()}</div>` : ''}</div>`; }
  function quotaCard(window, title, color = '') {
    const valid = Number.isFinite(window?.usedPercent);
    const remaining = valid ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null;
    return `<article class="card stat"><div class="stat-head"><span>${esc(title)}</span>${icon('clock')}</div><div class="stat-number ${color}">${remaining === null ? '—' : Math.round(remaining)}<small>${remaining === null ? tr("ui.unknown") : tr("ui.remaining")}</small></div><div class="meter ${remaining !== null && remaining < state.settings.minimumRemaining ? 'orange' : color}"><span style="width:${remaining ?? 0}%"></span></div><div class="stat-foot"><span>${remaining === null ? tr("ui.waiting_for_account_data") : resetLabel(window.resetsAt)}</span><span>${remaining === null ? '' : tr("ui.used", { p0: Math.round(window.usedPercent) })}</span></div></article>`;
  }
  function stats() {
    const bucket = allBuckets().find(b => b.limitId === 'codex') || allBuckets()[0];
    const running = state.tasks.filter(isTaskActive).length;
    const continuous = state.tasks.filter(t => t.continuous && t.status !== 'completed').length;
    const windowName = (w, fallback) => w?.windowDurationMins ? (w.windowDurationMins >= 1440 ? tr("ui.day_quota", { p0: w.windowDurationMins / 1440 }) : tr("ui.hour_quota", { p0: w.windowDurationMins / 60 })) : fallback;
    return `<div class="stats">${quotaCard(bucket?.primary, windowName(bucket?.primary, tr("ui.short_term_quota")), 'purple')}${quotaCard(bucket?.secondary, windowName(bucket?.secondary, tr("ui.long_term_quota")), 'green')}<article class="card stat"><div class="stat-head"><span>${tr("ui.active_work")}</span>${icon('tasks')}</div><div class="stat-number">${running}<small>/ ${state.tasks.filter(t => t.status !== 'completed').length}${tr("ui.work_items")}</small></div><div class="mini-steps">${Array.from({ length: 10 }, (_, i) => `<span class="${i < running ? 'filled' : ''}"></span>`).join('')}</div><div class="stat-foot"><span>${running ? tr("ui.working_toward_project_goals") : tr("ui.ready_for_the_next_step")}</span><span>${tr("ui.runs_one_at_a_time")}</span></div></article><article class="card stat"><div class="stat-head"><span>${tr("ui.continuous_work_enabled")}</span>${icon('bolt')}</div><div class="stat-number purple">${continuous}<small>${tr("ui.work_items_2")}</small></div><div class="mini-steps">${Array.from({ length: 10 }, (_, i) => `<span class="${i < continuous ? 'filled' : ''}"></span>`).join('')}</div><div class="stat-foot"><span>${tr("ui.resumes_after_quota_recovery")}</span>${icon('arrow')}</div></article></div>`;
  }
  function banner() { return `<div class="banner"><div class="banner-icon">${icon('bolt')}</div><div><h3>${state.settings.enabled ? tr("ui.keep_work_moving") : tr("ui.scheduling_paused")}</h3><p>${state.settings.enabled ? tr("ui.monitor_available_quota_and_resume_work_when") : tr("ui.current_turns_continue_new_turns_wait_until")}</p></div><span class="banner-label">${tr("ui.scheduling")}</span>${toggle(state.settings.enabled, 'scheduler', tr("ui.scheduling"))}</div>`; }
  function tasksPanel(full = false) {
    const list = state.tasks.filter(t => filter !== 'continuous' || t.continuous);
    return `<div class="card ${full ? 'full-tasks' : ''}"><div class="tabs">${[['all', tr("ui.all_work")], ['continuous', tr("ui.continuous_work")]].map(([value, label]) => `<button class="tab ${value === filter ? 'active' : ''}" data-filter="${value}">${label}${value === 'all' ? ` <span class="pill">${state.tasks.length}</span>` : ''}</button>`).join('')}</div>${list.length ? `<div class="task-list">${list.map(taskCard).join('')}</div>` : empty(tr("ui.no_work_here_yet"), tr("ui.add_a_project_goal_to_make_progress"), true)}<div class="card-bottom">${icon('shield')}${tr("ui.completed_work_is_removed_automatically_approvals_wait")}</div></div>`;
  }
  function taskCard(task) {
    return taskCardHtml(task, state.settings);
  }
  function flowPanel() { return `<article class="card side-panel"><div class="section-head"><h2>${tr("ui.continuation_policy")}</h2><span class="pill">${state.settings.enabled ? tr("ui.enabled") : tr("ui.paused")}</span></div><div class="flow"><span class="flow-icon">${icon('chart')}</span><div><strong>${tr("ui.monitor_quota")}</strong><p>${tr("ui.every")}${state.settings.pollSeconds}${tr("ui.sec_with_live_updates")}</p></div></div><div class="flow"><span class="flow-icon">${icon('clock')}</span><div><strong>${tr("ui.preserve_work_when_quota_is_low")}</strong><p>${tr("ui.save_the_chat_and_wait_for_all")}</p></div></div><div class="flow"><span class="flow-icon">${icon('play')}</span><div><strong>${tr("ui.resume_according_to_work_mode")}</strong><p>${tr("ui.resume_at")}${state.settings.minimumRemaining}${tr("ui.resume_percent_suffix")}</p></div></div><p class="help-note">${tr("ui.direct_work_stops_when_completed_blocked_or")}${state.settings.maxRounds}${tr("ui.rounds_original_chats")}${esc(wakeExplanation)}${tr("ui.each_record_can_send_up_to")}${state.settings.maxWakeSends}${tr("ui.messages")}</p><button class="text-button" style="margin-top:13px" data-page="settings">${tr("ui.adjust_policy")}${icon('arrow')}</button></article>`; }
  function recentPanel() { return `<article class="card side-panel"><div class="section-head"><h2>${tr("ui.recent_activity")}</h2><button class="text-button" data-page="logs">${tr("ui.all")}${icon('arrow')}</button></div>${state.logs.slice(0, 3).map(log => `<div class="log-preview"><i class="status-dot" style="background:${log.type === 'warning' ? 'var(--orange)' : log.type === 'success' ? 'var(--green)' : 'var(--purple)'}"></i><div><p>${esc(systemText(log))}</p><time>${relative(log.time)}</time></div></div>`).join('') || `<p class="help-note">${tr("ui.activity_will_appear_here_after_your_first")}</p>`}</article>`; }
  function chart() {
    const data = state.history.map(h => ({ time: h.time, value: h.values.find(v => v.id === 'codex')?.used ?? h.values[0]?.used })).filter(h => Number.isFinite(h.value));
    if (data.length < 2) return `<article class="card trend-panel"><h2>${tr("ui.quota_usage_trend")}</h2><div class="empty">${tr("ui.the_trend_appears_after_at_least_two")}</div></article>`;
    const width = 900, start = data[0].time, duration = data.at(-1).time - start || 1;
    const points = data.map(d => `${((d.time - start) / duration * width).toFixed(2)},${(104 - Math.max(0, Math.min(100, d.value)) * .92).toFixed(2)}`).join(' ');
    return `<article class="card trend-panel"><div class="chart-heading"><h2>${tr("ui.quota_usage_trend")}</h2><span class="chart-legend"><i></i>${tr("ui.short_term_quota_usage")}</span></div><svg class="chart" viewBox="0 0 940 115" preserveAspectRatio="none" role="img" aria-label="${tr("ui.recent_quota_usage_trend")}"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#9cad78" stop-opacity=".2"/><stop offset="100%" stop-color="#9cad78" stop-opacity=".01"/></linearGradient></defs>${[12, 58, 104].map((y, i) => `<line x1="0" y1="${y}" x2="900" y2="${y}" stroke="var(--line)" stroke-dasharray="4 5"/><text x="910" y="${y + 3}">${100 - i * 50}%</text>`).join('')}<polygon points="0,104 ${points} 900,104" fill="url(#chart-fill)"/><polyline points="${points}" fill="none" stroke="var(--purple)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="chart-times"><span>${time(start)}</span><span>${time(start + duration / 2)}</span><span>${time(data.at(-1).time)}</span></div></article>`;
  }
  function alerts() {
    let html = storageNotice(state, esc);
    if (state.demo) html += `<div class="notice demo">${icon('info')}${tr("ui.demo_simulated_quota_and_work_no_real")}<div class="actions"><button class="small" data-action="exhaust">${tr("ui.simulate_exhaustion")}</button><button class="small" data-action="recover">${tr("ui.simulate_recovery")}</button></div></div>`;
    if (state.connection.status !== 'connected') html += `<div class="notice">${icon('info')} ${esc(systemText(state.connection))}${tr("ui.run_codex_login_confirm_cli_is_available")}</div>`;
    for (const a of approvalDetails.readAll(state.approvals)) html += `<div class="card approval"><h3>${tr("ui.approval_required")}</h3><p>${esc(a.reason)}</p><pre class="detail-output">${esc(a.command || a.method)}
${esc(a.cwd)}</pre>${a.requiresDetails ? `<p>${tr("ui.full_approval_details_are_not_loaded_refresh")}</p>` : ''}<div class="actions"><button class="primary small" data-action="approve" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}" ${a.requiresDetails ? 'disabled' : ''}>${tr("ui.allow_once")}</button><button class="small" data-action="decline" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}">${tr("ui.decline")}</button></div></div>`;
    return html;
  }
  function settings() {
    const s = state.settings;
    const intervals = [...new Set([10, 15, 30, 60, 90, s.pollSeconds])].sort((a, b) => a - b);
    const intervalOptions = intervals.map(n => `<option value="${n}" ${s.pollSeconds === n ? 'selected' : ''}>${n}${tr("ui.sec")}</option>`).join('');
    const connected = state.connection.status === 'connected';
    const autostart = state.diagnostics?.autostart;
    const watcher = autostart?.watcherRunning ? tr("ui.watcher_running") : autostart?.enabled === false ? tr("ui.off") : tr("ui.watcher_stopped_or_status_unknown");
    return `${heading(tr("ui.settings"), tr("ui.set_when_and_how_your_work_resumes"))}
      <form id="settings-form">
        <div class="card settings-card">
          <div class="setting-row">
            <div><h3>${tr("ui.scheduling")}</h3><p>${tr("ui.when_off_no_new_turns_start_current")}</p></div>
            ${toggle(s.enabled, 'scheduler', tr("ui.scheduling"))}
          </div>
          <div class="setting-row">
            <div><h3>${tr("ui.quota_sync_interval")}</h3><p>${tr("ui.seconds_with_live_updates_and_periodic_checks")}</p></div>
            <select name="pollSeconds">${intervalOptions}</select>
          </div>
          <div class="setting-row">
            <div><h3>${tr("ui.resume_threshold")}</h3><p>${tr("ui.all_returned_quota_windows_must_meet_this")}</p></div>
            <div><input name="minimumRemaining" type="number" min="1" max="99" value="${s.minimumRemaining}" required aria-label="${tr("ui.resume_threshold")}"> %</div>
          </div>
          <div class="setting-row">
            <div><h3>${tr("ui.direct_work_turn_limit")}</h3><p>${tr("ui.applies_to_new_work_resume_manually_after")}</p></div>
            <div><input name="maxRounds" type="number" min="1" max="100" value="${s.maxRounds}" required aria-label="${tr("ui.direct_work_turn_limit")}">${tr("ui.turns")}</div>
          </div>
          <div class="setting-row">
            <div><h3>${tr("ui.original_chat_message_limit")}</h3><p>${tr("ui.counts_are_cumulative_per_record_and_survive")}</p></div>
            <div><input name="maxWakeSends" type="number" min="1" max="100" value="${s.maxWakeSends}" required aria-label="${tr("ui.original_chat_message_limit")}">${tr("ui.messages_2")}</div>
          </div>
          <div class="setting-row">
            <div><h3>${tr("ui.local_connection")}</h3><p>${tr("ui.uses_local_codex_sign_in_and_the")}<br>${tr("ui.work_runs_in_the_project_directory_sandbox")}</p></div>
            <span class="badge ${connected ? 'completed' : 'waiting'}">${connected ? tr("ui.connected") : tr("ui.disconnected")}</span>
          </div>
        </div>
        <div class="settings-actions"><button class="primary" type="submit">${tr("ui.save_settings")}</button><span class="form-error" id="settings-error"></span></div>
      </form>
      <p class="subtitle">${tr("ui.the_local_service_must_stay_running_work")}${watcher}。<br>${tr("ui.build")}${esc(state.buildId || '')}${tr("ui.protocol")}${state.protocolVersion} · <button type="button" class="text-button" data-action="health">${tr("ui.diagnostics")}</button></p>`;
  }
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
    $('#connection').textContent = !streamAlive ? tr("ui.local_service_disconnected") : state.demo ? tr("ui.demo_connection") : connected ? tr("ui.local_service_connected") : tr("ui.waiting_for_codex_connection");
    $('#connection').classList.toggle('off', !connected);
    $('#footer-status').textContent = !streamAlive ? tr("ui.local_service_disconnected_reconnecting") : state.demo ? tr("ui.demo_simulated_data") : connected ? tr("ui.codex_app_server_connected") : tr("ui.waiting_for_codex_cli_connection");
    $('#footer-update').textContent = tr("ui.every_sec", { p0: state.settings.pollSeconds, p1: state.sampledAt ? tr("ui.updated_at", { p0: time(state.sampledAt) }) : tr("ui.quota_data_unknown") });
    // Preserve form input while background events arrive.
    if (!languageChanged && page === 'settings' && $('#settings-form')) {
      const control = $('#settings-form .switch');
      control.classList.toggle('on', state.settings.enabled);
      control.setAttribute('aria-checked', String(state.settings.enabled));
      return;
    }
    let html;
    if (page === 'overview') html = `${heading(tr("ui.work_overview"), tr("ui.track_your_quota_and_keep_projects_moving"), refreshButton() + newButton())}${alerts()}${banner()}${stats()}<div class="content-grid"><section><div class="section-head"><h2>${tr("ui.my_work")}<span class="pill">${state.tasks.length}</span></h2><button class="text-button" data-action="import">${icon('import')}${tr("ui.import_chat")}</button></div>${tasksPanel()}${chart()}</section><aside class="right-column">${flowPanel()}${recentPanel()}</aside></div>`;
    else if (page === 'tasks') html = `${heading(tr("ui.work"), tr("ui.your_goals_progress_and_next_steps_in"), `<button data-action="import">${icon('import')}${tr("ui.import_chat")}</button>${newButton()}`)}${alerts()}${tasksPanel(true)}`;
    else if (page === 'quota') html = `${heading(tr("ui.quota_monitor"), tr("ui.track_account_quota_and_when_work_can"), refreshButton())}${alerts()}${allBuckets().length ? allBuckets().map(b => `<div class="section-head"><h2>${esc(b.limitName || b.limitId || 'Codex')} <span class="pill">${esc(b.planType || tr("ui.account_quota"))}</span></h2></div><div class="quota-grid">${quotaCard(b.primary, tr("ui.primary_quota_window"), 'purple')}${quotaCard(b.secondary, tr("ui.secondary_quota_window"), 'green')}</div>`).join('<br>') : empty(tr("ui.quota_unavailable"), tr("ui.connect_a_signed_in_codex_cli_to"))}${chart()}<p class="subtitle">${tr("ui.reset_times_come_from_the_server_and")}</p>`;
    else if (page === 'logs') html = `${heading(tr("ui.activity_log"), tr("ui.shows_the_latest_events_export_up_to"), `<button data-action="export">${tr("ui.export_logs")}</button>`)}<div class="card">${state.logs.length ? `<table class="log-table"><thead><tr><th>${tr("ui.time")}</th><th>${tr("ui.type")}</th><th>${tr("ui.activity")}</th></tr></thead><tbody>${state.logs.map(l => `<tr><td>${new Date(l.time).toLocaleDateString(locale())} ${time(l.time)}</td><td><span class="badge ${l.type === 'success' ? 'completed' : l.type === 'warning' ? 'waiting' : ''}">${({ success: tr("ui.success"), warning: tr("ui.attention"), info: tr("ui.info") })[l.type]}</span></td><td>${esc(systemText(l))}</td></tr>`).join('')}</tbody></table>` : empty(tr("ui.no_activity_yet"), tr("ui.scheduling_activity_appears_here_after_you_add"))}</div>`;
    else html = settings();
    setHtml(main, html);
    if (draft) for (const [name, value] of draft) { const input = $('#settings-form').elements.namedItem(name); if (input) input.value = value; }
    if (modal.open && selectedTask) renderDetail(selectedTask);
  }
  function openModal(html) { modalRenderer = null; importList = null; selectedTask = null; $('#modal-body').innerHTML = html; if (!modal.open) modal.showModal(); }
  function openLocalized(render) { openModal(''); modalRenderer = render; refreshLocalizedContent($('#modal-body'), render); }
  function modalHead(title) { return `<div class="modal-head"><h2>${title}</h2><button class="icon-button" data-action="close" aria-label="${tr("ui.close")}">${icon('close')}</button></div>`; }
  function newTask() {
    openLocalized(() => modalHead(tr("ui.new_work")) + newTaskForm());
  }
  function renderDetail(id) {
    const summary = state.tasks.find(task => task.id === id);
    if (!summary) { modal.close(); selectedTask = null; return; }
    const task = taskDetails.read(summary);
    $('#modal-body').innerHTML = modalHead(esc(task.name)) + taskDetailHtml(task, state.settings, {
      canEdit: taskDetails.ready(summary),
    });
  }
  async function importModal(cursor = null, append = false) {
    if (!append) {
      const list = { data: [], nextCursor: null, loading: true, error: null };
      const render = () => `${modalHead(tr("ui.import_codex_chat"))}<p class="subtitle">${tr("ui.choose_a_local_chat_to_manage_monitoring")}</p><div id="thread-list">${list.loading && !list.data.length ? `<div class="loading">${tr("ui.loading_chats")}</div>` : list.data.map(t => `<div class="thread-option"><div><strong>${esc(t.name || t.preview || tr("ui.untitled_chat"))}</strong><small>${esc(t.cwd || t.id)}</small></div><button class="small" data-action="choose-thread" data-id="${esc(t.id)}">${tr("ui.select")}</button></div>`).join('') || `<p class="subtitle">${tr("ui.no_chats_available_to_import")}</p>`}</div><div id="thread-more">${list.nextCursor ? `<button class="text-button" data-action="more-threads" data-cursor="${esc(list.nextCursor)}" ${list.loading ? 'disabled' : ''}>${tr("ui.load_more")}</button>` : ''}</div><div class="form-error" id="modal-error">${esc(systemText(list.error))}</div>`;
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
      if (action === 'health') { const health = await api('/api/health'); openLocalized(() => `${modalHead(tr("ui.diagnostics"))}<pre class="detail-output">${esc(JSON.stringify(health, null, 2))}</pre>`); return; }
      if (action === 'detail') { openModal(''); selectedTask = id; renderDetail(id); return; }
      if (action === 'edit-message') {
        const summary = state.tasks.find(task => task.id === id), task = summary && taskDetails.read(summary);
        if (!task || task.mode !== 'quota-wake') throw Error(tr("ui.only_monitored_chats_support_editing_continuation_messages"));
        if (!taskDetails.ready(summary)) throw Error(tr("ui.wait_for_the_full_work_details_to"));
        openLocalized(() => `${modalHead(tr("ui.edit_continuation_message"))}${continuationEditor(task, esc)}`); return;
      }
      if (action === 'import') { await importModal(); return; }
      if (action === 'more-threads') { await importModal(button.dataset.cursor, true); return; }
      if (action === 'choose-thread') {
        openLocalized(() => modalHead(tr("ui.monitor_original_chat_quota")) + monitorImportForm(id));
        return;
      }
      if (action === 'export') { const logs = await api('/api/logs'); const blob = new Blob([JSON.stringify(logs.logs, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'continuer-logs.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
      button.disabled = true;
      if (action === 'storage-retry' || action === 'storage-backup') { state = await api('/api/storage/recover', { source: action === 'storage-backup' ? 'backup' : 'retry' }); toast(tr("ui.storage_recovered_scheduling_remains_off")); }
      else if (action === 'refresh') { state = await api('/api/refresh', {}); toast(state.connection.status === 'connected' ? tr("ui.quota_synced") : tr("ui.connection_failed_check_the_notice")); }
      else if (action === 'scheduler') { state = await api('/api/settings', { enabled: !state.settings.enabled }); toast(state.settings.enabled ? tr("ui.scheduling_enabled") : tr("ui.scheduling_paused")); }
      else if (action === 'continuous') { state = await api(`/api/tasks/${id}`, { action, value: !state.tasks.find(t => t.id === id).continuous }); }
      else if (['pause', 'resume', 'complete'].includes(action)) { const wake = state.tasks.find(t => t.id === id)?.mode === 'quota-wake'; state = await api(`/api/tasks/${id}`, { action }); toast(wake ? (action === 'resume' ? tr("ui.monitoring_enabled") : action === 'complete' ? tr("ui.monitoring_ended_and_removed") : tr("ui.monitoring_paused")) : (action === 'resume' ? tr("ui.work_queued") : action === 'complete' ? tr("ui.marked_complete") : tr("ui.pause_requested"))); }
      else if (action === 'approve' || action === 'decline') { if (action === 'approve' && !approvalDetails.ready(state.approvals.find(item => String(item.id) === id && item.detailToken === token))) throw Error(tr("ui.wait_for_the_full_approval_details_to")); state = await api('/api/approval', { id, token, decision: action === 'approve' ? 'accept' : 'decline' }); }
      else if (action === 'exhaust' || action === 'recover') { state = await api('/api/demo/quota', { exhausted: action === 'exhaust' }); toast(action === 'exhaust' ? tr("ui.simulated_quota_exhausted") : tr("ui.simulated_quota_recovered")); }
      render();
    } catch (error) { toast(systemText(error)); } finally { button.disabled = false; }
  });
  document.addEventListener('submit', async event => {
    const form = event.target; event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"],button.primary'); submit.disabled = true;
    try {
      if (form.id === 'task-form') { state = await api('/api/tasks', { ...values, continuous: values.continuous === 'on' }); modal.close(); toast(tr("ui.work_created")); }
      else if (form.id === 'import-form') { state = await api('/api/import', { ...values, threadId: form.dataset.id }); modal.close(); toast(tr("ui.chat_imported_monitoring_stays_paused")); }
      else if (form.id === 'message-form') { state = await api(`/api/tasks/${encodeURIComponent(form.dataset.id)}`, { action: 'message', value: values.continuationMessage }); taskDetails.clear(); modal.close(); toast(tr("ui.continuation_message_saved")); }
      else if (form.id === 'settings-form') { state = await api('/api/settings', Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))); document.activeElement?.blur(); toast(tr("ui.settings_saved")); }
      render();
    } catch (error) { const errorEl = form.querySelector('.form-error'); if (errorEl) setFormError(errorEl, error); else toast(systemText(error)); }
    finally { submit.disabled = false; }
  });
  $('#language').addEventListener('change', async event => { const input = event.target; input.disabled = true; try { state = await api('/api/settings', { language: input.value }); render(); } catch (error) { toast(systemText(error)); applyStaticLanguage(); } finally { input.disabled = false; } });
  $('#theme').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('continuer-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); });
  if (localStorage.getItem('continuer-theme') === 'dark') document.body.classList.add('dark');
  modal.addEventListener('close', () => { if (modal.open) return; modalRenderer = null; importList = null; selectedTask = null; taskDetails.clear(); });
  const stream = new VisibleFeed({ ...(environment.createSource ? { create: environment.createSource } : {}), visible: () => !document.hidden, receive: data => { streamAlive = true; state = data; render(); }, error: () => { streamAlive = false; if (state) render(); else setHtml(main, `<div class="notice">${tr("ui.could_not_connect_to_the_local_service")}</div>`); } });
  document.addEventListener('visibilitychange', () => { stream.sync(); if (!document.hidden) render(); });
  window.addEventListener('pagehide', () => stream.close());
  window.addEventListener('pageshow', () => stream.sync());
  stream.sync();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') mountPage();

import { newTaskForm, monitorImportForm } from './task-forms.js';
import { t as tr, systemText, setFormError, locale, setLanguage, staticInterface, refreshLocalizedContent } from './i18n.js';
import { TaskDetails } from './task-details.js';
import { createApiClient } from './api-client.js';
import { escapeHtml as esc } from './html.js';
import { taskCardHtml, taskDetailHtml } from './task-view.js';
import { VisibleFeed, LazyResource, setHtml } from './view-lifecycle.js';
import { ApprovalDetails } from './approval-details.js';
import { storageNotice } from './storage-status.js';
import { wakeExplanation, continuationEditor } from './task-mode.js';
import { quotaWindow, resetCountdown } from './quota-display.js';
import { pixelText } from './rhine-readout.js';

export function mountWidget(environment = globalThis) {
  const { document, window, localStorage, Date, FormData, AbortSignal, DOMParser, getComputedStyle, setTimeout, clearTimeout, setInterval, clearInterval, fetch, Blob, URL } = environment;
  const api = createApiClient({ request: (...args) => fetch(...args) });
  const applyStaticLanguage = staticInterface(document);
  const $ = s => document.querySelector(s);
  const bridge = window.continuerDesktop;
  const QUOTA_CYCLE_MS = 12000, QUOTA_TRANSITION_MS = 1000;
  const taskDetails = new TaskDetails(api, () => { if (viewVisible() && detailId && $('#modal').open) detail(detailId); }, error => toast(systemText(error)));
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
    if(!response.ok) throw Error(tr("ui.rhine_could_not_load_animation"));
    const source=new DOMParser().parseFromString(await response.text(),'image/svg+xml');
    if(source.querySelector('parsererror')) throw Error(tr("ui.rhine_invalid_animation"));
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
      if (!animation.loaded) void animation.ensure().catch(error => toast(systemText(error)));
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
    const placeholder = sessionError && !sessionItems.length ? tr("ui.chats_unavailable") : sessionItems.length ? tr("ui.choose_a_chat_to_manage") : !lastSessionRead && !sessionError ? tr("ui.loading_chats_2") : tr("ui.no_local_codex_chats");
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
    $('#add-session').textContent = managed ? tr("ui.view_added_work") : tr("ui.add_to_my_work");
    $('#session-preview').textContent = sessionError ? tr("ui.could_not_load_click_chats_to_retry", { p0: systemText(sessionError) }) : t ? `${t.cwd || tr("ui.no_project_directory")}${t.updatedAt ? tr("ui.updated", { p0: new Date(t.updatedAt * 1000).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }) : ''}` : tr("ui.choose_a_chat_sorted_by_most_recently");
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
  function reset(t) { if (!t) return tr("ui.reset_time_unknown"); const m = Math.ceil((t * 1000 - Date.now()) / 60000); return m <= 0 ? tr("ui.waiting_for_recovery_confirmation") : m >= 1440 ? tr("ui.d_h_until_reset", { p0: Math.floor(m / 1440), p1: Math.floor(m % 1440 / 60) }) : m >= 60 ? tr("ui.h_min_until_reset", { p0: Math.floor(m / 60), p1: m % 60 }) : tr("ui.min_until_reset", { p0: m }); }
  function windowName(w, fallback) { const m = w?.windowDurationMins; return m ? m >= 1440 ? tr("ui.day_quota", { p0: m / 1440 }) : tr("ui.hour_quota", { p0: m / 60 }) : fallback; }
  function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(timer); timer = setTimeout(() => $('#toast').classList.remove('show'), 3500); }
  function card(w, title) { const p = percent(w); return `<article class="quota"><div class="caption">${esc(title)}</div><strong>${p === null ? '—' : Math.round(p)}<small>${p === null ? tr("ui.unknown_2") : tr("ui.remaining")}</small></strong><div class="meter"><i style="width:${p ?? 0}%"></i></div><div class="reset">${reset(w?.resetsAt)}</div></article>`; }
  function renderGauge() {
    if (!state || document.hidden || !nativeVisible || !document.body.classList.contains('collapsed')) return;
    const reading = quotaWindow(state, windowSlot, connected, Date.now());
    const available = reading.remaining !== null;
    const setText=(selector,value) => { const element=$(selector),text=String(value); if(element.textContent!==text) element.textContent=text; };
    setText('#mini-quota',available ? Math.round(reading.remaining) : '—');
    setText('#mini-reset',resetCountdown(reading.resetsAt, Date.now()));
    const countdown=$('#mini-reset').textContent;
    const numeric=/^\d/.test(countdown);
    $('#mini-reset').classList.toggle('visually-empty',numeric);
    if(numeric && countdown!==lastPixelCountdown) {
      const pixels=pixelText(countdown.replace(tr("ui.d_2"),'d'));
      const scale=Math.min(1.9,104/pixels.width);
      $('#mini-reset-pixels').setAttribute('d',pixels.path);
      $('#mini-reset-pixels').setAttribute('transform',`translate(${128-pixels.width*scale/2} 176) scale(${scale})`);
    } else if(!numeric && countdown!==lastPixelCountdown) $('#mini-reset-pixels').setAttribute('d','');
    lastPixelCountdown=countdown;
    const windowLabel=windowSlot==='primary'?tr("ui.hour"):tr("ui.day");
    setText('#mini-window',tr("ui.available_quota", { p0: windowLabel }));
    setText('#mini-reset-label',tr("ui.until_reset_2"));
    $('#mini').dataset.window=windowSlot;
    $('#quota-dot-primary').classList.toggle('selected',windowSlot==='primary');
    $('#quota-dot-secondary').classList.toggle('selected',windowSlot==='secondary');
    $('#mini').classList.toggle('offline', !available);
    $('#mini').title = tr("ui.click_to_expand_drag_to_move_ctrl", { p0: available ? tr("ui.available_quota_time_until_reset", { p0: windowLabel, p1: Math.round(reading.remaining), p2: resetCountdown(reading.resetsAt, Date.now()) }) : tr("ui.waiting_for_quota_data", { p0: windowLabel }) });
    $('#gauge-readout').setAttribute('aria-label',$('#mini').title);
  }
  function render() {
    if (!state) return;
    const languageChanged = setLanguage(state.settings.language || 'zh'); applyStaticLanguage();
    if ($('#error').dataset.sourceMessage) setFormError($('#error'), $('#error').errorSource || $('#error').dataset.sourceMessage);
    if (languageChanged && modalRenderer && $('#modal').open) refreshLocalizedContent($('#modal-body'), modalRenderer, true);
    if (bridge && !rendererAnnounced) {
      rendererAnnounced = true;
      bridge.control('renderer-ready').then(result => { rendererReady = true; applyDesktop(result); stream.sync(); }).catch(error => { rendererAnnounced = false; toast(systemText(error)); });
    }
    if (bridge && rendererReady && lastDesktopLanguage !== (state.settings.language || 'zh')) {
      const value = state.settings.language || 'zh'; lastDesktopLanguage = value;
      void bridge.control('language', value).catch(error => { lastDesktopLanguage = undefined; toast(systemText(error)); });
    }
    renderGauge();
    if(!viewVisible() || document.body.classList.contains('collapsed')) { syncActivity(); return; }
    const buckets = Object.values(state.quota?.rateLimitsByLimitId || {}).filter(Boolean);
    if (!buckets.length && state.quota?.rateLimits) buckets.push(state.quota.rateLimits);
    const stale = !state.sampledAt || Date.now() - state.sampledAt > 90000;
    setHtml($('#quotas'), (buckets.length ? buckets : [{}]).map(b => card(b.primary, (buckets.length > 1 ? `${b.limitName || b.limitId} · ` : '') + windowName(b.primary, tr("ui.short_term_quota"))) + card(b.secondary, windowName(b.secondary, tr("ui.long_term_quota")))).join(''));
    $('#updated').textContent = state.sampledAt ? tr("ui.synced", { p0: clock(state.sampledAt) }) : tr("ui.waiting_to_sync_2");
    $('#health').textContent = desktopPreferenceError ? tr("ui.widget_settings_were_not_saved", { p0: desktopPreferenceError }) : !connected ? tr("ui.local_service_disconnected_reconnecting_2") : state.demo ? tr("ui.demo_simulated_quota_and_work_no_real") : state.connection.status !== 'connected' ? systemText(state.connection) : stale ? tr("ui.quota_data_is_stale_scheduling_waits_for") : tr("ui.connected_codex_live_updates_periodic_sync");
    setHtml($('#storage-status'), storageNotice(state, esc));
    $('#scheduler').checked = state.settings.enabled;
    $('.scheduler').classList.toggle('paused', !state.settings.enabled);
    $('#scheduler-note').textContent = state.settings.enabled ? tr("ui.resume_at_2", { p0: state.settings.minimumRemaining }) : tr("ui.scheduling_paused_current_turn_continues");
    $('#count').textContent = state.tasks.length;
    const taskCards = state.tasks.map(task => taskCardHtml(task, state.settings, 'widget')).join('');
    setHtml($('#tasks'), taskCards || `<p class="empty">${tr("ui.no_work_yet")}<br>${tr("ui.add_a_chat_above_or_create_new")}</p>`);
    setHtml($('#approvals'), approvalDetails.readAll(state.approvals).map(a => `<div class="approval"><strong>${tr("ui.approval_required")}</strong><p class="hint">${esc(a.reason)}</p><pre>${esc(a.command || a.method)}
${esc(a.cwd)}</pre>${a.requiresDetails ? `<p>${tr("ui.full_approval_details_are_not_loaded_refresh_2")}</p>` : ''}<button data-action="approve" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}" ${a.requiresDetails ? 'disabled' : ''}>${tr("ui.allow_once")}</button><button data-action="decline" data-id="${esc(a.id)}" data-token="${esc(a.detailToken)}">${tr("ui.decline")}</button></div>`).join(''));
    setHtml($('#logs'), state.logs.slice(0, 10).map(l => `<div class="log"><time>${clock(l.time)}</time><span>${esc(systemText(l))}</span></div>`).join('') || `<p class="hint">${tr("ui.no_activity_yet_2")}</p>`);
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
    const summary = state.tasks.find(task => task.id === id);
    if (!summary) return;
    const task = taskDetails.read(summary);
    $('#modal-title').textContent = task.name;
    $('#modal-body').innerHTML = taskDetailHtml(task, state.settings, {
      layout: 'widget', canEdit: taskDetails.ready(summary),
    });
  }
  async function sessions(cursor, append = false) {
    if (!append) {
      const list = { data: [], nextCursor: null, loading: true, error: null };
      openLocalized(() => {
        const options = list.data.map(t => `<button class="session" data-action="select-session" data-id="${esc(t.id)}">${esc(t.name || t.preview || t.id)}<small>${esc(t.cwd)}</small></button>`).join('');
        const empty = list.loading ? `<p class="hint">${tr("ui.loading_local_chats")}</p>` : list.error ? `<p class="hint">${tr("ui.chats_unavailable")}</p>` : `<p class="hint">${tr("ui.no_chats_available_to_import")}</p>`;
        const more = list.nextCursor ? `<button id="more" data-action="more" data-cursor="${esc(list.nextCursor)}" ${list.loading ? 'disabled' : ''}>${tr("ui.load_more")}</button>` : '';
        const retry = list.error ? `<button data-action="import">${tr("ui.retry")}</button>` : '';
        return { title: tr("ui.import_an_existing_chat"), html: (options || empty) + more + retry };
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
      if (modalRenderer === current.render && $('#modal').open) setFormError($('#error'), error);
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
      if (managed) { open(tr("ui.work_details"), ''); detailId = managed.id; detail(managed.id); return; }
      openLocalized(() => ({
        title: tr("ui.monitor_original_chat_quota"), html: monitorImportForm(t.id, { layout: 'widget', thread: t }),
      }));
      return;
    }
    if (action === 'new') {
      openLocalized(() => ({ title: tr("ui.new_work"), html: newTaskForm({ layout: 'widget', pickDirectory: !!bridge }) }));
      return;
    }
    if (action === 'detail') { open(tr("ui.work_details"), ''); detailId = id; detail(id); return; }
    if (action === 'edit-message') {
      const summary = state.tasks.find(task => task.id === id), task = summary && taskDetails.read(summary);
      if (!task || task.mode !== 'quota-wake') throw Error(tr("ui.only_monitored_chats_support_editing_continuation_messages"));
      if (!taskDetails.ready(summary)) throw Error(tr("ui.wait_for_the_full_work_details_to"));
      openLocalized(() => ({ title: tr("ui.edit_continuation_message"), html: continuationEditor(task, esc) })); return;
    }
    if (action === 'pick') { const path = await bridge.pickDirectory(); if (path) $('#new-form [name=cwd]').value = path; return; }
    if (action === 'import' || action === 'more') { await sessions(b.dataset.cursor, action === 'more'); return; }
    if (action === 'select-session') {
      openLocalized(() => ({ title: tr("ui.monitor_original_chat_quota"), html: monitorImportForm(id, { layout: 'widget' }) }));
      return;
    }
    b.disabled = true;
    if (action === 'storage-retry' || action === 'storage-backup') { state = await api('/api/storage/recover', { source: action === 'storage-backup' ? 'backup' : 'retry' }); toast(tr("ui.storage_recovered_scheduling_remains_off")); }
    else if (action === 'refresh') { state = await api('/api/refresh', {}); toast(tr("ui.quota_sync_requested")); }
    else if (['pause', 'resume', 'complete'].includes(action)) state = await api(`/api/tasks/${encodeURIComponent(id)}`, { action });
    else if (action === 'approve' || action === 'decline') { if (action === 'approve' && !approvalDetails.ready(state.approvals.find(item => String(item.id) === id && item.detailToken === token))) throw Error(tr("ui.wait_for_the_full_approval_details_to")); state = await api('/api/approval', { id, token, decision: action === 'approve' ? 'accept' : 'decline' }); }
    render();
  } catch (error) { if ($('#modal').open) setFormError($('#error'), error); else toast(systemText(error)); } finally { b.disabled = false; } });
  document.addEventListener('change', async e => { const input = e.target; try { if (input.id === 'language') { input.disabled = true; try { state = await api('/api/settings', { language: input.value }); } finally { input.disabled = false; } } else if (input.id === 'scheduler') state = await api('/api/settings', { enabled: input.checked }); else if (input.dataset.continuous) state = await api(`/api/tasks/${encodeURIComponent(input.dataset.continuous)}`, { action: 'continuous', value: input.checked }); else if (input.id === 'follow') { applyDesktop(await bridge.control('follow', input.checked)); return; } else return; render(); } catch (error) { toast(systemText(error)); render(); } });
  document.addEventListener('submit', async e => { e.preventDefault(); const form = e.target, values = Object.fromEntries(new FormData(form)), button = form.querySelector('[type=submit]'); button.disabled = true; setFormError($('#error'), ''); try { if (form.id === 'new-form') state = await api('/api/tasks', { ...values, continuous: values.continuous === 'on' }); else if (form.id === 'import-form') state = await api('/api/import', { threadId: form.dataset.id, note: values.note, continuationMessage: values.continuationMessage }); else if (form.id === 'message-form') { state = await api(`/api/tasks/${encodeURIComponent(form.dataset.id)}`, { action: 'message', value: values.continuationMessage }); taskDetails.clear(); } else if (form.id === 'settings-form') state = await api('/api/settings', Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))); if (form.id !== 'settings-form') $('#modal').close(); render(); toast(form.id === 'message-form' ? tr("ui.continuation_message_saved") : tr("ui.saved")); } catch (error) { if ($('#modal').open) setFormError($('#error'), error); else toast(systemText(error)); } finally { button.disabled = false; } });
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
    void bridge.control('transition-ready',id).then(result=>{if(nativeTransition?.id===id) applyDesktop(result);}).catch(error=>toast(systemText(error)));
  }
  function applyDesktop(s) {
    desktopPreferenceError = s.preferenceError || null;
    if (desktopPreferenceError) toast(tr("ui.widget_settings_were_not_saved", { p0: desktopPreferenceError }));
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
    if(bridge) { try { applyDesktop(await bridge.control('expand',expanded)); } catch(error) { toast(systemText(error)); } }
    else { document.body.classList.toggle('collapsed',!expanded); $('#mini').setAttribute('aria-expanded',String(expanded)); syncView(); }
  }
  let pointerDrag=null,dragSequence=0;
  let pointerResult=Promise.resolve({ moved:false });
  $('#mini').addEventListener('pointerdown',e => {
    if(e.button!==0 || !e.isPrimary || pointerDrag) return;
    const drag={id:e.pointerId,session:++dragSequence,x:e.screenX,y:e.screenY,moved:false};
    pointerDrag=drag;
    $('#mini').setPointerCapture(e.pointerId);
    drag.started=bridge ? bridge.control('drag-start',drag.session).catch(error => { toast(systemText(error)); return {ok:false}; }) : Promise.resolve({ok:true});
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
    }).catch(error => { toast(systemText(error)); return {moved:true}; });
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
    if(bridge) { try { applyDesktop(await bridge.control('compact-size',compactPixels)); } catch(error) { toast(systemText(error)); } }
    else localStorage.setItem('continuer-compact-size',String(compactPixels));
  }
  $('#compact-size').addEventListener('input',e => { void changeSize(e.target.value); });
  $('#collapse').onclick=() => { void setExpanded(false); };
  if(bridge) {
    bridge.onState(applyDesktop); bridge.control('state').then(applyDesktop).catch(e=>toast(e.message));
    $('#quit').onclick=()=>bridge.control('quit');
    $('#reset-position').onclick=()=>bridge.control('reset-position').then(()=>toast(tr("ui.widget_position_reset")));
  } else { document.body.classList.add('browser'); setSize(Number(localStorage.getItem('continuer-compact-size'))||256); }
  document.addEventListener('visibilitychange',syncView);
  $('#session-select').onchange = () => { localStorage.setItem('continuer-selected-session', $('#session-select').value); updateSessionSelection(); };
  $('#close').onclick = () => $('#modal').close(); $('#modal').addEventListener('close', () => { if ($('#modal').open) return; modalRenderer = null; sessionModal = null; detailId = null; taskDetails.clear(); });
  if (localStorage.getItem('continuer-rhine-theme') === 'light') document.body.classList.add('light');
  $('#theme').onclick = () => { document.body.classList.toggle('light'); localStorage.setItem('continuer-rhine-theme', document.body.classList.contains('light') ? 'light' : 'dark'); };
  const stream = new VisibleFeed({ ...(environment.createSource ? { create: environment.createSource } : {}), visible: viewVisible, bootstrap: () => !!bridge && !rendererReady, receive: data => { connected = true; state = data; render(); }, error: () => { connected = false; if (state) render(); else $('#health').textContent = tr("ui.could_not_connect_to_the_local_service_2"); } });
  window.addEventListener('pagehide', () => { stream.close(); nativeVisible = false; syncActivity(); });
  window.addEventListener('pageshow', () => { if (!bridge) nativeVisible = true; syncView(); });
  stream.sync();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') mountWidget();

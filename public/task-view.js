import { t as tr, systemText, defaultContinuation } from './i18n.js';
import { taskMode, wakeExplanation } from './task-mode.js';
import { escapeHtml as esc } from './html.js';
import { icon } from './icons.js';

const activeStatuses = new Set(['running', 'starting', 'approval', 'pausing']);
const pausableStatuses = new Set([...activeStatuses, 'monitoring', 'waiting', 'queued']);
const statusText = {
  queued: "ui.queued",
  waiting: "ui.waiting_for_quota",
  starting: "ui.starting",
  running: "ui.running",
  pausing: "ui.pausing",
  paused: "ui.paused",
  blocked: "ui.needs_attention",
  failed: "ui.failed",
  completed: "ui.completed",
  approval: "ui.awaiting_approval",
  monitoring: "ui.monitoring"
};

export const isTaskActive = task => activeStatuses.has(task.status);

export function taskStatusLabel(task) {
  if (task.status === 'monitoring') return tr("ui.monitoring");
  if (task.status === 'waiting' && task.waitReason === 'desktop') return tr("ui.waiting_for_delivery");
  if (task.status === 'waiting' && ['writer', 'thread'].includes(task.waitReason)) return tr("ui.waiting_for_chat");
  return statusText[task.status] ? tr(statusText[task.status]) : task.status || '';
}

export function taskPresentation(task, settings) {
  const mode = taskMode(task, settings);
  const pause = pausableStatuses.has(task.status);
  const progress = Number.isFinite(task.progress) ? Math.max(0, Math.min(100, task.progress)) : 0;
  return {
    task, mode, progress,
    label: taskStatusLabel(task),
    activity: systemText(task.activity, task.activityMessage),
    progressText: task.progress == null ? tr("ui.no_plan") : `${progress}%`,
    control: task.status === 'completed' ? null : { action: pause ? 'pause' : 'resume', label: pause ? mode.pause : mode.resume },
    canComplete: !isTaskActive(task) && task.status !== 'completed',
  };
}

export function toggle(on, action, label, id = '') {
  return `<button type="button" class="switch ${on ? 'on' : ''}" role="switch"
    aria-checked="${!!on}" aria-label="${esc(label)}"
    data-action="${esc(action)}" data-id="${esc(id)}"></button>`;
}

function badge(view) {
  return `<span class="badge ${esc(view.task.status)}">${esc(view.label)}</span>`;
}

function monitorNote(view) {
  if (!view.mode.wake) return '';
  const task = view.task, note = task.notePreview ?? task.note ?? tr("ui.not_provided");
  return `<p class="monitor-note">
    <strong>${tr("ui.monitoring_note")}</strong><span>${esc(note) || tr("ui.not_provided")}</span>
    ${task.noteTruncated ? `<small>${tr("ui.see_details_for_the_full_note")}</small>` : ''}
  </p>`;
}

function controlButton(view, layout) {
  if (!view.control) return '';
  const { action, label } = view.control;
  const buttonIcon = layout === 'page' ? icon(isTaskActive(view.task) ? 'pause' : 'play') : '';
  return `<button ${layout === 'page' ? 'class="text-button"' : ''}
    data-action="${action}" data-id="${esc(view.task.id)}">${esc(label)}${buttonIcon}</button>`;
}

function pageTaskCard(view) {
  const { task, mode, progress } = view;
  return `<article class="task">
    <div class="task-top">
      <div class="task-icon">${icon('folder')}</div>
      <div class="task-info">
        <button class="task-title" data-action="detail" data-id="${esc(task.id)}">${esc(task.name)}</button>
        <div class="task-path" title="${esc(task.cwd)}">${esc(task.cwd)}</div>
      </div>
      ${badge(view)}
    </div>
    ${monitorNote(view)}
    <div class="task-progress">
      <div class="meter ${task.status === 'completed' ? 'green' : ''}"><span style="width:${progress}%"></span></div>
      <span>${esc(mode.progress || view.progressText)}</span>
    </div>
    <div class="task-path">${esc(mode.counter)}</div>
    <div class="task-activity" title="${esc(view.activity)}">${esc(view.activity)}</div>
    <div class="task-bottom">
      <div class="task-auto">${toggle(task.continuous, 'continuous', `${task.name}${mode.continuous}`, task.id)}${mode.continuous}</div>
      <div class="task-controls">
        <button class="text-button" data-action="detail" data-id="${esc(task.id)}">${tr("ui.view_details")}</button>
        ${controlButton(view, 'page')}
      </div>
    </div>
  </article>`;
}

function widgetTaskCard(view) {
  const { task, mode } = view;
  return `<article class="task">
    <div class="task-top">
      <button class="task-title" data-action="detail" data-id="${esc(task.id)}">${esc(task.name)}</button>
      ${badge(view)}
    </div>
    <div class="path" title="${esc(task.cwd)}">${esc(task.cwd)}</div>
    ${monitorNote(view)}
    <div class="progress">
      <div class="meter"><i style="width:${view.progress}%"></i></div>
      <span>${mode.wake ? tr("ui.view_in_original_chat") : esc(view.progressText)}</span>
    </div>
    <p class="activity" title="${esc(view.activity)}">${esc(view.activity)}</p>
    <p class="hint">${esc(mode.counter)}</p>
    <div class="task-bottom">
      <label><input type="checkbox" data-continuous="${esc(task.id)}" ${task.continuous ? 'checked' : ''}>${mode.continuous}</label>
      <div>
        <button data-action="detail" data-id="${esc(task.id)}">${tr("ui.details")}</button>
        ${controlButton(view, 'widget')}
      </div>
    </div>
  </article>`;
}

export function taskCardHtml(task, settings, layout = 'page') {
  const view = taskPresentation(task, settings);
  return layout === 'widget' ? widgetTaskCard(view) : pageTaskCard(view);
}

function monitorDetails(view, settings, canEdit, hint) {
  const task = view.task;
  return `<p class="detail-summary"><strong>${tr("ui.continuation_message")}</strong><br>${esc(task.continuationMessage?.trim() || defaultContinuation(settings.language))}</p>
    <button type="button" data-action="edit-message" data-id="${esc(task.id)}" ${canEdit ? '' : 'disabled'}>${tr("ui.edit_continuation_message")}</button>
    <p class="${hint}">${esc(wakeExplanation)}</p>`;
}

function planDetails(view, layout) {
  const steps = view.task.plan || [];
  if (layout === 'widget') {
    return `<ol class="steps">${steps.map(step => `<li>${step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '◉' : '○'} ${esc(step.step)}</li>`).join('')}</ol>`;
  }
  const progress = view.task.progress == null ? tr("ui.no_plan_yet") : `· ${view.progress}%`;
  const rows = steps.map(step => `<li class="${esc(step.status)}">
    ${icon(step.status === 'completed' ? 'check' : step.status === 'inProgress' ? 'play' : 'clock')}${esc(step.step)}
  </li>`).join('');
  return `<h3>${tr("ui.plan_progress")}${progress}</h3>
    <ul class="detail-plan">${rows}</ul>
    <p class="subtitle">${tr("ui.the_percentage_shows_completed_plan_steps_only")}</p>`;
}

function outputDetails(view, layout, hint) {
  if (view.mode.wake) return '';
  const task = view.task;
  const notice = task.outputTruncated
    ? `<p class="${hint}">${tr("ui.only_the_end_of_long_output_is")}</p>` : '';
  if (layout === 'widget') return notice + (task.output ? `<pre>${esc(task.output)}</pre>` : '');
  return `<h3>${tr("ui.turn_output")}</h3>${notice}<pre class="detail-output">${esc(task.output || tr("ui.no_output_yet"))}</pre>`;
}

export function taskDetailHtml(task, settings, { layout = 'page', canEdit = false } = {}) {
  const view = taskPresentation(task, settings), page = layout === 'page';
  const hint = page ? 'subtitle' : 'hint';
  const complete = view.canComplete ? `<button data-action="complete" data-id="${esc(task.id)}">${view.mode.complete}</button>` : '';
  const context = page
    ? `${badge(view)}<p class="subtitle">${esc(task.cwd)}</p>`
    : `<p class="hint">${esc(task.cwd)}<br>${esc(view.label)} · ${esc(view.mode.counter)}</p>`;
  const activity = page
    ? `<p class="subtitle">${tr("ui.current_status")}${esc(view.activity)} · ${esc(view.mode.counter)}</p>`
    : `<p class="detail-summary">${esc(view.activity)}</p>`;
  const thread = page && task.threadId ? `<p class="subtitle">${tr("ui.chat")}${esc(task.threadId)}</p>` : '';
  const actions = page
    ? `<div class="modal-actions">${complete}<button class="primary" data-action="close">${tr("ui.close")}</button></div>` : complete;
  const description = `<p class="detail-summary">${esc(view.mode.description)}</p>`;
  const details = view.mode.wake ? monitorDetails(view, settings, canEdit, hint) : planDetails(view, layout);
  return `${page ? context + description : description + context}${details}${activity}${thread}${outputDetails(view, layout, hint)}${actions}`;
}

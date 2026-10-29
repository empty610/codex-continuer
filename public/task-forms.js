import { t as tr } from './i18n.js';
import { wakeExplanation } from './task-mode.js';
import { escapeHtml as esc } from './html.js';
import { icon } from './icons.js';

export function newTaskForm({ layout = 'page', pickDirectory = false } = {}) {
  const page = layout === 'page', fieldClass = page ? 'form-field' : '';
  const directory = `<input name="cwd" required placeholder="E:\\Projects\\my-project">`;
  const directoryControl = page
    ? `${directory}<small>${tr("ui.enter_an_absolute_path_to_an_existing")}</small>`
    : `<span class="directory">${directory}${pickDirectory ? `<button type="button" data-action="pick">${tr("ui.select")}</button>` : ''}</span>`;
  const submit = page ? tr("ui.create_work", { p0: icon('arrow') }) : tr("ui.create_and_queue");
  const actions = page
    ? `<div class="modal-actions"><button type="button" data-action="close">${tr("ui.cancel")}</button><button class="primary" type="submit">${submit}</button></div>`
    : `<button class="primary" type="submit">${submit}</button>`;
  return `${page ? `<p class="subtitle">${tr("ui.give_your_project_a_clear_goal_continuer")}</p>` : ''}
    <form id="${page ? 'task-form' : 'new-form'}">
      <label class="${fieldClass}">${tr("ui.work_name")}<input name="name" required maxlength="120" ${page ? 'autofocus' : ''}
          placeholder="${page ? tr("ui.example_improve_knowledge_base_search") : tr("ui.example_finish_knowledge_base_search")}">
      </label>
      <label class="${fieldClass}">${tr("ui.project_directory")}${directoryControl}</label>
      <label class="${fieldClass}">${page ? tr("ui.work_goal") : tr("ui.goal_and_acceptance_criteria")}
        <textarea name="prompt" required maxlength="12000"
          placeholder="${page ? tr("ui.describe_the_desired_features_and_acceptance_criteria") : tr("ui.describe_the_desired_changes_and_how_to")}"></textarea>
      </label>
      <label class="${page ? 'check-label' : 'check'}">
        <input name="continuous" type="checkbox" checked>${tr("ui.keep_working_after_quota_recovers")}</label>
      <p class="${page ? 'subtitle' : 'hint'}">${page
        ? tr("ui.queued_after_creation_work_starts_when_quota")
        : tr("ui.work_is_queued_after_creation_extra_permissions")}</p>
      ${page ? '<div class="form-error" id="modal-error"></div>' : ''}
      ${actions}
    </form>`;
}

export function monitorImportForm(threadId, { layout = 'page', thread = null } = {}) {
  const page = layout === 'page', fieldClass = page ? 'form-field' : '', hint = page ? 'subtitle' : 'hint';
  const preview = thread ? `<strong>${esc(thread.name || thread.preview || tr("ui.codex_chat"))}</strong><p class="hint">${esc(thread.cwd)}</p>` : '';
  const label = thread ? tr("ui.add_to_my_work") : tr("ui.import_chat");
  const button = `<button class="primary" type="submit">${label}</button>`;
  const actions = page
    ? `<div id="modal-error" class="form-error"></div><div class="modal-actions"><button type="button" data-action="close">${tr("ui.cancel")}</button>${button}</div>`
    : button;
  return `<form id="import-form" data-id="${esc(threadId)}">
    ${preview}
    <label class="${fieldClass}">${tr("ui.continuation_message_optional")}<textarea name="continuationMessage" maxlength="12000"
        placeholder="${tr("ui.leave_blank_to_send_continue_example_run")}"></textarea>
      <small>${tr("ui.sent_to_the_original_chat_after_each")}</small>
    </label>
    <label class="${fieldClass}">${tr("ui.monitoring_note_optional_local_only")}<textarea name="note" maxlength="12000" ${thread ? tr("ui.placeholder_example_project_to_resume") : ''}></textarea>
    </label>
    <p class="${hint}">${thread ? tr("ui.monitoring_stays_paused_after_adding") : tr("ui.monitoring_stays_paused_after_import")}${esc(wakeExplanation)}</p>
    ${actions}
  </form>`;
}

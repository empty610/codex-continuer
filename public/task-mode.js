import { t as tr, onLanguageChange } from './i18n.js';
const wakeMessageId = "ui.after_confirmed_quota_exhaustion_and_recovery_the";
export let wakeExplanation = tr(wakeMessageId);
onLanguageChange(() => { wakeExplanation = tr(wakeMessageId); });
export function taskMode(task, settings) {
  const wake = task.mode === 'quota-wake';
  return {
    wake,
    description: wake ? tr("ui.monitoring_note_local_only", { p0: task.note || tr("ui.not_provided") }) : task.prompt,
    counter: wake ? tr("ui.queued_messages", { p0: task.sentCount || 0, p1: settings.maxWakeSends }) : tr("ui.executed_turns", { p0: task.rounds, p1: settings.maxRounds }),
    progress: wake ? tr("ui.check_progress_in_the_original_chat") : null,
    continuous: wake ? tr("ui.quota_monitor") : tr("ui.continuous_work"),
    pause: wake ? tr("ui.pause_monitoring") : tr("ui.pause"),
    resume: wake ? tr("ui.enable_monitoring") : tr("ui.continue"),
    complete: wake ? tr("ui.end_monitoring_and_remove") : tr("ui.mark_complete"),
  };
}
export function continuationEditor(task, esc) {
  return `<form id="message-form" data-id="${esc(task.id)}"><label class="form-field">${tr("ui.continuation_message_optional_2")}<textarea name="continuationMessage" maxlength="12000" placeholder="${tr("ui.leave_blank_to_send_continue_example_run")}" autofocus>${esc(task.continuationMessage || '')}</textarea></label><p class="hint subtitle">${tr("ui.leave_blank_to_use_the_default_message")}</p><p class="hint subtitle">${tr("ui.the_saved_message_is_used_for_future")}</p><div class="form-error"></div><div class="modal-actions"><button type="button" data-action="detail" data-id="${esc(task.id)}">${tr("ui.cancel")}</button><button class="primary" type="submit">${tr("ui.save_message")}</button></div></form>`;
}

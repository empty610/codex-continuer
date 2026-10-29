import { t as tr, systemText } from './i18n.js';
export function storageNotice(state, esc) {
  const summary = state.summaryNotice ? `<p class="notice">${esc(systemText(state.summaryNotice, state.summaryNoticeInfo))}</p>` : '';
  if (state.persistence?.status === 'error') return summary + `<div class="notice storage-warning"><p>${tr("ui.data_could_not_be_saved_or_loaded")}${esc(systemText(state.persistence))}</p>${!state.persistence.needsRestore ? `<button data-action="storage-retry">${tr("ui.retry_save_scheduling_stays_off")}</button>` : ''}${state.persistence.backupAvailable ? `<button data-action="storage-backup">${tr("ui.restore_backup_pause_all_records")}</button><p>${tr("ui.a_copy_of_the_current_file_is")}</p>` : ''}</div>`;
  return summary + (state.observationOnly ? `<p class="notice">${tr("ui.read_only_mode_work_starts_only_after")}</p>` : '');
}

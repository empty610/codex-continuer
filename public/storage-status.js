export function storageNotice(state, esc) {
  const summary = state.summaryNotice ? `<p class="notice">${esc(state.summaryNotice)}</p>` : '';
  if (state.persistence?.status === 'error') return summary + `<div class="notice storage-warning"><p>数据保存或读取失败，自动调度已停止：${esc(state.persistence.message)}</p>${!state.persistence.needsRestore ? '<button data-action="storage-retry">重试保存（调度保持关闭）</button>' : ''}${state.persistence.backupAvailable ? '<button data-action="storage-backup">恢复上次备份（暂停全部记录）</button><p>恢复会保留当前主文件副本；恢复后请先核对原聊天与项目状态。</p>' : ''}</div>`;
  return summary + (state.observationOnly ? '<p class="notice">当前为查询模式，尚未恢复自动调度。开启调度或明确继续工作后才会执行。</p>' : '');
}

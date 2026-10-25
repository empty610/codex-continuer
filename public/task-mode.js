export const wakeExplanation = '确认额度耗尽并恢复后，仅向原聊天发送固定“继续”；备注不发送。不读取原聊天进度或完成状态，工作结果请在原聊天确认。';
export function taskMode(task, settings) {
  const wake = task.mode === 'quota-wake';
  return {
    wake,
    description: wake ? `监测备注：${task.note || '未填写'}（仅本地保存）` : task.prompt,
    counter: wake ? `已排队发送 ${task.sentCount || 0} / ${settings.maxWakeSends} 次` : `已执行 ${task.rounds} / ${settings.maxRounds} 轮`,
    progress: wake ? '进度请在原聊天查看' : null,
    continuous: wake ? '额度监测' : '持续工作',
    pause: wake ? '暂停监测' : '暂停',
    resume: wake ? '开启监测' : '继续',
    complete: wake ? '结束监测并移除' : '标记完成',
  };
}

import { t as tr, onLanguageChange } from './i18n.js';
const wakeSource = '确认额度耗尽并恢复后，向原聊天发送一次自定义续作消息（留空发送“继续”）；备注不发送。不读取原聊天进度或完成状态，工作结果请在原聊天确认。';
export let wakeExplanation = tr(wakeSource);
onLanguageChange(() => { wakeExplanation = tr(wakeSource); });
export function taskMode(task, settings) {
  const wake = task.mode === 'quota-wake';
  return {
    wake,
    description: wake ? tr`监测备注：${task.note || tr('未填写')}（仅本地保存）` : task.prompt,
    counter: wake ? tr`已排队发送 ${task.sentCount || 0} / ${settings.maxWakeSends} 次` : tr`已执行 ${task.rounds} / ${settings.maxRounds} 轮`,
    progress: wake ? tr('进度请在原聊天查看') : null,
    continuous: wake ? tr('额度监测') : tr('持续工作'),
    pause: wake ? tr('暂停监测') : tr('暂停'),
    resume: wake ? tr('开启监测') : tr('继续'),
    complete: wake ? tr('结束监测并移除') : tr('标记完成'),
  };
}

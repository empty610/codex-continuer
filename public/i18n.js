import { english } from './messages.js';

let language = 'zh';
const listeners = new Set();
const phrases = Object.keys(english).sort((a, b) => b.length - a.length);
const pattern = new RegExp(phrases.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
export const getLanguage = () => language;
export const locale = () => language === 'en' ? 'en-US' : 'zh-CN';
export const defaultContinuation = (value = 'zh') => value === 'en' ? 'Continue' : '继续';
export function setLanguage(value) {
  const next = value === 'en' ? 'en' : 'zh';
  if (next === language) return false;
  language = next;
  for (const listener of listeners) listener(next);
  return true;
}
export function onLanguageChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function interfaceText(value, selected = language) {
  if (selected !== 'en') return value;
  const translated = Object.hasOwn(english, value) ? english[value] : value.replace(pattern, phrase => english[phrase]);
  // These are literal interface sections, never interpolated chat content.
  return translated.replace(/[，。；：（）「」]/g, char => ({ '，': ', ', '。': '. ', '；': '; ', '：': ': ', '（': ' (', '）': ')', '「': '“', '」': '”' })[char]);
}
// External output stays in its original language. Only recognized service
// messages are translated; names embedded in log records remain unchanged.
export function systemText(value) {
  if (language !== 'en' || typeof value !== 'string') return value;
  if (Object.hasOwn(english, value)) return english[value];
  for (const [prefix, translated] of [['已添加会话：', 'Chat added: '], ['添加工作：', 'Work added: '], ['开始工作：', 'Work started: '], ['未确认中断：', 'Interruption unconfirmed: '], ['发送结果未确认，请检查原聊天：', 'Delivery unconfirmed. Check the original chat: ']]) {
    if (value.startsWith(prefix)) return translated + value.slice(prefix.length);
  }
  const limit = /^已达到原聊天发送上限（(\d+)\/(\d+) 次），监测已停止；请查看原聊天确认工作结果$/.exec(value);
  if (limit) return `Message limit reached (${limit[1]}/${limit[2]}). Monitoring stopped; check results in the original chat.`;
  const ended = /^已结束监测：(.*)；工作结果请在原聊天确认$/.exec(value);
  if (ended) return `Monitoring ended: ${ended[1]}; check results in the original chat`;
  const approval = /^(.*) 等待操作授权$/.exec(value);
  if (approval) return `${approval[1]} is awaiting approval`;
  const range = /^([a-zA-Z]+) 必须为 (\d+)–(\d+) 的整数$/.exec(value);
  if (range) return `${range[1]} must be an integer between ${range[2]} and ${range[3]}`;
  const colon = value.indexOf('：');
  if (colon > 0) {
    const message = value.slice(colon + 1);
    if (Object.hasOwn(english, message)) return `${value.slice(0, colon)}: ${english[message]}`;
  }
  return value;
}
export function setFormError(element, message) {
  element.dataset.sourceMessage = message;
  element.textContent = systemText(message);
}
// Translate only literal template sections, before inserting any dynamic values.
export function t(value, ...values) {
  if (typeof value === 'string') return interfaceText(value);
  return value.reduce((result, part, index) => result + interfaceText(part) + (index < values.length ? String(values[index]) : ''), '');
}
export function refreshLocalizedContent(element, render, preserveErrors = false) {
  const document = element.ownerDocument;
  const draft = [...element.querySelectorAll('input[name],textarea[name],select[name]')].map(control => ({
    name: control.name, value: control.value, checked: control.checked,
    focused: document?.activeElement === control,
    start: control.selectionStart, end: control.selectionEnd,
  }));
  const container = element.closest('dialog') || element, scroll = container.scrollTop;
  const errors = preserveErrors && draft.length ? [...element.querySelectorAll('.form-error')].map(node => node.dataset.sourceMessage || node.textContent) : [];
  element.innerHTML = render();
  for (const control of element.querySelectorAll('input[name],textarea[name],select[name]')) {
    const saved = draft.find(item => item.name === control.name);
    if (!saved) continue;
    control.value = saved.value; control.checked = saved.checked;
    if (saved.focused) {
      control.focus({ preventScroll: true });
      if (Number.isInteger(saved.start)) control.setSelectionRange(saved.start, saved.end);
    }
  }
  [...element.querySelectorAll('.form-error')].forEach((node, index) => { if (errors[index]) setFormError(node, errors[index]); });
  container.scrollTop = scroll;
}
// Capture the initial static shell once; generated content and user input are
// never traversed or rewritten during a language change.
export function staticInterface(document) {
  const entries = [];
  if (document.createTreeWalker) {
    const walker = document.createTreeWalker(document.documentElement, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (/[\p{Script=Han}]/u.test(node.nodeValue) && !['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) entries.push({ node, original: node.nodeValue });
    }
    for (const node of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
      for (const attribute of ['title', 'aria-label', 'placeholder']) {
        const original = node.getAttribute(attribute);
        if (original) entries.push({ node, attribute, original });
      }
    }
  }
  return () => {
    document.documentElement.lang = locale();
    for (const { node, attribute, original } of entries) {
      if (!node.isConnected) continue;
      if (attribute) node.setAttribute(attribute, interfaceText(original));
      else node.nodeValue = interfaceText(original);
    }
    const select = document.querySelector('#language');
    if (select) select.value = language;
  };
}

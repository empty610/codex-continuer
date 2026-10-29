import { message, formatMessage, isMessage, MessageError } from './message.js';

let language = 'zh';
const listeners = new Set();
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
export function t(id, params = {}) { return formatMessage(message(id, params), language); }
export function interfaceText(id, selected = language) { return formatMessage(message(id), selected); }
export function uiError(id, params = {}) { return new MessageError(message(id, params), t(id, params)); }

// Message ownership is explicit. User output and legacy strings stay untouched.
export function systemText(value, descriptor) {
  const fallback = typeof value === 'string' ? value : value?.message ?? '';
  const info = descriptor || value?.messageInfo;
  return isMessage(info) ? formatMessage(info, language) : fallback;
}
export function setFormError(element, value) {
  const source = typeof value === 'string' ? { message: value } : value;
  element.errorSource = source;
  element.dataset.sourceMessage = source?.message || '';
  element.textContent = systemText(source);
}
export function refreshLocalizedContent(element, render, preserveErrors = false) {
  const document = element.ownerDocument;
  const draft = [...element.querySelectorAll('input[name],textarea[name],select[name]')].map(control => ({
    name: control.name, value: control.value, checked: control.checked,
    focused: document?.activeElement === control,
    start: control.selectionStart, end: control.selectionEnd,
  }));
  const container = element.closest('dialog') || element, scroll = container.scrollTop;
  const errors = preserveErrors && draft.length ? [...element.querySelectorAll('.form-error')].map(node => node.errorSource || node.dataset.sourceMessage || node.textContent) : [];
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
// Only explicitly marked shell text and attributes participate in localization.
export function staticInterface(document) {
  const entries = [];
  for (const element of document.querySelectorAll('[data-i18n]')) {
    const node = [...element.childNodes].find(child => child.nodeType === 3 && child.nodeValue.trim());
    if (node) entries.push({ node, id: element.getAttribute('data-i18n') });
  }
  for (const attribute of ['title', 'aria-label', 'placeholder']) {
    for (const node of document.querySelectorAll('[data-i18n-' + attribute + ']')) {
      entries.push({ node, attribute, id: node.getAttribute('data-i18n-' + attribute) });
    }
  }
  return () => {
    document.documentElement.lang = locale();
    for (const { node, attribute, id } of entries) {
      if (!node.isConnected) continue;
      if (attribute) node.setAttribute(attribute, t(id));
      else node.nodeValue = t(id);
    }
    const select = document.querySelector('#language');
    if (select) select.value = language;
  };
}

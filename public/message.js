import { messages } from './messages.js';
import { systemMessages } from './system-messages.js';

export const messageCatalog = Object.freeze({ ...messages, ...systemMessages });
const slots = template => [...template.matchAll(/\{([A-Za-z]\w*)\}/g)].map(match => match[1]);
const parameters = new Map(Object.entries(messageCatalog).map(([id, entry]) => [id, new Set(slots(entry.zh))]));

export function isMessage(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3 || !parameters.has(value.id)) return false;
  const params = value.params === undefined ? {} : value.params, required = parameters.get(value.id);
  return !!params && typeof params === 'object' && !Array.isArray(params)
    && [...required].every(key => Object.hasOwn(params, key))
    && Object.keys(params).every(key => required.has(key))
    && Object.values(params).every(item => item === null || ['string', 'boolean'].includes(typeof item)
      || (typeof item === 'number' && Number.isFinite(item)) || isMessage(item, depth + 1));
}

export function message(id, params = {}) {
  const value = { id, params: Object.fromEntries(Object.entries(params).map(([key, item]) => [key, item === undefined ? 'undefined' : item])) };
  if (!isMessage(value)) throw new Error('Invalid message contract: ' + id);
  return value;
}

export function formatMessage(value, language = 'zh') {
  if (!isMessage(value)) throw new Error('Invalid message contract');
  const entry = messageCatalog[value.id], template = language === 'en' ? entry.en : entry.zh;
  return template.replace(/\{([A-Za-z]\w*)\}/g, (_slot, key) => {
    const part = value.params?.[key];
    return isMessage(part) ? formatMessage(part, language) : String(part);
  });
}

// Only declared parameters survive serialization; text limits apply recursively.
export function boundedMessage(value, limit = 2600) {
  if (!isMessage(value)) return undefined;
  return { id: value.id, params: Object.fromEntries(Object.entries(value.params || {}).map(([key, item]) => [key,
    typeof item === 'string' ? item.slice(0, limit) : isMessage(item) ? boundedMessage(item, limit) : item,
  ])) };
}

export class MessageError extends Error {
  constructor(value, fallback) {
    const info = boundedMessage(value);
    super(fallback ?? (info ? formatMessage(info) : String(value ?? '')));
    if (info) this.messageInfo = info;
  }
}

export function messageText(value) {
  return isMessage(value) ? formatMessage(value) : String(value?.message ?? value ?? '');
}

export function setActivity(task, value) {
  const info = boundedMessage(isMessage(value) ? value : value?.messageInfo);
  task.activity = messageText(value).slice(0, 2400);
  if (info) task.activityMessage = info;
  else delete task.activityMessage;
}

export function activityFields(value) { const fields = {}; setActivity(fields, value); return fields; }
export function messageFields(value) {
  const info = boundedMessage(isMessage(value) ? value : value?.messageInfo);
  return { message: messageText(value), ...(info ? { messageInfo: info } : {}) };
}
export function errorResponse(value) {
  const fields = messageFields(value);
  return { error: fields.message, ...(fields.messageInfo ? { errorInfo: fields.messageInfo } : {}) };
}
export function taskActivityMessage(task) {
  return message('log.task_activity', { name: task.name, activity: isMessage(task.activityMessage) ? task.activityMessage : task.activity });
}

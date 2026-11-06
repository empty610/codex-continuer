// HTTP responses and the live stream share one order across service restarts.
export class StateSnapshots {
  constructor() { this.current = null; this.retired = new Set(); }
  accept(next) {
    if (!next?.instanceId || !Number.isSafeInteger(next.snapshotRevision)) return next;
    const old = this.current;
    if (this.retired.has(next.instanceId)) return old;
    if (old?.instanceId === next.instanceId && old.snapshotRevision > next.snapshotRevision) return old;
    if (old && old.instanceId !== next.instanceId) this.retired.add(old.instanceId);
    return this.current = next;
  }
}

// Submission ownership survives DOM replacement during localization.
export class FormSessions {
  constructor() { this.modal = {}; this.settings = {}; }
  open() { this.modal = {}; }
  begin(form) {
    const session = form.id === 'settings-form' ? this.settings : this.modal;
    if (session.pending) return null;
    session.pending = true;
    return { session, modal: form.id !== 'settings-form' };
  }
  current(job) { return !job.modal || job.session === this.modal; }
  end(job) { job.session.pending = false; }
  sync(modal, settings) {
    for (const [root, session] of [[modal, this.modal], [settings, this.settings]]) {
      for (const button of root?.querySelectorAll('[type="submit"]') || []) button.disabled = !!session.pending;
    }
  }
}

// Keep pagination bounded without making older chats unreachable.
export function chatPage(previous, result, append) {
  const data = result.data || [];
  const items = [...new Map([...(append && previous.length + data.length <= 300 ? previous : []), ...data].map(item => [item.id, item])).values()];
  return { data: items, nextCursor: result.nextCursor || null };
}

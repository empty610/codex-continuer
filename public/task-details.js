// Only one open detail is cached; stale responses cannot replace a newer selection.
export class TaskDetails {
  constructor(request, changed, error = () => {}) { this.request = request; this.changed = changed; this.error = error; this.slot = null; }
  read(summary) {
    if (!this.slot || this.slot.id !== summary.id) this.slot = { id: summary.id };
    const slot = this.slot, revision = summary.detailRevision ?? 0;
    if (!slot.pending && slot.revision !== revision && (!slot.retryAt || Date.now() >= slot.retryAt)) {
      slot.pending = true; slot.revision = revision;
      this.request(`/api/tasks/${encodeURIComponent(summary.id)}`).then(result => {
        if (this.slot !== slot) return;
        slot.task = result.task; slot.taskRevision = revision; slot.pending = false; this.changed();
      }).catch(error => { if (this.slot === slot) { slot.pending = false; slot.revision = undefined; slot.retryAt = Date.now() + 2000; this.error(error); } });
    }
    const result = { ...slot.task, ...summary };
    if (slot.task && slot.taskRevision === revision) for (const key of ['cwd', 'activity', 'activityMessage', 'name']) if (key in slot.task) result[key] = slot.task[key];
    return result;
  }
  ready(summary) { return !!this.slot?.task && this.slot.id === summary.id && !this.slot.pending && this.slot.taskRevision === (summary.detailRevision ?? 0); }
  clear() { this.slot = null; }
}

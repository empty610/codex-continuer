// Never enable acceptance using a truncated command preview.
export class ApprovalDetails {
  constructor(request, changed) { this.request = request; this.changed = changed; this.slots = new Map(); }
  readAll(summaries) {
    const ids = new Set(summaries.map(item => String(item.id)));
    for (const id of this.slots.keys()) if (!ids.has(id)) this.slots.delete(id);
    return summaries.map(summary => {
      if (!summary.requiresDetails) return summary;
      const id = String(summary.id);
      let slot = this.slots.get(id);
      if (!slot || slot.token !== summary.detailToken) { slot = { token: summary.detailToken }; this.slots.set(id, slot); }
      if (!slot.value && !slot.pending && (!slot.retryAt || Date.now() >= slot.retryAt)) {
        slot.pending = true;
        this.request(`/api/approvals/${encodeURIComponent(id)}?token=${encodeURIComponent(slot.token)}`).then(result => {
          if (this.slots.get(id) !== slot) return;
          if (result.approval.detailToken !== slot.token) throw new Error('授权请求已更新');
          slot.value = result.approval; slot.pending = false; this.changed();
        }).catch(() => {
          if (this.slots.get(id) !== slot) return;
          slot.pending = false; slot.retryAt = Date.now() + 2000; this.changed();
        });
      }
      return slot.value ? { ...summary, ...slot.value, requiresDetails: false } : summary;
    });
  }
  ready(summary) {
    if (!summary) return false;
    const slot = this.slots.get(String(summary.id));
    return !summary.requiresDetails || !!(slot?.token === summary.detailToken && slot?.value);
  }
}

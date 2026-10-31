import { t as tr } from './i18n.js';
const fields = ['minimumRemaining', 'pollSeconds', 'maxRounds', 'maxWakeSends'];

function ensureOption(input, key, value) {
  if (input.tagName !== 'SELECT' || !value || [...input.options].some(option => option.value === value)) return;
  const option = input.ownerDocument.createElement('option');
  option.value = value; option.textContent = key === 'pollSeconds' ? `${value}${tr('ui.sec')}` : value;
  input.add(option, [...input.options].find(existing => Number(existing.value) > Number(value)) || null);
}

// Keep unedited fields current without replacing a user's in-progress edits.
export class SettingsForm {
  constructor(getForm) { this.getForm = getForm; this.baseline = new Map(); }
  sync(settings, { reset = false } = {}) {
    if (reset) this.baseline.clear();
    const form = this.getForm();
    if (!form) return;
    for (const key of fields) {
      const input = form.elements.namedItem(key);
      if (!input) continue;
      const value = String(settings[key] ?? '');
      ensureOption(input, key, value);
      if (!this.baseline.has(key) || String(input.value) === this.baseline.get(key) || String(input.value) === value) input.value = value;
      this.baseline.set(key, value);
    }
  }
  restore(draft) {
    const form = this.getForm();
    if (!form) return;
    for (const [key, value] of draft) {
      const input = fields.includes(key) && form.elements.namedItem(key);
      if (input) { ensureOption(input, key, String(value)); input.value = value; }
    }
  }
  changes(values) {
    return Object.fromEntries(fields.filter(key => key in values && String(values[key]) !== this.baseline.get(key)).map(key => [key, Number(values[key])]));
  }
}

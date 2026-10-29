import { messageFields, message as textMessage } from '../public/message.js';
import { ClientError } from './http-policy.js';
import { initialState, prepareState, prepareBackup, prepareStorageRetry } from './state-lifecycle.js';

const OUTPUT_SAVE_INTERVAL_MS = 250;

// Owns the in-memory state and its durable-save lifecycle. Store owns file I/O.
export class StatePersistence {
  constructor(store, onFailure) {
    this.store = store;
    this.onFailure = onFailure;
    this.status = { status: 'ok', message: null };
    this.pending = false;
    this.timer = null;
  }
  get healthy() { return this.status.status === 'ok'; }
  load() {
    try { this.state = this.store.load(); }
    catch (error) { this.status = { status: 'error', ...messageFields(error), needsRestore: true }; }
    this.state ||= initialState(!this.status.needsRestore);
    if (prepareState(this.state)) {
      try { this.store.save(this.state); }
      catch (error) { this.fail(error); }
    }
  }
  fail(error) {
    this.status = { ...this.status, status: 'error', messageInfo: undefined, ...messageFields(error), failedAt: Date.now() };
    this.state.settings.enabled = false;
    this.onFailure(error);
  }
  changed({ deferSave = false } = {}) {
    this.pending = true;
    if (!deferSave) return this.flush();
    // One deadline from the first fragment; continuous output cannot postpone it.
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); }
      catch { /* fail recorded the error; retain pending output for retry. */ }
    }, OUTPUT_SAVE_INTERVAL_MS);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.pending) return;
    try { this.store.save(this.state); }
    catch (error) { this.fail(error); throw error; }
    this.pending = false;
    this.status = { status: 'ok', message: null };
  }
  commit() {
    this.pending = true;
    this.flush();
  }
  restoreBackup() {
    this.state = this.store.restoreBackup(prepareBackup);
    clearTimeout(this.timer); this.timer = null;
    this.status = { status: 'ok', message: null };
    this.pending = false;
  }
  retry() {
    if (this.status.needsRestore) throw new ClientError(textMessage("error.the_main_state_file_is_corrupt_choose_restore"));
    prepareStorageRetry(this.state);
    this.commit();
  }
}

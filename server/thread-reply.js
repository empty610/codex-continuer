// Inspect protocol state only: a final reply ends the latest instruction, but
// does not independently prove that the project's acceptance criteria passed.
export function turnReplyState(turn) {
  if (!turn || typeof turn.id !== 'string' || !turn.id) return 'unknown';
  if (turn.status === 'inProgress') return 'active';
  if (!['completed', 'failed', 'interrupted'].includes(turn.status)
    || !Array.isArray(turn.items) || turn.items.some(item => !item || typeof item.type !== 'string')
    || (turn.itemsView != null && turn.itemsView !== 'full')) return 'unknown';
  if (turn.status !== 'completed') return 'incomplete';
  const instruction = turn.items.findLastIndex(item => item.type === 'userMessage');
  const reply = turn.items.slice(instruction + 1).findLast(item => item.type === 'agentMessage');
  if (reply && (typeof reply.text !== 'string' || (reply.phase != null && !['commentary', 'final_answer'].includes(reply.phase)))) return 'unknown';
  // Older providers omit phase. A successfully completed turn and nonempty
  // assistant reply retain compatibility; commentary alone is not a final reply.
  return typeof reply?.text === 'string' && reply.text.trim()
    && (reply.phase == null || reply.phase === 'final_answer') ? 'complete' : 'incomplete';
}

const runtimeState = thread => thread?.status?.type === 'active' ? 'active'
  : ['idle', 'notLoaded'].includes(thread?.status?.type) ? null : 'unknown';

const replySnapshot = turn => ({ state: turnReplyState(turn), turnId: typeof turn?.id === 'string' ? turn.id : null });

// Return only protocol evidence, never inspected chat text.
export async function readThreadReplySnapshot(rpc, threadId) {
  const { thread } = await rpc.call('thread/read', { threadId, includeTurns: false });
  if (thread?.id !== threadId) return { state: 'unknown', turnId: null };
  const runtime = runtimeState(thread);
  if (runtime) return { state: runtime, turnId: null };
  if (thread.historyMode === 'paginated') {
    const page = await rpc.call('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'full' });
    // Listing history and reading runtime status are separate RPCs. A new
    // answer may start while the page is in flight; never trust the older idle.
    const { thread: current } = await rpc.call('thread/read', { threadId, includeTurns: false });
    if (current?.id !== threadId) return { state: 'unknown', turnId: null };
    const state = runtimeState(current);
    if (state) return { state, turnId: null };
    return replySnapshot(Array.isArray(page?.data) && page.data.length === 1 ? page.data[0] : null);
  }
  // Legacy app-servers expose full chronological history through thread/read.
  const { thread: history } = await rpc.call('thread/read', { threadId, includeTurns: true });
  if (history?.id !== threadId) return { state: 'unknown', turnId: null };
  const state = runtimeState(history);
  return state ? { state, turnId: null } : replySnapshot(Array.isArray(history.turns) ? history.turns.at(-1) : null);
}

export async function readThreadReply(rpc, threadId) {
  return (await readThreadReplySnapshot(rpc, threadId)).state;
}

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

export async function readThreadReply(rpc, threadId) {
  const { thread } = await rpc.call('thread/read', { threadId, includeTurns: false });
  if (thread?.id !== threadId) return 'unknown';
  const runtime = runtimeState(thread);
  if (runtime) return runtime;
  if (thread.historyMode === 'paginated') {
    const page = await rpc.call('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'full' });
    return Array.isArray(page?.data) && page.data.length === 1 ? turnReplyState(page.data[0]) : 'unknown';
  }
  // Legacy app-servers expose full chronological history through thread/read.
  const { thread: history } = await rpc.call('thread/read', { threadId, includeTurns: true });
  if (history?.id !== threadId) return 'unknown';
  return runtimeState(history) || (Array.isArray(history.turns) ? turnReplyState(history.turns.at(-1)) : 'unknown');
}

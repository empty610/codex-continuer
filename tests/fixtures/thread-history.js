export function interruptedThread(id, overrides = {}) {
  return { id, name: 'Original', cwd: 'E:\\fixture', status: { type: 'idle' }, turns: [{
    id: 'quota-interrupted-turn', status: 'failed', itemsView: 'full',
    error: { codexErrorInfo: 'usageLimitExceeded' },
    items: [{ type: 'userMessage', id: 'instruction', content: [{ type: 'text', text: 'Fixture instruction' }] },
      { type: 'agentMessage', id: 'partial', phase: 'commentary', text: 'Still working' }],
  }], ...overrides };
}

// Only deliberate local validation messages may cross the HTTP boundary.
import { MessageError, message, errorResponse } from '../public/message.js';

export class ClientError extends MessageError {}
export function clientErrorMessage(error) {
  return clientErrorResponse(error).error;
}
export function clientErrorResponse(error) {
  if (error instanceof ClientError) return errorResponse(error);
  return errorResponse(message(error?.code === 'ENOENT' ? 'error.project_missing' : 'error.operation_failed'));
}

// Fixed-size buckets: unauthenticated traffic cannot spend a client's budget.
export function createRequestLimiter(now = () => performance.now()) {
  const budgets = { unauthorized: [60, 1], read: [300, 5], write: [120, 2] };
  const buckets = new Map();
  return (authorized, method) => {
    const key = !authorized ? 'unauthorized' : method === 'GET' ? 'read' : 'write';
    const [capacity, perSecond] = budgets[key], time = now();
    const bucket = buckets.get(key) || { tokens: capacity, time };
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, time - bucket.time) * perSecond / 1000); bucket.time = time;
    buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens--; return true;
  };
}

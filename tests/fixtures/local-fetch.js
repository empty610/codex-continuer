import localTls from '../../server/local-tls.cjs';
export function pinnedFetch(directory, demo = false) {
  return (url, options = {}) => localTls.fetchLocal(url, { signal: AbortSignal.timeout(5000), ...options }, localTls.requestOptions(directory, demo));
}

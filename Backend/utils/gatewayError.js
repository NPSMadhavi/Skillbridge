/**
 * Maps Central AI Gateway HTTP and network errors according to system specification:
 * - 401 -> "gateway key missing or wrong"
 * - 404 with HTML body -> "this route is not exposed on this gateway address"
 * - Network errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc.) -> "gateway unreachable"
 * - Never leaks API keys, headers, or internal tracebacks.
 */
export function formatGatewayError(error) {
  if (!error) return 'gateway error';

  const status = error.response?.status || error.status;
  const data = error.response?.data;
  const contentType = String(error.response?.headers?.['content-type'] || '').toLowerCase();
  const isHtml = typeof data === 'string' && (
    data.includes('<html') ||
    data.includes('<!DOCTYPE') ||
    data.includes('<center><h1>404') ||
    data.includes('404 Not Found')
  );

  if (status === 401) {
    return 'gateway key missing or wrong';
  }

  if (status === 404 && (isHtml || contentType.includes('text/html'))) {
    return 'this route is not exposed on this gateway address';
  }

  const isNetwork = !error.response || ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code);
  if (isNetwork) {
    return 'gateway unreachable';
  }

  if (error.message && typeof error.message === 'string') {
    return error.message.replace(/(key|token)=([^\s&]+)/gi, '$1=***');
  }

  return 'gateway error';
}

export default formatGatewayError;

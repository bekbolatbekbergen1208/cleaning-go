const loopback = (host) =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
export function resolveMobileEndpoints({
  apiUrl,
  registrationUrl,
  hostUri,
  webOrigin,
  isDevelopment = false,
} = {}) {
  let devHost = '';
  if (isDevelopment && hostUri) {
    try {
      devHost = new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`)
        .hostname;
    } catch {}
  }
  if (!devHost && webOrigin) {
    try {
      devHost = new URL(webOrigin).hostname;
    } catch {}
  }
  const api = new URL(apiUrl || 'http://127.0.0.1:54321');
  if (!['http:', 'https:'].includes(api.protocol))
    throw new Error('API URL must use HTTP or HTTPS');
  if (devHost && !loopback(devHost) && loopback(api.hostname))
    api.hostname = devHost;
  let registration;
  if (registrationUrl) {
    registration = new URL(registrationUrl);
    if (devHost && !loopback(devHost) && loopback(registration.hostname))
      registration.hostname = devHost;
  } else {
    registration = new URL(api.origin);
    registration.port = '3000';
    registration.pathname = '/api/register';
  }
  if (!['http:', 'https:'].includes(registration.protocol))
    throw new Error('Registration URL must use HTTP or HTTPS');
  return {
    apiUrl: api.href.replace(/\/$/, ''),
    registrationUrl: registration.href,
    webUrl: registration.origin,
  };
}

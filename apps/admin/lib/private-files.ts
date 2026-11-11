// Keep private signed files on the web origin (CSP, HTTPS and remote browsers).
export function privateFileUrl(signedUrl: string) {
  return `/api/local/file${new URL(signedUrl, 'http://localhost').search}`;
}

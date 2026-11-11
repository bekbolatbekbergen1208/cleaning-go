# Cleaning Go: deployment and verification, 2026-11-11

Public site: http://31.76.11.212

Admin login: http://31.76.11.212/admin/login

The existing administrator account was preserved. Credentials are intentionally omitted from this report.

## Deployment

- Release: `/var/www/cleaning-go-releases/cleaning-go-20261111-1486ca2b`.
- Active link: `/var/www/cleaning-go-current`.
- Persistent database and storage: `/var/lib/cleaning-go/data`.
- Private environment: `/etc/cleaning-go/server.env`.
- Enabled systemd services: `cleaning-go-api.service` and `cleaning-go.service`.
- API and Next.js bind to loopback ports 54321 and 3020; Nginx serves the public site.
- Transferred archive checksums and all 42 table row counts matched the source snapshot before startup. Source contained one administrator and no orders; 41 migrations were recorded.

The application runs as the dedicated `cleaning-go` user with systemd filesystem restrictions. A new server service key was generated privately. Browser assets were checked for accidental administrator-password or service-key exposure; none was found.

## Verification

- 25 unit/validation tests passed.
- 114 isolated web security checks passed.
- 69 functional checks passed against the actual public URL through Nginx, using rendered Next.js forms and HTTP requests.
- Build, type checks and lint passed during preparation.

Public functional checks created five QA accounts and four orders. They covered company/cleaner registration and approval, communities, client registration, referrals, bonuses, uploads, price changes and stale consent rejection, claiming orders, status replay protection, location endpoints, photo reports, completion, finance state, reviews and moderation, cancellation, disputes and password recovery for a QA account.

| Order | Final status | Payment status |
| --- | --- | --- |
| CG-20261111-10001 | disputed | paid |
| CG-20261111-10002 | cancelled | pending |
| CG-20261111-10003 | completed | paid |
| CG-20261111-10004 | completed | pending |

QA records were retained for inspection. The QA company was returned to pending verification and the QA cleaner made unavailable. Final counts: six users, four orders and five storage objects. QA credentials are private on the server at `/root/cleaning-go-incoming/live-qa-credentials.json`; the machine-readable report is `/root/cleaning-go-incoming/live-functional-report.json`.

Both application services were restarted after an offline backup. Administrator login and persisted order states were verified after restart. Both services were active, enabled and had zero automatic restarts. The login page and other existing sites on ports 3010, 3040 and 3050 returned HTTP 200 in the final check.

## Backup

Private offline database, storage and environment backup:

`/root/cleaning-go-deployment-backups/cleaning-go-20261111-1486ca2b/data-after-qa-20261111T174408Z.tar.gz`

Metadata and checksum are in `latest-data-backup.json` in the same directory. This is a deployment backup; scheduled recurring backups have not been configured.

## Remaining integration limits

The deployment currently uses HTTP on the IP address. Add the domain and configure HTTPS before public customer use; browser GPS and PWA capabilities require a secure context. Successful location API checks do not verify browser GPS permission behavior.

An IP certificate was subsequently renewed successfully, valid until 2026-11-18 09:00:53 UTC, and its Certbot renewal dry-run passed. HTTPS activation remains pending: clients connecting by IP receive the shared Nginx default certificate. Automatic approval review rejected changing the shared default HTTPS server; the HTTP configuration was restored and verified with HTTP 200. The certificate remains installed for activation after approval or domain setup.

Payment-provider settlement and real outbound email delivery were not verified. A pending card order was checked to ensure it was not falsely marked paid. Automated form/API checks do not constitute a complete manual visual or device-browser review, or a guarantee against every security issue.

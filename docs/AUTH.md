# Authentication and admin bootstrap

PeaceAi uses cookie-backed sessions (not JWT): an opaque, 192-bit random token
stored in the database with an HMAC-SHA256 signature, delivered in an
`httpOnly`, `SameSite=Lax`, HTTPS-`Secure` cookie. Passwords are stored as
per-user salted scrypt hashes and compared in constant time. `/api/auth` is
rate limited to 10 requests per minute per IP.

## Sign in

Open <http://localhost:3000/#/login> (or click **Sign in** in the chat UI) and
use the account email and password. After signing in, the user menu has
**Settings → Change password** and, for admins, the **Admin** area.

## Create or reset an admin account from the server

Use the bootstrap CLI on the machine that runs PeaceAi. It writes only a scrypt
hash to the data store; the password is never added to source, `.env`, or logs.

```bash
# Recommended: read the password from stdin (no password in shell history)
printf '%s' 'your-strong-password' | npm run admin:create -- --email admin@example.com --password-stdin

# Alternative: environment variable
PEACEAI_ADMIN_EMAIL=admin@example.com PEACEAI_ADMIN_PASSWORD='your-strong-password' npm run admin:create

# Alternative: interactive hidden prompt
npm run admin:create -- --email admin@example.com
```

Options:

- `--name <name>` sets the display name (defaults to the email's local part).
- `--tenant-id <id>` assigns a new admin to a specific workspace instead of the default guest workspace.
- `--reset-password` updates an existing account's password, restores `admin` role and `active` status, and **revokes all of that account's sessions**. Use it after a suspected compromise or when you forget the password. It never creates a duplicate account.
- `--password <value>` works but is visible in the process list; prefer `--password-stdin`.

Passwords must be at least 12 characters and contain at least three of:
lowercase, uppercase, digit, symbol.

The first admin created this way becomes the platform admin, unless a platform
admin already exists. Restarting the server is not required: the account is
written to the same SQLite database the server reads.

## Security behavior worth knowing

- Changing a password revokes every *other* session for that user; the current session stays signed in.
- Logout, account deletion, and password resets revoke sessions immediately.
- Tampered session cookies and expired sessions are rejected.
- `SESSION_HOURS` controls both the cookie lifetime and the server-side session expiry; invalid values fall back to 168 hours (7 days).
- Set `PEACEAI_SECRET` to a long random value before real use so session signatures remain valid across restarts, and use TLS in production (`COOKIE_SECURE=auto` adds the Secure flag on HTTPS).
- Keep the bootstrap command out of shell history where possible, and rotate the seeded password from **Settings → Change password** after first sign-in.

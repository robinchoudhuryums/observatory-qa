# Emergency Access Procedures

Covers: break-glass account unlock, PHI system access during outages, and emergency credential recovery.

---

## Scenario 1 — Admin Account Locked Out (Most Common)

After 5 failed login attempts, an account is locked for **15 minutes** automatically.
The lockout is in-memory — it does **not** persist across server restarts.

### Option A: Wait (Recommended for non-urgent situations)
The lockout expires automatically after 15 minutes. No action required.

### Option B: Super-Admin Unlock API (Immediate, requires super_admin credentials)

```bash
curl -X POST https://<your-domain>/api/super-admin/unlock-account \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=<super-admin-session-cookie>" \
  -d '{"username": "<locked-username>"}'
```

**Requirements**: You must be authenticated as a `super_admin` user (configured via `SUPER_ADMIN_USERS` env var).

**Audit trail**: Every invocation writes a tamper-evident `emergency_account_unlock` event to the HIPAA audit log, including which super-admin performed the unlock, timestamp, and IP address. This is visible in the Audit Logs page.

### Option C: Server Restart (Last resort — causes brief downtime)

The lockout state is stored in-memory. Restarting the application process clears all lockouts:

```bash
# EC2 (systemd)
sudo systemctl restart observatory-qa

# Render.com
# Trigger a manual deploy from the Render dashboard
```

**When to use**: Only if Option A and B are unavailable (e.g., super-admin is also locked out).
**Impact**: Active sessions survive (session data is in Redis/PostgreSQL). New login is required.
**Audit trail**: The restart itself is not directly logged in the HIPAA audit trail. Document it manually in the incident log.

---

## Scenario 2 — ALL Admin Accounts Locked or Credentials Unknown

If no admin user can log in (credentials lost, accounts locked, password hashes corrupted):

### Step 1: Use ENV-var admin user (if configured)

Check if `AUTH_USERS` is set in the production environment:

```bash
# EC2: check running environment
sudo systemctl show observatory-qa --property=Environment
# or
cat /opt/observatory-qa/.env | grep AUTH_USERS
```

ENV users bypass the database and are always available as long as the server can start.

### Step 2: Create a database admin user directly

```bash
# Connect to PostgreSQL
psql "$DATABASE_URL"

# Find your org ID
SELECT id, name, slug FROM organizations LIMIT 10;

# Generate a password hash (run this in Node)
node -e "
  const { scrypt, randomBytes } = require('crypto');
  const { promisify } = require('util');
  const scryptAsync = promisify(scrypt);
  async function hash(pw) {
    const salt = randomBytes(16).toString('hex');
    const buf = await scryptAsync(pw, salt, 64);
    return buf.toString('hex') + '.' + salt;
  }
  hash('TEMP_PASSWORD_CHANGE_IMMEDIATELY').then(console.log);
"

# Insert emergency admin user
INSERT INTO users (id, org_id, username, password_hash, name, role, created_at)
VALUES (
  gen_random_uuid(),
  '<org_id>',
  'emergency-admin',
  '<hash_from_above>',
  'Emergency Admin',
  'admin',
  NOW()
);
```

**Security requirements after emergency access**:
1. Log in immediately and change the password via normal UI
2. Delete the emergency-admin user when no longer needed
3. Document the emergency access in the incident log
4. Review audit logs for the window of unauthorized access

### Step 3: Restore from backup ENV file

If the `.env` file is lost, restore `AUTH_USERS` from the encrypted backup:
```bash
# Decrypt the backup (see KEY_MANAGEMENT.md for key storage)
gpg --decrypt env-backup-<date>.enc > .env
sudo systemctl restart observatory-qa
```

---

## Scenario 3 — PHI Encryption Key Lost

If `PHI_ENCRYPTION_KEY` is lost, encrypted PHI fields (clinical note content) **cannot be recovered** without the key. This is intentional — encryption without key backup is key escrow failure.

**Prevention** (required): Store `PHI_ENCRYPTION_KEY` in AWS Secrets Manager with:
- MFA-delete protection on the secret
- A second authorized IAM principal (Security Officer) who can retrieve the secret
- Cross-region replica for disaster recovery

**If the key is truly lost**:
1. Stop serving clinical notes immediately (prevent garbled data reaching clinicians)
2. Notify affected providers — clinical note content is unavailable
3. Check if the key exists in Secrets Manager via the backup IAM principal
4. If irrecoverable: document as a data loss incident; may require breach notification assessment

---

## Scenario 4 — Database Unavailable

Clinical note analysis and authentication (DB users) will fail. ENV users (`AUTH_USERS`) continue to work.

**Immediate steps**:
1. Check RDS/PostgreSQL status in AWS Console
2. If using read replica, confirm primary is the one down
3. If primary is down and automated failover didn't trigger: manually promote read replica

**Temporary operation**: Set `STORAGE_BACKEND=memory` + restart → in-memory mode (no data persistence, for diagnostic use only).

---

## Emergency Contact Chain

| Role | Responsibility | Contact |
|------|----------------|---------|
| Security Officer | Incident commander; HIPAA notification decisions | [FILL IN] |
| Engineering Lead | Technical access restoration | [FILL IN] |
| AWS Account Owner | IAM, Secrets Manager, RDS access | [FILL IN] |
| Legal Counsel | Breach notification if PHI accessed | [FILL IN] |

---

## Post-Emergency Requirements (HIPAA)

After any emergency access event:
1. **Document** in incident log (see `INCIDENT_RESPONSE.md` template)
2. **Review** audit logs for the period the account was locked
3. **Rotate** credentials used during emergency access
4. **Verify** no unauthorized PHI access occurred during the lockout window
5. **Update** this document if the procedure was unclear or incomplete

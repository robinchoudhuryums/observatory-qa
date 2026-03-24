# Observatory QA — HIPAA Security Rule Compliance Checklist

Last reviewed: 2026-03-24
Scope: SaaS platform handling Protected Health Information (PHI) in clinical call recordings, transcripts, and AI-generated clinical notes.

---

## Administrative Safeguards (§164.308)

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Security Officer designated | ✅ Required | Designate a HIPAA Security Officer; document in BAA |
| Risk analysis conducted | ✅ Required | Must be performed annually; document findings |
| Risk management plan | ✅ Required | Remediation plan based on risk analysis |
| Workforce training | ✅ Required | Train all staff with PHI access on HIPAA policies |
| Access management policy | ✅ Implemented | Role-based access (viewer/manager/admin) enforced in middleware |
| Workforce clearance procedure | ✅ Required | Background checks for staff with PHI system access |
| Termination procedures | ✅ Required | Account deactivation on offboarding |
| Access authorization | ✅ Implemented | requireAuth + requireRole middleware; per-org isolation |
| Security incident procedures | ✅ Implemented | See `INCIDENT_RESPONSE.md` |
| Contingency plan | ✅ Implemented | RTO/RPO targets, backup encryption procedures in `KEY_MANAGEMENT.md`; DR plan needed |
| Evaluation | ✅ Required | Annual HIPAA compliance review |
| BAA with subcontractors | ✅ Required | See `BAA_TEMPLATE.md`; BAAs needed with AWS, AssemblyAI |

---

## Physical Safeguards (§164.310)

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Facility access controls | ✅ Implemented | EC2 hosted in AWS data center (SOC 2 Type II) |
| Workstation use policy | ✅ Required | Policy for employee devices accessing PHI |
| Workstation security | ✅ Required | Encryption at rest on developer machines |
| Device/media controls | ✅ Implemented | S3 data remains in AWS; no removable media |

---

## Technical Safeguards (§164.312)

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Unique user identification | ✅ Implemented | Per-org unique usernames; UUID user IDs |
| Emergency access procedure | ✅ Implemented | Super-admin unlock API (`POST /api/super-admin/unlock-account`) + `docs/hipaa/EMERGENCY_ACCESS.md` |
| Automatic logoff | ✅ Implemented | 15-min idle timeout + 8-hour absolute max (`server/auth.ts`) |
| Encryption/decryption | ✅ Implemented | AES-256-GCM field-level encryption for PHI fields (`phi-encryption.ts`) |
| Audit controls | ✅ Implemented | Tamper-evident hash-chain audit log (`audit-log.ts`); all PHI access logged |
| Integrity controls | ✅ Implemented | SHA-256 integrity hashes on audit entries; GCM auth tags on encrypted data |
| Person authentication | ✅ Implemented | Password + optional TOTP MFA; SAML SSO for Enterprise |
| Transmission security | ✅ Implemented | TLS 1.2+ enforced (Caddy/Render); HTTPS redirect in production |
| Access control | ✅ Implemented | RBAC + per-org data isolation; `requireAuth` + `injectOrgContext` on all routes |
| PHI in error logs | ✅ Implemented | Sentry `beforeSend` PHI sanitization; console logging disabled in production |
| CSRF protection | ✅ Implemented | Double-submit cookie pattern; all state-changing API endpoints protected |
| Session fixation | ✅ Implemented | `req.session.regenerate()` on login, MFA verification |
| Account lockout | ✅ Implemented | 5 failed attempts → 15-min lockout per username |
| MFA enforcement | ✅ Implemented | Per-org `mfaRequired` setting; TOTP with backup codes |

---

## Organizational Requirements (§164.314)

| Requirement | Status | Notes |
|-------------|--------|-------|
| BAA with covered entities | ✅ Required | Use `BAA_TEMPLATE.md` for each customer |
| BAA with business associates | ✅ Required | Required with: AWS, AssemblyAI, Anthropic (via Bedrock) |
| Group health plan requirements | N/A | Not applicable |

---

## Gaps and Remediation

| Gap | Risk | Remediation |
|-----|------|-------------|
| PHI_ENCRYPTION_KEY rotation procedure | High | See `KEY_MANAGEMENT.md`; rotate annually or on compromise |
| Formal DR/BCP plan | Medium | Document RTO/RPO targets; test restore quarterly |
| Penetration testing | Medium | Annual external pentest; remediate High/Critical within 30 days |
| Workforce training records | Medium | Keep training completion records for 6 years |
| Risk analysis documentation | High | Annual written risk assessment; retain 6 years |

---

## Data Retention

Per-org retention policies enforced via BullMQ workers (default: 90 days).
Override via `org.settings.retentionDays`. Minimum retention: 6 years for medical records per HIPAA.
**Action required**: Ensure no org is configured below 2,190 days (6 years) for clinical notes.

---

## Incident Response

See `INCIDENT_RESPONSE.md` for the full procedure.
Breach notification deadline: 60 days from discovery (§164.412).

---

## Annual Review Checklist

- [ ] Update risk analysis
- [ ] Review access logs for anomalies
- [ ] Verify BAAs are current with all subcontractors
- [ ] Rotate PHI_ENCRYPTION_KEY (see `KEY_MANAGEMENT.md`)
- [ ] Review and update workforce training
- [ ] Test backup restore procedure
- [ ] Run security audit (port scan, dependency audit, pentest)
- [ ] Review and update this checklist

# HIPAA Incident Response Procedure

Applies to: Any actual or suspected unauthorized access, use, disclosure, modification, or destruction of PHI.

---

## Severity Classification

| Severity | Description | Response Time |
|----------|-------------|---------------|
| **P1 — Critical** | Confirmed PHI breach; active exfiltration; credential compromise | Immediate (< 1 hour) |
| **P2 — High** | Suspected PHI exposure; unauthorized access detected in audit logs | < 4 hours |
| **P3 — Medium** | Potential misconfiguration; anomalous access patterns | < 24 hours |
| **P4 — Low** | Failed access attempts; policy violation without PHI exposure | < 72 hours |

---

## Response Team

| Role | Responsibility |
|------|----------------|
| Security Officer | Incident commander; breach determination; regulatory notification |
| Engineering Lead | Technical containment and forensics |
| Legal Counsel | Regulatory and contractual obligations |
| Executive Sponsor | Customer and media communication |

---

## Phase 1: Detection and Triage (0–1 hour for P1/P2)

**Detection sources:**
- HIPAA audit log anomalies (`GET /api/admin/audit-logs/verify` — chain integrity check)
- Sentry error spikes (unusual volume of decryption failures → possible key issue)
- AWS CloudTrail alerts (unexpected S3/Bedrock API calls)
- Customer or user report

**Triage steps:**
1. Confirm whether PHI was actually accessed (check audit log: event, resourceType, userId, ip)
2. Estimate scope: how many records, which org(s), what time range
3. Classify severity and assign incident commander
4. Create incident ticket with timestamp, reporter, initial evidence

---

## Phase 2: Containment (P1: immediate; P2: < 4 hours)

**Immediate containment options:**

```bash
# Option A: Revoke a specific user's sessions
# (set mfaEnabled = true to force re-auth or delete the user record)

# Option B: Block a specific IP at the load balancer / security group
# AWS Console → EC2 → Security Groups → remove inbound rule for IP

# Option C: Rotate compromised API key
# POST /api/api-keys/:id/revoke (admin API)

# Option D: Take the application offline (last resort for active breach)
# systemctl stop observatory-qa    # EC2
# Render dashboard → Suspend service
```

**Preserve evidence before containment changes:**
- Export audit log entries for affected time window
- Save application logs (Betterstack / CloudWatch)
- Take EBS snapshot if forensic analysis of disk needed
- Do NOT delete logs — HIPAA requires retention

---

## Phase 3: Investigation (within 24 hours)

**Questions to answer:**

1. **What was accessed?** Which PHI fields, which calls/notes, which patients
2. **Who accessed it?** User ID, IP address, User-Agent, session ID
3. **How was access gained?** Credential theft, session hijack, application vulnerability, insider threat
4. **When did it start?** First anomalous audit log entry
5. **Is it ongoing?** Check for active sessions, real-time audit log monitoring
6. **What was taken?** Distinguish between "accessed" and "exfiltrated"

**Investigation tools:**
```sql
-- Query audit logs for PHI access events by IP
SELECT event, username, resource_type, resource_id, detail, created_at
FROM audit_logs
WHERE ip = '<suspicious-ip>'
  AND created_at BETWEEN '<start>' AND '<end>'
ORDER BY sequence_num;

-- Verify audit chain integrity
GET /api/admin/audit-logs/verify
```

---

## Phase 4: Breach Determination

Under HIPAA (§164.402), a "breach" is presumed unless the covered entity can demonstrate low probability of PHI compromise based on a risk assessment of:

1. Nature and extent of PHI involved (identifiers + clinical data)
2. Who accessed or could have accessed the PHI
3. Whether PHI was actually acquired or viewed
4. Extent to which the risk has been mitigated

**Document the risk assessment.** If low probability cannot be demonstrated → it is a reportable breach.

---

## Phase 5: Notification (if breach confirmed)

### Timeline (§164.412)

| Recipient | Deadline |
|-----------|----------|
| Affected individuals | 60 days from discovery |
| Covered Entity customers | Per BAA (typically 5 business days for initial notice, 60 days for full report) |
| HHS Secretary | 60 days from discovery; annual report if < 500 individuals |
| Media | 60 days if > 500 individuals in a state/jurisdiction |

### Notification Content (§164.404(c))

Include:
- Brief description of what happened, including date of breach and date of discovery
- Description of PHI involved (types of identifiers)
- Steps individuals should take to protect themselves
- Description of what Observatory QA is doing to investigate, mitigate, and prevent recurrence
- Contact information (toll-free phone, email, website)

---

## Phase 6: Recovery and Post-Incident

1. **Remediate root cause** — patch vulnerability, reset credentials, update configuration
2. **Re-encrypt if key was compromised** — see `KEY_MANAGEMENT.md`
3. **Restore from backup** if data was modified or deleted
4. **Update security controls** — new detection rules, additional MFA requirements, etc.
5. **Post-incident review** — within 2 weeks; document timeline, root cause, lessons learned
6. **Update risk analysis** — reflect new findings

---

## Incident Log Template

```
Incident ID: INC-YYYY-MMDD-NNN
Date Discovered:
Reported By:
Severity: P1/P2/P3/P4
Status: Open / Contained / Resolved / Closed

Summary:

PHI Scope:
- Organizations affected:
- Estimated records affected:
- PHI types involved:

Timeline:
- [DATETIME] Event detected
- [DATETIME] Incident commander assigned
- [DATETIME] Containment action taken
- [DATETIME] Root cause identified
- [DATETIME] Remediation completed
- [DATETIME] Breach determination made (reportable / not reportable)
- [DATETIME] Notifications sent

Root Cause:

Remediation:

Breach Determination:
[ ] Not a breach — low probability risk assessment documented
[ ] Reportable breach — notifications required

Notifications Sent:
- Covered Entity customers:
- HHS:
- Media:
- Individuals:

Lessons Learned:

Sign-off (Security Officer): _____________________ Date: _________
```

# Business Associate Agreement — Template

**IMPORTANT**: This is a template only. Have legal counsel review before execution.

---

## BUSINESS ASSOCIATE AGREEMENT

This Business Associate Agreement ("Agreement") is entered into as of [EFFECTIVE DATE] between:

**Covered Entity**: [CUSTOMER NAME], a [STATE] [entity type] ("Covered Entity")

**Business Associate**: Observatory QA, Inc. ("Business Associate")

---

## 1. Definitions

Terms used in this Agreement shall have the same meanings as defined in the HIPAA Rules (45 CFR Parts 160 and 164).

- **PHI**: Protected Health Information
- **ePHI**: Electronic Protected Health Information
- **HIPAA Rules**: The Health Insurance Portability and Accountability Act of 1996 and its implementing regulations

---

## 2. Obligations of Business Associate

Business Associate agrees to:

**2.1 Use and Disclosure Limitations**
- Not use or disclose PHI other than as permitted or required by this Agreement or as required by law
- Use appropriate safeguards to prevent unauthorized use or disclosure of PHI
- Report any use or disclosure not provided for by this Agreement to Covered Entity within **5 business days**

**2.2 Security**
- Implement administrative, physical, and technical safeguards that reasonably and appropriately protect the confidentiality, integrity, and availability of ePHI (per 45 CFR 164.312)
- Encrypt all ePHI at rest (AES-256-GCM) and in transit (TLS 1.2+)
- Maintain HIPAA-compliant audit logs of all PHI access

**2.3 Subcontractors**
- Ensure any subcontractors who create, receive, maintain, or transmit PHI agree to the same restrictions through a written agreement
- Current subcontractors with PHI access: Amazon Web Services (storage, AI), AssemblyAI (transcription)

**2.4 Individual Rights**
- Make PHI available for access, amendment, and accounting of disclosures as directed by Covered Entity
- Incorporate amendments to PHI as directed within **30 days**

**2.5 Breach Notification**
- Notify Covered Entity of a Breach of Unsecured PHI without unreasonable delay and no later than **60 days** after discovery
- Notification shall include: (a) identity of individuals affected, (b) PHI involved, (c) unauthorized person who accessed PHI, (d) whether PHI was acquired or viewed, (e) extent of mitigation

**2.6 Record Availability**
- Make internal practices, books, and records available to the Secretary of HHS for determining compliance

---

## 3. Permitted Uses and Disclosures

Business Associate may use or disclose PHI:

- To perform services specified in the Services Agreement
- As required by law
- For proper management and administration of Business Associate's operations
- To provide data aggregation services relating to Covered Entity's health care operations

Business Associate may **not**:
- Use PHI for marketing purposes without authorization
- Sell PHI
- Use PHI in a way that would violate the HIPAA Rules

---

## 4. Term and Termination

**4.1 Term**: This Agreement is effective as of the Effective Date and terminates when the Services Agreement terminates, or earlier upon 30 days written notice.

**4.2 Termination for Cause**: Either party may terminate this Agreement if the other party materially breaches a provision, and the breach is not cured within 30 days of written notice.

**4.3 Effect of Termination**: Upon termination, Business Associate shall:
- Return or destroy all PHI received from, or created on behalf of, Covered Entity
- If return or destruction is infeasible, extend protections for as long as PHI is retained
- Certify in writing that all PHI has been returned or destroyed within **30 days**

---

## 5. Miscellaneous

**5.1 Survival**: Obligations regarding PHI surviving termination shall survive.

**5.2 Interpretation**: Any ambiguity in this Agreement shall be resolved to permit compliance with the HIPAA Rules.

**5.3 Amendment**: The parties agree to amend this Agreement to comply with changes in the HIPAA Rules.

---

## Signatures

**Covered Entity**

Signature: _______________________
Name: ___________________________
Title: ____________________________
Date: ____________________________

**Business Associate (Observatory QA)**

Signature: _______________________
Name: ___________________________
Title: ____________________________
Date: ____________________________

---

## Subcontractor BAA Status

| Subcontractor | Service | BAA Status | BAA Expiry |
|--------------|---------|------------|------------|
| Amazon Web Services | Storage (S3), AI (Bedrock), Infrastructure (EC2) | Required | — |
| AssemblyAI | Transcription | Required | — |
| Neon / Supabase | PostgreSQL (staging) | Required if PHI present | — |
| Render.com | Hosting (staging) | Required if PHI present | — |
| Betterstack | Log aggregation | Required | — |

**Note**: Do not use staging environment (Render) for production PHI without a signed BAA.

# Enterprise Pricing Guide (Internal — Not Customer-Facing)

*Last updated: 2026-03-29*

---

## Pricing Philosophy

Enterprise pricing is **value-based, not cost-based**. You're not selling API calls — you're selling:
- Time saved (hours of manual QA review eliminated)
- Risk reduction (HIPAA compliance, audit trail)
- Revenue captured (calls that would have been lost without QA insights)

The cost to serve is your floor. The value delivered is your ceiling. Price closer to the ceiling.

---

## Cost-to-Serve Calculator

Use this to determine your **minimum viable price** for any Enterprise deal.

### Step 1: Estimate monthly call volume
Ask the prospect: "How many calls does your team handle per month?"

### Step 2: Calculate variable cost

| Component | Cost per call | Notes |
|-----------|--------------|-------|
| AssemblyAI (5-min avg call) | $0.065 | Transcription + sentiment + diarization |
| AssemblyAI PII redaction | $0.020 | HIPAA recommended |
| Bedrock Claude Sonnet | $0.006 | AI analysis (1K input + 500 output tokens) |
| Bedrock Titan Embed (RAG) | $0.0001 | Only if RAG enabled |
| S3 storage | $0.0001 | ~5MB per call at $0.023/GB |
| **Total per call** | **~$0.09** | |

### Step 3: Calculate monthly cost floor

```
Monthly cost floor = (estimated_calls × $0.09) + $60 (infra share)
```

| Calls/month | Variable cost | Infra share | **Cost floor** |
|-------------|--------------|-------------|---------------|
| 500 | $45 | $60 | **$105** |
| 1,000 | $90 | $60 | **$150** |
| 2,000 | $180 | $60 | **$240** |
| 5,000 | $450 | $60 | **$510** |
| 10,000 | $900 | $80 | **$980** |
| 20,000 | $1,800 | $100 | **$1,900** |

### Step 4: Apply pricing multiplier

| Customer type | Multiplier | Rationale |
|---------------|-----------|-----------|
| Small practice (1-5 providers) | 3-4× cost | High value-per-user, low support burden |
| Mid-size group (5-20 providers) | 2.5-3× cost | Volume efficiency, moderate support |
| Large organization (20+ providers) | 2-2.5× cost | Volume discount, but higher support/SLA expectations |
| Urgent need / competitive deal | 2× cost minimum | Never go below 2× — margin erosion is permanent |

---

## Pricing Matrix (Quick Reference)

Use this during sales conversations. All prices are monthly.

| Calls/mo | Seats | Features | Suggested price | Floor (don't go below) |
|----------|-------|----------|----------------|----------------------|
| 500 | 5-10 | QA + Clinical | $349-449 | $249 |
| 500 | 5-10 | QA only | $299-349 | $199 |
| 1,000 | 10-15 | QA + Clinical | $499-699 | $349 |
| 1,000 | 10-15 | QA + Clinical + SSO | $699-899 | $499 |
| 2,000 | 15-25 | Full platform + SSO | $899-1,199 | $599 |
| 5,000 | 25-50 | Full platform + SSO + SCIM | $1,299-1,799 | $999 |
| 10,000 | 50+ | Full platform + everything | $2,499-3,499 | $1,799 |
| 20,000+ | 100+ | Full platform + SLA | $4,999+ | $3,499 |

### Per-seat add-on (above base allocation)
- Base: 25 seats included in any Enterprise deal
- Additional: **$25/seat/month** (non-negotiable below $20/seat)

### Call overage
- Standard: **$0.15/call** over the agreed cap
- High-volume discount (negotiable): $0.10-0.12/call for commitments > 10,000/mo

---

## Discovery Questions

Ask these during the initial conversation to size the deal:

### Volume & Team
1. "How many calls does your team handle per month?" → Sizes the call tier
2. "How many people need access to the platform?" → Sizes seat count
3. "How many locations/offices do you have?" → Indicates org complexity
4. "Do you have an IT team, or is this managed by practice staff?" → Indicates support burden

### Features & Compliance
5. "Do you need clinical documentation (AI-generated SOAP/DAP notes)?" → +20-30% price
6. "Do you use an EHR system? Which one?" → Open Dental/Eaglesoft integration value
7. "Do you need single sign-on (SSO) for your team?" → Enterprise-only feature
8. "Are you subject to HIPAA compliance requirements?" → All healthcare = yes
9. "Do you currently do any QA scoring on calls?" → Manual QA replacement = high value

### Budget & Timeline
10. "Do you have a budget range in mind?" → Anchors negotiation
11. "When are you looking to get started?" → Urgency = less negotiation
12. "Are you evaluating other solutions?" → Competitive pressure
13. "Is this a new initiative or replacing an existing tool?" → Switching cost context

---

## Negotiation Playbook

### Prospect says "That's too expensive"

**Response framework:**
1. **Acknowledge**: "I understand — let me make sure the pricing matches your actual needs."
2. **Right-size**: Reduce call tier or seats to match their real usage (don't discount the rate)
3. **Annual commitment**: Offer 15-20% discount for annual prepayment (improves your cash flow too)
4. **Phased rollout**: Start with fewer features, add Clinical Docs or SSO later

**What NOT to do:**
- Don't discount more than 20% from your initial quote
- Don't offer free months (sets expectation of free)
- Don't remove features to hit a price (reduces perceived value)

### Prospect says "Competitor X is cheaper"

**Response:**
- "What features does [competitor] include at that price?"
- "Do they include clinical documentation / HIPAA audit trail / EHR integration?"
- "Are they HIPAA-compliant with BAA?"
- Most competitors don't have the clinical + QA bundle — that's your moat

### Prospect asks for a pilot/trial

**Standard offer:**
- 30-day pilot at 50% of quoted price (not free)
- Includes full feature access
- Converts to full price after 30 days unless cancelled
- Pilot data carries over (no migration friction)

**Why not free trials for Enterprise:**
- Enterprise features (SSO, SCIM) require configuration time from you
- Free trials attract tire-kickers, paid pilots attract buyers
- Sets the expectation that this is a premium product

---

## Contract Structure

### Standard Enterprise Agreement

| Term | Standard | Negotiable range |
|------|----------|-----------------|
| Contract length | Annual | 6-month minimum |
| Billing | Monthly | Quarterly/annual prepay for discount |
| Price lock | 12 months | Up to 24 months for annual prepay |
| Call cap | Agreed volume | +/- 20% buffer before overage kicks in |
| Overage rate | $0.15/call | $0.10-0.15 for high volume |
| Seat additions | $25/seat/mo | $20-25 depending on volume |
| SLA | 99.5% uptime | 99.9% for premium (+$200/mo) |
| Support | Email (24h response) | Slack channel (+$100/mo) or phone (+$200/mo) |

### Annual Prepay Discounts
| Monthly equivalent | Discount | Annual total |
|-------------------|----------|-------------|
| $500-999/mo | 15% off | Save $900-1,800/yr |
| $1,000-1,999/mo | 18% off | Save $2,160-4,320/yr |
| $2,000+/mo | 20% off | Save $4,800+/yr |

---

## Renegotiation Handling

### When customers ask to renegotiate

**Common triggers:**
- Contract renewal (annual anniversary)
- Usage changed significantly (up or down)
- Competitor offer
- Budget cuts
- Expanded team wanting more seats

### Framework for handling renegotiations

**Step 1: Understand the "why"**
- "What's changed since we set this pricing?" → Don't concede before understanding
- If usage went UP → they should be paying MORE (you have leverage)
- If usage went DOWN → right-size the plan (reduce call cap, reduce price proportionally)
- If competitor offer → ask what features they'd lose (your clinical docs are the moat)

**Step 2: Never reduce price without reducing scope**

| They want | You can offer |
|-----------|--------------|
| 20% price reduction | Remove SSO, reduce call cap by 30% |
| Lower per-call rate | Commit to higher minimum volume (annual prepay) |
| Free additional seats | Add seats but extend contract 6 months |
| Month-to-month flexibility | Remove annual discount (price goes UP) |

**Step 3: Counter-offer structure**
```
"I can bring the monthly to $X if we:
 (a) extend the contract to [longer term], or
 (b) switch to annual prepay, or
 (c) adjust the call cap to [lower number]"
```

**Key principle:** Every concession you make should come with a concession from them (longer commitment, prepay, or reduced scope). Never give a pure discount.

### Retention pricing (churn risk)

If a customer explicitly says they're leaving:
- Maximum retention discount: 25% for 6 months, then return to standard pricing
- Only offer if they've been a customer for 6+ months AND you'd lose money acquiring a replacement
- Document the retention discount with an end date — never make it permanent

### Price increases at renewal

**Standard approach:**
- Year 1→2: Hold price (build loyalty)
- Year 2→3: 5-8% increase (inflation + feature improvements)
- Year 3+: 3-5% annual increases
- Always give 60 days notice before renewal

**How to communicate:**
> "Your renewal is coming up on [date]. Over the past year we've added [features]. Your new rate will be $X/mo (a [Y]% adjustment). We're happy to discuss if you'd like to adjust your plan."

Never apologize for price increases. Frame them as "adjustments" tied to product improvements.

---

## Email Response Templates

### Initial inquiry response

```
Subject: Observatory QA Enterprise — Let's find the right fit

Hi [Name],

Thanks for your interest in Observatory QA Enterprise.

To put together the right plan for [Company], I'd love to understand:

- Roughly how many calls your team handles per month
- How many team members would need access
- Whether clinical documentation (AI-generated SOAP/DAP notes) would be useful
- Any specific compliance requirements (SSO, SCIM provisioning, etc.)

Happy to jump on a 15-minute call this week to walk through
the platform and discuss pricing. What works for your schedule?

Best,
[Your name]
```

### Follow-up with pricing

```
Subject: Your Observatory QA Enterprise quote

Hi [Name],

Great talking with you. Based on what you shared:

- ~[X] calls/month across [Y] team members
- [Features they need]

Here's what I'd recommend:

  Observatory QA Enterprise
  [X] calls/month · [Y] seats · [features]
  $[price]/month (or $[annual_price]/year — save [X]%)

This includes:
✓ [Feature 1]
✓ [Feature 2]
✓ [Feature 3]
✓ Dedicated onboarding and email support

I'd love to get you started with a 30-day pilot at 50% ($[pilot_price]/mo)
so your team can evaluate with real data. Pilot data carries over to the
full subscription.

Want me to set that up?

Best,
[Your name]
```

---

## Red Flags (Walk Away)

- Prospect wants unlimited calls with no cap for < $500/mo → unprofitable
- Prospect insists on free pilot > 30 days → unlikely to convert
- Prospect needs custom SLA (99.99%+) → you can't deliver this as a solo operator
- Prospect needs on-premise deployment → not supported, don't promise it
- Prospect has > 50,000 calls/month → your infrastructure isn't ready yet (revisit at scale)
- Prospect wants to pay per-call only (no base subscription) → misaligned incentives

---

## Quick Decision Flowchart

```
Prospect contacts you
  │
  ├─ < 300 calls/mo, < 5 seats → Suggest Starter or Professional (self-service)
  │
  ├─ 300-1000 calls/mo, needs SSO or Clinical → Enterprise $499-899/mo
  │
  ├─ 1000-5000 calls/mo → Enterprise $899-1,799/mo
  │
  ├─ 5000-10000 calls/mo → Enterprise $1,799-3,499/mo
  │
  ├─ 10000+ calls/mo → Enterprise $3,499+/mo (verify your infra can handle it)
  │
  └─ "Just needs SSO" with low volume → Enterprise $349-499/mo
     (SSO is Enterprise-only, so even low-volume SSO customers pay Enterprise base)
```

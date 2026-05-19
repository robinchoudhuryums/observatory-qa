# Orrery Redesign — Implementation Plan

Source design: `design/Orrery Prototype.html` (entry point) + `design/directions/*.jsx` + `design/prototype/*.jsx` + `design/Orrery App Map.html` (nav graph).

Target: complete frontend redesign of Observatory QA. Pre-production project, no active users, no backward-compat constraints.

Decisions locked:
- Both presentation modes ship — Observatory (celestial metaphor) + Clinical (flat charts, swapped lexicon). Per-org toggle, industry-type sets default.
- Complete redesign (no feature flag, no opt-in). Old aurora theme is removed.
- Recharts kept, restyled with celestial palette. Custom SVG only for orrery-specific viz (orbits, galaxy, constellations, call arc, clinical swimlane/sankey/heatmap).
- This document lives in-repo as the working reference.

## 1. Scope & non-goals

**In scope**
- Replace all design tokens (color, typography, spacing, radius, shadow, motion).
- Redesign 17 existing pages that have orrery counterparts.
- Build 9 net-new screens (Galaxy, Patterns-as-constellations, Day Replay overlay, Mobile Atlas, Ask Ory FAB, Owl persona kit, Realism states pack, Track Pattern popover, Coach-this-call panel).
- Restyle (tokens only, no layout change) the remaining 12 pages.
- Port the prototype's `window.*` globals to ES modules under `client/src/components/orrery/`.
- Introduce `presentation` org setting and `clinicalLex()` lexicon swap.
- Replace `branding-provider.tsx` color injection to target the celestial palette.

**Out of scope**
- Backend schema changes beyond `org.settings.presentation` (boolean toggle + lexicon mode).
- New API endpoints — every screen maps to existing routes (data adapters do the shape work client-side).
- Marketing/landing page redesign (the App Map flags it as "separate project").
- Mobile app — only mobile-responsive web (Mobile Atlas pattern).

## 2. Design-vs-current delta

The redesign is not a re-skin. Every layer changes.

| Layer | Current | Orrery | Migration |
|---|---|---|---|
| Brand primary | `hsl(262 83% 58%)` Aurora violet | `#22b8cf` celestial cyan + `#0892a8` deep cyan | Replace `--primary` token + every `--chart-*` |
| Display type | Poppins 600 | Instrument Serif italic 400/500 | Add Instrument Serif via Google Fonts; remove Poppins |
| Body type | Poppins 400/500 | Inter 400/500/600 | Inter already loaded; demote Poppins |
| Mono type | Menlo | JetBrains Mono 400/500 | Add JetBrains Mono |
| Radius | `--radius: 0.625rem` (single) | 6/8/10/12/14px (scale) | Extend Tailwind `borderRadius` |
| Chart engine | Recharts (8 pages) | Custom SVG + Recharts coexist | Recharts stays; remap chart palette; add new SVG viz |
| Motion | Framer Motion (7 files) + CSS keyframes | CSS keyframes + SVG SMIL + rAF | Both stacks coexist (Framer for page transitions, prototype stack for viz) |
| Layout shell | Fixed sidebar + per-page header | Sticky `OrreryTopBar` + right rails (hero pages) / sidebar (bench pages) | New `<OrreryShell>` for hero tiers; existing `Sidebar` retained for workbench |
| Theme tokens | CSS custom properties (HSL) | JS objects `ORRERY_LIGHT/DARK` (hex) | Both — JS objects for component reads, CSS vars mirror them for global selectors |
| Owl/brand | None (logo only) | Animated layered owl persona (`Ory`) with state machine | New `client/src/components/orrery/owl/` module |
| Empty/loading | Scattered per-page | Realism state pack (empty-glyph, loading-planet, processing-badge, uncertainty-haze) | New unified vocabulary |

## 3. Screen mapping

### Tier mapping
- **Full orrery (hero)** — celestial visualization is the screen itself.
- **Quiet orrery** — light celestial touch, real content dominates.
- **Workbench** — calm work surface, minimal celestial chrome.

### Page mapping

| Prototype screen | Tier | Existing page | Strategy |
|---|---|---|---|
| `signin` | Full | `client/src/pages/auth.tsx` | Full redesign. Light theme parity required (prototype is dark-only for sign-in — must add light variant). MFA/SSO/OAuth branches preserved. |
| `dashboard` (Atlas) | Full | `client/src/pages/dashboard.tsx` | Hero orrery + KPI strip + alert row. Lens switcher (type/lifecycle/revenue/recency). Drops the existing `metrics-overview.tsx` / `sentiment-analysis.tsx` / `performance-card.tsx` / `calls-table.tsx` composition. |
| `planet` detail | Quiet | New `client/src/pages/atlas-cluster.tsx`, route `/atlas/cluster/:category` | New page — drill-in from Atlas planet click. 19 moons (calls) orbiting a hero planet. |
| `call` detail | Quiet | `client/src/pages/transcripts.tsx` (detail mode when `:id` present) | Arc + moments + transcript. `transcript-viewer.tsx` refactored — hooks-order invariant (INV-19) honored. Clinical mode swaps arc for `ClinicalCallTimeline`. |
| `galaxy` | Full | New `client/src/pages/galaxy.tsx`, route `/galaxy` | Month spiral, days as planets. |
| `patterns` | Full | `client/src/pages/insights.tsx` | Constellations replace existing bar/area charts. `/api/insights` + `/api/insights/clusters` already provide the data. Clinical mode swaps for network graph / sankey / heatmap. |
| `clinical-note` | Bench | `client/src/pages/clinical-notes.tsx` | Workbench redesign — completeness orb header, timeline arc, Ory's Note panel. PHI encryption (INV-08, INV-09) and attestation/amendment flow preserved. |
| `coaching` | Full | `client/src/pages/coaching.tsx` | Each agent rendered as mini-orrery. Coaching session form + action plan editor. |
| `mobile-atlas` | Quiet (mobile) | Responsive variant of `/dashboard` | Bottom sheet with peek/half/full snap heights. Activated under `md` breakpoint. |
| `day-replay` overlay | Full | New overlay on `/dashboard` | 24-call animation, 18s rAF loop. New feature. |
| `clinical` mode (cross-cutting) | — | Affects dashboard, patterns, call detail, clinical-* pages | `presentation` prop threaded through layout shell. `clinicalLex(key)` for labels. |
| `coach-this-call` panel | Overlay | Triggered from call detail | New right-rail. Posts to existing `/api/coaching`. |
| `track-pattern` popover | Overlay | Triggered from patterns view | New anchored popover. Persists alert config (new schema field). |
| `owl-showcase` | Lab | New `/dev/orrery/owl` | Super-admin only. Owl persona states. |
| `realism-showcase` | Lab | New `/dev/orrery/realism` | Super-admin only. Empty/loading/error vocabulary. |
| `type-lab`, `type-lab-b` | Lab | New `/dev/orrery/type-lab`, `/dev/orrery/type-lab-b` | Super-admin only. Typography reference. |
| `ios-frame` | Wrapper | Used by mobile-atlas dev preview only | Not user-facing. |

### Restyle-only (no layout change, tokens only)

These get the orrery color/typography/spacing pass but keep existing structure:
- `upload.tsx`, `search.tsx`, `sentiment.tsx`, `performance.tsx`, `employees.tsx`
- `learning.tsx`, `gamification.tsx`, `calibration.tsx`
- `simulated-calls.tsx`, `ab-testing.tsx`
- `settings.tsx`, `admin.tsx`, `audit-logs.tsx`, `prompt-templates.tsx`
- `marketing.tsx`, `revenue.tsx`, `emails.tsx`, `insurance-narratives.tsx`
- `billing.tsx`, `spend-tracking.tsx`, `feedback.tsx`
- `clinical-live.tsx`, `clinical-templates.tsx`, `clinical-upload.tsx`

### Net-new schema additions

| Field | Where | Type | Default |
|---|---|---|---|
| `org.settings.presentation` | `shared/schema/org.ts` | `'observatory' \| 'clinical'` | derived from `industryType` (clinical for dental/medical/behavioral_health/veterinary) |
| `org.settings.theme` | `shared/schema/org.ts` | `'light' \| 'dark' \| 'auto'` | `'auto'` |
| `pattern_subscriptions` | new table | `id, orgId, patternKey, triggerKind, expiresAt, createdBy` | for Track-Pattern popover |

Both touch `shared/schema/org.ts` and require `sync-schema.ts` mirrored DDL (INV-10).

## 4. Cross-cutting infrastructure

### 4.1 Token plumbing

- `client/src/lib/orrery-theme.ts` — TypeScript port of `ORRERY_LIGHT`/`ORRERY_DARK`. Exports `Theme` type, `lightTheme`, `darkTheme`, `useOrreryTheme()` hook.
- `client/src/index.css` — replace all aurora variables. Add celestial vars:
  ```
  --bg, --bg-flat, --panel, --panel-border, --panel-stroke
  --ink, --ink-soft, --ink-mute
  --orbit, --star-core, --star-glow-1, --star-glow-2, --halo-bg
  --celestial-bright, --celestial-warm, --celestial-cool, --celestial-cold, --celestial-ice
  --accent-amber, --accent-red, --accent-green
  --logo-tint, --logo-tint-gold
  ```
- `tailwind.config.ts` — extend `colors` with semantic celestial names; extend `fontFamily` (`serif: ['Instrument Serif']`, `sans: ['Inter']`, `mono: ['JetBrains Mono']`); extend `borderRadius` (6/8/10/12/14); extend `transitionTimingFunction` (`pop: cubic-bezier(0.22, 1, 0.36, 1)`).
- `client/src/index.css` font imports — remove Poppins; add Instrument Serif italic and JetBrains Mono.
- Existing dark-mode Recharts `!important` overrides — recolor to `--ink-soft`.

### 4.2 Component ports (`window.*` → ES modules)

Target folder: `client/src/components/orrery/`. One file per primitive; barrel `index.ts`.

**System (from `directions/orrery-system.jsx`):**
- `theme.ts` — token objects + hook
- `OrreryTopBar.tsx`
- `OrreryCenterStar.tsx`
- `OrreryOrbitRing.tsx`
- `OrreryPlanet.tsx`
- `OrreryStarfield.tsx`
- `OrreryKpi.tsx`
- `OrreryCard.tsx`
- `OrreryTag.tsx`
- `OrreryThemeToggle.tsx`
- `projection.ts` — exports `TILT`, `orreryProject()`
- `brightness.ts` — exports `brightToColor()`

**Brand (from `directions/observatory-brand.jsx` + `directions/observatory-owl-mark-data.js`):**
- `owl/ObservatoryOwlMark.tsx`
- `owl/ObservatoryWordmark.tsx`
- `owl/ObservatoryFilledOwl.tsx`
- `owl/ObservatoryFilledOwlHead.tsx`
- `owl/ObservatoryLockup.tsx`
- `owl/ObservatoryLayeredOwl.tsx` — state machine props: `state: 'idle' | 'thinking' | 'attention' | 'concerned' | 'talking'`
- `owl/owl.css` — keyframes (`obsOwlBlink`, `obsOwlAttention`, `obsOwlBreath`, `obsOwlTilt`)
- Owl mark PNG → `client/public/orrery/owl-mark.png` (21 KB). No data-URL embed (cleaner CSP, easier swap).

**Realism (from `directions/orrery-realism.jsx`):**
- `realism/EmptyState.tsx`
- `realism/EmptyGlyph.tsx` — `kind: 'flat-orbit' | 'no-constellation' | 'thin-data' | 'cloud'`
- `realism/LoadingPlanet.tsx`
- `realism/ProcessingBadge.tsx`
- `realism/UncertaintyHaze.tsx`
- `realism/realism.css` — `realPulse` keyframe

**Visualization (per-screen):**
- `viz/Orrery.tsx` — composes center star + orbit rings + planets, accepts `planets: Planet[]` + `lens` prop
- `viz/Galaxy.tsx` — spiral layout
- `viz/Constellation.tsx` — nodes + edges, pattern-aware
- `viz/CallArc.tsx` — orbital arc with moments
- `viz/AgentSystem.tsx` — mini-orrery per agent (used in coaching)
- `viz/clinical/SwimlaneHero.tsx`
- `viz/clinical/SankeyHero.tsx`
- `viz/clinical/HeatmapHero.tsx`
- `viz/clinical/CallTimeline.tsx` — horizontal time × quality curve
- `viz/clinical/PatternsNetwork.tsx` — flat node-link graph

**Overlays / interactions:**
- `overlays/AskOryFab.tsx` + `overlays/AskOryPanel.tsx`
- `overlays/CoachThisCallPanel.tsx`
- `overlays/TrackPatternPopover.tsx`
- `overlays/DayReplay.tsx`
- `overlays/CoachSentToast.tsx`
- `overlays/OwlSignature.tsx`

**Layout shell:**
- `shell/OrreryShell.tsx` — `<OrreryShell tier="full|quiet">` wraps top bar + content + optional right rail
- `shell/PresentationBadge.tsx` — observatory/clinical toggle chrome
- `shell/usePresentation.ts` — hook bound to `org.settings.presentation`
- `shell/clinicalLex.ts` — lexicon map (atlas→Dashboard, patterns→Trends, planet→Cluster, etc.)

### 4.3 Data adapters

`client/src/lib/orrery-adapters.ts` — pure functions, fully typed against `shared/schema/*`, unit-tested.

| Adapter | Input | Output |
|---|---|---|
| `callsToPlanets(calls, lens)` | `Call[]`, `Lens` | `Planet[]` (orbit, angle, size, brightness) |
| `dayBucketsToGalaxy(days)` | `{ d, calls, close, weekend, anchor }[]` | `GalaxyDay[]` with spiral coords |
| `patternsToConstellations(insights)` | API `/api/insights` shape | `Pattern[]` (nodes + edges + color + stat) |
| `agentsToCoachingSystems(employees, performances)` | `Employee[]`, `Performer[]` | `Agent[]` with brightness/delta |
| `transcriptToMoments(transcript, sentiment, analysis)` | full transcript+sentiment+analysis | `Moment[]` (angle, label, time, tone) |
| `callToClinicalTimeline(transcript, sentiment, analysis)` | same | quality-over-time samples for `<CallTimeline>` |
| `clinicalNoteToOrbital(note)` | `ClinicalNote` | completeness orb data + timeline steps |

Brightness ramp lives in `brightness.ts`. Lens definitions in `lib/orrery-lenses.ts` — each lens has a name, orbit assignment function, and color override hook.

### 4.4 Layout decisions

- Hero pages (dashboard, galaxy, patterns, coaching) → `<OrreryShell tier="full">`. No fixed sidebar. Sticky top bar with owl + wordmark + view label + nav links.
- Quiet pages (planet detail, call detail, sentiment, performance, employees, etc.) → `<OrreryShell tier="quiet">`. Optional sidebar collapsed by default; can be opened from top bar hamburger.
- Workbench pages (clinical-*, settings, admin, billing, spend, audit, prompt templates, emails, insurance narratives, ab-testing) → existing `<Sidebar>` layout with restyled tokens. No top-bar swap.
- Mobile (`<md` breakpoint): hero pages use the mobile-atlas bottom-sheet pattern. Workbench stays on existing drawer.

A single `<AppShell>` component reads route metadata (`tier`) and chooses the wrapper.

### 4.5 Branding provider rework

`client/src/components/branding-provider.tsx` currently injects `--primary`, `--accent`, `--ring`, `--chart-1`, `--brand-from`, `--brand-to`. Rework:
- Org `primaryColor` → `--celestial-bright` chain (computed via brightness ramp).
- Org `secondaryColor` → `--celestial-warm`.
- Derived `--celestial-cool/-cold/-ice` interpolated between bright and ice via HSL lightness ramp.
- Logo tint: org branding can set `--logo-tint`; defaults to theme value.
- Per-org dark-mode overrides: derive from same primary via L-axis flip.

## 5. Phased delivery

Each phase is one PR (or two for large phases). Pre-production means we can land each phase directly on main once reviewed; no feature flag.

### Phase 0 — Tokens, primitives, dev showcases (1 PR, ~30 files)
- Replace all CSS variables in `index.css`. Remove aurora keyframes. Add celestial keyframes.
- Update `tailwind.config.ts`.
- Swap fonts (remove Poppins, add Instrument Serif + JetBrains Mono).
- Port all `client/src/components/orrery/` primitives.
- Owl PNG → `client/public/orrery/owl-mark.png`.
- New routes `/dev/orrery/*` (super-admin only): owl, realism, type-lab, type-lab-b, components.
- Update `branding-provider.tsx` for celestial palette.
- Update existing pages: enough token usage swaps to keep them compiling. **Tokens-only pass on the 12 restyle-only pages happens here**, because aurora violet disappears from the build.
- E2E: existing `a11y.spec.ts` and `dashboard.spec.ts` continue to pass (visual changes only).
- Verification: visual diff vs prototype at `/dev/orrery/components`.

**Files touched (Phase 0):** ~30 new + ~50 modified (CSS vars only across pages).

### Phase 1 — Atlas hero (1 PR, ~15 files)
- New `client/src/components/orrery/viz/Orrery.tsx` + lens definitions.
- Rewrite `client/src/pages/dashboard.tsx` as Atlas.
- Build `callsToPlanets()` + `dayBucketsToGalaxy()` adapters.
- Day Replay overlay (`overlays/DayReplay.tsx`).
- Mobile Atlas bottom sheet — extract into `shell/MobileBottomSheet.tsx`.
- Realism state wiring: empty/partial/flat-day computed from actual `/api/dashboard/metrics` + today's call count.
- Delete `components/dashboard/metrics-overview.tsx`, `components/dashboard/sentiment-analysis.tsx`, `components/dashboard/performance-card.tsx`, `components/tables/calls-table.tsx` if no other consumers. (Verify via grep before deletion.)
- E2E: `dashboard.spec.ts` updated — orrery hero renders, lens switcher works, day replay opens.

**Risk H — dynamic planet count.** Prototype hardcodes 12 planets. Real orgs have variable call categories. Mitigation: cap at 12, group overflow into "Other"; if fewer than 6, render larger planets with wider orbit spacing. Validate in `callsToPlanets()` tests with degenerate inputs (0, 1, 3, 12, 30 categories).

### Phase 2 — Drill-in (Planet + Call detail) (1 PR, ~12 files)
- New `client/src/pages/atlas-cluster.tsx` + route `/atlas/cluster/:category`.
- Rewrite `client/src/pages/transcripts.tsx` detail mode using `<CallArc>`.
- Refactor `client/src/components/transcripts/transcript-viewer.tsx` — hooks order before early returns (INV-19), arc moments + transcript line synchronization.
- Adapters: `transcriptToMoments()`, `callToClinicalTimeline()`.
- Overlays: `CoachThisCallPanel`, `TrackPatternPopover` (stub — wired in Phase 3).
- Clinical-mode swap: `<CallArc>` ↔ `<ClinicalCallTimeline>` based on `usePresentation()`.
- E2E: new `atlas-cluster.spec.ts`; existing `transcripts.spec.ts` (if any) updated.

**Risk M — moment detection.** Moments are derived from sentiment segments + analysis flags + speaker turns. The prototype shows 7 named moments; real calls have variable length. Adapter strategy: bucket transcript into 6-10 moments by sentiment shifts + flag boundaries; if call < 60s, collapse to 3 moments; if call > 30min, use rolling-window peaks. Falls back to even time-spacing if no sentiment data.

### Phase 3 — Galaxy + Patterns + Ask Ory (1 PR, ~15 files)
- New `client/src/pages/galaxy.tsx`.
- Rewrite `client/src/pages/insights.tsx` as Patterns view.
- New `<Constellation>` viz; clinical mode `<PatternsNetwork>` / `<SankeyHero>` / `<HeatmapHero>`.
- `patternsToConstellations()` adapter — uses `/api/insights` + `/api/insights/clusters` + `/api/calls` for evidence drilldown.
- Track Pattern popover wired to new `/api/patterns/subscribe` endpoint (small backend task).
- **Ask Ory** — global FAB in `AppShell`. Panel posts to existing `/api/reference-documents/rag/search` (RAG already exists). Streaming responses if `responseStyle` is `concise`.
- Owl persona kit reaches first real usage (Ask Ory panel uses `OwlLayered` in `thinking` and `talking` states).
- E2E: new `galaxy.spec.ts`, new `ask-ory.spec.ts`; existing `insights.spec.ts` updated.

**Risk M — pattern detection quality.** The prototype shows 3 hand-curated patterns. Real `getCallClusters()` returns clusters that may not map cleanly to "patterns". Strategy: in Phase 3, surface clusters as patterns 1:1; in a follow-up, add cross-call pattern detection (e.g., "calls that mention insurance + drop close-rate"). The current `/api/insights/clusters` endpoint is sufficient for Phase 3.

### Phase 4 — Coaching + Clinical workbench (2 PRs, ~25 files)

**PR 4a — Coaching**
- Rewrite `client/src/pages/coaching.tsx`.
- Per-agent `<AgentSystem>` mini-orrery.
- Action plan editor with checklist + reference calls.
- `agentsToCoachingSystems()` adapter against `/api/performance` + `/api/employees`.

**PR 4b — Clinical workbench**
- Rewrite `client/src/pages/clinical-notes.tsx` — completeness orb header, timeline arc, Ory's Note panel, structured SOAP/DAP/BIRP sections.
- Restyle `client/src/pages/clinical-dashboard.tsx` (workbench tier — minimal celestial chrome).
- Restyle `client/src/pages/clinical-live.tsx` — soft "active listening" pulse using `<LoadingPlanet>` aesthetic.
- Restyle `client/src/pages/clinical-templates.tsx`, `clinical-upload.tsx`.
- Clinical presentation mode: when `presentation === 'clinical'`, lexicon swaps via `clinicalLex()` applies to dashboard / patterns / call detail headers.

**Risk H — clinical PHI integrity.** INV-08 (PHI encryption in production) and INV-09 (every decryption logs audit event) must survive. The redesign changes UI but does not change `clinical.ts` route handlers — these continue to call `decryptClinicalNotePhi()` with audit context. Verification: `tests/clinical-routes.test.ts` and `tests/clinical-amendments.test.ts` unchanged, must continue to pass.

### Phase 5 — Sign-in + tail pages + cleanup (1 PR, ~20 files)
- Rewrite `client/src/pages/auth.tsx` with orrery sign-in design + light theme variant + MFA/SSO/OAuth branches.
- Restyle `client/src/pages/landing.tsx` — replace existing wave animation with celestial starfield; keep SMIL animations.
- Final restyle pass on the 12 tail pages (most already token-correct from Phase 0).
- Delete unused: aurora keyframes (already done in Phase 0), Poppins font import (done in Phase 0), any orphaned `components/dashboard/*` after Phase 1 deletions.
- Update Playwright fixtures if any selectors changed.
- Move `design/` contents to `archive/design-v1/` for reference; keep `ORRERY_IMPLEMENTATION_PLAN.md` at root of new location.

### Phase 6 — Hardening (1 PR)
- Accessibility audit pass: ARIA labels on all SVG planets, keyboard navigation for orrery interactions (arrow keys to move between planets, Enter to drill in).
- Performance: lighthouse score on dashboard; defer Day Replay rAF when tab hidden; lazy-load showcase routes.
- Cross-browser: Safari `mask-image` test (owl mark); fallback to inline SVG if `mask-image` unsupported.
- Final visual diff vs prototype: side-by-side screenshots for each redesigned page committed to `design/screenshots/v2/`.

## 6. Risks & mitigations

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| Dynamic planet count breaks fixed orbital layout | 1 | H | Cap at 12 + overflow group; degenerate input tests |
| `transcript-viewer` hooks-order regression (INV-19) | 2 | H | ESLint `react-hooks/rules-of-hooks` enforces; refactor with hooks at top |
| PHI encryption invariants (INV-08, INV-09) | 4b | H | Route handlers untouched; existing `clinical-routes.test.ts` is the gate |
| Moment detection produces noisy moments on real calls | 2 | M | Tunable thresholds; falls back to even time-spacing |
| Recharts dark mode `!important` overrides leak | 0 | M | Test all chart pages in dark mode during Phase 0; recolor `!important` rules |
| `mask-image` not supported on older Safari | 0 | M | Inline SVG fallback in `ObservatoryOwlMark` |
| Mobile bottom sheet drag interactions fragile | 1 | M | Cover with Playwright touch-emulation; consider `vaul` library if hand-rolled is unstable |
| Branding provider color derivation produces ugly ramps for some primaries | 0 | L | Document supported hue ranges; offer a "celestial-locked" mode that ignores org color |
| Babel-in-browser `window.*` globals leak into ported code | 0 | L | ESLint `no-restricted-globals` for `window.Orrery*` |
| Clinical lexicon swap misses some strings | 4b | L | `clinicalLex()` returns the original key if no mapping (lexicon is additive) |
| Owl PNG asset breaks CDN | 0 | L | Embed as base64 fallback if `<img>` fails |

## 7. Testing strategy

**Unit (Node test runner via `tsx`)**
- New: `tests/orrery-adapters.test.ts` — every adapter tested against fixture `Call[]` / `ClinicalNote` / `Insight` shapes from real schemas.
- New: `tests/orrery-projection.test.ts` — `orreryProject()`, `brightToColor()`, lens orbit assignments.
- New: `tests/clinical-lex.test.ts` — `clinicalLex()` returns expected strings + falls back to key.
- Modified: existing tests (1623 total) should mostly pass unchanged; any that reference deleted `metrics-overview.tsx` or aurora tokens get updated.

**E2E (Playwright)**
- New: `tests/e2e/orrery-atlas.spec.ts` — hero renders, lens switcher, day replay overlay.
- New: `tests/e2e/orrery-galaxy.spec.ts`.
- New: `tests/e2e/orrery-patterns.spec.ts`.
- New: `tests/e2e/ask-ory.spec.ts`.
- New: `tests/e2e/orrery-clinical-mode.spec.ts` — verifies lexicon swap on clinical org.
- New: `tests/e2e/mobile-atlas.spec.ts` — touch emulation, bottom sheet snap points.
- Modified: `dashboard.spec.ts`, `auth.spec.ts`, `clinical.spec.ts`, `coaching.spec.ts`, `navigation.spec.ts` — selectors updated.
- `a11y.spec.ts` extended to cover orrery SVG ARIA labels.

**Visual regression**
- Screenshot baselines per redesigned page in `tests/e2e/__screenshots__/orrery/`.
- Compare in CI; fail on >2% pixel diff.

## 8. File deliverables summary

| Path | Phase | Action |
|---|---|---|
| `client/src/index.css` | 0 | Rewrite (tokens, fonts, keyframes) |
| `tailwind.config.ts` | 0 | Extend (colors, fonts, radius, easing) |
| `client/src/components/orrery/` | 0 | New folder, ~30 components |
| `client/public/orrery/owl-mark.png` | 0 | New asset |
| `client/src/components/branding-provider.tsx` | 0 | Rewrite (celestial palette) |
| `client/src/pages/auth.tsx` | 5 | Rewrite |
| `client/src/pages/landing.tsx` | 5 | Restyle |
| `client/src/pages/dashboard.tsx` | 1 | Rewrite |
| `client/src/pages/atlas-cluster.tsx` | 2 | New |
| `client/src/pages/transcripts.tsx` | 2 | Rewrite detail mode |
| `client/src/pages/galaxy.tsx` | 3 | New |
| `client/src/pages/insights.tsx` | 3 | Rewrite |
| `client/src/pages/coaching.tsx` | 4a | Rewrite |
| `client/src/pages/clinical-notes.tsx` | 4b | Rewrite |
| `client/src/pages/clinical-*.tsx` (4 files) | 4b | Restyle |
| `client/src/pages/{upload,search,sentiment,performance,employees,learning,gamification,calibration,simulated-calls,ab-testing,settings,admin,audit-logs,prompt-templates,marketing,revenue,emails,insurance-narratives,billing,spend-tracking,feedback}.tsx` | 0 (tokens) + 5 (polish) | Restyle only |
| `client/src/components/dashboard/{metrics-overview,sentiment-analysis,performance-card}.tsx` | 1 | Delete (if no other consumers) |
| `client/src/components/tables/calls-table.tsx` | 1 | Delete (if no other consumers) |
| `client/src/components/transcripts/transcript-viewer.tsx` | 2 | Refactor for arc + INV-19 |
| `client/src/lib/orrery-adapters.ts` | 1-4 | New, accretes per phase |
| `client/src/lib/orrery-lenses.ts` | 1 | New |
| `shared/schema/org.ts` | 0 | Add `presentation`, `theme` fields |
| `shared/schema/patterns.ts` | 3 | New (pattern subscriptions) |
| `server/db/sync-schema.ts` | 0, 3 | Mirror DDL for new columns/tables |
| `server/routes/patterns.ts` | 3 | New (subscribe/unsubscribe) |
| `tests/orrery-*.test.ts` | per phase | New |
| `tests/e2e/orrery-*.spec.ts` | per phase | New |
| `design/` | 5 | Move to `archive/design-v1/`; keep this plan |

## 9. Open questions

These don't block Phase 0 but should be resolved before their phase:

1. **Phase 2 — Moments grammar.** Should moments be AI-generated (Bedrock prompt for "label the key turning points in this transcript") or rule-based (sentiment shifts + flag boundaries + speaker change)? AI gives richer labels but adds cost + latency.
2. **Phase 3 — Track Pattern persistence.** New `pattern_subscriptions` table or store as JSONB on org settings? Recommend table — supports per-pattern alert config.
3. **Phase 3 — Ask Ory streaming.** Use SSE or chunked HTTP? Existing `/api/reference-documents/rag/search` is request/response — streaming requires a new endpoint variant.
4. **Phase 4 — Clinical lexicon scope.** Does the lexicon swap apply to URLs (e.g. `/dashboard` → `/clinical-dashboard` for clinical orgs) or only to UI strings? Recommend UI-only; URLs stay stable.
5. **Owl PNG vs SVG.** The mark PNG is 21 KB; an inlined SVG (already in `design/uploads/owl-traced.svg` at 1.3 MB!) is too large. Recommend an optimized SVG (~5 KB after SVGO) as the production asset, with the PNG as fallback for older Safari `mask-image` support. Decision needed in Phase 0.
6. **Light-mode sign-in.** The prototype's sign-in screen is dark-only; the right-panel orrery preview "breaks in light theme" per the file comment. Phase 5 must design a light variant.

## 10. Verification checklist (per phase)

For every PR:
- [ ] `npm run check` — TypeScript clean
- [ ] `npm run lint` — zero ESLint warnings
- [ ] `npm run test` — all unit tests pass
- [ ] `npm run test:e2e` — all E2E pass
- [ ] `npm run build` — production bundle builds
- [ ] Visual diff against `design/Orrery Prototype.html` screen for the redesigned page (screenshots in PR description)
- [ ] Dark mode + light mode both verified
- [ ] Observatory + clinical presentation modes verified on affected screens
- [ ] Mobile breakpoint (`<md`) verified for hero pages
- [ ] No new `as any` casts beyond what's in existing files
- [ ] No regressions in `tests/clinical-*.test.ts` (HIPAA invariants)

---

**Status:** Plan ready. Phase 0 can start on user approval.

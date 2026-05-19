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
- Marketing/landing page redesign (the App Map flags it as "separate project").
- Mobile app — only mobile-responsive web (Mobile Atlas pattern).

**Limited backend work (in scope, kept small)**
- Schema additions: `org.settings.presentation`, `org.settings.theme`, new `pattern_subscriptions` table (Phase 0 + Phase 3).
- New API endpoints, all small:
  - `/api/dashboard/galaxy?month=YYYY-MM` — day-bucketed call counts for Galaxy view (Phase 3). Required because client-side bucketing of `/api/calls` is too slow at scale (>5K calls/month).
  - `/api/patterns/subscribe` (POST) + `/api/patterns/unsubscribe` (DELETE) + `/api/patterns/subscriptions` (GET) — Track Pattern popover (Phase 3).
  - Ask Ory uses the existing `/api/reference-documents/rag/search` endpoint (non-streaming for v1; see section 9.3 for streaming decision).

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
- `onboarding.tsx`, `reports.tsx`, `invite-accept.tsx`, `not-found.tsx`

The App Map flags `onboarding.tsx` and `reports.tsx` as **quiet tier** ("celestial preview" / "orrery on report header"). For Phase 0 we ship tokens-only on both; promote either to a quiet-tier redesign in a follow-up if the polished aesthetic justifies the work. `invite-accept.tsx` and `not-found.tsx` are short pages that only need token consistency.

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

`client/src/lib/orrery-adapters.ts` — pure functions, fully typed against `shared/schema/*`, unit-tested. Concrete signatures below; if a referenced field doesn't exist on the existing schema, the adapter must compute it from available fields (the "derived" column says how).

| Adapter | Concrete signature | Reads (real schema fields) | Derived (computed) |
|---|---|---|---|
| `callsToPlanets` | `(calls: Call[], lens: Lens) => Planet[]` | `call.callCategory`, `call.duration`, `call.status`, `call.uploadedAt`, joined `analysis.performanceScore` | `orbit` = lens(callCategory); `angle` = stable hash of category; `size` = log(count per category); `brightness` = avg(performanceScore)/10; cap at 12 categories, group overflow as `Other` planet |
| `dayBucketsToGalaxy` | `(days: GalaxyDayRow[]) => GalaxyDay[]` where `GalaxyDayRow = { date: string; calls: number; closeRate: number }` | New endpoint `/api/dashboard/galaxy?month=YYYY-MM` returns this shape | `weekend` = derived from date; `anchor` = today; `brightness` = closeRate; spiral `(x,y)` computed in adapter |
| `patternsToConstellations` | `(clusters: CallCluster[], calls: Call[]) => Pattern[]` | `/api/insights/clusters` returns clusters; `/api/calls?cluster=:id` returns member calls per cluster | `nodes` = up to 5 most-frequent topics within cluster; `edges` = topic co-occurrence pairs (within calls of cluster); `color` from cluster trend (rising/stable/declining); `stat` = cluster delta vs prior period |
| `agentsToCoachingSystems` | `(employees: Employee[], perf: PerformanceRow[]) => CoachingAgent[]` where `PerformanceRow` = `/api/performance` row shape | `employee.id`, `employee.name`, `employee.role`, `employee.status`; `perf.avgPerformanceScore`, `perf.totalCalls`, `perf.weekDelta` (if present in API; otherwise compute from two `/api/performance?weeks=2` calls) | `brightness` = avgScore/10; `delta` = weekDelta or computed; `ringHot` = flagged calls > 0 (need `/api/calls?employeeId=&flagged=true` count) |
| `transcriptToMoments` | `(transcript: Transcript, sentiment: SentimentAnalysis, analysis: CallAnalysis) => Moment[]` | `transcript.text` + `transcript.words[].speaker`; `sentiment.segments[]` (already exists — `{ start, end, sentiment, score }`); `analysis.flags`, `analysis.topics` | See section 6 below ("Moment detection strategy") — locked decision; rule-based v1 |
| `callToClinicalTimeline` | same inputs | same | Quality curve = rolling average of `sentiment.segments[].score` mapped to 0-100% Y axis; X axis = `transcript.words[0].start..last.end` |
| `clinicalNoteToOrbital` | `(note: ClinicalNote) => { completenessOrb: number; timelineSteps: Step[] }` | `note.documentationCompleteness`, `note.clinicalAccuracy`, `note.providerAttested`, `note.amendments[]`, `note.cosignature` | `timelineSteps` = derived from `[createdAt, transcribedAt (implicit), draftedAt (implicit = createdAt), editHistory, attestedAt, amendments]` |

**Lens definitions** in `lib/orrery-lenses.ts`:
```typescript
type Lens = {
  id: 'type' | 'lifecycle' | 'revenue' | 'recency';
  label: string;
  orbitFor: (category: string, call?: Call) => 0 | 1 | 2 | 3;
  brightnessFor: (calls: Call[]) => number; // 0..1
};
```
Brightness ramp lives in `brightness.ts`.

**Invariant check for adapters:** All input APIs MUST return raw `T[]` arrays per INV-01. Verify in adapter unit tests with a fixture that matches the current `res.json(...)` shape of each endpoint. If any endpoint returns a wrapper object, fix the endpoint, don't wrap the adapter.

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

### Phase 0 — Tokens, primitives, dev showcases (1 PR, ~30 new + ~60 modified)
- Replace all CSS variables in `index.css`. Remove aurora keyframes. Add celestial keyframes.
- Update `tailwind.config.ts`.
- Swap fonts (remove Poppins, add Instrument Serif + JetBrains Mono).
- Add `presentation` and `theme` fields to `org.settings` Zod schema (`shared/schema/org.ts`); mirror DDL in `sync-schema.ts` (INV-10). Default `presentation` derived from `industryType` server-side. Default `theme` is `'auto'`.
- Port all `client/src/components/orrery/` primitives.
- Owl asset: ship as optimized SVG (`client/public/orrery/owl-mark.svg`, ~5 KB after SVGO). Keep PNG copy at `client/public/orrery/owl-mark.png` (21 KB) for the `mask-image` fallback path on older Safari. `ObservatoryOwlMark` tries SVG first, falls back via `@supports not (mask-image: url(...svg))`.
- New routes `/dev/orrery/*` (super-admin only): owl, realism, type-lab, type-lab-b, components.
- Update `branding-provider.tsx` for celestial palette.
- Update existing pages: enough token usage swaps to keep them compiling. **Tokens-only pass on the 16 restyle-only pages happens here**, because aurora violet disappears from the build.
- **Recharts recolor checklist** (replaces existing `!important` overrides in `index.css`):
  - `.dark .recharts-cartesian-axis-tick text` → `fill: var(--ink-soft) !important`
  - `.dark .recharts-cartesian-grid line` → `stroke: var(--panel-stroke) !important`
  - `.dark .recharts-tooltip-wrapper` → `background: var(--panel) !important; border: 1px solid var(--panel-border) !important`
  - `.dark .recharts-default-tooltip` → `background-color: var(--panel) !important; border-color: var(--panel-border) !important`
  - `.dark .recharts-tooltip-label` → `color: var(--ink) !important`
  - `.dark .recharts-tooltip-item` → `color: var(--ink-soft) !important`
  - `.dark .recharts-legend-item-text` → `color: var(--ink-soft) !important`
  - `--chart-1` through `--chart-5` → celestial ramp: `bright`, `warm`, `cool`, `cold`, `accent-amber`. Light + dark variants.
- E2E: existing `a11y.spec.ts` and `dashboard.spec.ts` continue to pass (visual changes only).
- Verification: visual diff vs prototype at `/dev/orrery/components`. Manual check: every Recharts page (`dashboard`, `insights`, `sentiment`, `performance`, `revenue`, `spend-tracking`, `clinical-dashboard`, `calibration`) renders cleanly in both themes.

**Files touched (Phase 0):** ~30 new + ~60 modified. The modified count went up from 50 because the restyle list grew (+4 pages) and the Recharts recolor adds explicit CSS rule edits.

### Phase 1 — Atlas hero (1 PR, ~15 files)
- New `client/src/components/orrery/viz/Orrery.tsx` + lens definitions.
- Rewrite `client/src/pages/dashboard.tsx` as Atlas.
- Build `callsToPlanets()` adapter (galaxy adapter lands in Phase 3 alongside the new endpoint).
- Day Replay overlay (`overlays/DayReplay.tsx`).
- Mobile Atlas bottom sheet — extract into `shell/MobileBottomSheet.tsx`.
- Realism state wiring: empty/partial/flat-day computed from actual `/api/dashboard/metrics` + today's call count.
- Delete `components/dashboard/metrics-overview.tsx`, `components/dashboard/sentiment-analysis.tsx`, `components/dashboard/performance-card.tsx` (grep-verified: these are dashboard-only).
- **Keep `components/tables/calls-table.tsx`** — it's also consumed by `transcripts.tsx` list mode. Deletion moves to Phase 2 after the transcripts list redesign.
- E2E: `dashboard.spec.ts` updated — orrery hero renders, lens switcher works, day replay opens.

**Risk H — dynamic planet count.** Prototype hardcodes 12 planets. Real orgs have variable call categories. Mitigation: cap at 12, group overflow into "Other"; if fewer than 6, render larger planets with wider orbit spacing. Validate in `callsToPlanets()` tests with degenerate inputs (0, 1, 3, 12, 30 categories).

### Phase 2 — Drill-in (Planet + Call detail) (1 PR, ~14 files)
- New `client/src/pages/atlas-cluster.tsx` + route `/atlas/cluster/:category`.
- Rewrite `client/src/pages/transcripts.tsx` **both modes**:
  - **Detail mode** (`/transcripts/:id`) — `<CallArc>` + transcript pane.
  - **List mode** (`/transcripts`) — new `<CallList>` component built on the same orrery-card primitive as planet detail's call list. Drops `calls-table.tsx` consumption.
- Delete `components/tables/calls-table.tsx` and `components/dashboard/calls-table*` (carried over from Phase 1).
- Refactor `client/src/components/transcripts/transcript-viewer.tsx` — **all hooks declared at the top of the component, BEFORE any early-return guards** (INV-19). Add ESLint `react-hooks/rules-of-hooks` to the file's overrides; PR fails if violated. Arc moments and transcript lines share a `selectedMoment` state; click on arc = scroll transcript to moment time; scroll transcript past a moment = highlight arc point.
- Adapters: `transcriptToMoments()`, `callToClinicalTimeline()`.
- Overlays: `CoachThisCallPanel` (functional — posts to `/api/coaching` on submit), `TrackPatternPopover` (stub — wired in Phase 3 when subscription endpoint lands).
- Clinical-mode swap: `<CallArc>` ↔ `<ClinicalCallTimeline>` based on `usePresentation()`.
- E2E: new `atlas-cluster.spec.ts`; update `transcripts.spec.ts` to assert both list-mode (`<CallList>`) and detail-mode (`<CallArc>`) render.

**Moment detection strategy — locked (closes open question 1).** Rule-based v1, with AI-augmented labels in a follow-up phase. Algorithm:
1. Bucket the call into ~8 segments by sentiment shift boundaries from `sentiment.segments[]`. If <8 boundaries, supplement with speaker-turn boundaries (first transition per speaker after a 5-second silence).
2. For each bucket, pick the timestamp where `|sentiment.score - prev.score|` is maximal as the moment anchor.
3. Tone = `warm` if score > 0.6, `cool` if < 0.4, otherwise the analysis flag color (amber for `low_score`, green for `exceptional_call`).
4. Label = nearest topic from `analysis.topics[]` by timestamp proximity; falls back to `"Moment N"` if no topics.
5. Calls <60s: collapse to 3 moments (greeting / middle / close).
6. Calls >30min: cap at 10 moments via importance ranking (largest sentiment swings win).
7. If no sentiment segments at all (legacy calls): even time-spacing, 6 moments, no tone color.

This is testable as a pure function. AI-augmented labels can be added later by piping moment timestamps + transcript spans through Bedrock; no schema change required.

### Phase 3 — Galaxy + Patterns + Ask Ory (1 PR, ~20 files)

**Backend additions** (small, scope-confined):
- `server/routes/galaxy.ts` exposing `GET /api/dashboard/galaxy?month=YYYY-MM`. Returns `{ date: string; calls: number; closeRate: number }[]`. Aggregates from the `calls` table grouped by `date_trunc('day', uploaded_at)`. Filtered by `orgId` via existing `injectOrgContext` middleware. Cached for 5 min via `dashboard-cache.ts`.
- `server/routes/patterns.ts` exposing:
  - `POST /api/patterns/subscribe` — body `{ patternKey, triggerKind, expiresAt }` → creates `pattern_subscriptions` row.
  - `DELETE /api/patterns/subscribe/:id` — deletes row (org-scoped).
  - `GET /api/patterns/subscriptions` — lists subscriptions for current org.
- `shared/schema/patterns.ts` — Zod schemas + types.
- DDL in `sync-schema.ts` for `pattern_subscriptions` table (INV-10): columns `id, org_id, pattern_key, trigger_kind, expires_at, created_by, created_at`. Index on `(org_id, pattern_key)`.

**Frontend**:
- New `client/src/pages/galaxy.tsx` + route `/galaxy`. Uses `dayBucketsToGalaxy()` adapter against the new endpoint.
- Rewrite `client/src/pages/insights.tsx` as Patterns view.
- New `<Constellation>` viz; clinical mode `<PatternsNetwork>` / `<SankeyHero>` / `<HeatmapHero>`.
- `patternsToConstellations()` adapter — uses `/api/insights/clusters` (exists) + `/api/calls?cluster=:id` (exists, filter param) for evidence drilldown.
- `TrackPatternPopover` wired to the new endpoints (was a stub in Phase 2).
- **Ask Ory** — global FAB in `AppShell`. Posts to existing `/api/reference-documents/rag/search` (no new endpoint). **Non-streaming for v1 (closes open question 3).** Concise responses are <2K tokens; P95 latency under 3s is acceptable. Streaming is deferred to Phase 6 hardening — revisit only if user feedback shows the wait is jarring. The owl persona still toggles between `thinking` and `talking` states on request/response boundaries, so the FAB feels responsive even without token-by-token streaming.
- E2E: new `galaxy.spec.ts`, new `patterns.spec.ts`, new `ask-ory.spec.ts`, new `track-pattern.spec.ts`.

**Risk M — pattern detection quality.** The prototype shows 3 hand-curated patterns. Real `getCallClusters()` returns clusters that may not map cleanly to "patterns". Strategy: in Phase 3, surface clusters as patterns 1:1; in a follow-up, add cross-call pattern detection (e.g., "calls that mention insurance + drop close-rate"). The current `/api/insights/clusters` endpoint is sufficient for Phase 3.

**Risk L — galaxy endpoint perf.** Day-grouping over a month returns ≤31 rows. Uses the existing `(org_id, uploaded_at)` index on `calls`. No new index required.

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
| `client/src/index.css` | 0 | Rewrite (tokens, fonts, keyframes, Recharts overrides per checklist in §5 Phase 0) |
| `tailwind.config.ts` | 0 | Extend (colors, fonts, radius, easing) |
| `client/src/components/orrery/` | 0 | New folder, ~30 components |
| `client/public/orrery/owl-mark.svg` | 0 | New asset (primary, ~5 KB after SVGO) |
| `client/public/orrery/owl-mark.png` | 0 | New asset (PNG fallback for older Safari `mask-image`) |
| `client/src/components/branding-provider.tsx` | 0 | Rewrite (celestial palette) |
| `client/src/pages/auth.tsx` | 5 | Rewrite (includes new light-theme sign-in variant — see §9.5) |
| `client/src/pages/landing.tsx` | 5 | Restyle |
| `client/src/pages/dashboard.tsx` | 1 | Rewrite |
| `client/src/pages/atlas-cluster.tsx` | 2 | New |
| `client/src/pages/transcripts.tsx` | 2 | Rewrite both list mode (`<CallList>`) and detail mode (`<CallArc>`) |
| `client/src/pages/galaxy.tsx` | 3 | New |
| `client/src/pages/insights.tsx` | 3 | Rewrite |
| `client/src/pages/coaching.tsx` | 4a | Rewrite |
| `client/src/pages/clinical-notes.tsx` | 4b | Rewrite |
| `client/src/pages/clinical-dashboard.tsx` | 4b | Restyle (workbench tier — tokens only; UX redesign deferred until App Map promotes from "Not yet" to "Designed") |
| `client/src/pages/{clinical-live,clinical-templates,clinical-upload}.tsx` | 4b | Restyle |
| `client/src/pages/{upload,search,sentiment,performance,employees,learning,gamification,calibration,simulated-calls,ab-testing,settings,admin,audit-logs,prompt-templates,marketing,revenue,emails,insurance-narratives,billing,spend-tracking,feedback,onboarding,reports,invite-accept,not-found}.tsx` | 0 (tokens) + 5 (polish pass) | Restyle only |
| `client/src/components/dashboard/{metrics-overview,sentiment-analysis,performance-card}.tsx` | 1 | Delete (grep-verified dashboard-only) |
| `client/src/components/tables/calls-table.tsx` | 2 | Delete after transcripts list mode rewrite (also consumed by transcripts.tsx — F-02 fix) |
| `client/src/components/transcripts/transcript-viewer.tsx` | 2 | Refactor for arc + INV-19 (hooks before early returns; ESLint `react-hooks/rules-of-hooks` enforced) |
| `client/src/lib/orrery-adapters.ts` | 1-4 | New, accretes per phase |
| `client/src/lib/orrery-lenses.ts` | 1 | New |
| `shared/schema/org.ts` | 0 | Add `presentation`, `theme` fields to `orgSettingsSchema` |
| `shared/schema/patterns.ts` | 3 | New (pattern subscriptions) |
| `server/db/sync-schema.ts` | 0, 3 | Mirror DDL for new columns/tables (INV-10) |
| `server/db/schema.ts` | 0, 3 | Drizzle table additions for `pattern_subscriptions`; `org.settings` JSONB shape doesn't need migration |
| `server/routes/galaxy.ts` | 3 | New (`GET /api/dashboard/galaxy?month=YYYY-MM`) |
| `server/routes/patterns.ts` | 3 | New (subscribe/unsubscribe/list) |
| `server/routes/index.ts` | 3 | Register new galaxy + patterns routes |
| `tests/orrery-*.test.ts` | per phase | New |
| `tests/e2e/orrery-*.spec.ts` | per phase | New |
| `design/` | 5 | Move to `archive/design-v1/`; keep this plan |

## 9. Decisions & remaining open questions

### Locked decisions (from audit review)

1. **Moments grammar (was Phase 2 open).** ✅ Rule-based v1 per the algorithm in Phase 2. AI-augmented labels deferred to a follow-up; no schema change required when added later.
2. **Track Pattern persistence (was Phase 3 open).** ✅ Dedicated `pattern_subscriptions` table. JSONB on org settings was rejected because it would require array-update gymnastics in the storage layer and break under concurrent writes.
3. **Ask Ory streaming (was Phase 3 open).** ✅ Non-streaming for v1. Concise responses are <2K tokens (P95 latency under 3s); owl persona state-toggling provides perceived responsiveness. Streaming reconsidered in Phase 6 only if user feedback warrants it.
4. **Owl PNG vs SVG (was Phase 0 open).** ✅ Optimized SVG primary (~5 KB after SVGO), PNG fallback (~21 KB) for older Safari `mask-image` support. Both shipped in `client/public/orrery/`.
5. **Galaxy data flow (was implicit).** ✅ New endpoint `/api/dashboard/galaxy?month=YYYY-MM` rather than client-side bucketing. Relaxes the section-1 non-goal but keeps the change small (one route file, one query, no schema migration).

### Remaining open questions

6. **Phase 4 — Clinical lexicon URL scope.** Does the lexicon swap apply to URLs (e.g. `/dashboard` → `/clinical-dashboard` for clinical orgs) or only to UI strings? **Tentative answer:** UI-only; URLs stay stable. Confirm during Phase 4 design review.
7. **Phase 5 — Light-mode sign-in design.** The prototype's sign-in screen is dark-only; the right-panel orrery preview "breaks in light theme" per the file comment. A light-theme design must be sketched before Phase 5 implementation. **Action:** prepare design artifact during Phase 3 or Phase 4 (any spare cycle), so Phase 5 isn't blocked.
8. **`clinical-dashboard.tsx` redesign scope.** The plan currently treats it as restyle-only because the App Map shows status "Not yet" (no design). If a dedicated design lands during the rollout window, upgrade to a Phase 4b redesign.

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

## 11. Revision history

**Rev 2 (audit response).** Applied 5 substantive findings from plan audit:
- F-02: `calls-table.tsx` deletion deferred to Phase 2 (transcripts.tsx list mode also consumes it; Phase 1 was going to delete prematurely).
- F-04: Ask Ory streaming decision locked — non-streaming for v1.
- F-07: Galaxy gets a small new endpoint (`/api/dashboard/galaxy`) rather than client-side bucketing.
- F-10: Explicit Recharts `!important` recolor checklist added to Phase 0.
- F-11: Added `onboarding.tsx`, `reports.tsx`, `invite-accept.tsx`, `not-found.tsx` to restyle-only list.

Plus tightening:
- F-05, F-06, F-13: Adapter signatures now specify concrete schema fields the adapters read, derived computations, and lens type.
- F-09: Phase 2 explicitly enforces `react-hooks/rules-of-hooks` on `transcript-viewer.tsx`.
- F-12: `clinical-dashboard.tsx` scope clarified as restyle-only with upgrade path.
- §1 non-goals relaxed: limited backend work is in scope (2 new endpoints + 1 new table + 2 org.settings fields).
- §9 reorganized into "Locked decisions" + "Remaining open questions" for clarity.

**Status:** Plan ready (Rev 2). Phase 0 can start on user approval.

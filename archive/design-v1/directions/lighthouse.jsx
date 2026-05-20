/* global React */
/* eslint-disable */
// =============================================================================
//  03 · LIGHTHOUSE  — wild challenger-brand magazine layout
//  Type: Bricolage Grotesque (display) + IBM Plex Sans (text) + IBM Plex Mono
//  Color: warm off-black #18130b, paper #f1ead8, signal-amber #f0a830,
//         deep teal #0a4a4a, signal-red #e0432a
// =============================================================================

const liTheme = {
  ink: '#18130b',
  ink2: '#3a3424',
  ink3: '#7a715b',
  paper: '#f1ead8',
  paperHi: '#f7f1e0',
  panel: '#ffffff',
  line: '#1a14070f',
  lineHard: '#18130b',
  amber: '#f0a830',
  amberDeep: '#c97f0e',
  teal: '#0a4a4a',
  tealHi: '#0e7575',
  red: '#e0432a',
  display: "'Bricolage Grotesque', 'Instrument Serif', serif",
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

function LiOwl({ size = 26, color = liTheme.ink }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* solid black head */}
      <path d="M16 3 C7 3 3 9 3 16 C3 23 8 29 16 29 C24 29 29 23 29 16 C29 9 25 3 16 3 Z" fill={color} />
      {/* amber eyes */}
      <circle cx="11" cy="14" r="3.5" fill={liTheme.amber} />
      <circle cx="21" cy="14" r="3.5" fill={liTheme.amber} />
      <circle cx="11" cy="14" r="1.4" fill={color} />
      <circle cx="21" cy="14" r="1.4" fill={color} />
      <path d="M14 18 L16 21 L18 18 Z" fill={liTheme.amber} />
    </svg>
  );
}

// Print-rule masthead-style top bar
function LiMasthead({ active = 'dashboard' }) {
  const items = ['Dashboard', 'Calls', 'Clinical', 'Coaching', 'Reports', 'Team'];
  return (
    <div style={{ borderBottom: `1.5px solid ${liTheme.lineHard}`, background: liTheme.paper }}>
      <div style={{ padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 18, borderBottom: `1px solid ${liTheme.line}` }}>
        <LiOwl />
        <span style={{ fontFamily: liTheme.display, fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', color: liTheme.ink }}>
          OBSERVATORY
        </span>
        <span style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink3, letterSpacing: '0.16em', textTransform: 'uppercase', borderLeft: `1px solid ${liTheme.ink3}`, paddingLeft: 10, marginLeft: 4 }}>
          Vol. CXVII — Tue Apr 26 2026 — Westside Dental Group — Edition Pacific
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink2, letterSpacing: '0.12em', textTransform: 'uppercase' }}>⌘K · search</span>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: liTheme.ink, color: liTheme.amber, fontFamily: liTheme.display, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>R</div>
        </div>
      </div>
      <nav style={{ padding: '0 32px', display: 'flex', gap: 0 }}>
        {items.map((label) => {
          const a = label.toLowerCase() === active;
          return (
            <div key={label} style={{ padding: '12px 18px 12px 0', marginRight: 18, fontFamily: liTheme.display, fontSize: 14, fontWeight: a ? 700 : 500, color: a ? liTheme.ink : liTheme.ink2, borderBottom: a ? `3px solid ${liTheme.amber}` : '3px solid transparent', marginBottom: -1.5, letterSpacing: '-0.01em' }}>
              {label}{a && <span style={{ fontFamily: liTheme.mono, fontSize: 10, marginLeft: 6, color: liTheme.amberDeep }}>●</span>}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

// Dramatic bar chart with thick rules
function LiBars({ height = 200, data = [4, 7, 5, 9, 6, 8, 7, 9, 6, 8, 9, 7, 6, 8] }) {
  const max = Math.max(...data);
  return (
    <div style={{ height, display: 'flex', alignItems: 'flex-end', gap: 6, padding: '0 4px', borderBottom: `1.5px solid ${liTheme.lineHard}` }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, height: `${(d / max) * 100}%`, background: i === data.length - 1 ? liTheme.amber : i % 4 === 0 ? liTheme.teal : liTheme.ink, position: 'relative' }}>
          {i === data.length - 1 && (
            <div style={{ position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)', fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink, fontWeight: 600 }}>NOW</div>
          )}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
//  ARTBOARD 1 · App shell — bold front-page energy
// =============================================================================
function LighthouseShell() {
  return (
    <div style={{ width: '100%', height: '100%', background: liTheme.paper, fontFamily: liTheme.sans, color: liTheme.ink, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <LiMasthead active="dashboard" />
      <div style={{ flex: 1, padding: '32px 40px', display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 40 }}>
        <div>
          <div style={{ fontFamily: liTheme.mono, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: liTheme.amberDeep, marginBottom: 18, display: 'flex', gap: 14 }}>
            <span>Lead Story</span>
            <span style={{ color: liTheme.ink3 }}>—</span>
            <span style={{ color: liTheme.ink2 }}>This week's call quality, top to bottom</span>
          </div>
          <div style={{ fontFamily: liTheme.display, fontSize: 128, fontWeight: 800, lineHeight: 0.88, letterSpacing: '-0.045em', color: liTheme.ink, marginBottom: 16 }}>
            Forty-two<br />
            <span style={{ color: liTheme.amber }}>conversations</span><br />
            <span style={{ fontStyle: 'italic', fontWeight: 500 }}>worth a look.</span>
          </div>
          <div style={{ fontFamily: liTheme.sans, fontSize: 17, lineHeight: 1.5, color: liTheme.ink2, maxWidth: 540, columnCount: 2, columnGap: 28, marginTop: 18 }}>
            Average score is up <strong style={{ color: liTheme.ink }}>0.31</strong> over the past week, paced by a sharp rise in treatment-plan acceptance. Four calls flagged for coaching review — three involve insurance objections, one a billing escalation.
          </div>
        </div>

        <div style={{ borderLeft: `1.5px solid ${liTheme.lineHard}`, paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink3, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Above the fold</div>
            <div style={{ fontFamily: liTheme.display, fontSize: 22, fontWeight: 600, marginTop: 4, lineHeight: 1.15, color: liTheme.ink }}>
              Maya P. lands a 9.1 on a recall — script adherence at <span style={{ color: liTheme.teal }}>98%</span>.
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${liTheme.line}`, paddingTop: 14 }}>
            <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink3, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Watch</div>
            <div style={{ fontFamily: liTheme.display, fontSize: 18, fontWeight: 600, marginTop: 4, lineHeight: 1.2 }}>
              Insurance-objection cluster grows for the third week running.
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${liTheme.line}`, paddingTop: 14, background: liTheme.ink, color: liTheme.paper, padding: 18, marginLeft: -18, marginRight: -2 }}>
            <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.amber, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Editor's pick</div>
            <div style={{ fontFamily: liTheme.display, fontSize: 22, fontWeight: 600, marginTop: 6, lineHeight: 1.2 }}>
              "I can talk to your office tomorrow." — three words that keep saving the schedule.
            </div>
            <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.amber, marginTop: 10 }}>read the breakdown →</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
//  ARTBOARD 2 · Dashboard — the front page of the day's calls
// =============================================================================
function LighthouseDashboard() {
  const calls = [
    { time: '14:02', name: 'Maya P.', topic: 'Treatment plan', score: 9.1, sent: 'pos', dur: '12:04', headline: '"Yes, let\'s schedule the crown today."' },
    { time: '13:48', name: 'Devon W.', topic: 'New patient', score: 8.4, sent: 'pos', dur: '08:21', headline: 'Booked for Friday, Delta Dental verified.' },
    { time: '13:12', name: 'Sara L.', topic: 'Insurance', score: 5.2, sent: 'neg', dur: '14:57', headline: 'Coverage dispute — flagged for follow-up.' },
    { time: '12:55', name: 'Maya P.', topic: 'Recall', score: 7.8, sent: 'pos', dur: '04:11', headline: 'Six-month cleaning rebooked.' },
  ];
  return (
    <div style={{ width: '100%', height: '100%', background: liTheme.paper, fontFamily: liTheme.sans, color: liTheme.ink, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <LiMasthead active="dashboard" />

      {/* Front-page hero */}
      <div style={{ padding: '36px 40px 24px', borderBottom: `2px solid ${liTheme.lineHard}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
          <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.amberDeep, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            ●&nbsp;&nbsp;The Daily Call · April 26, 2026 · 1,284 calls observed
          </div>
          <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.ink3 }}>updated 14:42 PT</div>
        </div>
        <div style={{ fontFamily: liTheme.display, fontSize: 96, fontWeight: 800, lineHeight: 0.9, letterSpacing: '-0.045em', color: liTheme.ink }}>
          A <span style={{ color: liTheme.teal }}>7.84</span> kind of week —<br />
          and rising.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 32, marginTop: 28, paddingTop: 20, borderTop: `1px solid ${liTheme.line}` }}>
          <div style={{ fontSize: 16, lineHeight: 1.55, color: liTheme.ink2, fontFamily: liTheme.sans }}>
            Mean score across all monitored agents climbed for the fifth straight day. Driving the move: stronger treatment-plan presentations and a notable drop in transfer escalations. Maya P. and Devon W. both broke 8.5 — Sara L. had one rough call worth reviewing.
          </div>
          {[['+18%', 'volume'], ['+0.31', 'mean score'], ['68%', 'sentiment+']].map(([v, k]) => (
            <div key={k} style={{ borderLeft: `1.5px solid ${liTheme.lineHard}`, paddingLeft: 14 }}>
              <div style={{ fontFamily: liTheme.display, fontSize: 44, fontWeight: 700, lineHeight: 1, color: liTheme.ink }}>{v}</div>
              <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.ink3, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: 6 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* The day's chart */}
      <div style={{ padding: '32px 40px', borderBottom: `1px solid ${liTheme.lineHard}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <div style={{ fontFamily: liTheme.display, fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Volume, hour by hour.
          </div>
          <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.ink3, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            <span style={{ color: liTheme.teal }}>━━</span>&nbsp; reference&nbsp;&nbsp;&nbsp;<span style={{ color: liTheme.ink }}>━━</span>&nbsp; today&nbsp;&nbsp;&nbsp;<span style={{ color: liTheme.amber }}>━━</span>&nbsp; live
          </div>
        </div>
        <LiBars height={220} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink3, marginTop: 8, letterSpacing: '0.06em' }}>
          {['8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', 'now'].map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>

      {/* Calls table — newspaper grid */}
      <div style={{ padding: '32px 40px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 40, borderBottom: `1px solid ${liTheme.lineHard}` }}>
        <div>
          <div style={{ fontFamily: liTheme.display, fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 14, paddingBottom: 12, borderBottom: `1.5px solid ${liTheme.lineHard}` }}>
            Today's headlines.
          </div>
          {calls.map((c, i) => (
            <article key={i} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 80px', gap: 16, padding: '20px 0', borderBottom: i === calls.length - 1 ? 'none' : `1px solid ${liTheme.line}` }}>
              <div>
                <div style={{ fontFamily: liTheme.display, fontSize: 36, fontWeight: 700, lineHeight: 1, color: c.score < 6 ? liTheme.red : liTheme.ink }}>{c.score.toFixed(1)}</div>
                <div style={{ fontFamily: liTheme.mono, fontSize: 9, color: liTheme.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 4 }}>{c.sent === 'pos' ? '↑ pos' : c.sent === 'neg' ? '↓ neg' : '○ neu'}</div>
              </div>
              <div>
                <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.amberDeep, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 4 }}>
                  {c.time} — {c.name} — {c.topic}
                </div>
                <div style={{ fontFamily: liTheme.display, fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: liTheme.ink, letterSpacing: '-0.015em' }}>
                  {c.headline}
                </div>
              </div>
              <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.ink3, textAlign: 'right' }}>{c.dur}</div>
            </article>
          ))}
        </div>

        <aside style={{ borderLeft: `1.5px solid ${liTheme.lineHard}`, paddingLeft: 28 }}>
          <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.amberDeep, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>Op-Ed · Pattern of the week</div>
          <div style={{ fontFamily: liTheme.display, fontSize: 28, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            The reluctant <span style={{ fontStyle: 'italic', color: liTheme.teal }}>insurance call</span>.
          </div>
          <div style={{ fontFamily: liTheme.sans, fontSize: 14, lineHeight: 1.55, color: liTheme.ink2, marginTop: 12 }}>
            Fourteen calls cluster around a single pattern: patients pushing back the moment coverage is mentioned. Mean score 5.4. Three of them ended without a booking.
          </div>
          <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.amberDeep, marginTop: 14, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            → open cluster
          </div>

          <div style={{ marginTop: 28, paddingTop: 20, borderTop: `1px solid ${liTheme.lineHard}` }}>
            <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink3, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 }}>Standings</div>
            {[['Maya P.', 9.1, 1], ['Devon W.', 8.7, 2], ['Jordan T.', 8.2, 3], ['Sara L.', 6.4, 4]].map(([n, s, r]) => (
              <div key={n} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 60px', alignItems: 'baseline', padding: '8px 0', borderTop: r === 1 ? 'none' : `1px solid ${liTheme.line}` }}>
                <span style={{ fontFamily: liTheme.display, fontSize: 16, fontWeight: 700, color: liTheme.ink3 }}>{r}.</span>
                <span style={{ fontSize: 14 }}>{n}</span>
                <span style={{ fontFamily: liTheme.display, fontSize: 22, fontWeight: 700, color: s < 7 ? liTheme.red : liTheme.ink, textAlign: 'right' }}>{s.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
//  ARTBOARD 3 · Clinical scribe — magazine layout meets clinical workflow
// =============================================================================
function LighthouseClinical() {
  return (
    <div style={{ width: '100%', height: '100%', background: liTheme.paper, fontFamily: liTheme.sans, color: liTheme.ink, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <LiMasthead active="clinical" />

      {/* Encounter banner */}
      <div style={{ padding: '32px 40px', borderBottom: `2px solid ${liTheme.lineHard}`, background: liTheme.ink, color: liTheme.paper, position: 'relative' }}>
        <div style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.amber, letterSpacing: '0.2em', textTransform: 'uppercase', display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ width: 8, height: 8, background: liTheme.red, borderRadius: '50%', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
          Live encounter · #4821 · operative · Apr 26, 14:02
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 40 }}>
          <div>
            <div style={{ fontFamily: liTheme.display, fontSize: 76, fontWeight: 800, lineHeight: 0.9, letterSpacing: '-0.04em' }}>
              Margaret Holloway
            </div>
            <div style={{ fontFamily: liTheme.display, fontSize: 24, fontWeight: 400, fontStyle: 'italic', color: liTheme.amber, marginTop: 8 }}>
              62F · Dr Reyes · pulpitis, lower right molar
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ padding: '12px 18px', background: 'transparent', color: liTheme.paper, border: `1.5px solid ${liTheme.paper}`, fontSize: 13, fontFamily: liTheme.display, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer' }}>EDIT</button>
            <button style={{ padding: '12px 22px', background: liTheme.amber, color: liTheme.ink, border: 'none', fontSize: 13, fontFamily: liTheme.display, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer' }}>✓ ATTEST & SIGN</button>
          </div>
        </div>
      </div>

      {/* Live waveform */}
      <div style={{ padding: '14px 40px', background: liTheme.paperHi, borderBottom: `1px solid ${liTheme.lineHard}`, display: 'flex', alignItems: 'center', gap: 18 }}>
        <span style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.red, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700 }}>● REC 03:24</span>
        <div style={{ flex: 1, height: 28, position: 'relative' }}>
          <svg viewBox="0 0 400 28" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            {Array.from({ length: 160 }).map((_, i) => {
              const h = 4 + ((i * 17) % 22);
              return <rect key={i} x={i * 2.5} y={(28 - h) / 2} width="1.6" height={h} fill={i < 70 ? liTheme.ink : liTheme.ink3} />;
            })}
          </svg>
        </div>
        <span style={{ fontFamily: liTheme.mono, fontSize: 11, color: liTheme.ink3, letterSpacing: '0.12em', textTransform: 'uppercase' }}>en-US · 96% confidence · 2 speakers</span>
      </div>

      {/* Two-column magazine spread */}
      <div style={{ padding: '32px 40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36 }}>
        {/* Transcript column */}
        <div style={{ borderRight: `1px solid ${liTheme.lineHard}`, paddingRight: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1.5px solid ${liTheme.lineHard}`, paddingBottom: 10, marginBottom: 20 }}>
            <span style={{ fontFamily: liTheme.display, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>The conversation</span>
            <span style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.ink3, letterSpacing: '0.12em', textTransform: 'uppercase' }}>verbatim · 12:04</span>
          </div>

          <div style={{ fontFamily: liTheme.display, fontSize: 32, fontStyle: 'italic', fontWeight: 500, lineHeight: 1.15, letterSpacing: '-0.02em', color: liTheme.teal, marginBottom: 24, paddingLeft: 14, borderLeft: `4px solid ${liTheme.amber}` }}>
            "It started cold-sensitive — but now it just throbs."
          </div>

          {[
            ['DR. REYES', 'How long has the pain been waking you up at night?'],
            ['HOLLOWAY', 'About a week. It started just being cold-sensitive but now it just throbs.', true],
            ['DR. REYES', 'Any swelling, anything that feels hot to the touch?'],
            ['HOLLOWAY', 'No swelling. No fever. Just the tooth itself.'],
            ['DR. REYES', "Looking at the X-ray, the decay has reached the nerve. We're going to need to do a pulpotomy today and schedule the root canal.", true],
            ['HOLLOWAY', 'Whatever you think is best.'],
          ].map(([sp, t, hl], i) => (
            <div key={i} style={{ marginBottom: 18, fontSize: 14.5, lineHeight: 1.6, color: liTheme.ink2 }}>
              <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: sp === 'DR. REYES' ? liTheme.teal : liTheme.amberDeep, fontWeight: 700, letterSpacing: '0.16em', marginBottom: 4 }}>{sp}</div>
              <div style={{ background: hl ? 'rgba(240,168,48,0.15)' : 'transparent', padding: hl ? '6px 10px' : 0, borderLeft: hl ? `2px solid ${liTheme.amber}` : 'none', color: hl ? liTheme.ink : liTheme.ink2 }}>{t}</div>
            </div>
          ))}
        </div>

        {/* SOAP column */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1.5px solid ${liTheme.lineHard}`, paddingBottom: 10, marginBottom: 20 }}>
            <span style={{ fontFamily: liTheme.display, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>The chart, drafted.</span>
            <span style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.amberDeep, letterSpacing: '0.12em', textTransform: 'uppercase' }}>● auto v0.4</span>
          </div>

          <div style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.amberDeep, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>Chief complaint</div>
            <div style={{ fontFamily: liTheme.display, fontSize: 26, fontStyle: 'italic', fontWeight: 500, lineHeight: 1.25, letterSpacing: '-0.015em' }}>
              "Persistent ache, lower right molar, worse with cold for two weeks."
            </div>
          </div>

          {[
            ['Subjective', 'Gradual onset cold sensitivity #31, now spontaneous, waking patient at night. No prior trauma. OTC ibuprofen partially effective.'],
            ['Objective', 'Tooth #31 — deep distal caries to pulp on radiograph. Percussion tender. Cold test prolonged. Probing depths WNL. Adjacent teeth normal.'],
            ['Assessment', 'Symptomatic irreversible pulpitis #31, secondary to deep distal carious lesion. Tooth restorable.'],
          ].map(([k, v]) => (
            <div key={k} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: `1px solid ${liTheme.line}` }}>
              <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.amberDeep, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>{k}</div>
              <div style={{ fontSize: 14.5, color: liTheme.ink2, lineHeight: 1.6 }}>{v}</div>
            </div>
          ))}

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: liTheme.mono, fontSize: 10, color: liTheme.amberDeep, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>Plan</div>
            <ol style={{ paddingLeft: 22, margin: 0, fontSize: 14.5, color: liTheme.ink2, lineHeight: 1.7 }}>
              <li><strong style={{ color: liTheme.ink, fontFamily: liTheme.display, fontWeight: 600 }}>Pulpotomy #31</strong> today, RCT within 1 week.</li>
              <li>Rx <strong style={{ color: liTheme.ink, fontFamily: liTheme.display, fontWeight: 600 }}>amoxicillin 500 mg TID × 7d</strong>.</li>
              <li>Crown buildup post-RCT.</li>
              <li>Hygiene recall 6 months.</li>
            </ol>
          </div>

          {/* Codes */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 14, borderTop: `1.5px solid ${liTheme.lineHard}` }}>
            {[['K04.01', 'ICD-10'], ['D3220', 'CDT'], ['D2950', 'CDT']].map(([c, t]) => (
              <span key={c} style={{ fontFamily: liTheme.mono, fontSize: 11, padding: '6px 10px', background: liTheme.ink, color: liTheme.amber, fontWeight: 600, letterSpacing: '0.04em' }}>{t} · {c}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.LighthouseShell = LighthouseShell;
window.LighthouseDashboard = LighthouseDashboard;
window.LighthouseClinical = LighthouseClinical;

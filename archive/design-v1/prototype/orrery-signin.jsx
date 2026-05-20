/* global React */
/* eslint-disable */
const { useState: useStateSignIn } = React;

function OrrerySignIn({ theme: themeProp = 'dark', onSignIn = null, onThemeChange = null }) {
  const [themeState, setThemeState] = useStateSignIn(themeProp);
  const theme = onThemeChange ? themeProp : themeState;
  const setTheme = (next) => { if (onThemeChange) onThemeChange(next); else setThemeState(next); };
  const t = theme === 'light' ? window.ORRERY_LIGHT : window.ORRERY_DARK;
  const [email, setEmail] = useStateSignIn('');
  const [password, setPassword] = useStateSignIn('');
  const [submitting, setSubmitting] = useStateSignIn(false);

  const submit = (e) => {
    e && e.preventDefault();
    setSubmitting(true);
    setTimeout(() => { onSignIn && onSignIn(); }, 600);
  };

  // little orrery for the right panel
  const orbits = [10, 18, 26];
  const planets = [
    { o: 0, a: 0.3, sz: 1.6, br: 0.85 },
    { o: 0, a: 2.6, sz: 1.2, br: 0.6 },
    { o: 1, a: 1.1, sz: 2.2, br: 0.92 },
    { o: 1, a: 4.1, sz: 1.4, br: 0.45 },
    { o: 2, a: 0.7, sz: 1.8, br: 0.7 },
    { o: 2, a: 4.0, sz: 1.1, br: 0.4 },
  ];
  const proj = planets.map((p) => {
    const r = orbits[p.o];
    const x = Math.cos(p.a) * r;
    const y = Math.sin(p.a) * r;
    const [px, py] = window.orreryProject(x, y);
    return { ...p, px, py };
  });

  return (
    <div style={{
      width: '100%', minHeight: '100vh', position: 'relative', overflow: 'hidden',
      background: t.bg, color: t.ink, fontFamily: "'Inter', sans-serif",
      display: 'grid', gridTemplateColumns: '1fr 1.05fr',
    }}>
      {/* Left — form */}
      <div style={{ padding: '56px 64px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', zIndex: 2, minHeight: '100vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <window.OrreryOwl size={32} t={t} tint={t.logoTint} />
          {window.ObservatoryWordmark
            ? <window.ObservatoryWordmark height={20} color={t.logoTint || t.ink} style={{ marginTop: 1 }} />
            : <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 24, color: t.logoTint || t.ink }}>Observatory</span>}
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.inkMute, letterSpacing: '0.18em', marginLeft: 8 }}>v2 · MODEL OF THE PRACTICE</span>
        </div>

        <div style={{ maxWidth: 420 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.bright, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 18 }}>◇ Sign in</div>
          <h1 style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 56, fontWeight: 400, letterSpacing: '-0.025em', margin: 0, lineHeight: 1.0, color: t.ink }}>
            A model of the<br/>
            <span style={{ fontStyle: 'italic', color: t.bright, fontWeight: 600 }}>practice in orbit.</span>
          </h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.65, color: t.inkSoft, marginTop: 22, maxWidth: 380 }}>
            Each call cluster becomes a planet around your practice's central star — sized by volume, brightened by close rate.
          </p>

          <form onSubmit={submit} style={{ marginTop: 36, display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase' }}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dr.lockwood@windsorperio.com"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `0.5px solid ${t.panelBorder}`,
                  padding: '10px 0',
                  fontSize: 15,
                  color: t.ink,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.16em', color: t.inkMute, textTransform: 'uppercase' }}>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••••••"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `0.5px solid ${t.panelBorder}`,
                  padding: '10px 0',
                  fontSize: 15,
                  color: t.ink,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 10,
                padding: '14px 18px',
                borderRadius: 8,
                border: 'none',
                background: submitting ? t.inkSoft : t.ink,
                color: t.bgFlat,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: submitting ? 'wait' : 'pointer',
                transition: 'all 200ms',
                letterSpacing: '0.02em',
              }}
            >{submitting ? 'Aligning the observatory…' : 'Enter the observatory →'}</button>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.inkMute, marginTop: 4 }}>
              <span style={{ cursor: 'pointer' }}>Forgot password</span>
              <span style={{ cursor: 'pointer' }}>SSO with Google</span>
            </div>
          </form>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: t.inkMute }}>
          <span>© Orrery 2026 · For dental practices</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em' }}>SOC2 · HIPAA</span>
        </div>
      </div>

      {/* Right — orrery preview */}
      <div style={{ position: 'relative', borderLeft: `0.5px solid ${t.panelBorder}`, minHeight: '100vh' }}>
        <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)', width: 600, height: 320, borderRadius: '50%', background: t.haloBg, filter: 'blur(140px)' }} />
        <svg viewBox="-44 -28 88 56" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
          <window.OrreryStarfield t={t} count={70} />
          <defs>
            <radialGradient id="signin-star" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor={t.starCore} stopOpacity="1" />
              <stop offset="35%" stopColor={t.starGlow1} stopOpacity="0.85" />
              <stop offset="100%" stopColor={t.starOuter} stopOpacity="0" />
            </radialGradient>
          </defs>
          {orbits.map((r, i) => (
            <g key={i}>
              <ellipse cx="0" cy="0" rx={r} ry={r * window.TILT}
                fill="none" stroke={t.orbit} strokeWidth="0.12" strokeDasharray="0.4 0.4">
                <animateTransform attributeName="transform" type="rotate" from="0" to={i % 2 === 0 ? 360 : -360} dur={`${60 + i * 40}s`} repeatCount="indefinite" />
              </ellipse>
            </g>
          ))}
          <g>
            <circle cx="0" cy="0" r="7" fill="url(#signin-star)">
              <animate attributeName="r" values="6.6;7.4;6.6" dur="4s" repeatCount="indefinite" />
            </circle>
            <circle cx="0" cy="0" r="1.5" fill={t.starCore} />
          </g>
          {proj.map((p, i) => {
            const c = window.brightToColor(p.br, t);
            return (
              <g key={i}>
                <ellipse cx={p.px} cy={p.py + p.sz * 0.5} rx={p.sz * 0.8} ry={p.sz * 0.22}
                  fill="#000" opacity="0.35" />
                <circle cx={p.px} cy={p.py} r={p.sz} fill={c} opacity="0.95">
                  <animate attributeName="opacity" values="0.85;1;0.85" dur={`${3 + i * 0.4}s`} repeatCount="indefinite" />
                </circle>
                <ellipse cx={p.px - p.sz * 0.3} cy={p.py - p.sz * 0.3}
                  rx={p.sz * 0.4} ry={p.sz * 0.3} fill="#fff" opacity="0.45" />
              </g>
            );
          })}
        </svg>
        <div style={{ position: 'absolute', bottom: 32, left: 0, right: 0, textAlign: 'center', zIndex: 2 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.bright, letterSpacing: '0.18em', textTransform: 'uppercase' }}>◇ Live · 47 calls today</div>
          <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontStyle: 'italic', fontSize: 18, color: t.inkSoft, marginTop: 8 }}>Brightness 0.71 · Close rate 24%</div>
        </div>
      </div>
    </div>
  );
}

window.OrrerySignIn = OrrerySignIn;

/* global React */
/* eslint-disable */
// =============================================================================
//  Observatory Brand — owl mark (line) + wordmark, themed via currentColor.
//  Two owls live here:
//    <ObservatoryOwlMark>   The MASTER BRAND owl — minimal linework, watchful,
//                           stars in the forehead crown. Used in top-bar lockup,
//                           sign-in hero, marketing.
//    <ObservatoryFilledOwl> The PERSONA owl — full filled silhouette (legacy
//                           brand owl, anatomically resolved). Used by the Owl
//                           AI assistant: signatures, AskOwl, OwlNote.
//    <ObservatoryFilledOwlHead>  Head-only crop of the persona owl, for use at
//                           small sizes where the body silhouette is unreadable.
//    <ObservatoryWordmark>  "Observatory" wordmark (unchanged).
// =============================================================================

// -----------------------------------------------------------------------------
// MASTER BRAND — owl mark
//
//  The mark is rendered from a transparent PNG extracted from the brand
//  reference image (gold owl on dark navy). For theming, we render the PNG as
//  a CSS `mask-image` on a div whose `background-color` is the requested color
//  — this makes the owl tintable to any color while preserving the exact
//  illustration of the original brand mark (round eyes, ear tufts, crown stars,
//  body wings, talons — all the detail my hand-drawn SVG was missing).
//
//  Asset is loaded as a base64 data URL from observatory-owl-mark-data.js so
//  the brand component is fully self-contained (works offline, in standalone
//  HTML exports, and in screenshot/export tools that can't fetch external
//  files mid-render). Falls back to the file path if the data URL isn't loaded.
// -----------------------------------------------------------------------------
const OBSERVATORY_OWL_MARK_ASPECT = 215 / 203; // width / height of the PNG

function ObservatoryOwlMark({ size = 28, color = 'currentColor', style }) {
  const w = Math.round(size * OBSERVATORY_OWL_MARK_ASPECT);
  const h = size;
  const src = window.OBSERVATORY_OWL_MARK_DATA_URL || 'directions/observatory-owl-mark.png';
  const useCurrent = color === 'currentColor';
  return (
    <span
      style={{
        display: 'inline-block', verticalAlign: 'middle', lineHeight: 0,
        width: w, height: h,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block', width: '100%', height: '100%',
          backgroundColor: useCurrent ? 'currentColor' : color,
          WebkitMaskImage: `url("${src}")`,
          maskImage: `url("${src}")`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    </span>
  );
}

// -----------------------------------------------------------------------------
// LEGACY WORDMARK — extracted from the original brand SVG, currentColor fill.
// -----------------------------------------------------------------------------
const OBSERVATORY_WORDMARK_INNER = "<g id=\"SvgjsG1145\" featureKey=\"0yvIkK-0\" transform=\"matrix(2.641092762262927,0,0,2.641092762262927,82.30608417349549,3.1114670179078363)\" fill=\"currentColor\"><path d=\"M2.34 12.92 q0 2.7 1.66 4.45 t4.34 1.79 q2.7 0 4.34 -1.77 t1.66 -4.47 q0 -2.74 -1.64 -4.47 t-4.38 -1.77 q-2.68 0 -4.32 1.76 t-1.66 4.48 z M8.34 5.48 q2.16 0 3.82 0.95 t2.57 2.66 t0.93 3.83 q0 3.26 -2.06 5.33 t-5.26 2.11 q-3.22 0 -5.24 -2.09 t-2.08 -5.35 q0.02 -3.26 2.04 -5.32 t5.28 -2.12 z M19.1 15.38 q0 1.6 1.15 2.67 t2.71 1.11 q1.62 0 2.64 -1.09 t1.02 -2.69 q0 -1.64 -1.03 -2.71 t-2.65 -1.07 q-1.58 0 -2.69 1.09 t-1.15 2.69 z M18.02 4.88 l1.2 0 l0 7.5 l0.04 0 q0.52 -0.9 1.54 -1.38 t2.16 -0.48 q2.16 0 3.51 1.4 t1.35 3.46 q0 2.14 -1.38 3.49 t-3.48 1.37 q-1.18 0 -2.21 -0.52 t-1.49 -1.34 l-0.04 0 l0 1.62 l-1.2 0 l0 -15.12 z M33.02 10.52 q2.34 0 3.24 1.74 l-1.08 0.64 q-0.68 -1.3 -2.16 -1.3 q-0.8 0 -1.39 0.43 t-0.59 1.05 t0.5 0.99 t1.74 0.59 q1.84 0.32 2.54 0.95 t0.7 1.77 q0 1.3 -0.93 2.08 t-2.43 0.78 q-2.64 -0.02 -3.7 -1.88 l1.06 -0.72 q0.34 0.7 1.11 1.11 t1.57 0.41 q0.92 0 1.52 -0.51 t0.6 -1.19 q0 -0.62 -0.49 -1.02 t-2.13 -0.72 q-1.42 -0.28 -2.14 -0.86 t-0.72 -1.68 q0 -1.18 0.9 -1.92 t2.28 -0.74 z M46.26 14.6 q0 -1.26 -0.94 -2.13 t-2.28 -0.87 q-1.3 0 -2.24 0.87 t-1.1 2.13 l6.56 0 z M43.12 10.52 q1.92 0 3.12 1.24 t1.22 3.2 l0 0.72 l-7.76 0 q0.08 1.56 1.03 2.51 t2.47 0.97 q0.94 0 1.79 -0.45 t1.31 -1.19 l0.88 0.74 q-1.3 1.98 -4 1.98 q-2.12 -0.02 -3.39 -1.38 t-1.29 -3.5 q0 -2.08 1.31 -3.45 t3.31 -1.39 z M54.26 10.52 q0.34 0 0.7 0.1 l-0.14 1.18 q-0.22 -0.08 -0.48 -0.08 q-1.46 0 -2.23 0.9 t-0.77 2.34 l0 5.04 l-1.2 0 l0 -6.74 q0 -0.2 -0.1 -2.5 l1.2 0 q0.04 1.38 0.08 1.62 q1.04 -1.86 2.94 -1.86 z M56.86 10.76 l3.08 7.94 l3 -7.94 l1.22 0 l-3.64 9.24 l-1.24 0 l-3.78 -9.24 l1.36 0 z M66.84 17.44 q0 0.76 0.61 1.24 t1.51 0.48 q1.62 0 2.41 -0.85 t0.79 -2.31 l0 -0.64 l-1.44 0 q-1.84 0 -2.86 0.56 t-1.02 1.52 z M69.56 10.52 q1.86 0 2.76 0.86 t0.92 2.4 l0 2.74 q0 2.24 0.18 3.48 l-1.12 0 q-0.12 -0.62 -0.12 -1.5 l-0.04 0 q-1 1.74 -3.22 1.74 q-1.5 0 -2.38 -0.74 t-0.9 -2 q0 -1.54 1.33 -2.32 t3.71 -0.78 l1.48 0 l0 -0.54 q0 -1.14 -0.7 -1.7 t-1.9 -0.56 q-1.6 0 -2.82 1.04 l-0.7 -0.82 q0.66 -0.64 1.63 -0.97 t1.89 -0.33 z M77.12 8.1 l1.2 0 l0 2.66 l2.64 0 l0 1.08 l-2.64 0 l0 6.04 q0 0.58 0.34 0.93 t0.94 0.35 q0.66 0 1.36 -0.32 l0.1 1.08 q-0.9 0.32 -1.58 0.32 q-1.18 0 -1.77 -0.66 t-0.59 -1.7 l0 -6.04 l-2 0 l0 -1.08 l2 0 l0 -2.66 z M83.78 15.38 q0 1.66 1.04 2.72 t2.62 1.06 q1.64 0 2.65 -1.08 t1.01 -2.7 q0 -1.6 -1 -2.68 t-2.68 -1.1 q-1.62 0 -2.62 1.08 t-1.02 2.7 z M87.44 10.52 q2.12 0 3.48 1.38 t1.38 3.48 q0 2.14 -1.39 3.49 t-3.47 1.37 q-2.18 -0.02 -3.51 -1.4 t-1.35 -3.46 q0 -2.14 1.37 -3.49 t3.49 -1.37 z M99.1 10.52 q0.34 0 0.7 0.1 l-0.14 1.18 q-0.22 -0.08 -0.48 -0.08 q-1.46 0 -2.23 0.9 t-0.77 2.34 l0 5.04 l-1.2 0 l0 -6.74 q0 -0.2 -0.1 -2.5 l1.2 0 q0.04 1.38 0.08 1.62 q1.04 -1.86 2.94 -1.86 z M101.68 10.76 l3.06 7.78 l2.98 -7.78 l1.28 0 l-4.74 12.06 q-0.78 1.98 -2.56 1.98 q-0.56 0 -1.18 -0.18 l0.12 -1.12 q0.66 0.22 1.08 0.22 q0.46 0 0.82 -0.32 t0.7 -1.16 l0.86 -2.2 l-3.76 -9.28 l1.34 0 z\"></path></g>";
const OBSERVATORY_WORDMARK_TRANSFORM = "scale(8.104052026013006) translate(10, 10)";
const OBSERVATORY_WORDMARK_VIEWBOX = "700 80 2460 580";

function ObservatoryWordmark({ height = 28, color = 'currentColor', style }) {
  const width = height * (2460 / 580);
  return (
    <svg
      width={width} height={height}
      viewBox={OBSERVATORY_WORDMARK_VIEWBOX}
      style={{ color, display: 'inline-block', verticalAlign: 'middle', ...style }}
      dangerouslySetInnerHTML={{ __html: `<g transform="${OBSERVATORY_WORDMARK_TRANSFORM}">${OBSERVATORY_WORDMARK_INNER}</g>` }}
    />
  );
}

// -----------------------------------------------------------------------------
// PERSONA — filled owl (legacy brand owl). Two variants:
//   <ObservatoryFilledOwl>      Full body — used in OwlMark "talking" / large
//                                showcase tiles where the whole bird reads.
//   <ObservatoryFilledOwlHead>  Head-only crop — used in OwlSignature, AskOwl
//                                fab, signature stamps. Eyes + brow + beak only.
// -----------------------------------------------------------------------------
const OBSERVATORY_FILLED_OWL_INNER = "<g id=\"SvgjsG1144\" featureKey=\"G09qjj-0\" transform=\"matrix(1.4046065591248846,0,0,1.4046065591248846,-37.82311880034244,-27.985388821171068)\" fill=\"currentColor\"><path xmlns=\"http://www.w3.org/2000/svg\" fill=\"currentColor\" d=\"M60.146,32.33c-3.833,0-6.951,3.118-6.951,6.951c0,0.51,0.059,1.005,0.163,1.484  c-2.886-1.626-5.3-1.021-6.685-0.141c0.085-0.435,0.133-0.884,0.133-1.344c0-3.833-3.118-6.951-6.951-6.951  c-3.833,0-6.951,3.118-6.951,6.951s3.118,6.951,6.951,6.951c2.015,0,3.826-0.867,5.097-2.241c0.03,0.038,0.044,0.084,0.079,0.119  l4.086,4.086c0.234,0.234,0.552,0.366,0.884,0.366s0.649-0.132,0.884-0.366l4.085-4.086c0.035-0.035,0.049-0.081,0.079-0.119  c1.271,1.374,3.083,2.241,5.097,2.241c3.833,0,6.951-3.118,6.951-6.951S63.978,32.33,60.146,32.33z M39.855,43.732  c-2.455,0-4.451-1.997-4.451-4.451s1.997-4.451,4.451-4.451c2.454,0,4.451,1.997,4.451,4.451S42.309,43.732,39.855,43.732z   M50,45.545l-2.452-2.452c0.032-0.026,0.071-0.038,0.101-0.067c0.185-0.186,1.871-1.728,4.776,0.094L50,45.545z M60.146,43.732  c-2.455,0-4.451-1.997-4.451-4.451s1.997-4.451,4.451-4.451c2.454,0,4.451,1.997,4.451,4.451S62.6,43.732,60.146,43.732z\"></path><path xmlns=\"http://www.w3.org/2000/svg\" fill=\"currentColor\" d=\"M27.054,59.49c0.367,5.874,2.454,10.489,6.202,13.718c2.772,2.388,6.019,3.64,8.892,4.294v1.324  c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-0.875c0.293,0.038,0.579,0.071,0.854,0.099v0.776c0,0.69,0.56,1.25,1.25,1.25  s1.25-0.56,1.25-1.25v-0.641c0.067,0.001,0.143,0.003,0.207,0.003c0.822,0,1.338-0.041,1.425-0.049  c0.132-0.012,0.25-0.059,0.366-0.107c0.116,0.049,0.234,0.096,0.366,0.107c0.086,0.008,0.603,0.049,1.425,0.049  c0.064,0,0.14-0.002,0.207-0.003v0.641c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25V78.05c0.275-0.027,0.56-0.061,0.854-0.099  v0.875c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-1.323c2.873-0.654,6.12-1.907,8.892-4.295  c3.748-3.229,5.835-7.844,6.202-13.718c0.277-4.437,0.014-17.334,0.002-17.854c0-11.972-10.229-21.712-22.802-21.712  c-0.052,0-0.096,0.023-0.146,0.029c-0.05-0.006-0.095-0.029-0.146-0.029c-12.573,0-22.802,9.74-22.801,21.686  C27.041,42.156,26.777,55.054,27.054,59.49z M70.451,59.334c-0.262,4.194-1.507,7.621-3.676,10.251  c-0.109-0.04-0.218-0.084-0.34-0.092c-1.671-0.107-2.934-0.716-3.861-1.861c-2.504-3.095-1.677-8.943-1.669-9.002  c0.101-0.683-0.371-1.318-1.053-1.419c-0.69-0.111-1.318,0.368-1.42,1.051c-0.042,0.283-1,6.981,2.192,10.936  c1.029,1.275,2.356,2.122,3.958,2.529c-2.104,1.648-4.507,2.628-6.731,3.19v-2.471c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25  v2.963c-0.292,0.042-0.579,0.081-0.854,0.111v-3.074c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v3.232  c-0.865,0.012-1.397-0.028-1.417-0.029c-0.21-0.02-0.405,0.029-0.586,0.105c-0.178-0.073-0.37-0.12-0.577-0.105  c-0.021,0.001-0.551,0.042-1.416,0.032v-3.235c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v3.079  c-0.274-0.03-0.562-0.068-0.854-0.111v-2.968c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v2.478  c-2.221-0.563-4.623-1.545-6.731-3.197c1.602-0.407,2.929-1.254,3.958-2.529c3.193-3.954,2.235-10.652,2.192-10.936  c-0.102-0.683-0.735-1.155-1.421-1.052c-0.683,0.103-1.153,0.738-1.051,1.421c0.244,1.628,0.419,6.416-1.665,8.996  c-0.927,1.148-2.191,1.759-3.865,1.866c-0.122,0.008-0.23,0.052-0.34,0.092c-2.168-2.63-3.414-6.057-3.676-10.251  c-0.189-3.025-0.114-10.374-0.051-14.59c2.845,6.102,10.688,10.387,20.182,10.387c0.113,0,0.215-0.036,0.319-0.064  c0.104,0.028,0.206,0.064,0.319,0.064c9.494,0,17.337-4.285,20.183-10.387C70.565,48.949,70.64,56.306,70.451,59.334z   M49.854,22.424c0.052,0,0.096-0.023,0.146-0.029c0.05,0.006,0.095,0.029,0.146,0.029c5.287,0,10.093,1.938,13.709,5.086  c-2.636-0.979-5.892-0.981-8.674,0.063c-2.286,0.858-4.043,2.326-5.182,4.276c-1.139-1.95-2.896-3.419-5.183-4.276  c-2.785-1.046-6.043-1.041-8.678-0.062C39.756,24.364,44.564,22.424,49.854,22.424z M50.319,52.631  c-0.113,0-0.215,0.036-0.319,0.064c-0.104-0.028-0.206-0.064-0.319-0.064c-10.567,0-18.845-5.701-18.845-12.979  c0-4.113,2.08-8.758,6.727-9.861c0.187-0.044,0.347-0.135,0.487-0.247c1.872-0.435,4.036-0.326,5.888,0.369  c1.518,0.57,3.527,1.796,4.481,4.401c0.186,0.507,0.664,0.82,1.174,0.82c0.135,0,0.272-0.025,0.407-0.072  c0.135,0.047,0.272,0.072,0.407,0.072c0.51,0,0.988-0.313,1.174-0.82c0.954-2.605,2.962-3.831,4.479-4.4  c1.853-0.696,4.017-0.805,5.889-0.37c0.14,0.112,0.3,0.203,0.487,0.247c4.647,1.104,6.727,5.748,6.727,9.861  C69.164,46.93,60.886,52.631,50.319,52.631z\"></path></g>";
const OBSERVATORY_FILLED_OWL_TRANSFORM = "scale(8.104052026013006) translate(10, 10)";

function ObservatoryFilledOwl({ size = 28, color = 'currentColor', style }) {
  return (
    <svg
      width={size} height={size}
      viewBox="60 0 540 760"
      style={{ color, display: 'inline-block', verticalAlign: 'middle', ...style }}
      dangerouslySetInnerHTML={{ __html: `<g transform="${OBSERVATORY_FILLED_OWL_TRANSFORM}">${OBSERVATORY_FILLED_OWL_INNER}</g>` }}
    />
  );
}

// Head-only viewBox: drops the body/legs portion, keeps eyes+brow+ears.
//  Original full-owl viewBox was: 60 0 540 760
//  Head occupies roughly the top 45% of the visual height.
//
//  Eye coordinates (in path coordinate system, BEFORE the inner matrix):
//    right pupil center: (60.146, 39.281), radius 4.451
//    left  pupil center: (39.855, 39.281), radius 4.451
//  Eye-cover ellipses sit in a sibling <g> with the SAME inner matrix, so
//  they inherit identical positioning + scaling — no manual % math, no
//  positioning drift across sizes.
function ObservatoryFilledOwlHead({ size = 28, color = 'currentColor', style, eyesClosed = false, blink = false }) {
  const innerMatrix = "matrix(1.4046065591248846,0,0,1.4046065591248846,-37.82311880034244,-27.985388821171068)";

  // Eye-cover ellipses in the same coordinate system as the pupils. When
  // `eyesClosed` is true (or `blink` is on), they paint over the eye discs in
  // the owl's tint color, reading as closed eyes. CSS animation cycles scaleY.
  // transform-box: fill-box pins the scale origin to the ellipse center.
  const eyeAnim = blink
    ? 'animation: obsOwlBlink 4.6s ease-in-out infinite; transform: scaleY(0);'
    : (eyesClosed ? 'transform: scaleY(1);' : 'transform: scaleY(0);');
  const eyeStyle = `style="transform-box: fill-box; transform-origin: center; ${eyeAnim}"`;
  const eyeOverlay = (blink || eyesClosed)
    ? `<g transform="${innerMatrix}" fill="currentColor"><ellipse cx="39.855" cy="39.281" rx="4.451" ry="4.451" ${eyeStyle}/><ellipse cx="60.146" cy="39.281" rx="4.451" ry="4.451" ${eyeStyle}/></g>`
    : '';

  return (
    <svg
      width={size} height={size}
      viewBox="60 0 540 380"
      style={{ color, display: 'inline-block', verticalAlign: 'middle', ...style }}
      dangerouslySetInnerHTML={{ __html: `<g transform="${OBSERVATORY_FILLED_OWL_TRANSFORM}">${OBSERVATORY_FILLED_OWL_INNER}${eyeOverlay}</g>` }}
    />
  );
}

// -----------------------------------------------------------------------------
// Lockup — line owl + wordmark, the master brand mark.
// -----------------------------------------------------------------------------
function ObservatoryLockup({ height = 32, gap = 12, color = 'currentColor', style, owlColor = null, wordColor = null }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, color, ...style }}>
      <ObservatoryOwlMark size={Math.round(height * 1.05)} color={owlColor || 'currentColor'} />
      <ObservatoryWordmark height={height * 0.62} color={wordColor || 'currentColor'} />
    </span>
  );
}

window.ObservatoryOwlMark = ObservatoryOwlMark;
window.ObservatoryWordmark = ObservatoryWordmark;
window.ObservatoryFilledOwl = ObservatoryFilledOwl;
window.ObservatoryFilledOwlHead = ObservatoryFilledOwlHead;
window.ObservatoryLockup = ObservatoryLockup;

// =============================================================================
//  ObservatoryLayeredOwl — animation-ready persona owl.
//
//  Source: directions/observatory-owl-layered.svg. Each part is an isolated
//  shape we can animate independently:
//    #body        — head outline + body silhouette (one path)
//    #left-eye    — stroke-only ring, cx=39.855 cy=39.281 r=5.701
//    #right-eye   — stroke-only ring, cx=60.146 cy=39.281 r=5.701
//    #beak        — small chevron at (50, 45.545)
//
//  ViewBox 16.58 16.58 66.84 66.84 — perfectly square, no letterbox.
//
//  State-driven animations (data-state attribute on the root <g>):
//    idle      — slow ambient blink every ~5s
//    thinking  — blink + slight head tilt
//    attention — eyes WIDEN (a "noticed something" alert pop)
//    concerned — eyes shift down + brow furrow
//    talking   — subtle breath (scale)
// =============================================================================
const OBSERVATORY_LAYERED_OWL_BODY = "M27.054,59.49c0.367,5.874,2.454,10.489,6.202,13.718c2.772,2.388,6.019,3.64,8.892,4.294v1.324  c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-0.875c0.293,0.038,0.579,0.071,0.854,0.099v0.776c0,0.69,0.56,1.25,1.25,1.25  s1.25-0.56,1.25-1.25v-0.641c0.067,0.001,0.143,0.003,0.207,0.003c0.822,0,1.338-0.041,1.425-0.049  c0.132-0.012,0.25-0.059,0.366-0.107c0.116,0.049,0.234,0.096,0.366,0.107c0.086,0.008,0.603,0.049,1.425,0.049  c0.064,0,0.14-0.002,0.207-0.003v0.641c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25V78.05c0.275-0.027,0.56-0.061,0.854-0.099  v0.875c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-1.323c2.873-0.654,6.12-1.907,8.892-4.295  c3.748-3.229,5.835-7.844,6.202-13.718c0.277-4.437,0.014-17.334,0.002-17.854c0-11.972-10.229-21.712-22.802-21.712  c-0.052,0-0.096,0.023-0.146,0.029c-0.05-0.006-0.095-0.029-0.146-0.029c-12.573,0-22.802,9.74-22.801,21.686  C27.041,42.156,26.777,55.054,27.054,59.49z M70.451,59.334c-0.262,4.194-1.507,7.621-3.676,10.251  c-0.109-0.04-0.218-0.084-0.34-0.092c-1.671-0.107-2.934-0.716-3.861-1.861c-2.504-3.095-1.677-8.943-1.669-9.002  c0.101-0.683-0.371-1.318-1.053-1.419c-0.69-0.111-1.318,0.368-1.42,1.051c-0.042,0.283-1,6.981,2.192,10.936  c1.029,1.275,2.356,2.122,3.958,2.529c-2.104,1.648-4.507,2.628-6.731,3.19v-2.471c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25  v2.963c-0.292,0.042-0.579,0.081-0.854,0.111v-3.074c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v3.232  c-0.865,0.012-1.397-0.028-1.417-0.029c-0.21-0.02-0.405,0.029-0.586,0.105c-0.178-0.073-0.37-0.12-0.577-0.105  c-0.021,0.001-0.551,0.042-1.416,0.032v-3.235c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v3.079  c-0.274-0.03-0.562-0.068-0.854-0.111v-2.968c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v2.478  c-2.221-0.563-4.623-1.545-6.731-3.197c1.602-0.407,2.929-1.254,3.958-2.529c3.193-3.954,2.235-10.652,2.192-10.936  c-0.102-0.683-0.735-1.155-1.421-1.052c-0.683,0.103-1.153,0.738-1.051,1.421c0.244,1.628,0.419,6.416-1.665,8.996  c-0.927,1.148-2.191,1.759-3.865,1.866c-0.122,0.008-0.23,0.052-0.34,0.092c-2.168-2.63-3.414-6.057-3.676-10.251  c-0.189-3.025-0.114-10.374-0.051-14.59c2.845,6.102,10.688,10.387,20.182,10.387c0.113,0,0.215-0.036,0.319-0.064  c0.104,0.028,0.206,0.064,0.319,0.064c9.494,0,17.337-4.285,20.183-10.387C70.565,48.949,70.64,56.306,70.451,59.334z M49.854,22.424c0.052,0,0.096-0.023,0.146-0.029c0.05,0.006,0.095,0.029,0.146,0.029c5.287,0,10.093,1.938,13.709,5.086  c-2.636-0.979-5.892-0.981-8.674,0.063c-2.286,0.858-4.043,2.326-5.182,4.276c-1.139-1.95-2.896-3.419-5.183-4.276  c-2.785-1.046-6.043-1.041-8.678-0.062C39.756,24.364,44.564,22.424,49.854,22.424z M50.319,52.631  c-0.113,0-0.215,0.036-0.319,0.064c-0.104-0.028-0.206-0.064-0.319-0.064c-10.567,0-18.845-5.701-18.845-12.979  c0-4.113,2.08-8.758,6.727-9.861c0.187-0.044,0.347-0.135,0.487-0.247c1.872-0.435,4.036-0.326,5.888,0.369  c1.518,0.57,3.527,1.796,4.481,4.401c0.186,0.507,0.664,0.82,1.174,0.82c0.135,0,0.272-0.025,0.407-0.072  c0.135,0.047,0.272,0.072,0.407,0.072c0.51,0,0.988-0.313,1.174-0.82c0.954-2.605,2.962-3.831,4.479-4.4  c1.853-0.696,4.017-0.805,5.889-0.37c0.14,0.112,0.3,0.203,0.487,0.247c4.647,1.104,6.727,5.748,6.727,9.861  C69.164,46.93,60.886,52.631,50.319,52.631z";

const OBSERVATORY_LAYERED_OWL_BEAK = "M50,45.545l-2.452-2.452c0.032-0.026,0.071-0.038,0.101-0.067c0.185-0.186,1.871-1.728,4.776,0.094L50,45.545z";

function ObservatoryLayeredOwl({ size = 28, color = 'currentColor', state = 'idle', style }) {
  // Stroke width is in viewBox units (the SVG is ~66 units wide). 2.5 reads
  // crisp at 28–60px; we keep it constant so eye-ring weight matches the
  // beak/silhouette across sizes.
  const strokeWidth = 2.5;
  return (
    <svg
      width={size}
      height={size}
      viewBox="16.58 16.58 66.84 66.84"
      style={{ color, display: 'inline-block', verticalAlign: 'middle', overflow: 'visible', ...style }}
    >
      <g
        className="obs-owl-root"
        data-owl-state={state}
        fill={color}
        style={{ transformBox: 'fill-box', transformOrigin: 'center', transition: 'transform 280ms cubic-bezier(0.4,0,0.2,1)' }}
      >
        <path className="obs-owl-body" fillRule="evenodd" d={OBSERVATORY_LAYERED_OWL_BODY} />

        {/* Eyes are stroke-only rings. We animate `ry` for blink (collapse to a
            sliver), `r` for attention (widen pop), and `cy` for concerned.
            transform-box: fill-box so scale operates around each eye's center. */}
        <g className="obs-owl-eye obs-owl-eye-left" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <circle cx="39.855" cy="39.281" r="5.701" fill="none" stroke={color} strokeWidth={strokeWidth} />
        </g>
        <g className="obs-owl-eye obs-owl-eye-right" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <circle cx="60.146" cy="39.281" r="5.701" fill="none" stroke={color} strokeWidth={strokeWidth} />
        </g>

        <path className="obs-owl-beak" d={OBSERVATORY_LAYERED_OWL_BEAK} />
      </g>
    </svg>
  );
}

window.ObservatoryLayeredOwl = ObservatoryLayeredOwl;

// Inject layered-owl animation keyframes once. The persona owl is now driven
// by data-owl-state on the root <g>; each state binds different animations:
//
//   idle      — slow ambient blink. Eyes mostly open; brief scaleY pulse.
//   thinking  — same blink, slightly more frequent + tiny head tilt.
//   attention — eyes widen twice in quick succession ("noticed something"),
//               then settle. Used for unread notifications.
//   concerned — eyes static, slightly squashed and shifted downward to read
//               as a furrowed look.
//   talking   — subtle "breath" scale on the body.
//
// Eye animations target `.obs-owl-eye` groups, whose transform-box: fill-box
// keeps scale operations centered on each eye independently.
if (typeof document !== 'undefined' && !document.getElementById('observatory-owl-anim-keyframes')) {
  const style = document.createElement('style');
  style.id = 'observatory-owl-anim-keyframes';
  style.textContent = `
    /* IDLE BLINK — eyes open most of the cycle, brief close at 92–98%. */
    @keyframes obsOwlBlink {
      0%, 92%, 100% { transform: scaleY(1); }
      94%, 96%      { transform: scaleY(0.05); }
    }

    /* ATTENTION — widen twice. Eyes are "noticing" something. */
    @keyframes obsOwlAttention {
      0%, 100%      { transform: scale(1); }
      15%, 45%      { transform: scale(1.32); }
      30%, 60%      { transform: scale(1); }
      72%, 90%      { transform: scale(1); }
    }

    /* TALKING — subtle whole-owl breath. */
    @keyframes obsOwlBreath {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.025); }
    }

    /* THINKING — tiny head tilt + slow blink share the cycle. */
    @keyframes obsOwlTilt {
      0%, 100% { transform: rotate(-2deg); }
      50%      { transform: rotate(2deg); }
    }

    /* === State bindings === */

    /* idle: gentle blink every 5.4s */
    .obs-owl-root[data-owl-state="idle"] .obs-owl-eye {
      animation: obsOwlBlink 5.4s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: center;
    }

    /* thinking: blink every 3.8s + slow head tilt every 4s */
    .obs-owl-root[data-owl-state="thinking"] {
      animation: obsOwlTilt 4s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
    .obs-owl-root[data-owl-state="thinking"] .obs-owl-eye {
      animation: obsOwlBlink 3.8s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
    .obs-owl-root[data-owl-state="thinking"] .obs-owl-eye-right {
      animation-delay: 0.15s; /* eyes don't blink quite in lockstep */
    }

    /* attention: eye-widen pop, repeats every 3.2s. Beak gets a tiny scoot. */
    .obs-owl-root[data-owl-state="attention"] .obs-owl-eye {
      animation: obsOwlAttention 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
      transform-box: fill-box;
      transform-origin: center;
    }

    /* concerned: static squashed eyes, slightly lowered. No animation; pure
       transform so it reads as a posture, not a motion. */
    .obs-owl-root[data-owl-state="concerned"] .obs-owl-eye {
      transform: translateY(0.6px) scaleY(0.6);
      transform-box: fill-box;
      transform-origin: center;
    }

    /* talking: breath on whole owl */
    .obs-owl-root[data-owl-state="talking"] {
      animation: obsOwlBreath 1.6s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: center;
    }

    /* Respect reduced motion */
    @media (prefers-reduced-motion: reduce) {
      .obs-owl-root, .obs-owl-root .obs-owl-eye {
        animation: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

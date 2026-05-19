/**
 * PERSONA owl — full filled silhouette. Used by the Owl AI assistant ("Ory"):
 * showcase tiles, large persona introductions, anywhere the whole bird reads.
 *
 * Same color tinting as the other brand marks via `currentColor`. The path
 * data is the original brand SVG; embedded inline via dangerouslySetInnerHTML
 * because it's a complex multi-path glyph that ships better as raw markup.
 */
import type { CSSProperties } from "react";

const FILLED_OWL_INNER = `<g featureKey="G09qjj-0" transform="matrix(1.4046065591248846,0,0,1.4046065591248846,-37.82311880034244,-27.985388821171068)" fill="currentColor"><path xmlns="http://www.w3.org/2000/svg" fill="currentColor" d="M60.146,32.33c-3.833,0-6.951,3.118-6.951,6.951c0,0.51,0.059,1.005,0.163,1.484  c-2.886-1.626-5.3-1.021-6.685-0.141c0.085-0.435,0.133-0.884,0.133-1.344c0-3.833-3.118-6.951-6.951-6.951  c-3.833,0-6.951,3.118-6.951,6.951s3.118,6.951,6.951,6.951c2.015,0,3.826-0.867,5.097-2.241c0.03,0.038,0.044,0.084,0.079,0.119  l4.086,4.086c0.234,0.234,0.552,0.366,0.884,0.366s0.649-0.132,0.884-0.366l4.085-4.086c0.035-0.035,0.049-0.081,0.079-0.119  c1.271,1.374,3.083,2.241,5.097,2.241c3.833,0,6.951-3.118,6.951-6.951S63.978,32.33,60.146,32.33z M39.855,43.732  c-2.455,0-4.451-1.997-4.451-4.451s1.997-4.451,4.451-4.451c2.454,0,4.451,1.997,4.451,4.451S42.309,43.732,39.855,43.732z   M50,45.545l-2.452-2.452c0.032-0.026,0.071-0.038,0.101-0.067c0.185-0.186,1.871-1.728,4.776,0.094L50,45.545z M60.146,43.732  c-2.455,0-4.451-1.997-4.451-4.451s1.997-4.451,4.451-4.451c2.454,0,4.451,1.997,4.451,4.451S62.6,43.732,60.146,43.732z"></path><path xmlns="http://www.w3.org/2000/svg" fill="currentColor" d="M27.054,59.49c0.367,5.874,2.454,10.489,6.202,13.718c2.772,2.388,6.019,3.64,8.892,4.294v1.324  c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-0.875c0.293,0.038,0.579,0.071,0.854,0.099v0.776c0,0.69,0.56,1.25,1.25,1.25  s1.25-0.56,1.25-1.25v-0.641c0.067,0.001,0.143,0.003,0.207,0.003c0.822,0,1.338-0.041,1.425-0.049  c0.132-0.012,0.25-0.059,0.366-0.107c0.116,0.049,0.234,0.096,0.366,0.107c0.086,0.008,0.603,0.049,1.425,0.049  c0.064,0,0.14-0.002,0.207-0.003v0.641c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25V78.05c0.275-0.027,0.56-0.061,0.854-0.099  v0.875c0,0.69,0.56,1.25,1.25,1.25s1.25-0.56,1.25-1.25v-1.323c2.873-0.654,6.12-1.907,8.892-4.295  c3.748-3.229,5.835-7.844,6.202-13.718c0.277-4.437,0.014-17.334,0.002-17.854c0-11.972-10.229-21.712-22.802-21.712  c-0.052,0-0.096,0.023-0.146,0.029c-0.05-0.006-0.095-0.029-0.146-0.029c-12.573,0-22.802,9.74-22.801,21.686  C27.041,42.156,26.777,55.054,27.054,59.49z M70.451,59.334c-0.262,4.194-1.507,7.621-3.676,10.251  c-0.109-0.04-0.218-0.084-0.34-0.092c-1.671-0.107-2.934-0.716-3.861-1.861c-2.504-3.095-1.677-8.943-1.669-9.002  c0.101-0.683-0.371-1.318-1.053-1.419c-0.69-0.111-1.318,0.368-1.42,1.051c-0.042,0.283-1,6.981,2.192,10.936  c1.029,1.275,2.356,2.122,3.958,2.529c-2.104,1.648-4.507,2.628-6.731,3.19v-2.471c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25  v2.963c-0.292,0.042-0.579,0.081-0.854,0.111v-3.074c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v3.232  c-0.865,0.012-1.397-0.028-1.417-0.029c-0.21-0.02-0.405,0.029-0.586,0.105c-0.178-0.073-0.37-0.12-0.577-0.105  c-0.021,0.001-0.551,0.042-1.416,0.032v-3.235c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v3.079  c-0.274-0.03-0.562-0.068-0.854-0.111v-2.968c0-0.69-0.56-1.25-1.25-1.25s-1.25,0.56-1.25,1.25v2.478  c-2.221-0.563-4.623-1.545-6.731-3.197c1.602-0.407,2.929-1.254,3.958-2.529c3.193-3.954,2.235-10.652,2.192-10.936  c-0.102-0.683-0.735-1.155-1.421-1.052c-0.683,0.103-1.153,0.738-1.051,1.421c0.244,1.628,0.419,6.416-1.665,8.996  c-0.927,1.148-2.191,1.759-3.865,1.866c-0.122,0.008-0.23,0.052-0.34,0.092c-2.168-2.63-3.414-6.057-3.676-10.251  c-0.189-3.025-0.114-10.374-0.051-14.59c2.845,6.102,10.688,10.387,20.182,10.387c0.113,0,0.215-0.036,0.319-0.064  c0.104,0.028,0.206,0.064,0.319,0.064c9.494,0,17.337-4.285,20.183-10.387C70.565,48.949,70.64,56.306,70.451,59.334z M49.854,22.424c0.052,0,0.096-0.023,0.146-0.029c0.05,0.006,0.095,0.029,0.146,0.029c5.287,0,10.093,1.938,13.709,5.086  c-2.636-0.979-5.892-0.981-8.674,0.063c-2.286,0.858-4.043,2.326-5.182,4.276c-1.139-1.95-2.896-3.419-5.183-4.276  c-2.785-1.046-6.043-1.041-8.678-0.062C39.756,24.364,44.564,22.424,49.854,22.424z M50.319,52.631  c-0.113,0-0.215,0.036-0.319,0.064c-0.104-0.028-0.206-0.064-0.319-0.064c-10.567,0-18.845-5.701-18.845-12.979  c0-4.113,2.08-8.758,6.727-9.861c0.187-0.044,0.347-0.135,0.487-0.247c1.872-0.435,4.036-0.326,5.888,0.369  c1.518,0.57,3.527,1.796,4.481,4.401c0.186,0.507,0.664,0.82,1.174,0.82c0.135,0,0.272-0.025,0.407-0.072  c0.135,0.047,0.272,0.072,0.407,0.072c0.51,0,0.988-0.313,1.174-0.82c0.954-2.605,2.962-3.831,4.479-4.4  c1.853-0.696,4.017-0.805,5.889-0.37c0.14,0.112,0.3,0.203,0.487,0.247c4.647,1.104,6.727,5.748,6.727,9.861  C69.164,46.93,60.886,52.631,50.319,52.631z"></path></g>`;
const FILLED_OWL_TRANSFORM = "scale(8.104052026013006) translate(10, 10)";
const FILLED_OWL_VIEWBOX = "60 0 540 760";

type Props = {
  size?: number;
  color?: string;
  style?: CSSProperties;
};

export function ObservatoryFilledOwl({ size = 28, color = "currentColor", style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={FILLED_OWL_VIEWBOX}
      style={{ color, display: "inline-block", verticalAlign: "middle", ...style }}
      dangerouslySetInnerHTML={{
        __html: `<g transform="${FILLED_OWL_TRANSFORM}">${FILLED_OWL_INNER}</g>`,
      }}
    />
  );
}

/**
 * Head-only crop of the persona owl — used in OwlSignature, AskOwl FAB, and
 * small attribution stamps where the body silhouette would be unreadable.
 * Optional `blink` cycles a CSS animation that scales eye covers; `eyesClosed`
 * holds the closed pose statically.
 */
type HeadProps = Props & {
  eyesClosed?: boolean;
  blink?: boolean;
};

const FILLED_OWL_HEAD_VIEWBOX = "60 0 540 380";

export function ObservatoryFilledOwlHead({
  size = 28,
  color = "currentColor",
  style,
  eyesClosed = false,
  blink = false,
}: HeadProps) {
  const innerMatrix =
    "matrix(1.4046065591248846,0,0,1.4046065591248846,-37.82311880034244,-27.985388821171068)";

  // Eye-cover ellipses in the same coord system as the pupils. When `eyesClosed`
  // is true (or `blink`), they paint over the eye discs in the owl's tint
  // color, reading as closed eyes. CSS animation cycles scaleY for blink.
  const eyeAnim = blink
    ? "animation: obsOwlBlink 4.6s ease-in-out infinite; transform: scaleY(0);"
    : eyesClosed
      ? "transform: scaleY(1);"
      : "transform: scaleY(0);";
  const eyeStyle = `style="transform-box: fill-box; transform-origin: center; ${eyeAnim}"`;
  const eyeOverlay =
    blink || eyesClosed
      ? `<g transform="${innerMatrix}" fill="currentColor"><ellipse cx="39.855" cy="39.281" rx="4.451" ry="4.451" ${eyeStyle}/><ellipse cx="60.146" cy="39.281" rx="4.451" ry="4.451" ${eyeStyle}/></g>`
      : "";

  return (
    <svg
      width={size}
      height={size}
      viewBox={FILLED_OWL_HEAD_VIEWBOX}
      style={{ color, display: "inline-block", verticalAlign: "middle", ...style }}
      dangerouslySetInnerHTML={{
        __html: `<g transform="${FILLED_OWL_TRANSFORM}">${FILLED_OWL_INNER}${eyeOverlay}</g>`,
      }}
    />
  );
}

/**
 * WCAG 2.1 contrast arithmetic for OKLCH token values.
 *
 * Pure so the token sheet can be checked in a unit test rather than by eye:
 * OKLCH -> OKLab -> LMS -> linear sRGB -> relative luminance -> ratio.
 * Matrices are the reference ones from Björn Ottosson's OKLab specification.
 */
export type Oklch = { l: number; c: number; h: number; alpha: number };

const OKLCH_PATTERN = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i;

export function parseOklch(value: string): Oklch {
  const match = OKLCH_PATTERN.exec(value.trim());
  if (!match) throw new Error(`Not an oklch() literal: ${value}`);
  const [, l, c, h, alpha] = match;
  return {
    l: Number(l),
    c: Number(c),
    h: Number(h),
    alpha:
      alpha === undefined
        ? 1
        : alpha.endsWith('%')
          ? Number(alpha.slice(0, -1)) / 100
          : Number(alpha),
  };
}

/** Linear-light sRGB components, clipped to the displayable gamut. */
export function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lc = l_ ** 3;
  const mc = m_ ** 3;
  const sc = s_ ** 3;

  const clip = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clip(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    clip(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    clip(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  ];
}

export function relativeLuminance(colour: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: Oklch, background: Oklch): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const [lighter, darker] = fg > bg ? [fg, bg] : [bg, fg];
  return (lighter + 0.05) / (darker + 0.05);
}

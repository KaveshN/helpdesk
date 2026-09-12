import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseOklch } from '@/lib/design/contrast';

/**
 * Reads globals.css on purpose: the palette is data, and this is the test
 * that stops a "small tweak" to a token from failing WCAG AA in one theme.
 */
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

function tokenBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Selector not found in globals.css: ${selector}`);
  const end = css.indexOf('}', start);
  const body = css.slice(start, end);
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[match[1]!] = match[2]!.trim();
  }
  return vars;
}

function resolve(vars: Record<string, string>, name: string): string {
  let value = vars[name];
  for (let hops = 0; value !== undefined && hops < 5; hops += 1) {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    if (!ref) break;
    value = vars[ref[1]!];
  }
  if (value === undefined) throw new Error(`Token --${name} is not defined`);
  return value;
}

const light = tokenBlock(':root');
const dark = { ...light, ...tokenBlock(":root[data-theme='dark']") };

/** [text token, surface token, minimum ratio] */
const TEXT_ON_SURFACE: Array<[string, string, number]> = [
  ['foreground', 'background', 4.5],
  ['foreground', 'card', 4.5],
  ['foreground', 'muted', 4.5],
  ['foreground', 'accent', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['primary-foreground', 'primary-hover', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['primary', 'card', 4.5],
  ['primary', 'background', 4.5],
  ['primary', 'primary-subtle', 4.5],
  ['success', 'card', 4.5],
  ['success', 'success-subtle', 4.5],
  ['warning', 'card', 4.5],
  ['warning', 'warning-subtle', 4.5],
  ['destructive', 'card', 4.5],
  ['destructive', 'destructive-subtle', 4.5],
  // Decorative / large-text tier: WCAG's 3:1 for UI components.
  ['faint', 'background', 3],
  ['faint', 'card', 3],
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s palette', (_name, vars) => {
  it.each(TEXT_ON_SURFACE)('--%s on --%s reaches %s:1', (text, surface, minimum) => {
    const ratio = contrastRatio(
      parseOklch(resolve(vars, text)),
      parseOklch(resolve(vars, surface)),
    );
    expect(ratio, `${text} on ${surface} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(minimum);
  });

  it('defines every token the light palette defines', () => {
    for (const name of Object.keys(light)) {
      if (name === 'density' || name.startsWith('sidebar') || name === 'radius') continue;
      expect(vars[name], `--${name}`).toBeDefined();
    }
  });
});

describe('contrast arithmetic', () => {
  it('returns 21 for black on white and 1 for identical colours', () => {
    const white = parseOklch('oklch(1 0 0)');
    const black = parseOklch('oklch(0 0 0)');
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
    expect(contrastRatio(white, white)).toBe(1);
  });

  it('parses an alpha channel', () => {
    expect(parseOklch('oklch(0.5 0.1 200 / 0.45)').alpha).toBe(0.45);
    expect(parseOklch('oklch(0.5 0.1 200 / 45%)').alpha).toBe(0.45);
  });
});

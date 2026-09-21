import { readFileSync } from 'node:fs';

/** Reads design tokens out of the real stylesheet, so tests see what ships. */
const css = readFileSync('src/styles/tokens.css', 'utf8');

function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`no block for ${selector}`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const line of css.slice(open + 1, close).split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

const shared = block(':root {');
const themes = {
  night: { ...shared, ...block(":root[data-theme='night']") },
  paper: { ...shared, ...block(":root[data-theme='paper']") },
};

export type ThemeName = keyof typeof themes;

/** A token lookup for one theme, shaped the way the palette builder wants it. */
export function tokensFor(theme: ThemeName): (name: string) => string {
  return (name) => {
    const v = themes[theme][name];
    if (v === undefined) throw new Error(`token ${name} is not defined for ${theme}`);
    return v;
  };
}

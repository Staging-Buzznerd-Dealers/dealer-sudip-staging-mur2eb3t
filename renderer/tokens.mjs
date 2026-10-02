// The design system compiler. `site/tokens.json` is the single editable source;
// everything below is derived from it. This module is the ONLY place the
// compilation rules live — the dashboard canvas imports the same function, so
// preview and production cannot drift.

/**
 * The token set a site starts with.
 *
 * It exists so the design system screen is never empty. A dealer whose repo has
 * no `site/tokens.json` — a repo provisioned before the design system existed,
 * or one whose file was deleted — still gets a full, editable set to work from,
 * and saving writes the file. "This site has no tokens.json yet, go and sync"
 * is not an answer to give someone who opened the screen to change a colour.
 *
 * These values are deliberately neutral rather than branded: the first thing a
 * dealer does is replace them.
 */
export const DEFAULT_TOKENS = {
  version: 2,
  fonts: { heading: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', files: [] },
  colors: {
    accent: '#d99038',
    accentDark: '#b8762a',
    ink: '#111c3a',
    inkDark: '#0a1226',
    muted: '#7c86a2',
    line: '#dde3ee',
    card: '#ffffff',
    paper: '#f4f6fb',
  },
  status: { ok: '#3a6b4a', info: '#3a5ea8', warn: '#b5761f', bad: '#b03a32' },
  type: { h1: 48, h2: 34, h3: 24, body: 16, small: 14, eyebrow: 12 },
  typography: {
    headingWeight: 700,
    bodyWeight: 400,
    headingLineHeight: 1.15,
    bodyLineHeight: 1.6,
  },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 },
  radius: { nav: 6, input: 8, card: 10, modal: 14, chip: 999 },
  // Container paddings default to the current behaviour (space-4 at every
  // width) so adding these tokens restyles nothing until a dealer changes them.
  layout: { container: '1160px', padDesktop: 16, padTablet: 16, padMobile: 16 },
};

/**
 * Fill in whatever a token file is missing.
 *
 * A file written by an older editor will not have every group, and a half-filled
 * token set compiles to CSS with `undefined` in it — which is invisible until a
 * page renders with no spacing at all. Merging against the defaults makes a
 * partial file safe.
 */
export function withDefaults(tokens) {
  const base = DEFAULT_TOKENS;
  if (!tokens || typeof tokens !== 'object') return { ...base };
  const merged = { ...base, ...tokens };
  for (const group of ['fonts', 'colors', 'status', 'type', 'typography', 'spacing', 'radius', 'layout']) {
    merged[group] = { ...base[group], ...(tokens[group] || {}) };
  }
  return merged;
}

const px = (n) => `${n}px`;
const rem = (n) => `${(Number(n) / 16).toFixed(4).replace(/\.?0+$/, '')}rem`;

/** Token keys a scoped override is allowed to set, grouped as they appear in JSON. */
export const TOKEN_GROUPS = {
  colors: ['accent', 'accentDark', 'ink', 'inkDark', 'muted', 'line', 'card', 'paper'],
  status: ['ok', 'info', 'warn', 'bad'],
  type: ['h1', 'h2', 'h3', 'body', 'small', 'eyebrow'],
  typography: ['headingWeight', 'bodyWeight', 'headingLineHeight', 'bodyLineHeight'],
  spacing: ['1', '2', '3', '4', '5', '6', '7'],
  radius: ['nav', 'input', 'card', 'modal', 'chip'],
  fonts: ['heading', 'body'],
  layout: ['container', 'padDesktop', 'padTablet', 'padMobile'],
};

/** The CSS custom property each token key maps to, and how its value is formatted. */
const DECLARATIONS = {
  colors: {
    accent: ['--accent', String],
    accentDark: ['--accent-dark', String],
    ink: ['--ink', String],
    inkDark: ['--ink-dark', String],
    muted: ['--muted', String],
    line: ['--line', String],
    card: ['--card', String],
    paper: ['--paper', String],
  },
  status: {
    ok: ['--ok', String],
    info: ['--info', String],
    warn: ['--warn', String],
    bad: ['--bad', String],
  },
  type: {
    h1: ['--text-h1', rem],
    h2: ['--text-h2', rem],
    h3: ['--text-h3', rem],
    body: ['--text-body', rem],
    small: ['--text-small', rem],
    eyebrow: ['--text-eyebrow', rem],
  },
  typography: {
    headingWeight: ['--weight-heading', String],
    bodyWeight: ['--weight-body', String],
    headingLineHeight: ['--leading-heading', String],
    bodyLineHeight: ['--leading-body', String],
  },
  spacing: {
    1: ['--space-1', px],
    2: ['--space-2', px],
    3: ['--space-3', px],
    4: ['--space-4', px],
    5: ['--space-5', px],
    6: ['--space-6', px],
    7: ['--space-7', px],
  },
  radius: {
    nav: ['--radius-nav', px],
    input: ['--radius-input', px],
    card: ['--radius-card', px],
    modal: ['--radius-modal', px],
    chip: ['--radius-chip', px],
  },
  layout: {
    container: ['--container', String],
    padDesktop: ['--container-pad', px],
    padTablet: ['--container-pad-tablet', px],
    padMobile: ['--container-pad-mobile', px],
  },
};

/**
 * Compile `site/tokens.json` into the `:root` block.
 *
 * The fixed extension layer (neutral ramp, wide type/space scales, shadows) and
 * the v1 back-compat aliases are deliberate: live page CSS is written against
 * `--primary`, `--bg`, `--surface`, `--border` and `--radius-full`, and removing
 * them silently restyles every published site.
 */
export function compileTokens(input) {
  const t = withDefaults(input);
  const c = t.colors,
    s = t.status,
    ty = t.type,
    sp = t.spacing,
    r = t.radius,
    f = t.fonts;
  return `:root {
  /* Fonts — editable */
  --font-heading:"${f.heading}",system-ui,sans-serif;
  --font-body:"${f.body}",system-ui,sans-serif;

  /* Colors — editable */
  --accent:${c.accent}; --accent-dark:${c.accentDark};
  --ink:${c.ink}; --ink-dark:${c.inkDark};
  --muted:${c.muted}; --line:${c.line}; --card:${c.card}; --paper:${c.paper};

  /* Status — editable */
  --ok:${s.ok}; --info:${s.info}; --warn:${s.warn}; --bad:${s.bad};

  /* Type scale — editable */
  --text-h1:${rem(ty.h1)}; --text-h2:${rem(ty.h2)}; --text-h3:${rem(ty.h3)};
  --text-body:${rem(ty.body)}; --text-small:${rem(ty.small)}; --text-eyebrow:${rem(ty.eyebrow)};

  /* Typography — editable */
  --weight-heading:${t.typography.headingWeight}; --weight-body:${t.typography.bodyWeight};
  --leading-heading:${t.typography.headingLineHeight}; --leading-body:${t.typography.bodyLineHeight};

  /* Spacing scale — editable */
  --space-1:${px(sp['1'])}; --space-2:${px(sp['2'])}; --space-3:${px(sp['3'])};
  --space-4:${px(sp['4'])}; --space-5:${px(sp['5'])}; --space-6:${px(sp['6'])}; --space-7:${px(sp['7'])};

  /* Radius by role — editable */
  --radius-nav:${px(r.nav)}; --radius-input:${px(r.input)}; --radius-card:${px(r.card)};
  --radius-modal:${px(r.modal)}; --radius-chip:${px(r.chip)};

  /* Layout — editable */
  --container:${t.layout.container};
  --container-pad:${px(t.layout.padDesktop)}; --container-pad-tablet:${px(t.layout.padTablet)};
  --container-pad-mobile:${px(t.layout.padMobile)};

  /* ---- Fixed extension layer (not dealer-editable) ---- */
  --gray-50:#f8fafc; --gray-100:#f1f5f9; --gray-200:#e2e8f0; --gray-300:#cbd5e1; --gray-400:#94a3b8;
  --gray-500:#64748b; --gray-600:#475569; --gray-700:#334155; --gray-800:#1e293b; --gray-900:#0f172a; --gray-950:#020617;
  --space-8:64px; --space-9:80px; --space-10:96px;
  --shadow-sm:0 1px 2px rgba(15,23,42,.06); --shadow-md:0 4px 12px rgba(15,23,42,.08);
  --shadow-lg:0 12px 32px rgba(15,23,42,.10); --shadow-2xl:0 18px 50px rgba(15,23,42,.12);
  --shadow:var(--shadow-2xl);

  /* ---- Back-compat aliases (v1 vocabulary; do not author new CSS against these) ---- */
  --primary:var(--ink); --primary-dark:var(--ink-dark); --text:var(--ink);
  --bg:var(--paper); --surface:var(--card); --border:var(--line);
  --radius:var(--radius-card); --radius-full:var(--radius-chip);
}
`;
}

/**
 * Compile a scoped override — a brand page's own design system.
 *
 * A brand page restyles within the same cascade (`[data-bz-tokens="kenworth"]`)
 * rather than loading a second stylesheet, so the base tokens stay in force for
 * anything the override does not mention. An override may only set keys that
 * already exist in the base: introducing a key would defeat the fixed key set
 * that lets the editor, the AI and the build agree on the vocabulary.
 */
export function compileTokenScope(scope, override, base) {
  const lines = [];
  const unknown = [];
  for (const [group, values] of Object.entries(override || {})) {
    const decls = DECLARATIONS[group];
    if (group === 'fonts') {
      if (values.heading) lines.push(`  --font-heading:"${values.heading}",system-ui,sans-serif;`);
      if (values.body) lines.push(`  --font-body:"${values.body}",system-ui,sans-serif;`);
      continue;
    }
    if (!decls) {
      if (group !== '$schema' && group !== 'version') unknown.push(group);
      continue;
    }
    for (const [key, value] of Object.entries(values || {})) {
      const decl = decls[key];
      if (!decl) {
        unknown.push(`${group}.${key}`);
        continue;
      }
      if (base && base[group] && base[group][key] === undefined) {
        unknown.push(`${group}.${key}`);
        continue;
      }
      lines.push(`  ${decl[0]}:${decl[1](value)};`);
    }
  }
  const css = lines.length ? `[data-bz-tokens="${scope}"] {\n${lines.join('\n')}\n}\n` : '';
  return { css, unknown };
}

/* ------------------------------------------------------------------- fonts */

/* Dealers own licensed brand fonts, and a brand font is the most conspicuous
 * thing about a site — get it wrong and the design is visibly not the design,
 * whatever else is right. So `tokens.fonts.files` describes self-hosted faces
 * and this section compiles them; Google Fonts stays as the fallback for a
 * dealer who has not uploaded anything.
 *
 * Files are uploaded through the media service to R2 and referenced by URL, so
 * nothing binary lands in the git repo. */

const FONT_FORMATS = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/** CSS strings are being built by hand, so anything that could close one is out. */
const cssSafe = (value) => typeof value === 'string' && !/["'()\\;{}]|[\u0000-\u001f]/.test(value);

/** Same-origin paths and https only — a font is a request the page has to trust. */
function safeFontUrl(url) {
  if (!cssSafe(url)) return null;
  const raw = url.trim();
  if (!raw) return null;
  return /^(?:https:\/\/[\w.-]+\/|\/(?!\/))/.test(raw) ? raw : null;
}

/** `400`, or a variable-font range like `600 900`. */
function fontWeight(value) {
  if (value === undefined || value === null || value === '') return '400';
  const parts = String(value).trim().split(/\s+/).map(Number);
  if (parts.length > 2 || parts.some((n) => !Number.isFinite(n) || n < 1 || n > 1000)) return null;
  return parts.join(' ');
}

/**
 * Normalise `tokens.fonts.files` into faces this module is willing to emit.
 *
 * An entry the validators reject is dropped rather than repaired: a broken
 * `@font-face` fails silently at render time, which is far harder to diagnose
 * than a face that never appeared.
 */
export function fontFiles(input) {
  const tokens = withDefaults(input);
  const files = Array.isArray(tokens.fonts.files) ? tokens.fonts.files : [];
  const out = [];
  for (const entry of files) {
    if (!entry || typeof entry !== 'object') continue;
    const url = safeFontUrl(entry.url);
    const family = typeof entry.family === 'string' ? entry.family.trim() : '';
    if (!url || !family || !cssSafe(family)) continue;
    const weight = fontWeight(entry.weight);
    if (weight === null) continue;
    const extension = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    const format = FONT_FORMATS[extension];
    if (!format) continue;
    out.push({
      family,
      url,
      format,
      weight,
      style: entry.style === 'italic' ? 'italic' : 'normal',
      display: entry.display === 'block' || entry.display === 'optional' ? entry.display : 'swap',
    });
  }
  return out;
}

/**
 * `@font-face` rules for every self-hosted file.
 *
 * Emitted into `styles/tokens.css` rather than the document head, which means
 * the storefront picks them up automatically: it already loads
 * `/partials/tokens.css` for the dealer's chrome, so inventory pages get the
 * dealer's brand font without a second mechanism.
 */
export function fontFaceCss(input) {
  const faces = fontFiles(input);
  if (!faces.length) return '';
  return (
    faces
      .map(
        (f) =>
          `@font-face{font-family:"${f.family}";src:url("${f.url}") format("${f.format}");` +
          `font-weight:${f.weight};font-style:${f.style};font-display:${f.display};}`,
      )
      .join('\n') + '\n'
  );
}

/** Which families the self-hosted files actually provide. */
function localFamilies(input) {
  return new Set(fontFiles(input).map((f) => f.family.toLowerCase()));
}

/**
 * The faces worth preloading — the ones that render the first screen.
 *
 * Preloading everything is worse than preloading nothing: it competes with the
 * LCP image for bandwidth. Upright text weights of the heading and body
 * families only, capped at four.
 */
export function fontPreloads(input) {
  const tokens = withDefaults(input);
  const wanted = [tokens.fonts.heading, tokens.fonts.body].filter(Boolean).map((f) => f.toLowerCase());
  return fontFiles(input)
    .filter((f) => f.format === 'woff2' && f.style === 'normal' && wanted.includes(f.family.toLowerCase()))
    .filter((f) => {
      const weight = Number(String(f.weight).split(' ')[0]);
      return weight <= 700;
    })
    .slice(0, 4)
    .map((f) => f.url);
}

/**
 * Google Fonts href for any family the self-hosted files do not cover.
 *
 * Returns an empty string when nothing is needed, and the shell omits the tag
 * entirely in that case — an empty `href` would resolve to the page itself and
 * fetch the whole document a second time as a stylesheet.
 */
export function fontsHref(input) {
  const tokens = withDefaults(input);
  const local = localFamilies(input);
  const remote = [...new Set([tokens.fonts.heading, tokens.fonts.body])]
    .filter(Boolean)
    .filter((family) => !local.has(String(family).toLowerCase()));
  if (!remote.length) return '';
  const fams = remote
    .map((f) => encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;600;700;800')
    .join('&family=');
  return `https://fonts.googleapis.com/css2?family=${fams}&display=swap`;
}

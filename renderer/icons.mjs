// The storefront's icon slots, and a dealer's mapping of them onto their own icons.
//
// The inventory pages under /store are drawn by the Remix storefront, not by this
// renderer, so a brand site's icons never reach them on their own: the storefront
// draws each mark as a text character (⌕ ♡ › …). `site/icons.json` names, per
// slot, what to draw instead — a class from an icon library the site loads, or an
// image — and the build publishes it in `/partials/manifest.json`, which the
// storefront already reads for the header and footer. A slot the file does not
// name keeps the storefront's own character.
//
// The slot list is fixed, and it is the storefront's, not the dealer's: each one
// is a place the inventory pages draw a mark. A slot nobody draws would be a
// setting that does nothing. The storefront keeps its own copy of these rules
// (`app/utils/icon-map.ts`) because it reads a fetched file and cannot import
// this one; the two must agree.

export const ICONS_VERSION = 1;

/** Every place the storefront draws an icon. `glyph` is what it draws unmapped. */
export const ICON_SLOTS = [
  { id: 'search', label: 'Search', glyph: '⌕', where: 'The search field on the inventory page' },
  { id: 'save', label: 'Save', glyph: '♡', where: 'The heart on a card, Saved, and Save on a listing' },
  { id: 'saved', label: 'Saved', glyph: '♥', where: 'The heart on a card the visitor has saved' },
  { id: 'compare', label: 'Compare', glyph: '✓', where: 'The tick in a card’s compare box' },
  { id: 'close', label: 'Remove', glyph: '×', where: 'Removing one filter chip' },
  { id: 'expand', label: 'Expand', glyph: '▸', where: 'A closed filter group' },
  { id: 'collapse', label: 'Collapse', glyph: '▾', where: 'An open filter group' },
  { id: 'prev', label: 'Previous', glyph: '‹', where: 'Previous page, previous month' },
  { id: 'next', label: 'Next', glyph: '›', where: 'Next page, next month, more specs on a card' },
  { id: 'share', label: 'Share', glyph: '↗', where: 'Share on a listing' },
  { id: 'plus', label: 'Open', glyph: '+', where: 'A closed question in a listing’s FAQ' },
  { id: 'minus', label: 'Close', glyph: '−', where: 'An open question in a listing’s FAQ' },
  { id: 'arrow-left', label: 'Back arrow', glyph: '←', where: '“All categories” above the category cards' },
  { id: 'arrow-right', label: 'Arrow', glyph: '→', where: 'Between the dates of a booked rental' },
];

export const ICON_SLOT_IDS = ICON_SLOTS.map((s) => s.id);

/** At most this many icon library stylesheets. One is the normal case. */
export const MAX_ICON_STYLESHEETS = 3;

const MAX_URL = 2048;
const MAX_CLASS = 120;

/**
 * `https://` and nothing a CSS `url("…")` or an HTML attribute could be broken
 * out of with. The storefront puts an image URL inside a mask declaration, so a
 * quote, a bracket or a space is refused here rather than escaped there.
 */
export function isIconUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL) return false;
  if (!/^https:\/\/[^\s"'()<>\\`]+$/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname;
  } catch {
    return false;
  }
}

/** An image an icon can be drawn from: SVG, PNG or WebP. */
export function isIconImageUrl(value) {
  if (!isIconUrl(value)) return false;
  return /\.(svg|png|webp)$/i.test(new URL(value).pathname);
}

/** One or more class names, space separated: `fa-solid fa-magnifying-glass`. */
export function isIconClass(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CLASS &&
    /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/.test(value)
  );
}

/** The file a site starts with: nothing mapped, so every slot keeps its character. */
export function emptyIcons() {
  return { version: ICONS_VERSION, stylesheets: [], slots: {} };
}

/**
 * Read `site/icons.json`.
 *
 * Returns what is safe to publish, and a problem per thing that was dropped. An
 * entry that fails a rule is left out rather than repaired: a slot drawn from a
 * half-valid value is worse than the storefront's own character.
 *
 * @returns {{ value: { version: number, stylesheets: string[], slots: Record<string, { class: string } | { src: string, tint: boolean }> }, problems: Array<{ where: string, message: string }> }}
 */
export function parseIcons(raw) {
  const value = emptyIcons();
  const problems = [];
  if (raw == null) return { value, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push({ where: '', message: 'must be an object with "stylesheets" and "slots"' });
    return { value, problems };
  }

  const sheets = raw.stylesheets ?? [];
  if (!Array.isArray(sheets)) {
    problems.push({ where: 'stylesheets', message: 'must be a list of https:// stylesheet URLs' });
  } else {
    sheets.forEach((href, i) => {
      if (!isIconUrl(href)) {
        problems.push({ where: `stylesheets[${i}]`, message: 'is not an https:// URL' });
      } else if (value.stylesheets.length >= MAX_ICON_STYLESHEETS) {
        problems.push({ where: `stylesheets[${i}]`, message: `at most ${MAX_ICON_STYLESHEETS} stylesheets` });
      } else if (!value.stylesheets.includes(href)) {
        value.stylesheets.push(href);
      }
    });
  }

  const slots = raw.slots ?? {};
  if (typeof slots !== 'object' || Array.isArray(slots)) {
    problems.push({ where: 'slots', message: 'must be an object keyed by slot id' });
    return { value, problems };
  }
  for (const [id, entry] of Object.entries(slots)) {
    const where = `slots.${id}`;
    if (!ICON_SLOT_IDS.includes(id)) {
      problems.push({ where, message: `is not a slot the storefront draws (${ICON_SLOT_IDS.join(', ')})` });
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push({ where, message: 'must be { "class": … } or { "src": … }' });
      continue;
    }
    const hasClass = entry.class != null && entry.class !== '';
    const hasSrc = entry.src != null && entry.src !== '';
    if (hasClass === hasSrc) {
      problems.push({ where, message: 'needs exactly one of "class" or "src"' });
      continue;
    }
    if (hasClass) {
      if (!isIconClass(entry.class)) {
        problems.push({ where: `${where}.class`, message: 'may only hold class names (letters, digits, - and _)' });
        continue;
      }
      value.slots[id] = { class: entry.class };
      continue;
    }
    if (!isIconImageUrl(entry.src)) {
      problems.push({ where: `${where}.src`, message: 'must be an https:// .svg, .png or .webp' });
      continue;
    }
    if (entry.tint != null && typeof entry.tint !== 'boolean') {
      problems.push({ where: `${where}.tint`, message: 'must be true or false' });
      continue;
    }
    value.slots[id] = { src: entry.src, tint: entry.tint !== false };
  }
  return { value, problems };
}

/**
 * The manifest's `icons`: the parsed file, or null when it maps nothing.
 *
 * A stylesheet with no slot pointing into it would load an icon font on every
 * /store page for nothing, so a file that only names stylesheets publishes null.
 */
export function iconsManifest(raw) {
  const { value } = parseIcons(raw);
  if (!Object.keys(value.slots).length) return null;
  return { stylesheets: value.stylesheets, slots: value.slots };
}

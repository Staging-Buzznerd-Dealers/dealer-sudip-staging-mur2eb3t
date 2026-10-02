// Per-node style overrides — the instance layer of the cascade.
//
// The design system answers "what does this site look like"; props answer
// "which of the design system's options does this node use"; this layer answers
// "this one node, specifically, wants something else". The order is:
//
//   design tokens  →  component CSS  →  node props  →  node styles (this file)
//
// Overrides live on the node as `styles: { base, tablet, mobile }` and compile
// to CSS keyed on the node's own id — `[data-bz-node="hero"] { … }` — which
// every rendered node already carries. The renderer's markup does not change at
// all; the same compiled stylesheet serves the published build and the editor
// canvas, so an override looks identical in both.
//
// The field set is a fixed whitelist, not free CSS. Free CSS is a page the
// design system cannot reach and the AI cannot reason about; a whitelist keeps
// every consumer — the style panel, the validator, the AI contract — agreeing
// on what an override can say, exactly the way the block catalogue already
// works for props.
//
// The whitelist is wide enough to express the layered, layout-driven sections
// real design handoffs are built from: a photo behind a scrim, a scrolling rail,
// a card with a fixed aspect ratio, a two-column split that mirrors on the
// second instance. What it deliberately still refuses is anything unbounded —
// no raw CSS strings, no `position: fixed`, no unbounded z-index. Every value
// below is parsed and re-emitted, never passed through.

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Colour: a hex value, or one of the design system's surface/text tokens. */
const COLOR_TOKENS = ['accent', 'accentDark', 'ink', 'inkDark', 'muted', 'line', 'card', 'paper'];
const color = value => {
  if (typeof value !== 'string') return null;
  if (COLOR_TOKENS.includes(value)) return `var(--${value.replace(/[A-Z]/g, c => '-' + c.toLowerCase())})`;
  return HEX.test(value.trim()) ? value.trim() : null;
};

/**
 * Translucent colour — `#rrggbb` plus an alpha percentage, as `rgb(… / …%)`.
 *
 * Scrims are the reason this exists. Every hero in every handoff puts copy on
 * top of a photograph, which needs a dark translucent layer between them, and
 * `opacity` cannot do it: opacity fades the element's children too, so the
 * heading would fade with the scrim.
 */
const alphaColor = value => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(#[0-9a-f]{3}|#[0-9a-f]{6})\s*@\s*(\d{1,3})%?$/i);
  if (!match) return color(value);
  const alpha = Number(match[2]);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 100) return null;
  let hex = match[1].slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${alpha}%)`;
};

/** Length in pixels, bounded so a typo cannot push a page into absurdity. */
const px = (max = 400, min = 0) => value => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? `${Math.round(n)}px` : null;
};

/** A bare number within bounds — line-height, opacity fractions. */
const num = (min, max, transform = v => String(v)) => value => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? transform(n) : null;
};

const oneOf = options => value => (options.includes(value) ? String(value) : null);

/** Map a friendly keyword onto the CSS it means. */
const keyword = table => value => (Object.prototype.hasOwnProperty.call(table, value) ? table[value] : null);

/**
 * A length that may also be a percentage, a viewport unit, or `auto`.
 *
 * Offsets need it (`top: 100%` puts a dropdown directly below its trigger) and
 * so do full-height sections (`min-height: 100vh`). A bare number still means
 * pixels, so the common case stays a number in the editor.
 */
const len = ({ max = 400, min = 0, units = ['%'], auto = false } = {}) => value => {
  if (auto && value === 'auto') return 'auto';
  const n = Number(value);
  if (Number.isFinite(n) && value !== '' && value !== null) {
    return n >= min && n <= max ? `${Math.round(n)}px` : null;
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(-?\d{1,3}(?:\.\d+)?)(%|vh|vw|rem)$/);
  if (!match) return null;
  const unit = match[2];
  if (!units.includes(unit)) return null;
  const amount = Number(match[1]);
  const ceiling = unit === '%' || unit === 'vh' || unit === 'vw' ? 200 : 40;
  return amount >= -ceiling && amount <= ceiling ? `${amount}${unit}` : null;
};

/** `16/9`, `4/3`, `1/1` — the card and thumbnail shapes handoffs are drawn to. */
const ratio = value => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}(?:\.\d)?)\s*\/\s*(\d{1,2}(?:\.\d)?)$/);
  if (!match) return null;
  const [w, h] = [Number(match[1]), Number(match[2])];
  if (!(w > 0 && h > 0)) return null;
  return `${w} / ${h}`;
};

/**
 * An image URL for a background layer.
 *
 * Same-origin paths and https only, and the value is re-quoted on the way out,
 * so a crafted value cannot break out of the `url()` and add declarations of
 * its own. `javascript:` and `data:` are refused outright.
 */
const imageUrl = value => {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || /["'()\\]|[\u0000-\u001f]/.test(raw)) return null;
  if (!/^(?:https:\/\/[\w.-]+\/|\/(?!\/))/.test(raw)) return null;
  // `background-image` cannot play a video, and fails silently when handed one:
  // the browser treats the mp4 as a broken image and paints nothing, so the band
  // is simply empty with no error anywhere. A section plays video through its
  // `backgroundVideo` prop, which renders a real element.
  if (/\.(?:mp4|m4v|mov|webm|ogv|avi|mkv)(?:[?#]|$)/i.test(raw)) return null;
  return `url("${raw}")`;
};

/**
 * A grid column template, as a bounded token list.
 *
 * Handoffs are full of templates the 12-column span model cannot say —
 * `240px 200px 1fr` for a menu panel, `1.4fr 1fr 1fr 1fr` for a footer. Each
 * token is validated individually and the list is re-joined, so the grammar is
 * closed even though the result is expressive.
 */
const gridTemplate = value => {
  if (typeof value !== 'string') return null;
  const tokens = value.trim().split(/\s+/);
  if (!tokens.length || tokens.length > 12) return null;
  const out = [];
  for (const token of tokens) {
    if (token === 'auto' || token === 'min-content' || token === 'max-content') {
      out.push(token);
      continue;
    }
    const match = token.match(/^(\d{1,4}(?:\.\d{1,2})?)(fr|px|%)$/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!(amount >= 0) || (match[2] === 'fr' && amount > 12) || (match[2] === '%' && amount > 100)) return null;
    out.push(`${amount}${match[2]}`);
  }
  return out.join(' ');
};

const SHADOWS = { none: 'none', sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)', xl: 'var(--shadow-2xl)' };

const TRANSITIONS = {
  none: 'none',
  fast: 'all .12s ease',
  base: 'all .2s ease',
  slow: 'all .35s ease',
};

const FLEX_ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const FLEX_JUSTIFY = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

/**
 * Where a declaration lands, relative to the node's own element.
 *
 * Almost every override styles the node itself, and the doubled-attribute
 * selector in `compileNodeStyles` is enough to make it win. Two cases are not
 * reachable that way, and both used to present as "the style panel does
 * nothing":
 *
 * `CASCADE` exists because `color` is inherited, and an inherited value loses
 * to *any* rule that matches a descendant directly — specificity never enters
 * into it. blocks.css sets `color` on `.bz-lede`, `.bz-eyebrow`, `.bz-card__m`,
 * `.bz-stat__l` and a dozen more, so a text colour set on a section or a card
 * changed the wrapper and nothing a dealer could see.
 *
 * Four classes are held back from it, and each is something a page would be
 * worse for recolouring: `.bz-btn` carries its own variant colour and has the
 * fields below; `.bz-input` is a form control painted on the form's own card,
 * so white-on-dark copy would otherwise mean white-on-white typing; `.bz-req`
 * and `.bz-form__status` are the only places colour *is* the message, marking
 * a required field and an error.
 *
 * `BUTTON` exists because a button is a descendant of the block that places it.
 * The block's own `background` paints the strip behind the button and can never
 * paint the button, so without a selector that reaches `.bz-btn` there was no
 * way at all to recolour one short of editing the design system.
 */
const TARGET = {
  SELF: '',
  CASCADE: '*:not(.bz-btn, .bz-input, .bz-req, .bz-form__status)',
  BUTTON: '.bz-btn',
};

/** Emission order, so a node's own rule reads first in the compiled sheet. */
const TARGET_ORDER = [TARGET.SELF, TARGET.CASCADE, TARGET.BUTTON];

/**
 * Everything an override may set. `css` is the property emitted; `accepts`
 * normalises and validates the stored value — a value it returns null for is
 * dropped, never emitted. `group` exists so the style panel can present ~40
 * fields as a handful of collapsed sections rather than one flat wall.
 * `target` moves the declaration onto a descendant, and `cascade` repeats it on
 * one as well as the node — see `TARGET` above for why either is ever needed.
 *
 * Declaration order in this object is also *emission* order, which matters in
 * two places: `background` is a shorthand that would reset `background-image`,
 * and `hide` must be able to win against an explicit `display`.
 */
export const STYLE_FIELDS = {
  /* ---------------------------------------------------------------- layout */
  display: {
    css: 'display',
    accepts: oneOf(['block', 'flex', 'inline-flex', 'grid', 'inline-block']),
    label: 'Display',
    group: 'layout',
    options: ['block', 'flex', 'inline-flex', 'grid', 'inline-block'],
  },
  gridColumns: {
    css: 'grid-template-columns',
    accepts: gridTemplate,
    label: 'Grid columns',
    group: 'layout',
    hint: 'A column list such as 1fr 1fr, 240px 200px 1fr, or 1.4fr 1fr 1fr 1fr.',
  },
  flexDirection: {
    css: 'flex-direction',
    accepts: oneOf(['row', 'row-reverse', 'column', 'column-reverse']),
    label: 'Direction',
    group: 'layout',
    options: ['row', 'row-reverse', 'column', 'column-reverse'],
  },
  flexWrap: {
    css: 'flex-wrap',
    accepts: oneOf(['wrap', 'nowrap']),
    label: 'Wrap',
    group: 'layout',
    options: ['wrap', 'nowrap'],
  },
  alignItems: {
    css: 'align-items',
    accepts: keyword(FLEX_ALIGN),
    label: 'Align',
    group: 'layout',
    options: Object.keys(FLEX_ALIGN),
  },
  justifyContent: {
    css: 'justify-content',
    accepts: keyword(FLEX_JUSTIFY),
    label: 'Justify',
    group: 'layout',
    options: Object.keys(FLEX_JUSTIFY),
  },
  flexBasis: {
    css: 'flex-basis',
    accepts: len({ max: 1600, units: ['%', 'vw'], auto: true }),
    label: 'Basis',
    group: 'layout',
  },
  flexGrow: { css: 'flex-grow', accepts: num(0, 12), label: 'Grow', group: 'layout' },
  flexShrink: { css: 'flex-shrink', accepts: num(0, 12), label: 'Shrink', group: 'layout' },
  /**
   * Visual order without touching the tree.
   *
   * Handoffs alternate split sections — image left, then image right — and
   * mirroring by reordering children breaks reading order for a screen reader
   * and makes the mobile stack wrong. `order` per breakpoint keeps one DOM
   * order and lets each instance present differently.
   */
  order: { css: 'order', accepts: num(-12, 12), label: 'Order', group: 'layout' },
  gap: { css: 'gap', accepts: px(160), label: 'Gap', group: 'layout' },
  rowGap: { css: 'row-gap', accepts: px(160), label: 'Row gap', group: 'layout' },
  columnGap: { css: 'column-gap', accepts: px(160), label: 'Column gap', group: 'layout' },

  /* -------------------------------------------------------------- position */
  /**
   * `fixed` is absent on purpose. A fixed node is viewport-anchored, escapes
   * its section, cannot be scrolled away from, and in the editor canvas floats
   * over the tooling that would let you undo it. Sticky covers the legitimate
   * case (a header that pins), and absolute covers layering.
   */
  position: {
    css: 'position',
    accepts: oneOf(['static', 'relative', 'absolute', 'sticky']),
    label: 'Position',
    group: 'position',
    options: ['static', 'relative', 'absolute', 'sticky'],
  },
  inset: { css: 'inset', accepts: len({ max: 400, min: -400, units: ['%'] }), label: 'Inset (all sides)', group: 'position' },
  top: { css: 'top', accepts: len({ max: 2000, min: -2000, units: ['%', 'vh'], auto: true }), label: 'Top', group: 'position' },
  right: { css: 'right', accepts: len({ max: 2000, min: -2000, units: ['%', 'vw'], auto: true }), label: 'Right', group: 'position' },
  bottom: { css: 'bottom', accepts: len({ max: 2000, min: -2000, units: ['%', 'vh'], auto: true }), label: 'Bottom', group: 'position' },
  left: { css: 'left', accepts: len({ max: 2000, min: -2000, units: ['%', 'vw'], auto: true }), label: 'Left', group: 'position' },
  zIndex: { css: 'z-index', accepts: num(0, 60), label: 'Layer', group: 'position', hint: '0–60. Site chrome sits at 70 and above.' },
  overflow: {
    css: 'overflow',
    accepts: oneOf(['visible', 'hidden', 'auto', 'clip']),
    label: 'Overflow',
    group: 'position',
    options: ['visible', 'hidden', 'auto', 'clip'],
  },
  overflowX: {
    css: 'overflow-x',
    accepts: oneOf(['visible', 'hidden', 'auto', 'clip']),
    label: 'Overflow across',
    group: 'position',
    options: ['visible', 'hidden', 'auto', 'clip'],
  },
  overflowY: {
    css: 'overflow-y',
    accepts: oneOf(['visible', 'hidden', 'auto', 'clip']),
    label: 'Overflow down',
    group: 'position',
    options: ['visible', 'hidden', 'auto', 'clip'],
  },

  /* ---------------------------------------------------------------- sizing */
  width: { css: 'width', accepts: len({ max: 1920, units: ['%', 'vw'], auto: true }), label: 'Width', group: 'sizing' },
  maxWidth: { css: 'max-width', accepts: len({ max: 1920, units: ['%', 'vw'], auto: false }), label: 'Max width', group: 'sizing' },
  minHeight: { css: 'min-height', accepts: len({ max: 1600, units: ['%', 'vh'] }), label: 'Min height', group: 'sizing' },
  height: { css: 'height', accepts: len({ max: 1600, units: ['%', 'vh'], auto: true }), label: 'Height', group: 'sizing' },
  aspectRatio: {
    css: 'aspect-ratio',
    accepts: ratio,
    label: 'Aspect ratio',
    group: 'sizing',
    hint: 'Width / height, such as 16/9, 4/3 or 1/1. Keeps cards the same shape whatever the image.',
  },

  /* -------------------------------------------------------------- spacing */
  paddingTop: { css: 'padding-top', accepts: px(), label: 'Padding top', group: 'spacing' },
  paddingRight: { css: 'padding-right', accepts: px(), label: 'Padding right', group: 'spacing' },
  paddingBottom: { css: 'padding-bottom', accepts: px(), label: 'Padding bottom', group: 'spacing' },
  paddingLeft: { css: 'padding-left', accepts: px(), label: 'Padding left', group: 'spacing' },
  /**
   * Negative margins are allowed on the block axis only.
   *
   * Overlap is a real pattern — the quick-links bar that rides up over the
   * hero — and it is always vertical. Negative inline margins are how a node
   * accidentally hangs off the side of the page and causes a horizontal
   * scrollbar on a phone, so those stay non-negative.
   */
  marginTop: { css: 'margin-top', accepts: px(400, -400), label: 'Margin top', group: 'spacing' },
  marginBottom: { css: 'margin-bottom', accepts: px(400, -400), label: 'Margin bottom', group: 'spacing' },
  marginLeft: { css: 'margin-left', accepts: len({ max: 400, units: ['%'], auto: true }), label: 'Margin left', group: 'spacing' },
  marginRight: { css: 'margin-right', accepts: len({ max: 400, units: ['%'], auto: true }), label: 'Margin right', group: 'spacing' },

  /* ------------------------------------------------------------ appearance */
  background: { css: 'background', accepts: alphaColor, label: 'Background', group: 'appearance', hint: 'A colour, or #000@60% for a translucent scrim.' },
  backgroundImage: { css: 'background-image', accepts: imageUrl, label: 'Background image', group: 'appearance' },
  backgroundSize: {
    css: 'background-size',
    accepts: oneOf(['cover', 'contain', 'auto']),
    label: 'Background size',
    group: 'appearance',
    options: ['cover', 'contain', 'auto'],
  },
  backgroundPosition: {
    css: 'background-position',
    accepts: oneOf(['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right']),
    label: 'Background position',
    group: 'appearance',
    options: ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'],
  },
  backgroundRepeat: {
    css: 'background-repeat',
    accepts: oneOf(['no-repeat', 'repeat', 'repeat-x', 'repeat-y']),
    label: 'Background repeat',
    group: 'appearance',
    options: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'],
  },
  objectFit: {
    css: 'object-fit',
    accepts: oneOf(['cover', 'contain', 'fill', 'none', 'scale-down']),
    label: 'Image fit',
    group: 'appearance',
    options: ['cover', 'contain', 'fill', 'none', 'scale-down'],
  },
  objectPosition: {
    css: 'object-position',
    accepts: oneOf(['center', 'top', 'bottom', 'left', 'right']),
    label: 'Image focus',
    group: 'appearance',
    options: ['center', 'top', 'bottom', 'left', 'right'],
  },
  radius: { css: 'border-radius', accepts: px(999), label: 'Corner radius', group: 'appearance' },
  radiusTopLeft: { css: 'border-top-left-radius', accepts: px(999), label: 'Radius top left', group: 'appearance' },
  radiusTopRight: { css: 'border-top-right-radius', accepts: px(999), label: 'Radius top right', group: 'appearance' },
  radiusBottomRight: { css: 'border-bottom-right-radius', accepts: px(999), label: 'Radius bottom right', group: 'appearance' },
  radiusBottomLeft: { css: 'border-bottom-left-radius', accepts: px(999), label: 'Radius bottom left', group: 'appearance' },
  shadow: {
    css: 'box-shadow',
    accepts: value => SHADOWS[value] ?? null,
    label: 'Shadow',
    group: 'appearance',
    options: Object.keys(SHADOWS),
  },
  opacity: { css: 'opacity', accepts: num(0, 100, n => String(Math.round(n) / 100)), label: 'Opacity (%)', group: 'appearance' },

  /* --------------------------------------------------------------- borders */
  borderWidth: { css: 'border-width', accepts: px(12), label: 'Border width', group: 'border' },
  borderTopWidth: { css: 'border-top-width', accepts: px(12), label: 'Border top', group: 'border' },
  borderRightWidth: { css: 'border-right-width', accepts: px(12), label: 'Border right', group: 'border' },
  borderBottomWidth: { css: 'border-bottom-width', accepts: px(12), label: 'Border bottom', group: 'border' },
  borderLeftWidth: { css: 'border-left-width', accepts: px(12), label: 'Border left', group: 'border' },
  borderStyle: {
    css: 'border-style',
    accepts: oneOf(['solid', 'dashed', 'dotted']),
    label: 'Border style',
    group: 'border',
    options: ['solid', 'dashed', 'dotted'],
  },
  borderColor: { css: 'border-color', accepts: alphaColor, label: 'Border colour', group: 'border' },

  /* ------------------------------------------------------------ typography */
  textColor: { css: 'color', accepts: alphaColor, cascade: true, label: 'Text colour', group: 'text' },
  textAlign: { css: 'text-align', accepts: oneOf(['left', 'center', 'right']), label: 'Text align', group: 'text' },
  fontSize: { css: 'font-size', accepts: px(160, 8), label: 'Font size', group: 'text' },
  fontWeight: {
    css: 'font-weight',
    accepts: oneOf(['300', '400', '500', '600', '700', '800', '900']),
    label: 'Font weight',
    group: 'text',
    options: ['300', '400', '500', '600', '700', '800', '900'],
  },
  lineHeight: { css: 'line-height', accepts: num(0.8, 3), label: 'Line height', group: 'text' },
  letterSpacing: { css: 'letter-spacing', accepts: px(20, -3), label: 'Letter spacing', group: 'text' },
  textTransform: {
    css: 'text-transform',
    accepts: oneOf(['none', 'uppercase', 'lowercase', 'capitalize']),
    label: 'Text case',
    group: 'text',
    options: ['none', 'uppercase', 'lowercase', 'capitalize'],
  },
  whiteSpace: {
    css: 'white-space',
    accepts: oneOf(['normal', 'nowrap']),
    label: 'Wrapping',
    group: 'text',
    options: ['normal', 'nowrap'],
  },

  /* --------------------------------------------------------------- buttons */
  /**
   * The buttons inside this node, whichever block drew them.
   *
   * Deliberately not per-variant: a node holding both a primary and a secondary
   * button is asking for two colours from one field, and the honest answer to
   * that is two `buttons` blocks, not a matrix of eight fields. The variant
   * remains the right way to say "the usual primary"; these are the escape
   * hatch for the one band where it is wrong.
   *
   * A fill set here outranks the variant's `:hover` rule, so an overridden
   * button holds its colour on hover rather than reverting to the accent. That
   * is the lesser of the two surprises: the alternative is a button that turns
   * back into the colour the dealer just rejected.
   */
  buttonBackground: {
    css: 'background-color',
    target: TARGET.BUTTON,
    accepts: alphaColor,
    label: 'Button fill',
    group: 'button',
    hint: 'Applies to every button inside this node, whatever variant it uses.',
  },
  buttonTextColor: { css: 'color', target: TARGET.BUTTON, accepts: alphaColor, label: 'Button text', group: 'button' },
  buttonBorderColor: { css: 'border-color', target: TARGET.BUTTON, accepts: alphaColor, label: 'Button border', group: 'button' },
  buttonRadius: { css: 'border-radius', target: TARGET.BUTTON, accepts: px(999), label: 'Button corners', group: 'button' },

  /* ---------------------------------------------------------------- motion */
  /**
   * Transform is exposed as four separate, bounded fields rather than one CSS
   * string, and composed on the way out. A free `transform` value is an
   * arbitrary-function hole; a slider per axis is also simply a better control.
   */
  translateX: { css: 'transform', composes: true, accepts: len({ max: 400, min: -400, units: ['%'] }), label: 'Move across', group: 'motion' },
  translateY: { css: 'transform', composes: true, accepts: len({ max: 400, min: -400, units: ['%'] }), label: 'Move down', group: 'motion' },
  scale: { css: 'transform', composes: true, accepts: num(0.2, 3), label: 'Scale', group: 'motion' },
  rotate: { css: 'transform', composes: true, accepts: num(-180, 180, n => `${n}deg`), label: 'Rotate', group: 'motion' },
  transition: {
    css: 'transition',
    accepts: value => TRANSITIONS[value] ?? null,
    label: 'Transition',
    group: 'motion',
    options: Object.keys(TRANSITIONS),
  },

  /**
   * Responsive visibility. `true` compiles to display:none in that bucket —
   * the mechanism behind "hide this on mobile", and the reason a device-
   * specific ask never has to become a structural change that hits every
   * device. Emitted last so it beats an explicit `display` in the same bucket.
   */
  hide: { css: 'display', accepts: value => (value === true || value === 'true' ? 'none' : null), label: 'Hide', group: 'visibility' },
};

/** Emission order, so shorthands cannot clobber the longhands set alongside them. */
const FIELD_ORDER = Object.keys(STYLE_FIELDS);

/** The transform components, in the order they compose. */
const TRANSFORM_PARTS = [
  ['translateX', v => `translateX(${v})`],
  ['translateY', v => `translateY(${v})`],
  ['rotate', v => `rotate(${v})`],
  ['scale', v => `scale(${v})`],
];

/** Field groups in panel order, for the style inspector. */
export const STYLE_GROUPS = [
  { key: 'layout', label: 'Layout' },
  { key: 'position', label: 'Position & layering' },
  { key: 'sizing', label: 'Size' },
  { key: 'spacing', label: 'Spacing' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'border', label: 'Border' },
  { key: 'text', label: 'Text' },
  { key: 'button', label: 'Buttons' },
  { key: 'motion', label: 'Motion' },
  { key: 'visibility', label: 'Visibility' },
];

/**
 * Desktop-first buckets, the way every mainstream builder reads them: `base`
 * applies everywhere, `tablet` narrows it at 1100px and below, `mobile` again
 * at 640px and below.
 *
 * The values match the breakpoints the design handoffs are drawn to. They were
 * 1023/767 — near-miss values that put the nav collapse 77px away from where
 * the design said it should happen, which is exactly the kind of small,
 * repeated infidelity that makes an imported design feel wrong without anyone
 * being able to say why. blocks.css uses the same two numbers.
 */
export const STYLE_BUCKETS = [
  { key: 'base', media: null },
  { key: 'tablet', media: '(max-width: 1100px)' },
  { key: 'mobile', media: '(max-width: 640px)' },
];

/** Normalise whatever is stored into { base, tablet, mobile } of valid fields only. */
export function sanitizeStyles(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const bucket of STYLE_BUCKETS) {
    const values = raw[bucket.key];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    const kept = {};
    for (const [field, value] of Object.entries(values)) {
      const spec = STYLE_FIELDS[field];
      if (!spec) continue;
      if (value === null || value === undefined || value === '') continue;
      if (spec.accepts(value) !== null) kept[field] = value;
    }
    if (Object.keys(kept).length) out[bucket.key] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/** Style keys in `raw` that the whitelist does not know — for validator messages. */
export function unknownStyleKeys(raw) {
  const unknown = [];
  if (!raw || typeof raw !== 'object') return unknown;
  for (const [bucketKey, values] of Object.entries(raw)) {
    if (!STYLE_BUCKETS.some(b => b.key === bucketKey)) {
      unknown.push(bucketKey);
      continue;
    }
    for (const field of Object.keys(values ?? {})) {
      if (!STYLE_FIELDS[field]) unknown.push(`${bucketKey}.${field}`);
    }
  }
  return unknown;
}

/**
 * Compile one bucket's values into declarations, grouped by the element they
 * style — one list per entry in `TARGET`, keyed by its selector.
 *
 * Only `target` and `cascade` fields ever leave the first group, so a document
 * that sets none of them compiles to exactly the CSS it did before.
 */
function declarationsFor(values) {
  const entries = Object.entries(values ?? {})
    .filter(([field]) => STYLE_FIELDS[field])
    .sort((a, b) => FIELD_ORDER.indexOf(a[0]) - FIELD_ORDER.indexOf(b[0]));

  const byTarget = Object.fromEntries(TARGET_ORDER.map(target => [target, []]));
  const lines = byTarget[TARGET.SELF];
  const axes = {};
  let sawBorderWidth = false;
  let sawBorderStyle = false;

  for (const [field, value] of entries) {
    const spec = STYLE_FIELDS[field];
    const compiled = spec.accepts(value);
    if (compiled === null) continue;

    if (TRANSFORM_PARTS.some(([key]) => key === field)) {
      axes[field] = compiled;
      continue;
    }
    if (field === 'borderStyle') sawBorderStyle = true;
    if (spec.css.startsWith('border-') && spec.css.endsWith('-width')) sawBorderWidth = true;
    if (spec.css === 'border-width') sawBorderWidth = true;

    const declaration = `${spec.css}:${compiled}`;
    byTarget[spec.target ?? TARGET.SELF].push(declaration);
    if (spec.cascade) byTarget[TARGET.CASCADE].push(declaration);
  }

  // A border width without a style renders nothing: the element default is
  // border-style none. Setting the width implies a visible border.
  if (sawBorderWidth && !sawBorderStyle) lines.push('border-style:solid');

  // Transform functions do not commute, so the axes compose in a fixed order —
  // translate, then rotate, then scale — rather than in whatever order the
  // editor happened to write the keys. Otherwise the same four values could
  // render two different results.
  const transform = TRANSFORM_PARTS.filter(([key]) => axes[key] !== undefined).map(([key, format]) =>
    format(axes[key]),
  );
  if (transform.length) lines.push(`transform:${transform.join(' ')}`);

  return byTarget;
}

/**
 * Compile every override in a document to one stylesheet.
 *
 * Emitted per node id, in tree order, base rules first and then one media block
 * per breakpoint. The selector doubles the attribute for weight —
 * `[data-bz-node="x"][data-bz-node]` — so an instance override outranks the
 * single-attribute and single-class rules the component stylesheet uses,
 * without importants and without depending on file order. A targeted field
 * appends its descendant selector to that same prefix, which is what keeps it
 * ahead of the `.bz-lede`-style rules it exists to beat.
 */
export function compileNodeStyles(nodes) {
  const perBucket = { base: [], tablet: [], mobile: [] };
  const walk = list => {
    for (const node of list ?? []) {
      if (!node || typeof node !== 'object') continue;
      const styles = node.id ? sanitizeStyles(node.styles) : null;
      if (styles) {
        const prefix = `[data-bz-node="${node.id}"][data-bz-node]`;
        for (const bucket of STYLE_BUCKETS) {
          const byTarget = declarationsFor(styles[bucket.key]);
          for (const target of TARGET_ORDER) {
            const lines = byTarget[target];
            if (!lines.length) continue;
            const selector = target ? `${prefix} ${target}` : prefix;
            perBucket[bucket.key].push(`${selector}{${lines.join(';')}}`);
          }
        }
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(nodes);

  const parts = [...perBucket.base];
  for (const bucket of STYLE_BUCKETS) {
    if (!bucket.media || !perBucket[bucket.key].length) continue;
    parts.push(`@media ${bucket.media}{${perBucket[bucket.key].join('')}}`);
  }
  return parts.join('\n');
}

# Design System — Token Contract

The design system is a fixed set of **token keys** with **dealer-editable values**,
stored in `site/tokens.json`. You style everything through these tokens. Dealers
change values; you never add, rename or remove keys, and you never introduce a second
palette or type scale.

At build time `site/tokens.json` is compiled into CSS custom properties in
`tokens.css`. Both the static brand site and the Remix storefront load the same file,
so the whole experience stays consistent.

## Editable groups (all of `site/tokens.json`)

| Group | Keys | CSS variables |
| --- | --- | --- |
| `fonts` | `heading`, `body`, `files[]` | `--font-heading`, `--font-body` |
| `colors` | `accent`, `accentDark`, `ink`, `inkDark`, `muted`, `line`, `card`, `paper` | `--accent`, `--accent-dark`, `--ink`, `--ink-dark`, `--muted`, `--line`, `--card`, `--paper` |
| `status` | `ok`, `info`, `warn`, `bad` | `--ok`, `--info`, `--warn`, `--bad` |
| `type` | `h1`, `h2`, `h3`, `body`, `small`, `eyebrow` (px) | `--text-h1` … `--text-eyebrow` (rem) |
| `spacing` | `1`–`7` (px) | `--space-1` … `--space-7` |
| `radius` | `nav`, `input`, `card`, `modal`, `chip` (px) | `--radius-nav`, `--radius-input`, `--radius-card`, `--radius-modal`, `--radius-chip` |
| `layout` | `container` | `--container` |

## What the colors mean

- `ink` — primary dark. Headings, primary buttons, the footer.
- `accent` — the brand's highlight. Eyebrows, links on hover, emphasis.
- `paper` — page background. `card` — raised surface background.
- `line` — borders and dividers. `muted` — secondary text.
- Status colors are for state messaging only; never use them decoratively.

## Fixed extension layer (emitted by the build, not editable)

- Neutral ramp `--gray-50` … `--gray-950`
- Wide spacing `--space-8` … `--space-10`
- Shadows `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-2xl`
- Breakpoints for `@media`: sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536

## Back-compat aliases

The build also emits `--primary`, `--primary-dark`, `--text`, `--bg`, `--surface`,
`--border`, `--radius` and `--radius-full` as aliases onto the tokens above, so CSS
written against the v1 vocabulary keeps rendering. **Do not author new CSS against
them.** Use the semantic names.

## Rules

1. **Always reference tokens.** `color: var(--ink)`, `padding: var(--space-5)`,
   `font-size: var(--text-h2)`, `border-radius: var(--radius-card)`. One-off geometry
   (a specific `max-width`, an aspect ratio) is fine; brand color, type, spacing
   rhythm and radius are not.
2. **To restyle, change values, not the system.** If the dealer wants "warmer" or "a
   navy rebrand", propose new *values* and apply them once — every page updates. Do
   not scatter new colors through page CSS.
3. **Adopting an existing brand.** Map their real colors and fonts onto `ink`,
   `accent`, `muted`, `line`, `paper`, `card` and the two font families. That is how
   "match my old site" is done — through token values.
4. **Contrast is a constraint, not a preference.** Keep text/background contrast at
   WCAG AA or better when setting values.

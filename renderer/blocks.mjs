// The block library — the unit a page is composed of.
//
// A page is a list of `{ id, type, props }`. Every entry here pairs a renderer
// with a JSON Schema, and the schema is the contract three consumers depend on:
// the AI generates instances against it, the editor builds its inspector from
// it, and the save path validates against it. Adding a block means adding both
// halves in one place.
//
// Two rules hold for every block, structurally rather than by convention:
//
//  1. Interactive elements carry `data-bz-el` / `data-bz-intent`. The caller
//     never has to ask. This is what makes browser-tag certification a one-time
//     platform exercise instead of a per-dealer fix-up after every AI edit.
//  2. Blocks take `headingLevel` rather than hardcoding `<h1>`, so a page keeps
//     exactly one h1 no matter which blocks it is assembled from.

import { attrs, cls, esc, heading, href, image, isExternal, join, tagAttrs, video } from './html.mjs';
import { compileWidgets } from './custom-widgets.mjs';
import { renderForm } from './forms.mjs';
import { renderMenu } from './menus.mjs';
import { renderWidget } from './widgets.mjs';

/* ------------------------------------------------------------------ schemas */

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });

const HEADING_LEVEL = int('Heading level for this block. Keep one h1 per page.', {
  minimum: 1,
  maximum: 6,
  default: 2,
});

const ALIGN = str('Text alignment.', { enum: ['left', 'center'], default: 'left' });

const IMAGE_SCHEMA = {
  type: 'object',
  description: 'An uploaded image, referenced by public URL. Never a base64 data URI.',
  properties: {
    src: str('Public image URL from the media library.'),
    alt: str('Descriptive alternative text. Required for anything not decorative.'),
    width: int('Intrinsic width in pixels.'),
    height: int('Intrinsic height in pixels.'),
  },
  required: ['src', 'alt'],
};

/**
 * One field for both kinds of video, because the renderer can tell them apart
 * from the URL. A mode select would be a second thing to get wrong, and getting
 * it wrong is silent — a YouTube link in `<video>` renders an empty black box.
 */
const VIDEO_SCHEMA = {
  type: 'object',
  description:
    'A video: either a file uploaded to the media library (mp4/webm), or a YouTube or Vimeo ' +
    'link. Anything that is not a recognised YouTube or Vimeo URL is treated as a file.',
  properties: {
    src: str('Public video URL from the media library, or a YouTube/Vimeo page URL.'),
    poster: str(
      'Image shown before playback starts. Strongly recommended for an uploaded file: ' +
        'without it the block is a black rectangle until the visitor presses play, and the ' +
        'editing canvas has nothing to show at all. Ignored by YouTube and Vimeo, which ' +
        'bring their own.',
    ),
    title: str('Accessible title, read by screen readers and shown if the video cannot load.'),
  },
  required: ['src'],
};

/**
 * A call to action. `ctaId` points at an entry in the dealer's Buttons library
 * (`site/buttons.json`), which is how a CTA stays consistent across pages and
 * carries the tagging values the attribute panel edits. Inline label/url is the
 * fallback for a one-off.
 */
const CTA_SCHEMA = {
  type: 'object',
  description:
    'A call to action. Prefer `ctaId` referencing the dealer\'s Buttons library over an inline label/url — a library CTA keeps its label, destination and tagging consistent everywhere it appears.',
  properties: {
    ctaId: str('Id of an entry in site/buttons.json.'),
    label: str('Inline label. Overrides the library label when both are set.'),
    url: str('Inline destination. Overrides the library destination.'),
    style: str('Visual variant.', { enum: ['primary', 'secondary', 'link'] }),
    intent: str('Analytics intent, e.g. "get-quote". Defaults to the library value.'),
  },
};

const CTAS_SCHEMA = {
  type: 'array',
  description: 'Calls to action, in order.',
  items: CTA_SCHEMA,
  maxItems: 3,
};

const STATS_SCHEMA = {
  type: 'array',
  description: 'Short proof points. Keep values terse — "39 yrs", "12k+".',
  items: {
    type: 'object',
    properties: { value: str('The figure.'), label: str('What it counts.') },
    required: ['value', 'label'],
  },
};

/* ------------------------------------------------------------------ helpers */

function levelOf(props) {
  return Math.min(6, Math.max(1, Number(props.headingLevel) || 2));
}

function container(inner, extra) {
  return `<div class="${cls('bz-container', extra)}">${inner}</div>`;
}

/**
 * A post date, readable. Falls back to the raw string: a date that does not
 * parse is still the author's date, and "2024-13-45" showing verbatim is more
 * debuggable than "Invalid Date" shipping on a dealer's homepage.
 */
function formatPostDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Resolve a CTA reference against the dealer's Buttons library. An unknown
 * `ctaId` degrades to whatever inline values exist rather than rendering a
 * dead button, and records a warning so the editor can flag it.
 */
export function resolveCta(ref, ctx) {
  if (!ref) return null;
  const lib = (ctx && ctx.buttons) || {};
  const base = ref.ctaId ? lib[ref.ctaId] : null;
  if (ref.ctaId && !base && ctx && ctx.warn) {
    ctx.warn(`CTA "${ref.ctaId}" is not in site/buttons.json — rendered from inline values.`);
  }
  const label = ref.label || (base && base.label) || '';
  const url = ref.url || (base && base.url) || '';
  if (!label) return null;
  return {
    id: ref.ctaId || null,
    label,
    url,
    style: ref.style || (base && base.style) || 'primary',
    intent: ref.intent || (base && base.intent) || 'cta',
    newTab: base ? !!base.newTab : false,
    formId: (base && base.formId) || null,
  };
}

function renderCta(ref, ctx, opts = {}) {
  const cta = resolveCta(ref, ctx);
  if (!cta) return '';
  const external = isExternal(cta.url);
  // A CTA whose destination is a form opens that form rather than navigating,
  // so the Buttons library stays the single place a lead-capture entry point is
  // defined. The hydration client binds the dialog; without JS it still links.
  return `<a${attrs({
    class: cls('bz-btn', `bz-btn--${cta.style}`, opts.onDark && 'bz-btn--on-dark'),
    href: href(cta.url || (cta.formId ? `#form-${cta.formId}` : '#'), ctx),
    target: cta.newTab ? '_blank' : null,
    rel: external || cta.newTab ? 'noopener' : null,
    'data-bz-cta': cta.id,
    'data-bz-form': cta.formId,
    ...tagAttrs('cta', cta.intent),
  })}>${esc(cta.label)}</a>`;
}

function renderCtas(refs, ctx, opts = {}) {
  const html = join((refs || []).map((r) => renderCta(r, ctx, opts)), '');
  return html ? `<div class="bz-btns">${html}</div>` : '';
}

function eyebrow(text) {
  return text ? `<p class="bz-eyebrow">${esc(text)}</p>` : '';
}

function statList(stats, extra) {
  if (!stats || !stats.length) return '';
  return `<dl class="${cls('bz-stats', extra)}">${join(
    stats.map(
      (s) =>
        `<div class="bz-stat"><dt class="bz-stat__v">${esc(s.value)}</dt><dd class="bz-stat__l">${esc(
          s.label,
        )}</dd></div>`,
    ),
    '',
  )}</dl>`;
}

/* ------------------------------------------------------------------- blocks */

const BLOCKS = {
  /* ------------------------------------------------------------ layout */

  spacer: {
    label: 'Spacer',
    category: 'basic',
    schema: {
      type: 'object',
      properties: { size: int('Step on the spacing scale.', { minimum: 1, maximum: 10, default: 6 }) },
    },
    render(props) {
      const size = Math.min(10, Math.max(1, Number(props.size) || 6));
      return `<div class="bz-spacer" style="height:var(--space-${size})" aria-hidden="true"></div>`;
    },
  },

  divider: {
    label: 'Divider',
    category: 'basic',
    schema: { type: 'object', properties: {} },
    render() {
      return container('<hr class="bz-hr" />');
    },
  },

  /* ----------------------------------------------------------- content */

  heading: {
    label: 'Heading',
    category: 'basic',
    schema: {
      type: 'object',
      properties: {
        text: str('The heading text.'),
        eyebrow: str('Small label above the heading.'),
        headingLevel: HEADING_LEVEL,
        align: ALIGN,
      },
      required: ['text'],
    },
    render(props) {
      return container(
        `<div class="${cls('bz-headingblock', props.align === 'center' && 'bz-center')}">${eyebrow(
          props.eyebrow,
        )}${heading(levelOf(props), props.text)}</div>`,
      );
    },
  },

  text: {
    label: 'Text',
    category: 'basic',
    schema: {
      type: 'object',
      properties: {
        text: str(
          'Body copy. Plain paragraphs separated by a blank line; inline <strong>, <em> and <a> are allowed.',
        ),
        align: ALIGN,
        width: str('Measure.', { enum: ['prose', 'full'], default: 'prose' }),
      },
      required: ['text'],
    },
    render(props, ctx) {
      const paras = String(props.text || '')
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${inlineHtml(p, ctx)}</p>`);
      if (!paras.length) return '';
      return container(
        `<div class="${cls(
          'bz-text',
          props.width !== 'full' && 'bz-prose',
          props.align === 'center' && 'bz-center',
        )}">${join(paras, '')}</div>`,
      );
    },
  },

  image: {
    label: 'Image',
    category: 'basic',
    schema: {
      type: 'object',
      properties: {
        image: IMAGE_SCHEMA,
        caption: str('Optional caption shown under the image.'),
        width: str('How wide the image sits.', { enum: ['prose', 'full'], default: 'full' }),
        url: str('Optional: where clicking the image goes.'),
      },
      required: ['image'],
    },
    // A linked image is what a logo rail is made of, and a designed component has
    // only this block to build one from — without a url each logo was a dead end,
    // and the alternative was hand-written markup in a coded widget.
    render(props, ctx) {
      const picture = image(props.image);
      const fig = `<figure class="${cls('bz-figure', props.width === 'prose' && 'bz-prose')}">${
        props.url
          ? `<a href="${esc(href(props.url, ctx))}"${attrs(tagAttrs('link', 'image'))}>${picture}</a>`
          : picture
      }${props.caption ? `<figcaption>${esc(props.caption)}</figcaption>` : ''}</figure>`;
      return container(fig);
    },
  },

  video: {
    label: 'Video',
    category: 'basic',
    schema: {
      type: 'object',
      properties: {
        video: VIDEO_SCHEMA,
        caption: str('Optional caption shown under the video.'),
        width: str('How wide the video sits.', { enum: ['prose', 'full'], default: 'full' }),
        autoplay: bool(
          'Start on load. Forces the clip muted, because no browser autoplays audio. ' +
            'Pair with `controls` off and `loop` on for an ambient clip.',
        ),
        loop: bool('Restart when it ends.'),
        controls: bool('Show the player controls. On unless turned off.'),
      },
      required: ['video'],
    },
    /**
     * No `data-bz-el`: the tagging vocabulary has no video member, and a made-up
     * one is an element that looks instrumented and reports to nothing. Play
     * tracking is a vocabulary change, not a block change.
     */
    render(props, ctx) {
      const player = video(props.video, {
        ctx,
        autoplay: props.autoplay,
        loop: props.loop,
        controls: props.controls,
      });
      const fig = `<figure class="${cls('bz-figure', props.width === 'prose' && 'bz-prose')}">${player}${
        props.caption ? `<figcaption>${esc(props.caption)}</figcaption>` : ''
      }</figure>`;
      return container(fig);
    },
  },

  buttons: {
    label: 'Buttons',
    category: 'basic',
    schema: {
      type: 'object',
      properties: { items: CTAS_SCHEMA, align: ALIGN },
      required: ['items'],
    },
    render(props, ctx) {
      const html = renderCtas(props.items, ctx);
      if (!html) return '';
      return container(`<div class="${cls(props.align === 'center' && 'bz-center')}">${html}</div>`);
    },
  },

  list: {
    label: 'Feature list',
    category: 'basic',
    schema: {
      type: 'object',
      properties: {
        heading: str('Optional heading above the list.'),
        headingLevel: HEADING_LEVEL,
        columns: int('Columns at desktop width.', { minimum: 1, maximum: 4, default: 3 }),
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: str('Item title.'), desc: str('One or two supporting sentences.') },
            required: ['label'],
          },
        },
      },
      required: ['items'],
    },
    render(props) {
      const cols = Math.min(4, Math.max(1, Number(props.columns) || 3));
      const items = (props.items || []).map(
        (it) =>
          `<li class="bz-feature"><h${levelOf(props) + 1} class="bz-feature__t">${esc(
            it.label,
          )}</h${levelOf(props) + 1}>${
            it.desc ? `<p class="bz-feature__d">${esc(it.desc)}</p>` : ''
          }</li>`,
      );
      if (!items.length) return '';
      return container(
        `${heading(levelOf(props), props.heading)}<ul class="bz-grid bz-grid--${cols} bz-bare">${join(
          items,
          '',
        )}</ul>`,
      );
    },
  },

  customHtml: {
    label: 'Custom HTML',
    category: 'basic',
    /**
     * The escape hatch. Flagged as untagged in the registry because the platform
     * cannot vouch for analytics attributes inside markup it did not generate —
     * the editor surfaces that to the dealer and the build warns on it, so a
     * certification pilot can exclude these pages.
     */
    autoTagged: false,
    schema: {
      type: 'object',
      properties: { html: str('Raw HTML fragment. No <script>, no document shell.') },
      required: ['html'],
    },
    render(props) {
      return container(`<div class="bz-custom">${stripUnsafe(props.html)}</div>`);
    },
  },

  form: {
    label: 'Form',
    category: 'forms',
    schema: {
      type: 'object',
      properties: {
        formId: str(
          "Id of a form in the dealer's Forms library (site/forms/<id>.json). Never invent form fields inline — reference a library form so routing, consent and validation stay in one place.",
        ),
        heading: str('Optional heading above the form.'),
        headingLevel: HEADING_LEVEL,
        intro: str('One short line under the heading.'),
      },
      required: ['formId'],
    },
    render(props, ctx) {
      const form = ((ctx && ctx.forms) || {})[props.formId];
      if (!form) {
        if (ctx && ctx.warn) ctx.warn(`Form "${props.formId}" is not in site/forms/ — block skipped.`);
        return '';
      }
      return container(
        `<div class="bz-formblock">${heading(levelOf(props), props.heading)}${
          props.intro ? `<p class="bz-lede">${esc(props.intro)}</p>` : ''
        }${renderForm(form, ctx)}</div>`,
      );
    },
  },

  widget: {
    label: 'Widget',
    category: 'dynamic',
    schema: {
      type: 'object',
      properties: {
        widget: str('Widget id from the platform registry, e.g. "locations-map".'),
        config: {
          type: 'object',
          description: "Widget props, validated against that widget's own schema.",
        },
        /* Declared so the validator stops reporting the one prop that makes a
           published page correct as an unknown one it will ignore. It is written
           by the platform — the editor on save, and publish for the whole repo —
           and its shape is the widget's own, so there is nothing to check here. */
        snapshot: {
          type: 'object',
          description:
            'Data resolved by the platform and committed into the page, so the ' +
            'facts are in the static HTML. Never hand-written.',
        },
      },
      required: ['widget'],
    },
    render(props, ctx, block) {
      return renderWidget(props, ctx, block);
    },
  },

  /* ------------------------------------------------------------ chrome */
  // These are what a header or footer template is built from. They are ordinary
  // blocks, edited in the same canvas as a page, because "the header is a
  // template you edit like a page" is the whole point of the theme builder.

  logo: {
    label: 'Logo',
    category: 'navigation',
    schema: {
      type: 'object',
      properties: {
        image: IMAGE_SCHEMA,
        /* Falls back to the business name so a site with no logo uploaded yet
           still shows something a visitor can click home. */
        text: str('Shown when there is no logo image. Defaults to the business name.'),
        url: str('Where the logo links.', { default: '/' }),
        height: int('Rendered height in pixels.', { minimum: 16, maximum: 120, default: 34 }),
      },
    },
    render(props, ctx) {
      const label = props.text || (ctx && ctx.businessName) || 'Home';
      const inner =
        props.image && props.image.src
          ? image(
              { ...props.image, alt: props.image.alt || label },
              { eager: true, class: 'bz-logo__img', height: props.height || 34 },
            )
          : `<span class="bz-logo__word">${esc(label)}</span>`;
      return `<a class="bz-brand" href="${esc(href(props.url || '/', ctx))}"${attrs({
        style: props.height ? `--bz-logo-h:${Number(props.height)}px` : null,
        'data-bz-el': 'logo',
      })}>${inner}</a>`;
    },
  },

  menu: {
    label: 'Menu',
    category: 'navigation',
    schema: {
      type: 'object',
      properties: {
        menuId: str('Which menu to show, by id. Menus are managed on the Menus screen.'),
        layout: str(
          'How the menu draws. "mega" turns each top-level item with children into a ' +
            'full-width panel whose second level becomes the columns — the standard ' +
            'dealer mega nav. It needs a three-level menu: item > column heading > links.',
          { enum: ['horizontal', 'vertical', 'mega'], default: 'horizontal' },
        ),
        collapseOnMobile: bool('Collapse behind a menu button on small screens.'),
        align: str('Alignment within its column.', {
          enum: ['start', 'center', 'end'],
          default: 'start',
        }),
        depth: int('How many levels to draw. 1 hides submenus.', {
          minimum: 1,
          maximum: 3,
          default: 2,
        }),
      },
      required: ['menuId'],
    },
    render(props, ctx) {
      const html = renderMenu(ctx && ctx.menus, props.menuId, ctx);
      if (!html) {
        // A menu that has not been chosen yet is a normal state during setup, so
        // the editor shows a hint rather than nothing at all — an invisible
        // widget is indistinguishable from a broken one.
        return ctx && ctx.editing
          ? `<p class="bz-widget__empty">Pick a menu for this widget.</p>`
          : '';
      }
      const nav = `<nav class="${cls(
        'bz-menu',
        `bz-menu--${props.layout || 'horizontal'}`,
        `bz-menu--${props.align || 'start'}`,
        Number(props.depth) === 1 && 'bz-menu--flat',
      )}" aria-label="Menu">${html}</nav>`;
      if (!props.collapseOnMobile) return nav;
      return `<div class="bz-menu-wrap" data-bz-collapse>
  <button class="bz-menu-toggle" type="button" aria-expanded="false" aria-label="Menu"><span></span><span></span><span></span></button>
  ${nav}
</div>`;
    },
  },

  /* ---------------------------------------------------------- sections */

  hero: {
    label: 'Hero (full-bleed)',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        eyebrow: str('Small label above the headline.'),
        headline: str('The page promise, one line.'),
        subhead: str('Two sentences at most.'),
        ctas: CTAS_SCHEMA,
        image: IMAGE_SCHEMA,
        showSearch: bool('Show the inventory search bar.'),
        headingLevel: HEADING_LEVEL,
      },
      required: ['headline'],
    },
    render(props, ctx) {
      const search = props.showSearch
        ? `<form class="bz-herosearch" action="/${
            (ctx && ctx.storefrontPrefix) || 'store'
          }/search" method="get" role="search"${attrs(tagAttrs('form', 'inventory-search'))}>
  <label class="bz-herosearch__l" for="bz-hero-q">Search inventory</label>
  <input class="bz-input" id="bz-hero-q" name="q" type="search" placeholder="Search inventory…" />
  <button class="bz-btn bz-btn--primary" type="submit"${attrs(
    tagAttrs('cta', 'inventory-search'),
  )}>Search</button>
</form>`
        : '';
      return `<div class="bz-hero__bg">${
        props.image && props.image.src
          ? image(props.image, { eager: true, class: 'bz-hero__img' })
          : ''
      }</div>${container(
        `<div class="bz-hero__copy">${eyebrow(props.eyebrow)}${heading(
          levelOf(props),
          props.headline,
          { class: 'bz-hero__h' },
        )}${props.subhead ? `<p class="bz-hero__sub">${esc(props.subhead)}</p>` : ''}${renderCtas(
          props.ctas,
          ctx,
          { onDark: true },
        )}${search}</div>`,
      )}`;
    },
  },

  splitHero: {
    label: 'Split hero (photo)',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        badge: str('Short credibility line, e.g. "Manufacturer-direct since 1987".'),
        headline: str('The page promise, one line.'),
        subhead: str('Two sentences at most.'),
        ctas: CTAS_SCHEMA,
        stats: STATS_SCHEMA,
        image: IMAGE_SCHEMA,
        headingLevel: HEADING_LEVEL,
      },
      required: ['headline'],
    },
    render(props, ctx) {
      return container(
        `<div class="bz-split">
  <div class="bz-split__copy">${
    props.badge ? `<p class="bz-badge">${esc(props.badge)}</p>` : ''
  }${heading(levelOf(props), props.headline)}${
          props.subhead ? `<p class="bz-lede">${esc(props.subhead)}</p>` : ''
        }${renderCtas(props.ctas, ctx)}${statList(props.stats, 'bz-stats--inline')}</div>
  <div class="bz-split__media">${image(props.image, { eager: true, placeholder: 'Product photo' })}</div>
</div>`,
      );
    },
  },

  iconGrid: {
    label: 'Quick links',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        heading: str('Optional heading.'),
        headingLevel: HEADING_LEVEL,
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: str('Shortcut title.'),
              desc: str('One sentence.'),
              url: str('Destination.'),
            },
            required: ['label'],
          },
        },
      },
      required: ['items'],
    },
    render(props, ctx) {
      const items = (props.items || []).slice(0, 4);
      if (!items.length) return '';
      const cells = items.map((it) => {
        const inner = `<h${levelOf(props) + 1} class="bz-quick__t">${esc(it.label)}</h${
          levelOf(props) + 1
        }>${it.desc ? `<p class="bz-quick__d">${esc(it.desc)}</p>` : ''}`;
        return it.url
          ? `<a class="bz-quick" href="${esc(href(it.url, ctx))}"${attrs(
              tagAttrs('link', 'quick-link'),
            )}>${inner}</a>`
          : `<div class="bz-quick">${inner}</div>`;
      });
      return container(
        `${heading(levelOf(props), props.heading)}<div class="bz-grid bz-grid--${items.length}">${join(
          cells,
          '',
        )}</div>`,
      );
    },
  },

  categoryGrid: {
    label: 'Category grid',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        heading: str('Optional heading.'),
        headingLevel: HEADING_LEVEL,
        cta: CTA_SCHEMA,
        items: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              label: str('Card title.'),
              meta: str('Second line, e.g. "New · $24,900".'),
              url: str('Destination.'),
              image: IMAGE_SCHEMA,
            },
            required: ['label'],
          },
        },
      },
      required: ['items'],
    },
    render(props, ctx) {
      const items = props.items || [];
      if (!items.length) return '';
      const cols = Math.min(4, items.length);
      const cards = items.map((it) => {
        const inner = `${image(it.image, { placeholder: 'Photo' })}<div class="bz-card__body"><span class="bz-card__t">${esc(
          it.label,
        )}</span>${it.meta ? `<span class="bz-card__m">${esc(it.meta)}</span>` : ''}</div>`;
        return it.url
          ? `<a class="bz-card" href="${esc(href(it.url, ctx))}"${attrs(
              tagAttrs('link', 'view-listing'),
            )}>${inner}</a>`
          : `<div class="bz-card">${inner}</div>`;
      });
      return container(
        `<div class="bz-sechead">${heading(levelOf(props), props.heading)}${renderCtas(
          props.cta ? [props.cta] : [],
          ctx,
        )}</div><div class="bz-grid bz-grid--${cols}">${join(cards, '')}</div>`,
      );
    },
  },

  statBand: {
    label: 'Stat band',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        heading: str('The claim.'),
        body: str('Two sentences supporting it.'),
        ctas: CTAS_SCHEMA,
        stats: STATS_SCHEMA,
        headingLevel: HEADING_LEVEL,
      },
      required: ['stats'],
    },
    render(props, ctx) {
      return container(
        `<div class="bz-band">
  <div>${heading(levelOf(props), props.heading)}${
          props.body ? `<p class="bz-band__b">${esc(props.body)}</p>` : ''
        }${renderCtas(props.ctas, ctx, { onDark: true })}</div>
  ${statList(props.stats)}
</div>`,
      );
    },
  },

  serviceGrid: {
    label: 'Service grid',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        heading: str('Section heading.'),
        body: str('One or two sentences.'),
        headingLevel: HEADING_LEVEL,
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: str('Service name.'),
              desc: str('What it covers.'),
              cta: CTA_SCHEMA,
            },
            required: ['label'],
          },
        },
      },
      required: ['items'],
    },
    render(props, ctx) {
      const items = (props.items || []).slice(0, 4);
      if (!items.length) return '';
      const cards = items.map(
        (it) =>
          `<div class="bz-service"><h${levelOf(props) + 1} class="bz-service__t">${esc(
            it.label,
          )}</h${levelOf(props) + 1}>${
            it.desc ? `<p class="bz-service__d">${esc(it.desc)}</p>` : ''
          }${renderCta(it.cta, ctx, { onDark: true })}</div>`,
      );
      return container(
        `${heading(levelOf(props), props.heading)}${
          props.body ? `<p class="bz-lede bz-lede--on-dark">${esc(props.body)}</p>` : ''
        }<div class="bz-grid bz-grid--${items.length}">${join(cards, '')}</div>`,
      );
    },
  },

  testimonials: {
    label: 'Testimonials',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        heading: str('Section heading.'),
        headingLevel: HEADING_LEVEL,
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              quote: str('The customer\'s words. Never fabricate a review.'),
              name: str('Who said it.'),
              role: str('Their context, e.g. "Owner-operator".'),
              rating: int('Stars out of five.', { minimum: 1, maximum: 5 }),
            },
            required: ['quote', 'name'],
          },
        },
      },
      required: ['items'],
    },
    render(props) {
      const items = props.items || [];
      if (!items.length) return '';
      const cards = items.map(
        (it) =>
          `<figure class="bz-quote">${stars(it.rating)}<blockquote>${esc(
            it.quote,
          )}</blockquote><figcaption><span class="bz-quote__n">${esc(it.name)}</span>${
            it.role ? `<span class="bz-quote__r">${esc(it.role)}</span>` : ''
          }</figcaption></figure>`,
      );
      return container(
        `${heading(levelOf(props), props.heading)}<div class="bz-grid bz-grid--${Math.min(
          3,
          items.length,
        )}">${join(cards, '')}</div>`,
      );
    },
  },

  logoStrip: {
    label: 'Logo strip',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        heading: str('Optional label, e.g. "Brands we carry".'),
        headingLevel: HEADING_LEVEL,
        logos: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: str('Brand name.'), image: IMAGE_SCHEMA, url: str('Brand page.') },
            required: ['name'],
          },
        },
      },
      required: ['logos'],
    },
    render(props, ctx) {
      const logos = props.logos || [];
      if (!logos.length) return '';
      const cells = logos.map((l) => {
        const inner =
          l.image && l.image.src
            ? image({ ...l.image, alt: l.image.alt || l.name }, { width: 160, height: 48 })
            : `<span class="bz-logo__t">${esc(l.name)}</span>`;
        return l.url
          ? `<a class="bz-logo" href="${esc(href(l.url, ctx))}"${attrs(
              tagAttrs('link', 'brand'),
            )}>${inner}</a>`
          : `<div class="bz-logo">${inner}</div>`;
      });
      return container(
        `${props.heading ? `<p class="bz-eyebrow bz-center">${esc(props.heading)}</p>` : ''}<div class="bz-logos">${join(
          cells,
          '',
        )}</div>`,
      );
    },
  },

  /**
   * The latest blog posts, from the site's own blog — never typed in.
   *
   * Both reference handoffs carry an insights/blog teaser, and without this
   * block every dealer hand-maintains a `categoryGrid` of post cards that goes
   * stale the day the next post publishes. The list resolves at build time from
   * `ctx.posts` (the same set `build.mjs` renders the blog from), so publishing
   * a post updates every teaser on the site in the same build.
   */
  postsList: {
    label: 'Latest posts',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        heading: str('Optional heading, e.g. "News & insights".'),
        headingLevel: HEADING_LEVEL,
        count: int('How many recent posts to show.', { minimum: 1, maximum: 6, default: 3 }),
        showDates: { type: 'boolean', description: 'Show each post’s date.', default: true },
        cta: CTA_SCHEMA,
      },
    },
    render(props, ctx) {
      const base = ctx.blogBasePath || '/blog';
      const count = Math.min(6, Math.max(1, Number(props.count) || 3));
      let posts = (Array.isArray(ctx.posts) ? ctx.posts : [])
        .filter((p) => p && p.slug && p.title && (p.status ?? 'published') === 'published')
        .slice(0, count);
      // The editor must show the shape even before the first post exists; a
      // build with no posts renders nothing rather than an empty band.
      if (!posts.length) {
        if (!ctx.editing) return '';
        posts = Array.from({ length: count }, (_, i) => ({
          slug: '',
          title: `Post title ${i + 1}`,
          description: 'A sentence of the post, shown once a real post is published.',
          date: '',
          coverImage: null,
        }));
      }
      const cards = posts.map((post) => {
        const body =
          `${image(post.coverImage ? { src: post.coverImage, alt: post.title } : null, { placeholder: 'Cover' })}` +
          `<div class="bz-card__body">${
            props.showDates !== false && post.date
              ? `<span class="bz-card__m">${esc(formatPostDate(post.date))}</span>`
              : ''
          }<span class="bz-card__t">${esc(post.title)}</span>${
            post.description ? `<span class="bz-post__d">${esc(post.description)}</span>` : ''
          }</div>`;
        return post.slug
          ? `<a class="bz-card bz-post" href="${esc(href(`${base}/${post.slug}`, ctx))}"${attrs(
              tagAttrs('link', 'read-post'),
            )}>${body}</a>`
          : `<div class="bz-card bz-post">${body}</div>`;
      });
      return container(
        `<div class="bz-sechead">${heading(levelOf(props), props.heading)}${renderCtas(
          props.cta ? [props.cta] : [],
          ctx,
        )}</div><div class="bz-grid bz-grid--${Math.min(3, posts.length)}">${join(cards, '')}</div>`,
      );
    },
  },

  locationsMap: {
    label: 'Locations + map',
    category: 'prebuilt',
    /**
     * The static half is authored; the map half is a widget, because a dealer's
     * locations are platform data and must not be re-typed here. Leave
     * `locations` empty and the Locations widget fills the list at hydration.
     */
    schema: {
      type: 'object',
      properties: {
        heading: str('Section heading.'),
        mapHeading: str('Heading over the map column.'),
        headingLevel: HEADING_LEVEL,
        useLiveLocations: bool(
          "Pull locations from the dealer's Locations module instead of the list below. Prefer this — a hand-typed list goes stale the day a location is added.",
        ),
        locations: {
          type: 'array',
          description: 'Only used when useLiveLocations is false.',
          items: {
            type: 'object',
            properties: {
              city: str('City and region.'),
              services: str('What the site offers, e.g. "Sales · Service · Parts".'),
              url: str('Location page.'),
            },
            required: ['city'],
          },
        },
        testimonial: {
          type: 'object',
          properties: { quote: str('Quote.'), name: str('Name.'), role: str('Role.') },
        },
      },
    },
    render(props, ctx, block) {
      const left = `<div>${heading(levelOf(props), props.heading)}${
        props.testimonial && props.testimonial.quote
          ? `<figure class="bz-quote">${stars(5)}<blockquote>${esc(
              props.testimonial.quote,
            )}</blockquote><figcaption><span class="bz-quote__n">${esc(
              props.testimonial.name || '',
            )}</span>${
              props.testimonial.role
                ? `<span class="bz-quote__r">${esc(props.testimonial.role)}</span>`
                : ''
            }</figcaption></figure>`
          : ''
      }</div>`;
      const right = props.useLiveLocations
        ? renderWidget(
            { widget: 'locations-map', config: { heading: props.mapHeading, showMap: true } },
            ctx,
            block,
          )
        : `<div>${heading(levelOf(props) + 1, props.mapHeading)}<ul class="bz-loclist bz-bare">${join(
            (props.locations || []).map(
              (l) =>
                `<li class="bz-loc">${
                  l.url
                    ? `<a href="${esc(href(l.url, ctx))}"${attrs(
                        tagAttrs('link', 'location'),
                      )}><span class="bz-loc__c">${esc(l.city)}</span></a>`
                    : `<span class="bz-loc__c">${esc(l.city)}</span>`
                }${l.services ? `<span class="bz-loc__s">${esc(l.services)}</span>` : ''}</li>`,
            ),
            '',
          )}</ul></div>`;
      return container(`<div class="bz-split">${left}${right}</div>`);
    },
  },

  footer: {
    label: 'Storefront footer',
    category: 'prebuilt',
    schema: {
      type: 'object',
      properties: {
        tagline: str('One line about the business.'),
        legal: str('Copyright / legal line.'),
        columns: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              heading: str('Column heading.'),
              links: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: str('Link text.'), url: str('Destination.') },
                  required: ['label', 'url'],
                },
              },
            },
            required: ['heading', 'links'],
          },
        },
      },
    },
    render(props, ctx) {
      const cols = (props.columns || []).map(
        (c) =>
          `<div class="bz-fcol"><p class="bz-fcol__h">${esc(c.heading)}</p><ul class="bz-bare">${join(
            (c.links || []).map(
              (l) =>
                `<li><a href="${esc(href(l.url, ctx))}"${attrs(
                  tagAttrs('link', 'footer-nav'),
                )}>${esc(l.label)}</a></li>`,
            ),
            '',
          )}</ul></div>`,
      );
      return container(
        `<div class="bz-footerblock"><div class="bz-fbrand"><p class="bz-fbrand__n">${esc(
          (ctx && ctx.businessName) || '',
        )}</p>${props.tagline ? `<p class="bz-fbrand__t">${esc(props.tagline)}</p>` : ''}</div>${join(
          cols,
          '',
        )}</div>${props.legal ? `<p class="bz-flegal">${esc(props.legal)}</p>` : ''}`,
      );
    },
  },
};

/* -------------------------------------------------------------- small parts */

function stars(rating) {
  const n = Math.min(5, Math.max(1, Number(rating) || 5));
  return `<p class="bz-stars" aria-label="${n} out of 5">${'★'.repeat(n)}</p>`;
}

/**
 * Allow the small inline vocabulary a text block needs and drop everything
 * else. Text blocks come from the AI and from paste, so a permissive path here
 * would be the one hole in the sanitizer the plugin applies on the way in.
 */
const INLINE_ALLOWED = /^<\/?(?:strong|b|em|i|br|a|small)(?:\s[^<>]*)?>$/i;

function inlineHtml(text, ctx) {
  return String(text).replace(/<[^>]*>|[&<>]/g, (m) => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (!INLINE_ALLOWED.test(m)) return '';
    if (/^<a\s/i.test(m)) {
      const url = (m.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1] || '#';
      return `<a href="${esc(href(url, ctx))}"${
        isExternal(url) ? ' rel="noopener"' : ''
      }${attrs(tagAttrs('link', 'body-link'))}>`;
    }
    return m.toLowerCase();
  });
}

/** Strip the document shell, scripts and inline handlers from a custom fragment. */
function stripUnsafe(html) {
  return String(html || '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/* ----------------------------------------------------------------- registry */

/**
 * Widget groups, in palette order.
 *
 * These replaced `category`, which had come to mean two different things at
 * once: where a block was allowed to sit (`section` meant top-level only) and
 * what kind of thing it was. Placement is the layout system's job now — `accepts`
 * in nodes.mjs answers it for every type — so a group here is only ever a label
 * on a palette drawer.
 */
export const WIDGET_GROUPS = [
  { id: 'basic', label: 'Basic' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'forms', label: 'Forms' },
  { id: 'dynamic', label: 'Dealer data' },
  { id: 'prebuilt', label: 'Prebuilt sections' },
  { id: 'custom', label: 'This site' },
];

/**
 * The platform widget registry: id → { render, schema, label, group, autoTagged }.
 * `autoTagged` is false only for `customHtml`; the editor marks those and the
 * build warns, because the platform cannot vouch for their tagging.
 */
export const blockRegistry = Object.fromEntries(
  Object.entries(BLOCKS).map(([id, def]) => [
    id,
    {
      id,
      label: def.label,
      category: def.category,
      group: def.category,
      autoTagged: def.autoTagged !== false,
      schema: def.schema,
      render: def.render,
    },
  ]),
);

/** Every widget id the platform ships. */
export function widgetIds() {
  return Object.keys(blockRegistry);
}

/* ------------------------------------------------- custom widget registry */

/**
 * Widgets the dealer's own repo defines, registered at runtime.
 *
 * The built-in library above is fixed at build time; this is not. A dealer site
 * carries `site/widgets/*.json`, and whoever is rendering — the static build, the
 * editor canvas — registers them before rendering anything. From that moment they
 * are ordinary blocks: `getBlock` finds them, the catalogue lists them, the
 * validator checks them against their generated schema, and `renderPage` renders
 * them through the same path.
 *
 * A module-level map is the right scope for both callers. `build.mjs` is one
 * process per site, and the dashboard holds one site at a time; `registerCustomWidgets`
 * replaces the whole set rather than merging, so switching sites cannot leave a
 * previous dealer's widget registered.
 */
const customRegistry = new Map();

/**
 * Replace the custom widget set. Definitions that do not compile are skipped with
 * a warning rather than throwing — one bad widget must not take a site's build
 * down, and the page that uses it degrades to a warning and no output.
 */
export function registerCustomWidgets(definitions, warn) {
  customRegistry.clear();
  for (const widget of compileWidgets(definitions, warn)) {
    if (blockRegistry[widget.id]) {
      if (warn) warn(`Custom widget "${widget.id}" shadows a built-in block and was skipped.`);
      continue;
    }
    customRegistry.set(widget.id, widget);
  }
  return [...customRegistry.keys()];
}

export function clearCustomWidgets() {
  customRegistry.clear();
}

/** The compiled custom widgets, in label order. */
export function customWidgets() {
  return [...customRegistry.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Every registered custom widget's CSS, already scoped to its own block class.
 * Emitted once per site rather than per instance.
 */
export function customWidgetCss() {
  return customWidgets()
    .map((w) => w.css)
    .filter(Boolean)
    .join('\n');
}

/** Starting props for a block type, built-in or custom. */
export function defaultPropsFor(type) {
  const custom = customRegistry.get(type);
  return custom ? JSON.parse(JSON.stringify(custom.defaults)) : {};
}

export function getBlock(type) {
  return blockRegistry[type] || customRegistry.get(type) || null;
}

/** Every placeable widget id — platform and this site's own. */
export function allWidgetIds() {
  return [...Object.keys(blockRegistry), ...customWidgets().map((w) => w.id)];
}

/** Machine-readable widget catalogue for the AI contract and the inspector. */
export function blockCatalogue() {
  const builtIn = Object.values(blockRegistry).map((b) => ({
    id: b.id,
    label: b.label,
    category: b.category,
    group: b.group,
    autoTagged: b.autoTagged,
    schema: b.schema,
  }));
  const custom = customWidgets().map((w) => ({
    id: w.id,
    label: w.label,
    description: w.description,
    // Grouped under "This site" in the palette. Placement is not a property of a
    // widget any more — the layout system decides where a widget may go, and the
    // answer is the same for every one of them.
    category: 'custom',
    group: 'custom',
    custom: true,
    origin: w.origin,
    autoTagged: w.autoTagged,
    schema: w.schema,
  }));
  return [...builtIn, ...custom];
}

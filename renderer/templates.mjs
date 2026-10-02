// Templates: a reusable layout, and the rules that decide where it applies.
//
// A template is a document like any other — the same node tree a page is — with
// one extra requirement: somewhere in it sits a `contentArea` node, and that is
// where the page's own content is injected. Everything else about it is free.
// Header, hero, sidebar, related products, footer, in whatever arrangement the
// dealer builds.
//
// This replaces a model with two fixed slots, `header` and `footer`, and a
// page rendered blindly between them. That could not express a sidebar, could
// not put a hero above the content, and gave the dealer no way to see where
// their page content would land — the content area was an implicit gap between
// two fragments rather than a thing on the canvas.
//
// Display conditions follow the pattern every builder uses, because it is the
// one people already know: a template declares what it applies to, the most
// specific declaration wins, and the winner is reported so "why is this template
// here" has an answer that does not require reading four files.

import { locateNode, parseDocument } from './nodes.mjs';

export const TEMPLATE_VERSION = 2;

/**
 * The kinds of thing a template can be attached to.
 *
 * Adding one is an entry here plus a case in `conditionMatches`. Deliberately
 * not a hardcoded list of special pages: a home page is a page, and a template
 * for it is `{ type: 'page', ref: 'home' }` like any other. Special-casing the
 * home page would be a second mechanism doing what this one already does.
 */
export const CONDITION_TYPES = [
  {
    id: 'entireSite',
    label: 'Entire site',
    description: 'Every page and post, unless something more specific matches.',
    ref: null,
    specificity: 100,
  },
  { id: 'allPages', label: 'All pages', description: 'Every page.', ref: null, specificity: 200 },
  {
    id: 'allPosts',
    label: 'All posts',
    description: 'Each individual blog post page — not the list of posts.',
    ref: null,
    specificity: 200,
  },
  {
    id: 'blog',
    label: 'Blog index',
    description: 'Only the page that lists your posts (/blog) — individual posts are "All posts".',
    ref: null,
    specificity: 300,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    description: 'Live inventory browse and detail pages, and the parts catalogue.',
    ref: null,
    specificity: 300,
  },
  {
    id: 'parts',
    label: 'Parts',
    description: 'The parts catalogue only. Without this, parts pages use the Inventory template.',
    ref: null,
    specificity: 350,
  },
  {
    id: 'allLocations',
    label: 'Location pages',
    description:
      'Every page built from the one-page-per-location template. Generated slugs do not exist until a location does, so a specific-page condition cannot reach them.',
    ref: null,
    specificity: 300,
  },
  {
    id: 'pageGroup',
    label: 'A group of pages',
    description: 'Every page tagged with one group.',
    ref: 'group',
    specificity: 400,
  },
  { id: 'page', label: 'A specific page', description: '', ref: 'page', specificity: 500 },
  { id: 'post', label: 'A specific post', description: '', ref: 'post', specificity: 500 },
  {
    id: 'location',
    label: 'One location’s page',
    description: 'The generated page for a single location, by its slug.',
    ref: 'location',
    specificity: 500,
  },
];

const BY_ID = new Map(CONDITION_TYPES.map(c => [c.id, c]));

/** What a target looks like: `{ kind, slug, group }`. */
export function conditionMatches(condition, target) {
  if (!condition || !condition.type) return false;
  const kind = target.kind || 'page';

  switch (condition.type) {
    case 'entireSite':
      return true;
    case 'allPages':
      // Location pages count: to a dealer they are pages, and a site whose only
      // template is "all pages" must still put chrome round them.
      return kind === 'page' || kind === 'location';
    case 'allLocations':
      return kind === 'location';
    case 'allPosts':
      return kind === 'post';
    case 'blog':
      return kind === 'blog';
    case 'inventory':
      // The whole storefront, parts included. A site that has only an Inventory
      // template must keep covering its parts pages; `parts` is the finer opt-in
      // for dealers who want that catalogue framed differently.
      return kind === 'inventory' || kind === 'parts';
    case 'parts':
      return kind === 'parts';
    case 'pageGroup':
      return (
        (kind === 'page' || kind === 'location') &&
        !!target.group &&
        target.group === condition.ref
      );
    case 'page':
      return kind === 'page' && target.slug === condition.ref;
    case 'post':
      return kind === 'post' && target.slug === condition.ref;
    case 'location':
      return kind === 'location' && target.location === condition.ref;
    default:
      return false;
  }
}

/** A sentence a dealer can read on the template card. */
export function describeCondition(condition, names = {}) {
  const type = BY_ID.get(condition?.type);
  if (!type) return String(condition?.type ?? 'unknown');
  if (!type.ref) return type.label;
  const name = names[condition.ref] ?? condition.ref;
  return `${type.label}: ${name}`;
}

/* ------------------------------------------------------------------ parse */

function slugFromPath(path) {
  const base = String(path || '').split('/').pop() || '';
  return base.replace(/\.json$/, '');
}

/**
 * Normalise one template file.
 *
 * Recognises the v1 slot fragments (`{ slot: 'header' | 'footer', blocks }`) and
 * marks them, so `parseTemplates` can fold a header/footer pair into one real
 * template rather than leaving a repo with two halves and no whole.
 */
export function parseTemplate(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || fallbackId || '').trim();
  if (!id) return null;

  const legacySlot = raw.slot === 'header' || raw.slot === 'footer' ? raw.slot : null;
  const document = parseDocument(raw);

  return {
    version: TEMPLATE_VERSION,
    id,
    name: String(raw.name || id),
    conditions: normaliseConditions(raw.conditions),
    nodes: document.nodes,
    // The template's own custom CSS and JS, carried to every page that uses it.
    // Chrome is where a sticky header or a mega menu lives, so a template is the
    // surface most likely to want a script of its own.
    css: typeof raw.css === 'string' ? raw.css : '',
    js: typeof raw.js === 'string' ? raw.js : '',
    legacySlot,
  };
}

function normaliseConditions(raw) {
  const out = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || !BY_ID.has(entry.type)) continue;
    const type = BY_ID.get(entry.type);
    out.push({ type: entry.type, ref: type.ref ? String(entry.ref ?? '') : null });
  }
  return out;
}

/**
 * Read every template file into a usable set.
 *
 * The migration matters more than it looks. A repo written under the slot model
 * has `header--default.json` and `footer--default.json` and nothing that knows
 * they belong together. Left alone, such a site would open in the new editor
 * with two templates, neither of which has a content area, and the dealer's
 * pages would render with no chrome at all. So the halves are composed into one
 * template — header nodes, a content area, footer nodes — which is exactly what
 * the site was already rendering, now as something that can be edited.
 */
export function parseTemplates(files) {
  const parsed = [];
  for (const [path, raw] of Object.entries(files || {})) {
    const template = parseTemplate(raw, slugFromPath(path));
    if (template) parsed.push(template);
  }

  const modern = parsed.filter(t => !t.legacySlot);
  const legacy = parsed.filter(t => t.legacySlot);
  if (!legacy.length) return modern;

  const header = legacy.find(t => t.legacySlot === 'header');
  const footer = legacy.find(t => t.legacySlot === 'footer');
  const composed = {
    version: TEMPLATE_VERSION,
    id: 'default',
    name: 'Site template',
    conditions: [{ type: 'entireSite', ref: null }],
    nodes: [
      ...(header ? header.nodes : []),
      { id: 'content', type: 'contentArea', props: { label: 'Page content' } },
      ...(footer ? footer.nodes : []),
    ],
    legacySlot: null,
    migratedFrom: legacy.map(t => t.id),
  };

  // A modern template already named `default` wins: the dealer has edited it,
  // and re-composing the fragments it replaced would undo that on every load.
  return modern.some(t => t.id === 'default') ? modern : [...modern, composed];
}

/* --------------------------------------------------------------- resolve */

/**
 * Which template applies to one target.
 *
 * Returns the winner, the condition that won, and any conflict — two equally
 * specific conditions naming different templates. Reported rather than silently
 * picked, because a silent pick is unexplainable a month later.
 */
export function resolveTemplate(target, templates) {
  const matches = [];
  for (const template of templates || []) {
    for (const condition of template.conditions || []) {
      if (!conditionMatches(condition, target)) continue;
      matches.push({
        template,
        condition,
        weight: BY_ID.get(condition.type)?.specificity ?? 0,
      });
    }
  }
  if (!matches.length) return { template: null, condition: null, label: 'no template', conflict: null };

  // Specific beats broad (page > group > blog/inventory > all pages/posts >
  // entire site) — the hierarchy every theme builder trains people on. Equal
  // specificity is a real conflict two templates cannot both win; the tie is
  // broken deterministically by template id so a rebuild never flips the site,
  // and reported so the Templates screen can show it instead of hiding it.
  matches.sort((a, b) => b.weight - a.weight || a.template.id.localeCompare(b.template.id));
  const top = matches[0];
  const tied = matches.filter(m => m.weight === top.weight && m.template.id !== top.template.id);

  return {
    template: top.template,
    condition: top.condition,
    label: describeCondition(top.condition),
    conflict: tied.length
      ? `${tied.length + 1} equally specific conditions name different templates (${[
          top.template.name,
          ...tied.map(t => t.template.name),
        ].join(', ')})`
      : null,
  };
}

/* --------------------------------------------------------------- compose */

/** Where the content area sits, if it does. */
export function findContentArea(nodes) {
  let found = null;
  const step = (list, parent) => {
    for (const node of list || []) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'contentArea' && !found) found = { node, parent };
      if (Array.isArray(node.children)) step(node.children, node);
    }
  };
  step(nodes, null);
  return found;
}

export function hasContentArea(nodes) {
  return !!findContentArea(nodes);
}

/**
 * The template with the page's own nodes in place of its content area.
 *
 * A template with no content area still renders — with the page appended, which
 * is the least surprising fallback and matches what the slot model did. The
 * editor refuses to save a template without one, so this path is only reached by
 * a file edited outside the builder.
 */
export function composeDocument(templateNodes, pageNodes, opts = {}) {
  const nodes = JSON.parse(JSON.stringify(templateNodes || []));
  const content = JSON.parse(JSON.stringify(pageNodes || []));

  const replaced = substitute(nodes, content, opts);
  if (replaced) return nodes;

  if (opts.warn) {
    opts.warn('This template has no content area, so the page content was appended to the end of it.');
  }
  return [...nodes, ...content];
}

function substitute(list, content, opts) {
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'contentArea') {
      // Marked rather than merely replaced: the editor needs to know which
      // stretch of the composed tree is the page, so it can make exactly that
      // part editable and lock the rest.
      const marked = opts.mark
        ? content.map(child => ({ ...child, __region: 'content' }))
        : content;
      list.splice(i, 1, ...marked);
      return true;
    }
    if (Array.isArray(node.children) && substitute(node.children, content, opts)) return true;
  }
  return false;
}

/**
 * The template split around its content area.
 *
 * The storefront needs a header fragment and a footer fragment to wrap live
 * inventory in the dealer's chrome, and this is where they come from now: what
 * precedes the content area is the header, what follows it is the footer. That
 * is the same answer the two-slot model gave, derived rather than declared —
 * which is what lets a dealer put a hero or a breadcrumb bar in either half
 * without the storefront needing to know.
 */
export function splitAtContentArea(nodes) {
  const before = [];
  const after = [];
  let seen = false;

  const step = list => {
    for (const node of list || []) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'contentArea') {
        seen = true;
        continue;
      }
      // Only the top level is split. A content area nested inside a column means
      // the surrounding layout cannot be cut in two without breaking the grid, so
      // that template contributes its whole self to the header and an empty
      // footer — visibly wrong on the storefront rather than subtly wrong.
      (seen ? after : before).push(node);
    }
  };
  step(nodes);
  return { before, after, found: seen };
}

/** File path for a template. */
export function templatePath(id) {
  return `site/templates/${id}.json`;
}

/** A new, valid template: something to edit rather than an empty canvas. */
export function starterTemplate(id = 'default', name = 'Site template') {
  return {
    version: TEMPLATE_VERSION,
    id,
    name,
    conditions: [{ type: 'entireSite', ref: null }],
    nodes: [
      {
        id: 'header',
        type: 'section',
        props: { width: 'boxed', paddingY: 4, background: 'card' },
        children: [
          {
            id: 'header-row',
            type: 'row',
            props: { gap: 6, align: 'center' },
            children: [
              { id: 'header-brand', type: 'column', props: { span: 3 }, children: [] },
              { id: 'header-nav', type: 'column', props: { span: 9, align: 'center' }, children: [] },
            ],
          },
        ],
      },
      { id: 'content', type: 'contentArea', props: { label: 'Page content' } },
      {
        id: 'footer',
        type: 'section',
        props: { width: 'boxed', paddingY: 7, background: 'ink' },
        children: [],
      },
    ],
  };
}

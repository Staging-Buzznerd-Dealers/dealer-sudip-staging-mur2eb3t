// Placeholders for designed components.
//
// A page is an instance of itself: every value it shows is the value it holds.
// A component is not — it is a shape waiting for content, and it only becomes a
// real thing when a page places it. Without a way to say "a logo goes here,
// supplied later", a reusable component can only ever be reusable in the weakest
// sense: identical everywhere it appears. Which is why a dealer wanting the same
// carousel with different logos had to copy it, and why an AI asked to build one
// left the slides empty — there was nothing it could put in them that would not
// be wrong on the second page.
//
// So a component declares `props`, its nodes bind to them with `{{key}}`, and a
// `sharedSection` placing it supplies `values`. This is the same model Webflow
// calls component properties, Builder.io calls symbol inputs, and WordPress
// calls pattern overrides: structure lives in the definition, content lives with
// the usage.
//
// The `repeat` prop is the piece those three mostly lack. Bound to a list prop,
// a node renders once per item with that item's fields in scope — so one column
// marked as a carousel slide becomes as many slides as there are logos. Webflow
// needs a CMS collection for this and WordPress cannot do it at all.

import { PROP_TYPES, lookup, normaliseProp } from './custom-widgets.mjs';
import { isDataBinding, resolveDataBinding } from './data-sources.mjs';

export { PROP_TYPES };

/** A value that is nothing but a single binding, e.g. `"{{logo}}"`. */
const WHOLE_BINDING = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;

/** Bindings anywhere inside a longer string, e.g. `"Meet {{name}}"`. */
const ANY_BINDING = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * The props a component declares, normalised.
 *
 * Deliberately the same shape and the same validator as a coded widget's props,
 * so the inspector that edits one edits the other and the AI learns one
 * vocabulary rather than two.
 */
export function parseComponentProps(raw, errors = []) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const prop = normaliseProp(entry, errors, seen);
    if (prop) out.push(prop);
  }
  return out;
}

/**
 * What a placement actually resolves to: declared defaults, overridden by the
 * values the page supplied.
 *
 * Only declared keys survive. A page carrying a stale `values` entry for a prop
 * the component has since dropped would otherwise keep feeding it forever, and a
 * binding removed from the tree would look like it still worked.
 */
export function componentValues(props, values) {
  const supplied = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const out = {};
  for (const prop of props || []) {
    const given = supplied[prop.key];
    out[prop.key] = given === undefined || given === null || given === '' ? fallback(prop) : given;
  }
  return out;
}

/**
 * The same values, with every list prop that points at a data source replaced by
 * the rows the platform resolved for this placement.
 *
 * Kept separate from `componentValues` because the two answer different
 * questions: that one is "what did the page say", which the editor needs
 * verbatim in order to save it back, and this one is "what should be drawn",
 * which only the renderer needs. Collapsing them would make the editor write the
 * resolved rows into the file on the next save and quietly turn a live list back
 * into the typed copy it replaced.
 */
export function resolveValues(props, values, data, opts = {}) {
  const out = componentValues(props, values);
  for (const prop of props || []) {
    if (prop.type !== 'list') continue;
    const value = out[prop.key];
    if (!isDataBinding(value)) continue;
    out[prop.key] = resolveDataBinding(value, data ? data[prop.key] : null, opts);
  }
  return out;
}

/** The value a prop shows when the page supplied none. */
function fallback(prop) {
  if (prop.default !== undefined) return prop.default;
  switch (prop.type) {
    case 'list':
      return [];
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'image':
      return { src: '', alt: '' };
    case 'select':
      return prop.options?.[0]?.value ?? '';
    default:
      return '';
  }
}

/**
 * Sample values, for showing a component's shape before anything places it.
 *
 * A component being edited has no page supplying it, so every binding would
 * resolve to a default — and for a list that means an empty array, i.e. a
 * carousel with no slides. Which is exactly the blank canvas that made the
 * feature look broken. Three rows reads as "several" without distorting the
 * layout the way a dozen would.
 */
export function componentSampleValues(props, rows = 3) {
  const out = {};
  for (const prop of props || []) {
    if (prop.type === 'list') {
      out[prop.key] = sampleList(prop.fields, rows);
      continue;
    }
    if (prop.default !== undefined && prop.default !== '') {
      out[prop.key] = prop.default;
      continue;
    }
    out[prop.key] = prop.type === 'select' ? prop.options?.[0]?.value ?? '' : sample(prop.type, prop.label || prop.key, 0);
  }
  return out;
}

const SAMPLE_FILLS = ['#e9ecf2', '#dde7f7', '#e7ddd4', '#dceee4'];

function sampleImage(label, index) {
  const caption = `${String(label || 'logo').slice(0, 10)} ${index + 1}`;
  const fill = SAMPLE_FILLS[index % SAMPLE_FILLS.length];
  return {
    src:
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80">` +
          `<rect width="160" height="80" fill="${fill}"/>` +
          `<text x="80" y="45" font-family="sans-serif" font-size="12" fill="#4b5563" text-anchor="middle">${caption}</text>` +
          `</svg>`,
      ),
    alt: caption,
  };
}

/**
 * Rows for a list, including any list nested inside one.
 *
 * Two inner rows rather than three: enough to show the design repeats there,
 * without an hours table turning one sample rooftop into twenty-one lines.
 */
function sampleList(fields, rows) {
  return Array.from({ length: rows }, (_, i) =>
    Object.fromEntries(
      (fields || []).map(f => [
        f.key,
        f.type === 'list' ? sampleList(f.fields, 2) : sample(f.type, f.label || f.key, i),
      ]),
    ),
  );
}

function sample(type, label, index) {
  switch (type) {
    case 'boolean':
      return true;
    case 'number':
      return index + 1;
    case 'image':
      return sampleImage(label, index);
    case 'url':
      return '#';
    case 'color':
      return 'var(--accent)';
    case 'richtext':
    case 'textarea':
      return `${label} — sample copy.`;
    default:
      return `${label} ${index + 1}`;
  }
}

/** Is this value a binding, whole or partial? */
export function isBinding(value) {
  return typeof value === 'string' && ANY_BINDING.test(value);
}

/**
 * Substitute one prop value.
 *
 * A value that is *nothing but* a binding resolves to the bound value itself,
 * type intact — so an image prop bound to `{{logo}}` receives `{ src, alt }`
 * rather than the string "[object Object]". Anything else interpolates as text,
 * which is what `"Meet {{name}}"` obviously means.
 *
 * Nothing is escaped here. These are node props, and the node that renders them
 * escapes at the point it emits HTML; escaping twice would show a dealer's
 * apostrophes as `&#39;`.
 */
function substitute(value, scopes) {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_BINDING);
    if (whole) {
      const found = lookup(whole[1], scopes);
      return found === undefined ? '' : found;
    }
    return value.replace(ANY_BINDING, (_, path) => {
      const found = lookup(path, scopes);
      if (found == null) return '';
      if (typeof found === 'object') return typeof found.src === 'string' ? found.src : '';
      return String(found);
    });
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, scopes));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, scopes)]));
  }
  return value;
}

/**
 * One node's props as an editor should *display* them.
 *
 * The canvas renders node by node rather than tree by tree, so it cannot use
 * `bindTree`. It needs this because a slide showing the literal text
 * `{{name}}` teaches a dealer that the component is broken; showing sample
 * content teaches them what a placement will look like.
 *
 * Display only. The stored props keep their bindings — substituting into the
 * document would turn the component into a copy of its own preview the next time
 * the editor saved.
 */
export function previewProps(props, values, item) {
  const scopes = [{ value: values || {} }];
  if (item && typeof item === 'object') scopes.push({ value: item, index: 0 });
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'repeat') continue;
    out[key] = substitute(value, scopes);
  }
  return out;
}

/**
 * Resolve a component's tree against a set of values.
 *
 * Returns a new tree; the definition is never mutated, because the same
 * definition is expanded once per placement and the second placement must not
 * inherit the first one's content.
 *
 * `keepEmptyRepeat` renders one copy of a node whose list is empty. On a
 * published page that would be a phantom slide, so it is off there; in the
 * editor a repeat that vanishes because nobody has added logos yet looks like a
 * bug, so it is on.
 */
export function bindTree(nodes, values, opts = {}) {
  const scopes = [{ value: values || {} }];
  return expand(nodes, scopes, !!opts.keepEmptyRepeat, '', opts.snapshots || null);
}

function expand(nodes, scopes, keepEmpty, suffix, snapshots) {
  const out = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue;
    const repeatKey = typeof node.props?.repeat === 'string' ? node.props.repeat.trim() : '';

    if (!repeatKey) {
      out.push(bindNode(node, scopes, keepEmpty, suffix, snapshots));
      continue;
    }

    const list = lookup(repeatKey, scopes);
    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      if (keepEmpty) out.push(bindNode(node, [...scopes, { value: {}, index: 0 }], keepEmpty, suffix, snapshots));
      continue;
    }
    items.forEach((item, index) => {
      // Ids have to stay unique: the canvas keys components off `data-bz-node`
      // and a duplicate would make two slides the same slide.
      out.push(
        bindNode(node, [...scopes, { value: item, index }], keepEmpty, `${suffix}-${index + 1}`, snapshots),
      );
    });
  }
  return out;
}

function bindNode(node, scopes, keepEmpty, suffix, snapshots) {
  const props = {};
  for (const [key, value] of Object.entries(node.props || {})) {
    // `repeat` is an instruction to this function, not something a renderer
    // should see — leaving it on would also make every expanded copy look like
    // it wanted repeating again.
    if (key === 'repeat') continue;
    props[key] = substitute(value, scopes);
  }

  // Widget data belongs to the *placement*, never to the definition. A component
  // whose widget reads `{{locationSlug}}` is one shape used by every rooftop, so
  // a snapshot stored on the definition would be one branch's address shown on
  // all of them. The placement supplies them, keyed by the id the node has in
  // the definition — before any repeat suffix, because that is the only id the
  // placement can know.
  if (snapshots && node.type === 'widget' && snapshots[node.id] !== undefined) {
    props.snapshot = snapshots[node.id];
  }

  const bound = {
    ...node,
    id: suffix && node.id ? `${node.id}${suffix}` : node.id,
    props,
  };
  if (Array.isArray(node.children)) {
    bound.children = expand(node.children, scopes, keepEmpty, suffix, snapshots);
  }
  if (node.styles && typeof node.styles === 'object') bound.styles = node.styles;
  return bound;
}

/**
 * Which prop keys a tree binds to, so an unused declaration can be reported and
 * a binding to a prop nobody declared does not fail silently.
 */
export function bindingsUsed(nodes, found = new Set()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue;
    const repeatKey = typeof node.props?.repeat === 'string' ? node.props.repeat.trim() : '';
    if (repeatKey) found.add(repeatKey.split('.')[0]);
    collect(node.props, found);
    if (Array.isArray(node.children)) bindingsUsed(node.children, found);
  }
  return found;
}

function collect(value, found) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ANY_BINDING)) {
      const path = match[1].trim();
      if (path && path !== '.' && path !== 'this' && !path.startsWith('@')) found.add(path.split('.')[0]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, found);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collect(item, found);
  }
}

// Custom widgets — the half of the widget system a dealer's own site owns.
//
// The platform ships a fixed block library (blocks.mjs) and a set of data-backed
// widgets (widgets.mjs). Neither can cover every design: a handoff arrives with a
// section nothing in the library expresses, and the honest answer is a new
// widget, not a customHtml block that the editor cannot inspect and the AI cannot
// reuse.
//
// A custom widget is a JSON file in the dealer's own repo, `site/widgets/<id>.json`.
// It carries a prop list, an HTML template and its CSS. Compiling one produces the
// same shape as a built-in block — `{ label, category, schema, render }` — so
// everything downstream treats it identically: the editor palette lists it, the
// inspector builds itself from its schema, the AI is told it exists, the save path
// validates against it, and the static build renders it. Nothing needs a second
// code path.
//
// Three properties make that safe rather than a script-injection hole:
//
//  1. The template language is a fixed, tiny subset — interpolation, one
//     conditional, one loop. There is no expression evaluation, so a template
//     cannot compute, fetch or reach outside the props it was given.
//  2. Every interpolation is escaped. `{{&key}}` is the one exception and it goes
//     through the same inline allowlist a text block uses, so it can emit <strong>
//     and never <script>.
//  3. The markup is stripped of scripts, event handlers and javascript: URLs when
//     the definition is parsed — before it is ever committed — and again here.
//
// A custom widget is a LEAF. It has no drop targets of its own, because nesting
// is the layout system's job: a section holds rows, a row holds columns, and a
// column holds widgets. An earlier version let a widget declare `data-bz-slot`
// holes, which meant two unrelated nesting mechanisms — one the editor
// understood as containers and one it had to special-case — and a widget whose
// children were wiped every time one of its props changed.
//
// Zero dependencies, like the rest of the renderer.

import { esc, href, image, rewriteAssetUrls } from './html.mjs';

/** Prop editor types. Each maps to a JSON Schema type and an inspector control. */
export const PROP_TYPES = [
  'text',
  'textarea',
  'richtext',
  'url',
  'image',
  'number',
  'boolean',
  'select',
  'color',
  'list',
];

const SCHEMA_TYPE = {
  text: 'string',
  textarea: 'string',
  richtext: 'string',
  url: 'string',
  color: 'string',
  select: 'string',
  number: 'number',
  boolean: 'boolean',
  image: 'object',
  list: 'array',
};

const ID_RE = /^[a-z][a-z0-9-]{1,47}$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/* --------------------------------------------------------------- sanitizing */

/**
 * Strip everything executable from a fragment.
 *
 * Deliberately the same rules the block library applies to `customHtml`: a custom
 * widget is authored by the AI or pasted by a dealer, so it gets no more trust
 * than any other untrusted markup. `data-*` survives, because `data-bz-el` and
 * `data-bz-intent` are how analytics finds a CTA.
 */
export function stripUnsafeHtml(html) {
  return String(html || '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/<\/?(?:iframe|object|embed|form)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/**
 * Strip anything from a stylesheet that can reach off the page.
 *
 * `@import` and `url()` would let a widget definition pull a remote resource on
 * every visitor's page load, which is both a privacy leak and a way to smuggle in
 * content the dealer never reviewed. Images belong in props, where they go through
 * the media library.
 */
export function stripUnsafeCss(css) {
  return String(css || '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/url\(\s*['"]?\s*(?:javascript|data:text\/html)[^)]*\)/gi, 'none')
    .replace(/<\/?\w[^>]*>/g, '')
    .trim();
}

const INLINE_ALLOWED = /^<\/?(?:strong|b|em|i|br|a|small|span)(?:\s[^<>]*)?>$/i;

function inlineHtml(text, ctx) {
  return String(text == null ? '' : text).replace(/<[^>]*>|[&<>]/g, (m) => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (!INLINE_ALLOWED.test(m)) return '';
    if (/^<a\s/i.test(m)) {
      const url = (m.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1] || '#';
      return `<a href="${esc(href(url, ctx))}">`;
    }
    return m.toLowerCase();
  });
}

/* ---------------------------------------------------------------- CSS scope */

/**
 * Prefix every top-level selector so a widget's CSS can only style its own
 * instances.
 *
 * Without this, two widgets that both style `.card` fight, and the winner depends
 * on file order — a bug that appears on one page months after the widget was
 * written. Scoping makes collisions impossible by construction, which matters most
 * for markup the AI generated and nobody reviewed.
 *
 * At-rules that wrap other rules (`@media`, `@supports`, `@container`) recurse;
 * `@keyframes` and `@font-face` pass through untouched, because their inner blocks
 * are not selectors.
 */
export function scopeCss(css, scope) {
  const source = stripUnsafeCss(css);
  if (!source || !scope) return source;
  return scopeBlock(source, scope);
}

function scopeBlock(source, scope) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const braceAt = source.indexOf('{', i);
    if (braceAt === -1) break;
    const prelude = source.slice(i, braceAt).trim();
    const end = matchBrace(source, braceAt);
    if (end === -1) break;
    const body = source.slice(braceAt + 1, end);

    if (/^@(media|supports|container|layer)\b/i.test(prelude)) {
      out.push(`${prelude}{${scopeBlock(body, scope)}}`);
    } else if (prelude.startsWith('@')) {
      out.push(`${prelude}{${body}}`);
    } else {
      out.push(`${scopeSelector(prelude, scope)}{${body}}`);
    }
    i = end + 1;
  }
  return out.join('\n');
}

function matchBrace(source, openAt) {
  let depth = 0;
  for (let i = openAt; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function scopeSelector(prelude, scope) {
  return prelude
    .split(',')
    .map((sel) => {
      const s = sel.trim();
      if (!s) return '';
      // `:root` inside a widget means "this widget's root", not the document's —
      // a widget must never be able to redefine the dealer's design tokens.
      if (s === ':root' || s === ':host') return scope;
      if (s.startsWith('&')) return scope + s.slice(1);
      return `${scope} ${s}`;
    })
    .filter(Boolean)
    .join(', ');
}

/* ------------------------------------------------------------ template AST */

/**
 * Compile a template into a small node tree.
 *
 * Compiled once per definition and cached on the compiled widget, because a page
 * can hold many instances of the same widget and re-parsing per instance would be
 * the renderer's slowest path for no reason.
 */
export function compileTemplate(source) {
  const tokens = tokenize(String(source || ''));
  const { nodes, index, stop } = parseNodes(tokens, 0, null);
  if (stop !== 'eof') {
    // An unbalanced block would otherwise silently swallow the rest of the
    // template; failing loudly at parse time is what makes it fixable.
    const token = tokens[index] || {};
    throw new Error(token.kind === 'else' ? 'stray {{else}}' : `stray {{/${token.name || ''}}}`);
  }
  return nodes;
}

function tokenize(source) {
  const out = [];
  const re = /\{\{([^}]*)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(source))) {
    if (m.index > last) out.push({ kind: 'text', value: source.slice(last, m.index) });
    out.push(readTag(m[1].trim()));
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push({ kind: 'text', value: source.slice(last) });
  return out;
}

function readTag(body) {
  if (body.startsWith('#if ')) return { kind: 'open', name: 'if', arg: body.slice(4).trim() };
  if (body.startsWith('#unless ')) return { kind: 'open', name: 'unless', arg: body.slice(8).trim() };
  if (body.startsWith('#each ')) return { kind: 'open', name: 'each', arg: body.slice(6).trim() };
  if (body === 'else') return { kind: 'else' };
  if (body.startsWith('/')) return { kind: 'close', name: body.slice(1).trim() };
  if (body.startsWith('&')) return { kind: 'rich', path: body.slice(1).trim() };
  if (body.startsWith('link ')) return { kind: 'helper', helper: 'link', path: body.slice(5).trim() };
  if (body.startsWith('img ')) return { kind: 'helper', helper: 'img', path: body.slice(4).trim() };
  return { kind: 'value', path: body };
}

function parseNodes(tokens, start, expectClose) {
  const nodes = [];
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.kind === 'close') {
      if (expectClose && token.name === expectClose) return { nodes, index: i + 1, stop: 'close' };
      return { nodes, index: i, stop: 'stray' };
    }
    if (token.kind === 'else') {
      if (expectClose) return { nodes, index: i + 1, stop: 'else' };
      return { nodes, index: i, stop: 'stray' };
    }

    if (token.kind === 'open') {
      // The first branch parse stops either at the close tag or at `{{else}}`;
      // when it stopped at the else, the second branch is parsed from there, so
      // `{{#if}}…{{else}}…{{/if}}` needs no separate tag form.
      const first = parseNodes(tokens, i + 1, token.name);
      let alternate = [];
      let next = first.index;
      if (first.stop === 'else') {
        const second = parseNodes(tokens, first.index, token.name);
        if (second.stop !== 'close') throw new Error(`{{#${token.name}}} is not closed`);
        alternate = second.nodes;
        next = second.index;
      } else if (first.stop !== 'close') {
        throw new Error(`{{#${token.name}}} is not closed`);
      }
      nodes.push({ kind: token.name, path: token.arg, body: first.nodes, alternate });
      i = next;
      continue;
    }

    nodes.push(token);
    i += 1;
  }
  if (expectClose) throw new Error(`{{#${expectClose}}} is not closed`);
  return { nodes, index: i, stop: 'eof' };
}

/* -------------------------------------------------------------- evaluation */

/**
 * Resolve a dotted path against a stack of scopes, innermost first.
 *
 * Exported because designed components bind their node props with the same
 * `{{key}}` paths this engine reads in widget markup. Two lookups would be two
 * dialects, and a dealer moving between a coded widget and a designed one would
 * have to know which they were in.
 */
export function lookup(path, scopes) {
  if (!path) return undefined;
  if (path === '.' || path === 'this') return scopes[scopes.length - 1].value;
  if (path === '@index') return scopes[scopes.length - 1].index;
  const parts = path.replace(/^this\./, '').split('.');
  for (let s = scopes.length - 1; s >= 0; s--) {
    let value = scopes[s].value;
    if (value == null || typeof value !== 'object') continue;
    let ok = true;
    for (const part of parts) {
      if (value == null || typeof value !== 'object' || !(part in value)) {
        ok = false;
        break;
      }
      value = value[part];
    }
    if (ok) return value;
  }
  return undefined;
}

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return !!value;
}

function renderNodes(nodes, scopes, ctx) {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.value;
        break;
      case 'value':
        out += esc(scalar(lookup(node.path, scopes)));
        break;
      case 'rich':
        out += inlineHtml(lookup(node.path, scopes), ctx);
        break;
      case 'helper': {
        const value = lookup(node.path, scopes);
        if (node.helper === 'link') out += esc(href(scalar(value), ctx));
        else if (node.helper === 'img') out += image(value, { ctx });
        break;
      }
      case 'if':
        out += truthy(lookup(node.path, scopes))
          ? renderNodes(node.body, scopes, ctx)
          : renderNodes(node.alternate, scopes, ctx);
        break;
      case 'unless':
        out += truthy(lookup(node.path, scopes))
          ? renderNodes(node.alternate, scopes, ctx)
          : renderNodes(node.body, scopes, ctx);
        break;
      case 'each': {
        const list = lookup(node.path, scopes);
        if (!Array.isArray(list) || !list.length) {
          out += renderNodes(node.alternate, scopes, ctx);
          break;
        }
        list.forEach((value, index) => {
          out += renderNodes(node.body, [...scopes, { value, index }], ctx);
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function scalar(value) {
  if (value == null) return '';
  // An image prop is `{ src, alt }`, and `{{logo}}` inside src="…" is what anyone
  // writing this template reaches for first — the AI included. Returning '' for it
  // produced `src=""`: a broken image, with nothing anywhere saying why. The `img`
  // helper is still the better form because it emits dimensions and lazy loading,
  // but the plain interpolation has an obvious meaning and now does it.
  if (typeof value === 'object') return typeof value.src === 'string' ? value.src : '';
  return value;
}

/* ------------------------------------------------------------------- slots */

const SLOT_RE = /data-bz-slot\s*=/i;

/**
 * Does this template still declare drop targets?
 *
 * Reported as an error rather than ignored. A template with a slot in it was
 * authored against a model where a widget could hold children; leaving the
 * attribute in silently would render an empty div where the author expected
 * content, which is the failure that looks like the widget is broken.
 */
export function declaresSlots(html) {
  return SLOT_RE.test(String(html || ''));
}

/* -------------------------------------------------------------- definition */

/**
 * Normalise and validate a widget definition.
 *
 * Returns `{ definition, errors }` rather than throwing: the AI writes these, and
 * a specific list of what is wrong is what the retry turn needs. A definition with
 * errors is not registered.
 */
export function parseWidgetDefinition(raw, fallbackId) {
  const errors = [];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const id = String(src.id || fallbackId || '')
    .trim()
    .toLowerCase();
  if (!ID_RE.test(id)) {
    errors.push(`id "${id}" must be lower-case letters, digits and dashes, starting with a letter`);
  }

  const category = src.category === 'section' ? 'section' : 'content';
  const label = String(src.label || id || 'Custom widget').slice(0, 60);
  const description = String(src.description || '').slice(0, 300);
  const origin = src.origin === 'user' ? 'user' : src.origin === 'import' ? 'import' : 'ai';

  const props = [];
  const seenKeys = new Set();
  for (const entry of Array.isArray(src.props) ? src.props : []) {
    const prop = normaliseProp(entry, errors, seenKeys);
    if (prop) props.push(prop);
  }

  const html = stripUnsafeHtml(src.html);
  if (!html) errors.push('html is required');
  const css = stripUnsafeCss(src.css);

  let templateError = null;
  try {
    compileTemplate(html);
  } catch (err) {
    templateError = err.message;
    errors.push(`template: ${err.message}`);
  }

  if (html && declaresSlots(html)) {
    errors.push(
      'this template declares data-bz-slot. Widgets are leaves — build the layout from a section, a row and columns instead, and put this widget in a column.',
    );
  }

  return {
    definition: errors.length
      ? null
      : {
          version: 1,
          id,
          label,
          description,
          category,
          origin,
          props,
          html,
          css,
          // Recorded rather than computed at render time so the editor can warn
          // about an untagged widget without re-scanning every template.
          autoTagged: isAutoTagged(html),
          createdAt: typeof src.createdAt === 'string' ? src.createdAt : null,
        },
    errors,
    templateError,
  };
}

/**
 * One declared prop, checked and filled in. `null` when it cannot be salvaged.
 *
 * Shared with designed components, whose props are declared the same way and
 * carry the same types — the only difference is what consumes them, markup in
 * one case and node props in the other.
 */
export function normaliseProp(entry, errors, seenKeys) {
  if (!entry || typeof entry !== 'object') {
    errors.push('each prop must be an object');
    return null;
  }
  const key = String(entry.key || '').trim();
  if (!KEY_RE.test(key)) {
    errors.push(`prop key "${key}" must be a short identifier`);
    return null;
  }
  if (key === 'columns') {
    errors.push('"columns" is reserved for slots and cannot be a prop');
    return null;
  }
  if (seenKeys.has(key)) {
    errors.push(`duplicate prop key "${key}"`);
    return null;
  }
  seenKeys.add(key);

  const type = PROP_TYPES.includes(entry.type) ? entry.type : 'text';
  const prop = {
    key,
    type,
    label: String(entry.label || key).slice(0, 60),
    description: String(entry.description || '').slice(0, 200),
    required: !!entry.required,
  };
  if (entry.default !== undefined) prop.default = entry.default;

  if (type === 'select') {
    const options = (Array.isArray(entry.options) ? entry.options : [])
      .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
      .filter((o) => o && typeof o.value === 'string')
      .map((o) => ({ value: String(o.value), label: String(o.label || o.value) }));
    if (!options.length) {
      errors.push(`prop "${key}" is a select with no options`);
      return null;
    }
    prop.options = options;
  }

  if (type === 'list') {
    const fields = listFields(entry, key, errors, LIST_DEPTH);
    if (!fields.length) {
      errors.push(`prop "${key}" is a list with no fields`);
      return null;
    }
    prop.fields = fields;
  }

  return prop;
}

/**
 * How many lists may nest below a list prop. Two, because that is the deepest
 * fact the data sources carry — a rooftop has departments (`hoursRows`) and a
 * department has a week (`days`) — and also the deepest shape a dealer can fill
 * in by hand on the inspector before the form stops being a form.
 */
const LIST_DEPTH = 2;

/**
 * A list's columns, any of which may itself be a list until `depth` runs out.
 *
 * Until this existed a list's fields were forced to scalars, so the resolver had
 * no reason not to join hours into a sentence and a design had no way to declare
 * the nesting even if it stopped. `repeat` itself was never the limit: it
 * resolves each key against the row it sits inside, so a node repeating `days`
 * inside a node repeating `hoursRows` already worked.
 */
function listFields(entry, key, errors, depth) {
  const fields = [];
  const seen = new Set();
  for (const field of Array.isArray(entry.fields) ? entry.fields : []) {
    const fk = String(field?.key || '').trim();
    if (!KEY_RE.test(fk) || seen.has(fk)) continue;
    seen.add(fk);
    const wanted = PROP_TYPES.includes(field.type) ? field.type : 'text';
    const ftype = wanted === 'list' && depth <= 0 ? 'text' : wanted;
    const out = { key: fk, type: ftype, label: String(field.label || fk).slice(0, 60) };
    if (ftype === 'select' && Array.isArray(field.options)) {
      out.options = field.options
        .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
        .filter((o) => o && typeof o.value === 'string')
        .map((o) => ({ value: String(o.value), label: String(o.label || o.value) }));
    }
    if (ftype === 'list') {
      const nested = listFields(field, `${key}.${fk}`, errors, depth - 1);
      if (!nested.length) {
        errors.push(`prop "${key}.${fk}" is a list with no fields`);
        continue;
      }
      out.fields = nested;
    }
    fields.push(out);
  }
  return fields;
}

/**
 * Does every interactive element in this template carry an analytics hook?
 *
 * The built-in blocks emit `data-bz-el` structurally, which is what makes browser
 * tag certification a one-time platform exercise. A custom widget is authored
 * markup, so the guarantee has to be checked rather than assumed — and the answer
 * is surfaced in the editor rather than enforced, because a widget with an
 * untagged link is still better than a page that cannot be built.
 */
export function isAutoTagged(html) {
  const tags = String(html || '').match(/<(?:a|button)\b[^>]*>/gi) || [];
  return tags.every((tag) => /data-bz-el\s*=/.test(tag));
}

/* ------------------------------------------------------------------ schema */

/** JSON Schema for a definition's props, in the shape the block library uses. */
export function widgetSchema(definition) {
  const properties = {};
  const required = [];

  for (const prop of definition.props || []) {
    properties[prop.key] = schemaForProp(prop);
    if (prop.required) required.push(prop.key);
  }

  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function schemaForProp(prop) {
  const base = {
    type: SCHEMA_TYPE[prop.type] || 'string',
    description: prop.description || prop.label,
  };
  if (prop.default !== undefined) base.default = prop.default;

  if (prop.type === 'select') {
    base.enum = prop.options.map((o) => o.value);
  }
  if (prop.type === 'image') {
    base.properties = {
      src: { type: 'string', description: 'Public image URL from the media library.' },
      alt: { type: 'string', description: 'Descriptive alternative text.' },
      width: { type: 'integer', description: 'Intrinsic width in pixels.' },
      height: { type: 'integer', description: 'Intrinsic height in pixels.' },
    };
    base.required = ['src', 'alt'];
  }
  if (prop.type === 'list') {
    base.items = {
      type: 'object',
      properties: Object.fromEntries(
        prop.fields.map((f) => [
          f.key,
          {
            type: SCHEMA_TYPE[f.type] || 'string',
            description: f.label,
            ...(f.type === 'select' && f.options ? { enum: f.options.map((o) => o.value) } : {}),
            ...(f.type === 'image'
              ? {
                  properties: {
                    src: { type: 'string', description: 'Public image URL.' },
                    alt: { type: 'string', description: 'Alternative text.' },
                  },
                  required: ['src', 'alt'],
                }
              : {}),
          },
        ]),
      ),
    };
  }
  return base;
}

/** The starting props for a freshly placed instance. */
export function defaultProps(definition) {
  const out = {};
  for (const prop of definition.props || []) {
    if (prop.default !== undefined) out[prop.key] = prop.default;
    else if (prop.type === 'list') out[prop.key] = [];
    else if (prop.type === 'boolean') out[prop.key] = false;
    else if (prop.type === 'number') out[prop.key] = 0;
    else if (prop.type === 'image') out[prop.key] = { src: '', alt: '' };
    else if (prop.type === 'select') out[prop.key] = prop.options?.[0]?.value ?? '';
    else out[prop.key] = prop.label;
  }
  return out;
}

/**
 * Props for *showing what a widget looks like*, which is not the same question
 * as what a fresh instance starts with.
 *
 * `defaultProps` is right to leave a list empty — a newly placed widget must not
 * invent content nobody typed. But a preview built from those defaults renders an
 * empty box, and an empty box is exactly what a logo carousel, a spec strip or a
 * testimonial slider all look like with no rows. That made the editor's preview
 * useless for the whole class of widget people actually build.
 *
 * So a preview fills lists with a few sample rows and gives images a visible
 * placeholder. Nothing here is ever committed: it exists to answer "is this the
 * layout I meant".
 */
export function previewProps(definition, rows = 3) {
  const sample = (type, label, index) => {
    switch (type) {
      case 'boolean':
        return true;
      case 'number':
        return index + 1;
      case 'image':
        return { src: PREVIEW_IMAGE, alt: `${label} ${index + 1}` };
      case 'url':
        return '#';
      case 'color':
        return 'var(--accent)';
      case 'richtext':
      case 'textarea':
        return `${label} — sample copy for the preview.`;
      default:
        return rows > 1 ? `${label} ${index + 1}` : label;
    }
  };

  const out = {};
  for (const prop of definition.props || []) {
    const label = prop.label || prop.key;
    if (prop.type === 'list') {
      // A list with one row cannot show what a repeating layout does, and a list
      // with a dozen makes the preview the wrong shape. Three reads as "several".
      const fields = prop.fields || [];
      out[prop.key] = Array.from({ length: rows }, (_, i) =>
        Object.fromEntries(
          fields.map(field => [field.key, sample(field.type, field.label || field.key, i)]),
        ),
      );
      continue;
    }
    if (prop.default !== undefined && prop.default !== '') {
      out[prop.key] = prop.default;
      continue;
    }
    if (prop.type === 'select') {
      out[prop.key] = prop.options?.[0]?.value ?? '';
      continue;
    }
    out[prop.key] = sample(prop.type, label, 0);
  }
  return out;
}

/** A neutral inline SVG, so a preview needs no network and no uploaded asset. */
const PREVIEW_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 160'%3E%3Crect width='240' height='160' fill='%23e5e7eb'/%3E%3Cpath d='M0 160 96 64l48 48 32-32 64 80z' fill='%23cbd5e1'/%3E%3Ccircle cx='176' cy='44' r='20' fill='%23cbd5e1'/%3E%3C/svg%3E";

/**
 * Render one definition on its own, for an editor preview.
 *
 * Exists because the obvious way to do this is wrong in a way that looks right.
 * Calling `renderDocument` with a node of the widget's type only works for a
 * widget already in the registry — so a definition being *edited* rendered the
 * last saved version, and a definition being *created* rendered nothing at all,
 * silently, because an unknown type is a warning and an empty string.
 *
 * Compiling and rendering directly removes the registry from the question. The
 * `.bz-block--<id>` wrapper is not decoration: `compileWidget` scopes the CSS to
 * that class, so without it none of the widget's own styles apply.
 */
export function renderWidgetPreview(definition, ctx = {}, props) {
  const { definition: parsed, errors } = parseWidgetDefinition(definition);
  if (!parsed) return { html: '', css: '', errors };
  try {
    const compiled = compileWidget(parsed);
    const previewCtx = { editing: true, ...ctx };
    const inner = compiled.render(props ?? previewProps(parsed), previewCtx);
    return {
      html: rewriteAssetUrls(inner ? `<div class="bz-block bz-block--${parsed.id}">${inner}</div>` : '', previewCtx),
      css: rewriteAssetUrls(compiled.css, previewCtx),
      errors: [],
    };
  } catch (err) {
    return { html: '', css: '', errors: [err.message] };
  }
}

/* ----------------------------------------------------------------- compile */

/**
 * Turn a definition into a registry entry indistinguishable from a built-in block.
 *
 * This is the whole point of the design: once compiled, nothing downstream knows
 * or cares that this widget came from the dealer's repo rather than from the
 * platform's library.
 */
export function compileWidget(definition) {
  const nodes = compileTemplate(definition.html);
  const scope = `.bz-block--${definition.id}`;

  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    custom: true,
    origin: definition.origin,
    autoTagged: definition.autoTagged !== false,
    props: definition.props,
    schema: widgetSchema(definition),
    css: scopeCss(definition.css, scope),
    defaults: defaultProps(definition),
    render(props, ctx) {
      return renderNodes(nodes, [{ value: props || {} }], ctx || {});
    },
  };
}

/** Read a directory listing of definitions into compiled widgets, skipping bad ones. */
export function compileWidgets(rawDefinitions, warn) {
  const out = [];
  for (const raw of rawDefinitions || []) {
    const { definition, errors } = parseWidgetDefinition(raw);
    if (!definition) {
      if (warn) warn(`Custom widget "${raw?.id ?? '?'}" is invalid and was skipped: ${errors.join('; ')}`);
      continue;
    }
    try {
      out.push(compileWidget(definition));
    } catch (err) {
      if (warn) warn(`Custom widget "${definition.id}" failed to compile: ${err.message}`);
    }
  }
  return out;
}

/** A minimal starting definition, used by "save as widget" and by the AI contract. */
export function emptyDefinition(id, label) {
  return {
    version: 1,
    id,
    label: label || id,
    description: '',
    category: 'content',
    origin: 'user',
    props: [],
    html: '<div class="wrap"><p>{{text}}</p></div>',
    css: '',
  };
}

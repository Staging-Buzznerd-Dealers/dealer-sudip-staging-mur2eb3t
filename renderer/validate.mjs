// Validation of a document tree against the node schemas.
//
// Deliberately not a general JSON Schema engine: it understands exactly the
// keywords the schemas use, which keeps the renderer dependency-free and keeps
// the failure messages specific enough to hand back to a model for a retry. If a
// schema starts using a keyword this does not implement, `unsupported` is
// reported rather than silently passing.
//
// Two things are checked that a schema cannot express, and they are the ones
// that matter for a builder: every node's id is unique, and every parent/child
// pair is one `accepts` allows. The second is the same predicate GrapesJS builds
// its drop rules from, so a tree the editor let you build always validates.

import { getBlock } from './blocks.mjs';
import { UNIVERSAL_PROPS, accepts, getLayout, isLayout, parseDocument } from './nodes.mjs';
import { allWidgetIds } from './blocks.mjs';

const KNOWN_KEYWORDS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'pattern',
  'default',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function check(schema, value, path, errors) {
  if (!schema) return;

  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key)) {
      errors.push({ path, message: `schema uses unsupported keyword "${key}"`, unsupported: true });
    }
  }

  if (value === undefined || value === null) return;

  // A value that is nothing but `{{someProp}}` is a placeholder inside a designed
  // component, and its type is whatever the page binds to it. Checking it here
  // would reject the only sensible way to write an image placeholder — a string
  // now, an object once resolved. The resolved value is checked in its place.
  if (typeof value === 'string' && /^\s*\{\{\s*[^{}]+?\s*\}\}\s*$/.test(value)) return;

  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push({ path, message: `expected ${schema.type}, got ${typeOf(value)}` });
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `must be one of ${schema.enum.join(', ')}` });
  }
  // Used where a value is a combination rather than one of a list — a node's
  // `part` may name several roles at once, which an enum cannot describe.
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push({ path, message: schema.description || `does not match ${schema.pattern}` });
  }
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    errors.push({ path, message: `must be >= ${schema.minimum}` });
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    errors.push({ path, message: `must be <= ${schema.maximum}` });
  }

  if (schema.type === 'array') {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push({ path, message: `needs at least ${schema.minItems} item(s)` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push({ path, message: `allows at most ${schema.maxItems} item(s)` });
    }
    if (schema.items) {
      value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
    }
  }

  if (schema.type === 'object' && schema.properties) {
    for (const req of schema.required || []) {
      const v = value[req];
      if (v === undefined || v === null || v === '') {
        errors.push({ path: `${path}.${req}`, message: 'is required' });
      }
    }
    for (const [key, propValue] of Object.entries(value)) {
      const propSchema = schema.properties[key];
      if (!propSchema) {
        // Unknown props are dropped rather than rejected: a newer editor writing
        // a prop this renderer version does not know must not fail the build.
        errors.push({ path: `${path}.${key}`, message: 'unknown property (will be ignored)', warning: true });
        continue;
      }
      check(propSchema, propValue, `${path}.${key}`, errors);
    }
  }
}

/** The definition for any node type, layout or widget. */
export function getDefinition(type) {
  return getLayout(type) || getBlock(type);
}

/**
 * A block's schema, widened by the props every node carries.
 *
 * Built here rather than baked into each block's schema so the block library
 * stays a description of what that block does, and one table — UNIVERSAL_PROPS —
 * stays the answer to "what may any node declare".
 */
function withUniversalProps(schema) {
  if (!schema || schema.type !== 'object') return schema;
  return {
    ...schema,
    properties: { ...UNIVERSAL_PROPS, ...(schema.properties || {}) },
  };
}

function checkNode(node, parentType, path, errors, seen) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push({ path, message: 'must be a node object' });
    return;
  }
  if (!node.id || typeof node.id !== 'string') {
    errors.push({ path: `${path}.id`, message: 'every node needs a short stable string id' });
  } else if (seen.has(node.id)) {
    errors.push({ path: `${path}.id`, message: `duplicate node id "${node.id}"` });
  } else {
    seen.add(node.id);
  }

  const definition = getDefinition(node.type);
  if (!definition) {
    errors.push({
      path: `${path}.type`,
      message:
        `unknown type "${node.type}". Layout: section, row, column, contentArea. ` +
        `Widgets: ${allWidgetIds().join(', ')}.`,
    });
    return;
  }

  if (!accepts(parentType, node.type)) {
    errors.push({
      path: `${path}.type`,
      message: `a ${node.type} cannot go inside ${parentType ? `a ${parentType}` : 'the page'}`,
    });
  }

  // Every node accepts the universal props whatever its own schema says —
  // `anchor`, `scope`, `repeat` and the behaviour set are read off the wrapper by
  // the renderer for any type. Checking a block's own schema alone reported all
  // six as "unknown property (will be ignored)", which is both wrong and the
  // worst kind of wrong: it told an author their working carousel was ignored.
  check(withUniversalProps(definition.schema), node.props || {}, `${path}.props`, errors);

  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length && !isLayout(node.type)) {
    errors.push({
      path: `${path}.children`,
      message: `"${node.type}" is a widget and cannot hold children — put it in a column instead`,
    });
    return;
  }
  children.forEach((child, i) => checkNode(child, node.type, `${path}.children[${i}]`, errors, seen));
}

/** Validate one node and everything under it. */
export function validateNode(node, parentType = null) {
  const all = [];
  checkNode(node, parentType, 'node', all, new Set());
  return split(all);
}

/** Validate a whole document. */
export function validateDocument(raw) {
  const document = parseDocument(raw);
  const all = [];
  const seen = new Set();
  document.nodes.forEach((node, i) => checkNode(node, null, `nodes[${i}]`, all, seen));
  return split(all);
}

/**
 * Validate a template: a document, plus the one rule that makes it a template.
 *
 * A template with no content area has nowhere to put a page, and one with two
 * has no answer to which. Both are refused at save time rather than at render
 * time, because at render time the only recourse is a warning on a live site.
 */
export function validateTemplate(raw) {
  const base = validateDocument(raw);
  const document = parseDocument(raw);

  let count = 0;
  const step = list => {
    for (const node of list || []) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'contentArea') count++;
      if (Array.isArray(node.children)) step(node.children);
    }
  };
  step(document.nodes);

  const errors = [...base.errors];
  if (count === 0) {
    errors.push({
      path: 'nodes',
      message: 'a template needs a content area — that is where page content goes',
    });
  } else if (count > 1) {
    errors.push({
      path: 'nodes',
      message: `a template can only have one content area; this one has ${count}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: base.warnings,
    message: errors.map(e => `${e.path}: ${e.message}`).join('; '),
  };
}

function split(all) {
  const warnings = all.filter(e => e.warning);
  const errors = all.filter(e => !e.warning);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    message: errors.map(e => `${e.path}: ${e.message}`).join('; '),
  };
}

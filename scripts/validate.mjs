#!/usr/bin/env node
// Validate everything under site/ against the renderer's own rules.
//
// This exists because a dealer site can be authored by something that is not the
// dashboard — an agent turning a design handoff into a repo, a person editing
// JSON by hand — and a mistake in that JSON is otherwise found in one of two bad
// places: the Vercel build log, or the dashboard rendering a hole where a section
// should be.
//
// The rules are not restated here. Every check calls the same function the
// editor, the build and the backend validator call, which is the only way a
// "valid" verdict here can mean anything at all. What this script owns is
// coverage — every file, every cross-reference — and the wording of the
// failure, which has to name the file, the path inside it and the fix.
//
//   node scripts/validate.mjs                  report, exit 1 on errors
//   node scripts/validate.mjs --quiet          only failures
//   node scripts/validate.mjs --root ../repo    check another repo's site/ against
//                                               *this* renderer — how a generated
//                                               site is reviewed before it is pushed
//
// Cross-file references are where hand-authored sites actually break, and no
// single-file validator can see them: a page whose `templates.header` names a
// template that was renamed, a menu item pointing at a deleted page, a `form`
// block naming a form nobody created. Those are checked here.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isValidPageType, pageTypeOptions } from '../renderer/analytics-vocab.mjs';
import {
  CONDITION_TYPES,
  DATA_SOURCES,
  MENU_ITEM_TYPES,
  RENDERER_VERSION,
  SLUG_TOKEN,
  SPEC_SOURCES,
  VALUE_SOURCES,
  allWidgetIds,
  blockCatalogue,
  dataSource,
  isDataBinding,
  isLocationPage,
  listMenus,
  locationIndex,
  parseComponentProps,
  parseIcons,
  parseMenus,
  parseTemplate,
  parseWidgetDefinition,
  registerCustomWidgets,
  validateDocument,
  validateTemplate,
  walkNodes,
} from '../renderer/index.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? HERE : resolve(process.cwd(), process.argv[rootFlag + 1] ?? '.');
const SITE = join(ROOT, 'site');
const QUIET = process.argv.includes('--quiet');

const problems = [];
const notes = [];
/**
 * Nodes that declare a behaviour, so `reportScriptedMotion` can tell staging the
 * platform owns from staging someone rebuilt in `site/custom-code.json`.
 */
const behaviourNodes = new Set();
/** @param {string} file @param {string} where @param {string} message @param {string} [fix] */
const fail = (file, where, message, fix) => problems.push({ file, where, message, fix });
const note = (file, message) => notes.push({ file, message });

const readJson = (path) => {
  const raw = readFileSync(path, 'utf8');
  try {
    return { value: JSON.parse(raw) };
  } catch (err) {
    return { error: err.message };
  }
};
const rel = (path) => relative(ROOT, path);
const listJson = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];

/* The closed vocabularies this repo must author against.
 *
 * Baked into `platform/analytics.json` at publish, alongside the providers
 * themselves, from whichever ones the dealer enabled. It lives with them rather
 * than in `renderer/` for two reasons: `renderer/` is overwritten wholesale by
 * the platform-file sync, which would delete a per-dealer file on the next
 * publish; and the vocabularies are a fact about this dealer's providers, so
 * they belong in the same file, written by the same bake, as the providers.
 *
 * Absent is the normal case and means nothing is constrained — not that
 * validation is degraded. A dealer with no providers, or whose providers take
 * free text, authors any page kind they like. A malformed file is treated the
 * same as an absent one: refusing to validate a whole repo because a generated
 * file is broken would block a dealer from fixing something they cannot edit. */
const analyticsVocab = (() => {
  const path = join(ROOT, 'platform', 'analytics.json');
  if (!existsSync(path)) return null;
  const { value } = readJson(path);
  const vocab = value?.vocabularies;
  return vocab && typeof vocab === 'object' ? vocab : null;
})();

/* ------------------------------------------------------- custom widgets first */
// Registered before any document is validated: a page placing this site's own
// widget is only valid once the renderer knows that widget exists, and a
// validator run in the wrong order reports every such page as broken.

const widgetDefs = [];
for (const file of listJson(join(SITE, 'widgets'))) {
  const path = join(SITE, 'widgets', file);
  const { value, error } = readJson(path);
  if (error) {
    fail(rel(path), '', `not valid JSON — ${error}`);
    continue;
  }
  const { definition, errors } = parseWidgetDefinition(value, file.replace(/\.json$/, ''));
  for (const message of errors) fail(rel(path), '', message);
  if (definition) widgetDefs.push(definition);
}
registerCustomWidgets(widgetDefs, (message) => note('site/widgets/', message));

const knownTypes = new Set([...allWidgetIds(), 'section', 'row', 'column', 'contentArea', 'sharedSection']);

/* ------------------------------------------------------------------- tokens */

const tokensPath = join(SITE, 'tokens.json');
if (!existsSync(tokensPath)) {
  fail('site/tokens.json', '', 'missing', 'Copy it from the template — every block is styled from it.');
} else {
  const { value, error } = readJson(tokensPath);
  if (error) fail('site/tokens.json', '', `not valid JSON — ${error}`);
  else if (!value?.colors?.accent) {
    note('site/tokens.json', 'no colors.accent — the starter palette will be used for anything unset');
  }
}

/* -------------------------------------------------------------------- icons */

// Optional. A site with no file keeps the storefront's own icons on /store.
const iconsPath = join(SITE, 'icons.json');
if (existsSync(iconsPath)) {
  const { value, error } = readJson(iconsPath);
  if (error) fail('site/icons.json', '', `not valid JSON — ${error}`);
  else {
    for (const problem of parseIcons(value).problems) {
      fail('site/icons.json', problem.where, problem.message, 'Fix or remove that entry; the slot keeps the storefront’s own icon until it is valid.');
    }
  }
}

/* --------------------------------------------------------------- the library */

const forms = new Set();
for (const file of listJson(join(SITE, 'forms'))) {
  const path = join(SITE, 'forms', file);
  const { value, error } = readJson(path);
  if (error) {
    fail(rel(path), '', `not valid JSON — ${error}`);
    continue;
  }
  const id = value?.id ?? file.replace(/\.json$/, '');
  forms.add(id);
  if (value?.id && value.id !== file.replace(/\.json$/, '')) {
    fail(rel(path), 'id', `is "${value.id}" but the file is named "${file}"`, 'Make the filename match the id.');
  }
  if (!Array.isArray(value?.fields) || !value.fields.length) {
    fail(rel(path), 'fields', 'a form with no fields renders as a bare submit button');
  }
  for (const [i, field] of (value?.fields ?? []).entries()) {
    if (!field?.id) fail(rel(path), `fields[${i}].id`, 'every field needs a stable id');
    if (!field?.type) fail(rel(path), `fields[${i}].type`, 'every field needs a type');
  }
  checkFormRouting(rel(path), value);
}

/* ------------------------------------------------------- routing and replies */

/**
 * Notifications and confirmations: who hears about a submission, and what the
 * visitor sees next.
 *
 * Both lists are ordered and first-match-wins, which is the rule most easily
 * lost when a list is edited — an unconditional entry above a conditional one
 * makes everything below it dead, and nothing about the JSON says so. That is a
 * note rather than a failure because it builds and routes; it just does not do
 * what whoever wrote the lower entry meant.
 */
function checkFormRouting(file, form) {
  const fieldIds = new Set((form?.fields ?? []).map((f) => f?.id).filter(Boolean));
  const specIds = new Set(SPEC_SOURCES.map((s) => s.id));

  for (const [i, field] of (form?.fields ?? []).entries()) {
    if (!field?.hidden) continue;
    const source = field.valueSource ?? 'static';
    if (!VALUE_SOURCES.includes(source)) {
      fail(
        file,
        `fields[${i}].valueSource`,
        `"${source}" is not a value source`,
        `Use one of: ${VALUE_SOURCES.join(', ')}.`,
      );
    }
    if (source === 'query' && !String(field.queryParam ?? '').trim()) {
      fail(
        file,
        `fields[${i}].queryParam`,
        'a hidden field reading a URL parameter has to say which one',
        'Set queryParam to the parameter name, e.g. "promo" for ?promo=spring.',
      );
    }
    if (field.required) {
      note(
        file,
        `hidden field "${field.id}" is marked required, which nothing enforces — a field the ` +
          'visitor cannot see is never part of the validation gate. Drop required, or show the field.',
      );
    }
  }

  const ruleSources = (where, rules) => {
    for (const [j, rule] of (rules ?? []).entries()) {
      const id = rule?.fieldId;
      if (!id) {
        fail(file, `${where}.rules[${j}].fieldId`, 'a rule has to name a field');
        continue;
      }
      if (fieldIds.has(id)) continue;
      if (specIds.has(id)) {
        if (!form?.pdpContext) {
          fail(
            file,
            `${where}.rules[${j}].fieldId`,
            `"${id}" is a product-page source, and this form is not marked for product pages`,
            'Set pdpContext to true, or route on one of the form\'s own fields.',
          );
        }
        continue;
      }
      fail(file, `${where}.rules[${j}].fieldId`, `no field called "${id}" on this form`);
    }
  };

  /** Everything above `i` that would swallow it first. */
  const deadBelow = (list, i) =>
    list.slice(0, i).some((entry) => !(entry?.rules ?? []).length);

  const notifications = form?.notifications ?? [];
  for (const [i, n] of notifications.entries()) {
    const where = `notifications[${i}]`;
    ruleSources(where, n?.rules);
    const target = n?.targetType ?? 'role';
    if (!['role', 'user', 'email'].includes(target)) {
      fail(file, `${where}.targetType`, `"${target}" is not a target type`, 'Use role, user or email.');
    }
    if (target === 'role' && !String(n?.roleId ?? '').trim()) {
      fail(file, `${where}.roleId`, 'a role notification has to name a role');
    }
    if (target === 'user' && !String(n?.administratorId ?? '').trim()) {
      fail(file, `${where}.administratorId`, 'a person notification has to name one');
    }
    if (target === 'email' && !String(n?.email ?? '').trim()) {
      fail(file, `${where}.email`, 'an external notification has to carry an address');
    }
    if (target === 'role' && n?.scopeMode === 'fixed') {
      if (!['location', 'group', 'organisation'].includes(n?.scopeType)) {
        fail(
          file,
          `${where}.scopeType`,
          'a fixed scope has to say which kind',
          'Use location, group or organisation — or scopeMode "dynamic" to follow the lead.',
        );
      } else if (n.scopeType !== 'organisation' && !String(n?.scopeId ?? '').trim()) {
        fail(file, `${where}.scopeId`, `a fixed ${n.scopeType} scope has to name one`);
      }
    }
    if (deadBelow(notifications, i)) {
      note(
        file,
        `notification "${n?.name ?? n?.id ?? i}" can never fire: an unconditional notification ` +
          'above it already matches everything, and the first match wins. Move it up, or give the ' +
          'one above it conditions.',
      );
    }
  }
  if ((form?.status ?? 'live') === 'live' && !notifications.length) {
    note(
      file,
      'a live form with no notifications stores the submission and tells nobody. Add one, or the ' +
        'lead sits on the Leads screen until somebody thinks to look.',
    );
  }

  const confirmations = form?.confirmations ?? [];
  for (const [i, c] of confirmations.entries()) {
    const where = `confirmations[${i}]`;
    ruleSources(where, c?.rules);
    const type = c?.type ?? 'message';
    if (!['message', 'redirect'].includes(type)) {
      fail(file, `${where}.type`, `"${type}" is not a confirmation type`, 'Use message or redirect.');
    }
    if (type === 'message' && !String(c?.message ?? '').trim()) {
      fail(file, `${where}.message`, 'a confirmation that shows a message needs one');
    }
    if (type === 'redirect' && !String(c?.redirectUrl ?? '').trim()) {
      fail(file, `${where}.redirectUrl`, 'a confirmation that redirects needs somewhere to go');
    }
    if (deadBelow(confirmations, i)) {
      note(
        file,
        `confirmation "${c?.name ?? c?.id ?? i}" can never show: an unconditional confirmation ` +
          'above it already matches everything, and the first match wins.',
      );
    }
  }
}

const buttons = new Set();
const buttonsPath = join(SITE, 'buttons.json');
if (existsSync(buttonsPath)) {
  const { value, error } = readJson(buttonsPath);
  if (error) fail('site/buttons.json', '', `not valid JSON — ${error}`);
  else {
    const list = Array.isArray(value) ? value : (value?.buttons ?? []);
    for (const [i, button] of list.entries()) {
      if (!button?.id) fail('site/buttons.json', `[${i}].id`, 'every button needs an id');
      else buttons.add(button.id);
      if (!button?.url && !button?.formId) {
        fail('site/buttons.json', `[${i}]`, `"${button?.id ?? i}" has neither url nor formId — it links nowhere`);
      }
      if (button?.formId && !forms.has(button.formId)) {
        fail('site/buttons.json', `[${i}].formId`, `no form called "${button.formId}"`);
      }
    }
  }
}

/* ---------------------------------------------------------------- the pages */

const pagesPath = join(SITE, 'pages.json');
const pages = [];
if (!existsSync(pagesPath)) {
  fail('site/pages.json', '', 'missing', 'The manifest is what the dashboard lists; without it there are no pages.');
} else {
  const { value, error } = readJson(pagesPath);
  if (error) {
    fail('site/pages.json', '', `not valid JSON — ${error}`);
  } else {
    const list = Array.isArray(value) ? value : (value?.pages ?? []);
    if (!Array.isArray(list)) {
      fail('site/pages.json', '', 'must be an array of pages (or { "pages": [...] })');
    } else {
      const slugs = new Set();
      const paths = new Set();
      for (const [i, page] of list.entries()) {
        const at = `[${i}]`;
        for (const key of ['slug', 'title', 'path', 'out', 'dir']) {
          if (!page?.[key]) fail('site/pages.json', `${at}.${key}`, 'is required');
        }
        if (page?.slug) {
          if (slugs.has(page.slug)) fail('site/pages.json', `${at}.slug`, `"${page.slug}" appears twice`);
          slugs.add(page.slug);
        }
        if (page?.path) {
          if (paths.has(page.path)) fail('site/pages.json', `${at}.path`, `"${page.path}" appears twice`);
          paths.add(page.path);
        }
        // One authored page standing for many. Its `path` is a pattern and its
        // `out` is derived per location, so the fixed-path rules below cannot
        // apply — and the two ways of getting it wrong are both silent: a path
        // with no :slug writes every location over the same file, and a page
        // nobody has published yet emits nothing at all.
        if (isLocationPage(page)) {
          if (page?.path && !page.path.includes(SLUG_TOKEN)) {
            fail(
              'site/pages.json',
              `${at}.path`,
              `builds one page per location but has no "${SLUG_TOKEN}" in "${page.path}", so every location would overwrite the same file`,
              `Use a path like "/locations/${SLUG_TOKEN}".`,
            );
          }
          const doc = readJson(join(SITE, 'pages', page.dir ?? '', 'page.json')).value;
          if (!locationIndex(doc).length) {
            note(
              'site/pages.json',
              `"${page.slug}" builds one page per location and has no locations baked into it yet, so it emits nothing. Publishing writes them in.`,
            );
          }
          continue;
        }
        // `path` is the address a visitor types; `out` is the file written for it.
        // They are separate fields and nothing else checks that they agree, so a
        // page can be listed at /financing and written to about/index.html.
        if (page?.path && page?.out) {
          const expected =
            page.path === '/' ? 'index.html' : `${page.path.replace(/^\/+|\/+$/g, '')}/index.html`;
          if (page.out !== expected) {
            fail(
              'site/pages.json',
              `${at}.out`,
              `is "${page.out}" but path "${page.path}" builds to "${expected}"`,
              `Set out to "${expected}".`,
            );
          }
        }
        // Optional, and a plain list of strings. Worth checking only because a
        // string typed here instead of an array renders as one keyword made of
        // every character, which nothing else reports.
        if (page?.seo?.keywords !== undefined) {
          if (!Array.isArray(page.seo.keywords)) {
            fail(
              'site/pages.json',
              `${at}.seo.keywords`,
              'must be an array of strings',
              'Write ["used trucks", "tampa"], not a comma-separated string.',
            );
          } else if (page.seo.keywords.some((k) => typeof k !== 'string')) {
            fail('site/pages.json', `${at}.seo.keywords`, 'must contain only strings');
          }
        }
        // Checked against the vocabulary the platform baked for whichever
        // providers this dealer enabled, and unconstrained when there is none —
        // a dealer in no programme authors whatever word describes the page.
        //
        // Optional either way, and a note rather than a failure when absent.
        // Every existing dealer repo predates the field, and
        // `syncPlatformFiles()` reaches those repos on publish rather than on a
        // schedule — a repo at renderer 4.7.0 against 4.9.0 is the live proof
        // that they drift. Making absence a failure today would break the next
        // save in every unsynced repo.
        if (page?.pageType !== undefined && !isValidPageType(page.pageType, analyticsVocab)) {
          const allowed = pageTypeOptions(analyticsVocab);
          fail(
            'site/pages.json',
            `${at}.pageType`,
            `"${page.pageType}" is not a page kind any enabled analytics provider accepts`,
            `Values are case sensitive. One of: ${allowed.join(', ')}.`,
          );
        } else if (page?.pageType === undefined) {
          note(
            'site/pages.json',
            `"${page?.slug ?? at}" has no pageType, so analytics cannot tell what kind ` +
              'of page it is. Set one in Pages → page settings.',
          );
        }

        if (page?.dir) pages.push(page);
      }
    }
  }
}

const CONDITION_IDS = CONDITION_TYPES.map(c => c.id);
const pageSlugs = new Set(pages.map(p => p.slug));
/** The Admin location slugs publish has baked into this repo, if any. */
const bakedLocationSlugs = new Set(
  pages
    .filter(isLocationPage)
    .flatMap(p => locationIndex(readJson(join(SITE, 'pages', p.dir ?? '', 'page.json')).value))
    .map(l => l.slug),
);
let sitewideTemplate = false;

/* Component ids have to exist before pages and templates are checked — a
   `sharedSection` on a page names one of these, and `checkReferences` reads
   the set. Validation of the component files themselves still happens later. */
const sectionIds = new Set();
/* Their trees too: a rooftop page usually places its locations and hours widgets
   through a component, so "does this page show location X" cannot be answered
   from the page alone. */
const sectionNodes = new Map();
/* And their declared props, because a placement may point a list prop at a live
   data source and only the declaration says which props are lists. */
const sectionProps = new Map();
for (const file of listJson(join(SITE, 'sections'))) {
  const { value } = readJson(join(SITE, 'sections', file));
  const id = value?.id ?? file.replace(/\.json$/, '');
  sectionIds.add(id);
  sectionNodes.set(id, value?.nodes ?? []);
  sectionProps.set(id, parseComponentProps(value?.props));
}

/* ----------------------------------------------------------- page documents */

const templateIds = new Set();
for (const file of listJson(join(SITE, 'templates'))) {
  const path = join(SITE, 'templates', file);
  const { value, error } = readJson(path);
  if (error) {
    fail(rel(path), '', `not valid JSON — ${error}`);
    continue;
  }
  const id = file.replace(/\.json$/, '');
  const parsed = parseTemplate(value, id);
  if (!parsed) {
    fail(rel(path), '', 'could not be read as a template');
    continue;
  }
  templateIds.add(parsed.id);
  // Display conditions decide which pages a template wraps, and an unrecognised
  // type simply never matches — so the template builds, validates, and silently
  // appears on nothing. That is the most expensive kind of mistake here: the
  // header exists in the repo and on no page, with nothing to explain it.
  const conditions = Array.isArray(value?.conditions) ? value.conditions : [];
  if (!conditions.length) {
    fail(
      rel(path),
      'conditions',
      'has no display conditions, so it wraps no pages',
      `Add one, e.g. { "type": "entireSite" }. Types: ${CONDITION_IDS.join(', ')}.`,
    );
  }
  for (const [i, condition] of conditions.entries()) {
    if (!CONDITION_IDS.includes(condition?.type)) {
      fail(
        rel(path),
        `conditions[${i}].type`,
        `"${condition?.type}" is not a display condition, so this template matches nothing`,
        `One of: ${CONDITION_IDS.join(', ')}.`,
      );
      continue;
    }
    const spec = CONDITION_TYPES.find(c => c.id === condition.type);
    if (spec?.ref && !condition.ref) {
      fail(rel(path), `conditions[${i}].ref`, `a "${condition.type}" condition needs a ref`);
    }
    if (spec?.ref === 'page' && condition.ref && !pageSlugs.has(condition.ref)) {
      fail(rel(path), `conditions[${i}].ref`, `no page with slug "${condition.ref}"`);
    }
    if (['entireSite', 'allPages'].includes(condition.type)) sitewideTemplate = true;
  }
  const { errors, warnings } = validateTemplate(value);
  for (const issue of errors) fail(rel(path), issue.path, issue.message);
  for (const issue of warnings) note(rel(path), `${issue.path}: ${issue.message}`);
  reportUnknownTypes(rel(path), parsed.nodes);
  reportHandTaggedMarkup(rel(path), parsed.nodes);
  checkReferences(rel(path), parsed.nodes);
  reportStackedSiblings(rel(path), parsed.nodes);
  reportRepeatedShapes(rel(path), parsed.nodes);
  collectBehaviours(parsed.nodes);
}

for (const page of pages) {
  const path = join(SITE, 'pages', page.dir, 'page.json');
  if (!existsSync(path)) {
    // A repo written before the block model may still carry body.html, and the
    // build supports it — but the dashboard cannot edit it on the canvas.
    if (existsSync(join(SITE, 'pages', page.dir, 'body.html'))) {
      note(
        `site/pages/${page.dir}/`,
        'has body.html and no page.json — it builds, but the editor shows a conversion banner instead of a canvas',
      );
    } else {
      fail(
        `site/pages/${page.dir}/page.json`,
        '',
        `missing, but site/pages.json lists the page "${page.slug}"`,
        'Write { "version": 2, "nodes": [] } and build the page up from there.',
      );
    }
    continue;
  }
  const { value, error } = readJson(path);
  if (error) {
    fail(rel(path), '', `not valid JSON — ${error}`);
    continue;
  }
  const { errors, warnings } = validateDocument(value);
  for (const issue of errors) fail(rel(path), issue.path, issue.message);
  for (const issue of warnings) note(rel(path), `${issue.path}: ${issue.message}`);
  reportUnknownTypes(rel(path), value?.nodes ?? []);
  reportHandTaggedMarkup(rel(path), value?.nodes ?? []);
  checkReferences(rel(path), value?.nodes ?? []);
  reportStackedSiblings(rel(path), value?.nodes ?? []);
  reportRepeatedShapes(rel(path), value?.nodes ?? []);
  collectBehaviours(value?.nodes ?? []);

  for (const [slot, id] of Object.entries(page.templates ?? {})) {
    if (id && !templateIds.has(id)) {
      fail('site/pages.json', `${page.slug}.templates.${slot}`, `no template called "${id}"`);
    }
  }

  reportRooftop(page, value?.nodes ?? []);
}

/**
 * A rooftop page's structured data is built from its own widget snapshots, so a
 * page that claims to be a location without carrying that location's data emits
 * nothing — silently, and only in production, which is the worst combination.
 */
function reportRooftop(page, nodes) {
  const slug = page.locationSlug;
  if (!slug) {
    if (/^\/locations\/[^/]+$/.test(page.path || '')) {
      note(
        'site/pages.json',
        `"${page.slug}" looks like a rooftop page but has no locationSlug, so it emits the ` +
          'company address rather than this branch\'s. Set it to the slug in Admin → Locations.',
      );
    }
    return;
  }
  if (!placesWidget(nodes, 'locations-map', slug)) {
    fail(
      'site/pages.json',
      `${page.slug}.locationSlug`,
      `the page declares location "${slug}" but places no locations widget for it, so ` +
        'there is nothing to build its address from',
      'Add a "locations-map" widget with the same locationSlug — directly, or through a ' +
        'component whose locationSlug value matches — then publish.',
    );
  } else if (!placesWidget(nodes, 'hours', slug)) {
    note(
      `site/pages/${page.dir}/page.json`,
      `rooftop page "${slug}" has no hours widget for it, so its structured data carries ` +
        'an address but no opening hours.',
    );
  }
}

/**
 * Is this widget placed for this rooftop — directly, or inside a component whose
 * `locationSlug` value matches? A component's own widgets read `{{locationSlug}}`,
 * so the placement is the only place the real slug appears.
 */
function placesWidget(nodes, id, slug) {
  let found = false;
  walkNodes({ nodes }, node => {
    if (node.type === 'widget' && node.props?.widget === id) {
      const configured = node.props?.config?.locationSlug;
      if (!configured || configured === slug) found = true;
    }
    if (node.type === 'sharedSection' && node.props?.values?.locationSlug === slug) {
      const section = sectionNodes.get(node.props.sectionId);
      if (section) {
        walkNodes({ nodes: section }, inner => {
          if (inner.type === 'widget' && inner.props?.widget === id) found = true;
        });
      }
    }
  });
  return found;
}

/* ---------------------------------------------------- sections (components) */

for (const file of listJson(join(SITE, 'sections'))) {
  const path = join(SITE, 'sections', file);
  const { value, error } = readJson(path);
  if (error) {
    fail(rel(path), '', `not valid JSON — ${error}`);
    continue;
  }
  const id = value?.id ?? file.replace(/\.json$/, '');
  sectionIds.add(id);
  if (value?.id && value.id !== file.replace(/\.json$/, '')) {
    fail(rel(path), 'id', `is "${value.id}" but the file is named "${file}"`);
  }
  const { errors, warnings } = validateDocument(value);
  for (const issue of errors) fail(rel(path), issue.path, issue.message);
  for (const issue of warnings) note(rel(path), `${issue.path}: ${issue.message}`);
  reportUnknownTypes(rel(path), value?.nodes ?? []);
  reportHandTaggedMarkup(rel(path), value?.nodes ?? []);
  checkReferences(rel(path), value?.nodes ?? []);
  reportStackedSiblings(rel(path), value?.nodes ?? []);
  reportRepeatedShapes(rel(path), value?.nodes ?? []);
  collectBehaviours(value?.nodes ?? []);
}

/* --------------------------------------------------------------------- blog */

for (const file of listJson(join(SITE, 'blog', 'posts'))) {
  const path = join(SITE, 'blog', 'posts', file);
  const { value, error } = readJson(path);
  if (error) {
    fail(rel(path), '', `not valid JSON — ${error}`);
    continue;
  }
  if (!value?.slug) fail(rel(path), 'slug', 'is required');
  if (!value?.title) fail(rel(path), 'title', 'is required');
  if (!value?.date) note(rel(path), 'no date — posts are ordered by date, so this one sorts last');
  if (value?.nodes || value?.blocks) {
    const { errors } = validateDocument(value);
    for (const issue of errors) fail(rel(path), issue.path, issue.message);
    reportUnknownTypes(rel(path), value.nodes ?? value.blocks ?? []);
    reportHandTaggedMarkup(rel(path), value.nodes ?? value.blocks ?? []);
  }
}

/* ------------------------------------------------- custom-code.json staging */

reportScriptedMotion();

/* -------------------------------------------------------------------- menus */

const storefrontPrefix = String(
  (existsSync(join(ROOT, 'dealer.config.json'))
    ? readJson(join(ROOT, 'dealer.config.json')).value?.storefrontPrefix
    : null) || 'store',
).replace(/^\/+|\/+$/g, '');
const storefrontUrl = new RegExp(`^/${storefrontPrefix}(?:[/?#]|$)`);

const menusPath = join(SITE, 'menus.json');
if (existsSync(menusPath)) {
  const { value, error } = readJson(menusPath);
  if (error) {
    fail('site/menus.json', '', `not valid JSON — ${error}`);
  } else {
    const menus = listMenus(parseMenus(value));
    const seen = new Set();
    for (const menu of menus) {
      if (seen.has(menu.id)) fail('site/menus.json', menu.id, 'two menus share this id');
      seen.add(menu.id);
      const walk = (items, where) => {
        for (const [i, item] of (items ?? []).entries()) {
          const at = `${where}[${i}]`;
          if (!item?.label) fail('site/menus.json', at, 'every item needs a label');
          if (item?.type && !MENU_ITEM_TYPES.includes(item.type)) {
            fail('site/menus.json', `${at}.type`, `"${item.type}" is not one of ${MENU_ITEM_TYPES.join(', ')}`);
          }
          // A location item's `ref` is an Admin slug, and which slugs exist is a
          // fact about the dealer's account rather than about this repo. Warned,
          // never failed: a repo that has not been published yet knows of none,
          // and refusing to validate it would make the feature unusable offline.
          if (item?.type === 'location' && item.ref && !bakedLocationSlugs.has(item.ref)) {
            note(
              'site/menus.json',
              `${at}.ref points at location "${item.ref}", which is not in the locations baked into this repo. It will resolve once that location is published, and link nowhere until then.`,
            );
          }
          if (item?.type === 'page' && item.ref && !pageSlugs.has(item.ref)) {
            fail('site/menus.json', `${at}.ref`, `no page with slug "${item.ref}"`, 'Menu items point at a page by slug, not by address.');
          }
          if (item?.type === 'url' && !item.url) fail('site/menus.json', `${at}.url`, 'a url item needs a url');
          if (item?.type === 'url' && storefrontUrl.test(String(item.url ?? ''))) {
            fail(
              'site/menus.json',
              `${at}.url`,
              `"${item.url}" types out the storefront prefix`,
              'The prefix is configuration and changes without warning this file. Use { "type": "inventory", "ref": "…" }, where ref names the route — "inventory", "parts", "search", optionally with a query string.',
            );
          }
          if (item?.type === 'inventory' && !item.ref) {
            note(
              'site/menus.json',
              `${at} ("${item.label}") points at the storefront's landing page, because it names no route — "inventory" or "parts" is usually what a nav item this deep means`,
            );
          }
          walk(item?.children, `${at}.children`);
        }
      };
      walk(menu.items, `${menu.id}.items`);
    }
  }
}

// A site whose pages match no template renders with no header and no footer.
// Legal — a one-page site may want that — but almost never intended.
if (templateIds.size && !sitewideTemplate) {
  note(
    'site/templates/',
    'no template has an entireSite or allPages condition, so any page not matched by a more specific one renders with no header or footer',
  );
}

/* ------------------------------------------------- can the platform adopt it? */
// The dashboard refuses to connect a repo that is not a dealer site, and it
// checks exactly these four files. Checking them here means an author finds out
// before pushing rather than from a refusal in the UI.

for (const path of ['renderer/index.mjs', 'scripts/build.mjs', 'dealer.config.json', 'vercel.json']) {
  if (!existsSync(join(ROOT, path))) {
    fail(
      path,
      '',
      'missing — the dashboard will refuse to connect this repo',
      'Generate the repo from the site template rather than building the tree by hand.',
    );
  }
}

const configPath = join(ROOT, 'dealer.config.json');
if (existsSync(configPath)) {
  const { value, error } = readJson(configPath);
  if (error) {
    fail('dealer.config.json', '', `not valid JSON — ${error}`);
  } else {
    for (const key of ['name', 'business', 'seo']) {
      if (!value?.[key]) fail('dealer.config.json', key, 'is required');
    }
    // Placeholders are correct before adoption: the platform writes the channel
    // token, domain and storefront origin when the channel connects the repo.
    if (JSON.stringify(value).includes('REPLACE_')) {
      note(
        'dealer.config.json',
        'still carries REPLACE_ placeholders — right, if this repo has not been connected to a channel yet. The platform fills them in on connect.',
      );
    }
  }
}

/**
 * `site/redirects.json` — the dealer's redirects: old addresses and where they go.
 *
 * The rules are kept in BuzzNerd Admin (Storefront → 301 Redirects) and written here
 * by **Sync from Admin** and by Publish, stamped `"managedBy": "admin"`. Once
 * stamped the file is a copy, and a hand edit is overwritten by the next sync —
 * so this checks it rather than inviting edits to it.
 *
 * Kept in the dealer's own tree rather than only in `vercel.json`: that file is
 * platform-owned and rebuilt from the template on every engine sync. The
 * platform composes this file into `vercel.json` when it bakes.
 *
 * Absent is the normal case. A site with no redirects has no such file, and that
 * is not worth a note.
 */
const redirectsPath = join(SITE, 'redirects.json');
if (existsSync(redirectsPath)) {
  const { value, error } = readJson(redirectsPath);
  if (error) {
    fail('site/redirects.json', '', `not valid JSON — ${error}`);
  } else {
    const list = Array.isArray(value) ? value : (value?.redirects ?? []);
    if (!Array.isArray(list)) {
      fail('site/redirects.json', '', 'must be an array of redirects (or { "redirects": [...] })');
    } else {
      const sources = new Set();
      const livePaths = new Set(pages.map((p) => p.path));
      for (const [i, rule] of list.entries()) {
        const at = `[${i}]`;
        for (const key of ['from', 'to']) {
          if (!rule?.[key]) fail('site/redirects.json', `${at}.${key}`, 'is required');
        }
        if (rule?.from && !String(rule.from).startsWith('/')) {
          fail('site/redirects.json', `${at}.from`, `"${rule.from}" must start with "/"`);
        }
        if (rule?.from) {
          if (sources.has(rule.from)) {
            fail('site/redirects.json', `${at}.from`, `"${rule.from}" appears twice`);
          }
          sources.add(rule.from);
        }
        // A redirect away from an address the site still builds is dead weight
        // at best: the static file wins on some hosts and the rule wins on
        // others, so which one a visitor gets stops being knowable.
        if (rule?.from && livePaths.has(rule.from)) {
          fail(
            'site/redirects.json',
            `${at}.from`,
            `"${rule.from}" is also a page this site builds`,
            'Redirect from an address nothing serves, or delete the page.',
          );
        }
        if (rule?.from && rule.from === rule?.to) {
          fail('site/redirects.json', `${at}.from`, `"${rule.from}" redirects to itself`);
        }
        if (rule?.statusCode !== undefined && ![301, 302, 307, 308].includes(rule.statusCode)) {
          fail(
            'site/redirects.json',
            `${at}.statusCode`,
            `${JSON.stringify(rule.statusCode)} is not a redirect status`,
            'Use 301, 302, 307 or 308.',
          );
        }
      }
      // Two hops is a chain search engines follow grudgingly and some clients
      // not at all. It happens naturally: rename a page twice and the first
      // rule still points at the second name.
      for (const rule of list) {
        if (rule?.to && sources.has(rule.to)) {
          note(
            'site/redirects.json',
            `"${rule.from}" redirects to "${rule.to}", which itself redirects. Point the first straight at the final address.`,
          );
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ helpers */

function collectBehaviours(nodes) {
  eachNode(nodes, (node) => {
    if (node.id && node.props?.behaviour) behaviourNodes.add(node.id);
  });
}

function eachNode(nodes, visit, path = 'nodes') {
  for (const [i, node] of (nodes ?? []).entries()) {
    const at = `${path}[${i}]`;
    if (node && typeof node === 'object') {
      visit(node, at);
      if (Array.isArray(node.children)) eachNode(node.children, visit, `${at}.children`);
    }
  }
}

/**
 * A node type nothing can render.
 *
 * Called out separately from schema validation because the failure mode is the
 * quietest one in the system: the renderer skips an unknown type with a warning,
 * so the page builds, deploys and simply has a hole where the section was.
 */
/**
 * Certified analytics events must never originate from `customHtml` or a coded
 * widget.
 *
 * The block model's whole tagging guarantee rests on the renderer emitting
 * `data-bz-el` / `data-bz-intent` structurally, so the AI cannot strip an
 * attribute it never authors. `customHtml` and coded widgets are the two places
 * an author writes markup directly, and markup written by hand carries whatever
 * attributes the author remembered — which is how a certified site quietly stops
 * reporting a CTA that somebody rebuilt as a hand-written link.
 *
 * They are not banned outright: both render, both are legitimate for markup no
 * block expresses, and the build already warns that `customHtml` is not
 * auto-tagged. What is refused is markup that *claims* to be a tagged element,
 * because that claim is what makes the loss invisible — the element looks
 * instrumented and reports nothing anybody maintains.
 */
function reportHandTaggedMarkup(file, nodes) {
  // Every analytics attribute the renderer emits structurally. Widened rather
  // than enumerated per provider: a hand-written `data-bz-` analytics attribute
  // is the problem whatever its name, and a list that lags the renderer would
  // pass exactly the ones nobody thought of.
  const TAGGED = /\bdata-bz-(el|intent|cta|analytics|field-analytics|link-type|department|brochure|asset|vehicle)\s*=/;
  eachNode(nodes, (node, path) => {
    if (node?.type !== 'customHtml') return;
    const html = node?.props?.html;
    if (typeof html === 'string' && TAGGED.test(html)) {
      fail(
        file,
        path,
        'hand-writes an analytics attribute inside customHtml',
        'Certified events come from real blocks, which emit these attributes structurally. ' +
          'Hand-written ones survive until the next AI edit and then silently stop reporting — ' +
          'use a buttons, menu, form or link block instead.',
      );
    }
  });
}

function reportUnknownTypes(file, nodes) {
  eachNode(nodes, (node, at) => {
    if (!node.type) {
      fail(file, at, 'has no type');
      return;
    }
    if (!knownTypes.has(node.type)) {
      fail(
        file,
        `${at}.type`,
        `"${node.type}" is not a block this renderer has`,
        'Run `npm run schemas` and pick an id from renderer/block-schemas.json, or author it as a custom widget under site/widgets/.',
      );
    }
  });
}

/**
 * Siblings stacked on one spot until a script separates them.
 *
 * A staged design — a coverflow, a deck — gives every card `position: absolute`
 * and lets `site/custom-code.json` place each one from an attribute its script
 * sets. That renders correctly on the published page and nowhere else: the
 * dashboard's Design canvas draws the tree *without* site JS, because the editor
 * owns that DOM, so the dealer sees one card and cannot reach the other four.
 * The live page's own first paint has the same problem until the script runs.
 *
 * The fix is a no-JS state, not a different layout: a `:not(.is-staged)` (or
 * equivalent) rule that leaves the cards in flow, with the script adding the
 * class before it stages them.
 */
function reportStackedSiblings(file, nodes) {
  const positioned = (node) =>
    Object.values(node?.styles ?? {}).some(
      (bucket) => bucket && typeof bucket === 'object' && bucket.position === 'absolute',
    );

  const check = (list, at) => {
    const stacked = (list ?? []).filter((node) => node && positioned(node));
    if (stacked.length > 1) {
      note(
        file,
        `${at}: ${stacked.length} sibling nodes (${stacked
          .map((n) => n.id)
          .join(', ')}) are position:absolute, so they sit on top of each other ` +
          'until a script moves them. The dashboard canvas runs no site JS, so only the ' +
          'last one can be selected there — give the un-staged state an in-flow layout in ' +
          'site/custom-code.json (e.g. a :not(.is-staged) rule the script switches off).',
      );
    }
    for (const [i, node] of (list ?? []).entries()) {
      if (node && Array.isArray(node.children)) check(node.children, `${at}[${i}].children`);
    }
  };
  check(nodes, 'nodes');
}

/**
 * Motion hand-written in `site/custom-code.json` where a behaviour belongs.
 *
 * A coverflow whose cards are placed by CSS keyed on an attribute the site's own
 * script sets is a carousel rebuilt from scratch: it needs its own script, its
 * own arrows, its own keyboard handling and its own accessible state, and it gets
 * none of that for free. It also only exists once the script has run, so the
 * dashboard's canvas — which runs no site JS — cannot lay it out at all.
 *
 * `behaviour: "carousel"` on the container with `part: "slide"` on each card gives
 * the platform's implementation instead: arrows, dots, keyboard, reduced-motion
 * and an un-enhanced state that is already in flow. Same for `rotator`, `filter`,
 * `dropdown`, `drawer`, `scrollstate`, `dependentselect` and `mapsync`.
 */
function reportScriptedMotion() {
  const path = join(SITE, 'custom-code.json');
  if (!existsSync(path)) return;
  const { value, error } = readJson(path);
  if (error || typeof value?.css !== 'string') return;

  const staged = new Map();
  for (const rule of value.css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, selector, body] = rule;
    if (!/transform\s*:|position\s*:\s*absolute/.test(body)) continue;
    for (const hit of selector.matchAll(/\[data-bz-node="([^"]+)"\]([^,]*)/g)) {
      const [, id, inside] = hit;
      if (!inside.trim() || behaviourNodes.has(id)) continue;
      // What separates staging from styling is the hook: an attribute or state
      // class the platform never emits, which means a script of the site's own is
      // expected to set it. `… > .bz-col[data-pos="0"] { transform: … }` is a
      // carousel; `… .bz-btn { position: absolute }` is just a button.
      if (!/\[(?!data-bz-)[a-z-]+|\.(is|has)-[a-z-]+/i.test(inside)) continue;
      staged.set(id, (staged.get(id) ?? 0) + 1);
    }
  }

  for (const [id, rules] of staged) {
    note(
      'site/custom-code.json',
      `${rules} rule(s) position or transform the children of "${id}", which declares no ` +
        'behaviour. If one of the platform behaviours does this, use it: `behaviour` on that node ' +
        '(carousel, rotator, filter, dropdown, drawer, scrollstate, dependentselect, mapsync) and ' +
        "`part` on the moving pieces — see renderer/behaviours.mjs for each behaviour's part " +
        'names. If none of them does, the script is fine, but this staging only exists once it has ' +
        'run: give the un-staged state a real in-flow layout the script turns off, or the ' +
        'dashboard canvas (which runs no site JS) shows one card and hides the rest.',
    );
  }
}

/**
 * The same shape, built by hand several times over.
 *
 * Cards written out one subtree each build and validate, and every one of them is
 * a separate thing to maintain: one wording change is N edits, one more card is a
 * copy-paste, and nothing about them says they are one list. A repeating shape
 * belongs to a prebuilt block whose items are props (`iconGrid`, `categoryGrid`,
 * `serviceGrid`, `statBand`, `testimonials`, `logoStrip`), to a component under
 * `site/sections/` with a list prop and one node carrying `repeat`, or to a coded
 * widget under `site/widgets/` with typed props. All three give the dealer one
 * place to edit and one list to extend.
 */
function reportRepeatedShapes(file, nodes) {
  // Types and nesting only. Two cards with different copy are the same shape,
  // which is the whole point; a card and a form are not.
  const shapeOf = (node) =>
    `${node.type}(${(node.children ?? [])
      .filter((child) => child && typeof child === 'object')
      .map(shapeOf)
      .join(',')})`;

  const check = (list, at) => {
    const groups = new Map();
    for (const node of list ?? []) {
      if (!node || typeof node !== 'object' || !node.type) continue;
      // A bare column or row with nothing in it is scaffolding, not a shape.
      if (!(node.children ?? []).length) continue;
      const shape = shapeOf(node);
      if (!groups.has(shape)) groups.set(shape, []);
      groups.get(shape).push(node);
    }
    for (const [shape, group] of groups) {
      if (group.length < 3) continue;
      note(
        file,
        `${at}: ${group.length} siblings (${group.map((n) => n.id).join(', ')}) are the same shape ` +
          `— ${shape}. Written out one by one, each is edited on its own and the set cannot grow ` +
          'without hand-copying JSON. Use a prebuilt block whose items are props, a component ' +
          'under site/sections/ with a list prop and one node carrying `repeat` (which only binds ' +
          'inside a component — on a page it is ignored), or a coded widget under site/widgets/ ' +
          'with typed props.',
      );
    }
    for (const [i, node] of (list ?? []).entries()) {
      if (node && Array.isArray(node.children)) check(node.children, `${at}[${i}].children`);
    }
  };
  check(nodes, 'nodes');
}

/**
 * A placement pointing a list prop at live dealer data.
 *
 * Every failure here renders as an empty band rather than an error, which is the
 * worst way to find out: the page builds, publishes, and shows nothing where the
 * locations were. So each one is caught at the only point the names can be
 * cross-checked — the placement knows the source, the component knows which of
 * its props are lists, and the catalogue knows which fields the source owns.
 */
function checkDataBindings(file, at, props) {
  const declared = sectionProps.get(props.sectionId) ?? [];
  const byKey = new Map(declared.map(p => [p.key, p]));

  for (const [key, value] of Object.entries(props.values ?? {})) {
    if (!isDataBinding(value)) continue;
    const where = `${at}.props.values.${key}`;
    const prop = byKey.get(key);

    if (!prop) {
      fail(file, where, `"${props.sectionId}" declares no prop called "${key}"`);
      continue;
    }
    if (prop.type !== 'list') {
      fail(file, where, `"${key}" is a ${prop.type} prop; only a list can come from a data source`);
      continue;
    }
    const source = dataSource(value.source);
    if (!source) {
      const known = DATA_SOURCES.map(s => s.id).join(', ');
      fail(file, `${where}.source`, `no data source called "${value.source}" — try one of: ${known}`);
      continue;
    }

    // A field the tree binds to that the source does not carry renders as empty
    // text forever, and reads on the canvas as "the data is not arriving".
    const owned = new Set(source.fields.map(f => f.key));
    const overlaid = new Set();
    for (const [i, row] of (value.overlay ?? []).entries()) {
      if (!row || typeof row !== 'object') {
        fail(file, `${where}.overlay[${i}]`, 'must be an object');
        continue;
      }
      if (row[source.match] == null || row[source.match] === '') {
        fail(file, `${where}.overlay[${i}]`, `needs "${source.match}" to say which row it belongs to`);
      }
      for (const field of Object.keys(row)) {
        if (field === source.match) continue;
        if (owned.has(field)) {
          fail(
            file,
            `${where}.overlay[${i}].${field}`,
            `"${field}" comes from ${source.label} and would go stale if typed here — remove it`,
          );
          continue;
        }
        overlaid.add(field);
      }
    }

    for (const field of prop.fields ?? []) {
      if (owned.has(field.key) || overlaid.has(field.key)) continue;
      note(file, `${where}: "${field.key}" is not in ${source.label} and no overlay row sets it — it renders empty`);
    }

    // `{"locationSlug": "{{locationSlug}}"}` is how a generated location page
    // scopes a band to its own branch. Only a declared prop reaches the binding,
    // so an undeclared one is dropped and the platform bakes no rows at all.
    for (const [key, raw] of Object.entries(value.config ?? {})) {
      const binding = typeof raw === 'string' ? raw.trim().match(/^\{\{\s*([\w.-]+)\s*\}\}$/) : null;
      if (!binding) continue;
      if (!byKey.has(binding[1])) {
        fail(
          file,
          `${where}.config.${key}`,
          `"${props.sectionId}" declares no prop called "${binding[1]}" — the binding cannot be filled in and the band bakes empty`,
        );
      }
    }
  }
}

/** Library ids a node points at, which no schema can check. */
function checkReferences(file, nodes) {
  eachNode(nodes, (node, at) => {
    const props = node.props ?? {};
    if (node.type === 'form' && props.formId && !forms.has(props.formId)) {
      fail(file, `${at}.props.formId`, `no form called "${props.formId}"`);
    }
    if (node.type === 'sharedSection' && props.sectionId && !sectionIds.has(props.sectionId)) {
      fail(file, `${at}.props.sectionId`, `no component called "${props.sectionId}"`);
    }
    if (node.type === 'sharedSection') checkDataBindings(file, at, props);
    for (const [i, item] of (props.items ?? []).entries()) {
      if (item?.ctaId && !buttons.has(item.ctaId)) {
        fail(file, `${at}.props.items[${i}].ctaId`, `no button called "${item.ctaId}"`);
      }
    }
    for (const [i, cta] of (props.ctas ?? []).entries()) {
      if (cta?.ctaId && !buttons.has(cta.ctaId)) {
        fail(file, `${at}.props.ctas[${i}].ctaId`, `no button called "${cta.ctaId}"`);
      }
    }
    if (props.cta?.ctaId && !buttons.has(props.cta.ctaId)) {
      fail(file, `${at}.props.cta.ctaId`, `no button called "${props.cta.ctaId}"`);
    }
  });
}

/* ------------------------------------------------------------------- report */

if (!QUIET) {
  const catalogue = blockCatalogue();
  console.log(`renderer ${RENDERER_VERSION} · ${catalogue.length} block types · ${pages.length} page(s)`);
  console.log(
    `libraries: ${forms.size} form(s), ${buttons.size} button(s), ${templateIds.size} template(s), ` +
      `${sectionIds.size} component(s), ${widgetDefs.length} custom widget(s)`,
  );
}

if (notes.length && !QUIET) {
  console.log(`\n${notes.length} note(s) — these build, but read them:`);
  for (const n of notes) console.log(`  · ${n.file}: ${n.message}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) {
    console.error(`  ✗ ${p.file}${p.where ? ` → ${p.where}` : ''}: ${p.message}`);
    if (p.fix) console.error(`      ${p.fix}`);
  }
  console.error('\nNothing was changed. Fix these and run `npm run validate` again.');
  process.exit(1);
}

console.log('\nsite/ is valid — the dashboard can open this repo and the build will render it.');

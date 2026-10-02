// Form rendering. A form is defined once in `site/forms/<id>.json` and referenced
// by id from a page, so validation, consent and notification routing live in one
// place instead of being re-invented per page by whoever (or whatever) edits it.
//
// Submission is same-origin through the storefront prefix: the dealer's own
// domain proxies `/store/*` to the Remix app, which forwards to the Shop API.
// That keeps the visitor cookie first-party and means the published static site
// still needs no server runtime of its own.

import { attrs, esc, join, tagAttrs } from './html.mjs';

/** Field types the builder offers, grouped as the palette presents them. */
export const FIELD_TYPES = {
  basic: ['single_line', 'paragraph', 'email', 'phone', 'number', 'date', 'file'],
  choice: ['radio', 'checkboxes', 'dropdown'],
  identity: ['first_name', 'last_name', 'full_name'],
};

/**
 * Where a hidden field's value comes from.
 *
 * A hidden field is still a field: it never reaches the visitor, but it is
 * stored on the submission and is available to conditions and to notification
 * rules. `static` is the dealer's own constant; the rest are captured from the
 * page by the platform client at load.
 *
 * `productId` is the one the server must not believe. The client fills it so the
 * dealer can see it on the submission, and the server re-resolves it from the
 * page's product context before anything reads it as a listing — a hidden input
 * is a field, and a field is something a bot can rewrite.
 */
export const VALUE_SOURCES = [
  'static',
  'query',
  'referrer',
  'pageUrl',
  'utmSource',
  'utmCampaign',
  'utmMedium',
  'productId',
];

/**
 * Condition sources a form embedded on a product page gets in addition to its
 * own fields, so a form can route by the listing rather than by an answer.
 *
 * Prefixed rather than bare, because a rule names one flat space and a dealer
 * may well have a field of their own called `location`. The values arrive with
 * the submission's product context, never from the browser.
 */
export const SPEC_SOURCES = [
  { id: 'spec:location', label: 'Spec: Location' },
  { id: 'spec:department', label: 'Spec: Department' },
  { id: 'spec:type', label: 'Spec: Product type' },
  { id: 'spec:category', label: 'Spec: Category' },
];

const INPUT_TYPE = {
  single_line: 'text',
  email: 'email',
  phone: 'tel',
  number: 'number',
  date: 'date',
  file: 'file',
  first_name: 'text',
  last_name: 'text',
  full_name: 'text',
};

const AUTOCOMPLETE = {
  email: 'email',
  phone: 'tel',
  first_name: 'given-name',
  last_name: 'family-name',
  full_name: 'name',
};

/** Operators each field type supports, mirrored by the dashboard's logic editor. */
export function operatorsForFieldType(type) {
  if (FIELD_TYPES.choice.includes(type)) return ['is', 'is_not'];
  if (type === 'number') return ['is', 'is_not', 'greater_than', 'less_than'];
  if (type === 'date') return ['is', 'is_not', 'before', 'after'];
  if (type === 'file') return ['is_empty', 'is_not_empty'];
  return ['is', 'is_not', 'contains', 'is_empty', 'is_not_empty'];
}

/**
 * The confirmation shown when nothing conditional matches.
 *
 * Confirmations are ordered and first-match-wins, and the server decides which
 * one fired. This is the copy the page carries before it has an answer: the
 * first entry with no rules, because that is the one that would have matched had
 * the visitor answered nothing at all. A list whose entries are all conditional
 * has no such entry, and the form's own `successMessage` stands in.
 */
export function defaultConfirmation(form) {
  const list = (form && form.confirmations) || [];
  for (const entry of list) {
    if (!entry || (entry.rules && entry.rules.length)) continue;
    return entry;
  }
  return null;
}

function fieldName(field) {
  return field.name || field.id;
}
/**
 * A form's or a field's analytics annotations, as they reach the browser.
 *
 * Namespaced by provider id — `{"shift-digital": {"formType": "Get a Quote"}}` —
 * because the values are each provider's own restricted vocabulary. Two
 * providers wanting a different form type for the same form is normal, and a
 * flat bag would have one of them silently overwrite the other.
 *
 * The renderer does not interpret any of it. It copies string leaves and drops
 * everything else: an object or an array would serialise into an event property
 * no provider can read, and shipping `[object Object]` as a form type is worse
 * than shipping nothing.
 */
function analyticsBag(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const out = {};
  let any = false;
  for (const [providerId, values] of Object.entries(source)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    const kept = {};
    let keptAny = false;
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string' || value === '') continue;
      kept[key] = value;
      keptAny = true;
    }
    if (!keptAny) continue;
    out[providerId] = kept;
    any = true;
  }
  return any ? JSON.stringify(out) : null;
}

function renderChoices(field, name) {
  const options = field.options || [];
  if (field.type === 'dropdown') {
    return `<select class="bz-input" id="${esc(field.id)}" name="${esc(name)}"${attrs({
      required: !!field.required,
    })}>
  <option value="">${esc(field.placeholder || 'Choose…')}</option>
${join(
  options.map((o) => `  <option value="${esc(o.value ?? o.label)}">${esc(o.label)}</option>`),
  '\n',
)}
</select>`;
  }
  const type = field.type === 'checkboxes' ? 'checkbox' : 'radio';
  const inputName = type === 'checkbox' ? `${name}[]` : name;
  return `<div class="bz-choices" role="group" aria-labelledby="${esc(field.id)}-l">${join(
    options.map(
      (o, i) =>
        `<label class="bz-choice"><input type="${type}" name="${esc(inputName)}" value="${esc(
          o.value ?? o.label,
        )}"${attrs({
          required: !!field.required && type === 'radio' && i === 0,
        })} /><span>${esc(o.label)}</span></label>`,
    ),
    '',
  )}</div>`;
}


/**
 * A field the visitor never sees.
 *
 * Rendered rather than dropped, because the payload is the point: the value is
 * stored on the submission, it is available to conditional logic, and it is what
 * a notification rule routes on. Dropping it from the markup would leave the
 * dealer a routing rule against a field that never arrives.
 *
 * Only `static` carries its value in the HTML. The rest are captured by the
 * platform client from the page at load, which is why the input ships empty with
 * a source marker on it: baking a page URL or a UTM parameter into a static
 * build would bake in whichever page happened to be built first.
 */
function renderHiddenField(field) {
  const name = fieldName(field);
  const source = VALUE_SOURCES.includes(field.valueSource) ? field.valueSource : 'static';
  return `<input type="hidden"${attrs({
    id: field.id,
    name,
    value: source === 'static' ? field.defaultValue || '' : null,
    'data-bz-field': field.id,
    'data-bz-hidden-field': true,
    'data-bz-source': source === 'static' ? null : source,
    'data-bz-param': source === 'query' ? field.queryParam || null : null,
    'data-bz-field-analytics': analyticsBag(field.analytics),
  })} />`;
}

function renderField(field) {
  if (field.hidden) return renderHiddenField(field);

  const name = fieldName(field);
  // What this field reports as, per provider. Absent when the dealer has not
  // mapped it, and the runtime then falls back to the input's own name rather
  // than guessing at a vocabulary it does not have.
  const analyticsName = analyticsBag(field.analytics);
  const label = `<label class="bz-label" id="${esc(field.id)}-l" for="${esc(field.id)}">${esc(
    field.label,
  )}${field.required ? ' <span class="bz-req" aria-hidden="true">*</span>' : ''}</label>`;

  let control;
  if (field.type === 'paragraph') {
    control = `<textarea class="bz-input" id="${esc(field.id)}" name="${esc(name)}" rows="4"${attrs({
      required: !!field.required,
      placeholder: field.placeholder || null,
    })}></textarea>`;
  } else if (FIELD_TYPES.choice.includes(field.type)) {
    control = renderChoices(field, name);
  } else {
    control = `<input class="bz-input" id="${esc(field.id)}" name="${esc(name)}"${attrs({
      type: INPUT_TYPE[field.type] || 'text',
      required: !!field.required,
      placeholder: field.placeholder || null,
      autocomplete: AUTOCOMPLETE[field.type] || null,
      accept: field.type === 'file' ? field.accept || null : null,
    })} />`;
  }

  // Conditional logic travels as data attributes rather than generated script, so
  // one platform-shipped client handles every dealer's forms and a logic change
  // is a JSON edit rather than a code change in a dealer repo.
  const logic = field.logic && field.logic.rules && field.logic.rules.length ? field.logic : null;

  // Half width is a pairing, not a column: two adjacent halves sit side by side
  // and an unpaired one still fills the row, so removing the field beside it
  // cannot leave a gap the dealer has to notice.
  const half = field.width === 'half';

  return `<div class="bz-field${half ? ' bz-field--half' : ''}"${attrs({
    'data-bz-field': field.id,
    'data-bz-field-analytics': analyticsName,
    'data-bz-logic': logic ? JSON.stringify(logic) : null,
    hidden: logic ? true : null,
  })}>${label}${control}${field.help ? `<p class="bz-help">${esc(field.help)}</p>` : ''}</div>`;
}

/**
 * Render a form definition. `ctx.storefrontPrefix` decides the action path; the
 * prefix is preserved, never stripped, because the rewrite on the dealer's
 * domain forwards the whole path to the Remix mount.
 */
export function renderForm(form, ctx) {
  if (!form || !form.id) return '';
  if (form.status && form.status !== 'live' && !(ctx && ctx.includeDraftForms)) {
    if (ctx && ctx.warn) ctx.warn(`Form "${form.id}" is a draft and was not rendered.`);
    return '';
  }
  const prefix = (ctx && ctx.storefrontPrefix) || 'store';
  const fields = join((form.fields || []).map(renderField), '\n');
  const consent =
    form.consent && form.consent.enabled
      ? `<div class="bz-field bz-field--consent"><label class="bz-choice"><input type="checkbox" name="consent" value="yes"${attrs(
          { required: form.consent.required !== false },
        )} /><span>${esc(form.consent.text || 'I agree to be contacted about this enquiry.')}</span></label></div>`
      : '';

  // The unconditional confirmation, baked in so the page has an answer before
  // the server gives it one — the no-JS redirect, and the canvas, both need
  // copy to show. The server's own answer wins at runtime, because only the
  // server has the submitted values the conditional entries are judged against.
  const fallback = defaultConfirmation(form);
  const successMessage =
    (fallback && fallback.type !== 'redirect' && fallback.message) ||
    form.successMessage ||
    'Thanks — we will be in touch shortly.';
  const redirectUrl =
    (fallback && fallback.type === 'redirect' && fallback.redirectUrl) || form.redirectUrl || null;

  return `<form class="bz-form" method="post" action="/${esc(prefix)}/forms/${esc(form.id)}"${attrs({
    id: `form-${form.id}`,
    'data-bz-form': form.id,
    'data-bz-success': successMessage,
    'data-bz-redirect': redirectUrl,
    // The form's analytics annotations ride on the element rather than being
    // looked up by the runtime: the runtime has no access to the form
    // definition, and a second copy of the mapping is a second thing to get
    // wrong. The bag is opaque here and in the runtime — a provider's adapter
    // is the only thing that knows what its keys mean, or that one of them is
    // required and needs a default.
    'data-bz-analytics': analyticsBag(form.analytics),
    // The vehicle a form on or near a VDP is bound to, baked in at build time
    // from the page's product context. Not hidden inputs: a hidden field is a
    // field, and a bot can rewrite one. The server re-resolves it anyway.
    'data-bz-vehicle': form.vehicle ? JSON.stringify(form.vehicle) : null,
    // The listing's own specs, for a form whose conditions route by the product
    // rather than by an answer. Supplied by the surface that knows the listing;
    // absent on a static brand-site page, which has no product. Read by the
    // client so a `spec:` rule resolves the same way it will server-side, and
    // never posted — the server re-resolves it from the submission's product
    // context for the same reason `data-bz-vehicle` is not an input.
    'data-bz-spec': specBag(ctx),
    ...tagAttrs('form', form.intent || `form-${form.id}`),
  })}>
  <p class="bz-form__t">${esc(form.name || 'Contact us')}</p>
${fields}
${consent}
  <div class="bz-field bz-field--hp" aria-hidden="true"><label for="${esc(
    form.id,
  )}-hp">Leave this empty</label><input id="${esc(
    form.id,
  )}-hp" name="_hp" tabindex="-1" autocomplete="off" /></div>
  <button class="bz-btn bz-btn--primary" type="submit"${attrs(
    tagAttrs('cta', form.intent || `submit-${form.id}`),
  )}>${esc(form.submitLabel || 'Submit')}</button>
  <p class="bz-form__status" role="status" aria-live="polite"></p>
</form>`;
}

/** The `spec:` values for this render, as the client reads them back. */
function specBag(ctx) {
  const source = ctx && ctx.productContext;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const out = {};
  let any = false;
  for (const { id } of SPEC_SOURCES) {
    const value = source[id.slice('spec:'.length)];
    if (typeof value !== 'string' || value === '') continue;
    out[id] = value;
    any = true;
  }
  return any ? JSON.stringify(out) : null;
}

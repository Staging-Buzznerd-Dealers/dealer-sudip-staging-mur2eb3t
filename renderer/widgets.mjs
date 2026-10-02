// The widget host.
//
// A widget is a page element backed by platform data a static build cannot
// reach: the dealer's locations, staff, opening hours, live inventory. The build
// runs on Vercel with no privileged credentials, so the data arrives by two
// routes and never by a build-time API call:
//
//   snapshot   The dashboard resolves the data when it saves the page and commits
//              it into the block's props. This is what puts real addresses and
//              phone numbers in the served markup — useful without JavaScript,
//              and extractable by answer engines.
//   hydration  The platform client script refreshes the widget in the browser
//              through the same-origin /store proxy, so the request is
//              first-party and the dealer is resolved from the hostname alone.
//
// Widget descriptors (prop schemas, which surfaces a widget is allowed on) live
// in Vendure, because plugins register them. This module owns only the markup.

import { attrs, cls, esc, href, image, join, tagAttrs } from './html.mjs';
import { renderForm } from './forms.mjs';

/** Widgets that install behaviour and render nothing a buyer sees. */
export const BEHAVIOUR_ONLY = new Set(['heatmaps', 'code-snippet']);

function shell(widget, config, inner, opts = {}) {
  return `<div class="${cls('bz-widget', `bz-widget--${widget}`, opts.class)}"${attrs({
    'data-bz-widget': widget,
    'data-bz-config': JSON.stringify(config || {}),
    'data-bz-hydrate': opts.hydrate === false ? null : true,
    'data-bz-region': 'widget',
  })}>${inner}</div>`;
}

/**
 * Carousel parts for a list a widget generates.
 *
 * A behaviour finds its moving pieces by `data-bz-part`, which an author sets on a
 * node. These items have no node — they are built from the dealer's data at render
 * time — so a rail of live locations, listings or staff was the one kind of rail
 * that could not be a `carousel`. The way that went wrong was always the same: the
 * author wrote arrow buttons and their own JavaScript, which the Design canvas
 * never runs, so the arrows were dead in the editor and unstyleable on the page.
 *
 * Inert unless an ancestor declares `behaviour`, so it costs nothing anywhere else.
 */
const TRACK = ' data-bz-part="track"';
const SLIDE = ' data-bz-part="slide"';

/* ------------------------------------------------------------- placeholders */

/**
 * The map the snapshot already knows how to draw.
 *
 * Left as an empty box, the only thing that could fill it was `widgets.js`,
 * which the Design canvas never runs and a sandboxed Preview may not be
 * allowed to iframe. Putting the embed in the HTML means the editor, the first
 * paint, and a crawler all see the same map.
 *
 * Which map is the design's call, because the trade-off is real rather than
 * technical. The two embeds are interactive and are `<iframe>`s, which the
 * dashboard's Preview sandboxes without `allow-same-origin` — correct, since
 * that frame must not reach the dashboard's session, and the consequence is
 * that a third-party embed inside it renders its own "access blocked" page.
 * `static` has no iframe: it is OpenStreetMap's own tiles as `<img>`, so it
 * draws in Preview, on the canvas, in the first paint and with JS switched
 * off, at the cost of pan and zoom.
 */
function mapCentre(locations) {
  const points = (locations || []).filter(
    (l) => l.latitude != null && l.longitude != null && l.latitude !== '' && l.longitude !== '',
  );
  if (!points.length) return null;
  const lats = points.map((p) => Number(p.latitude));
  const lons = points.map((p) => Number(p.longitude));
  return {
    points,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    spread: Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons)),
  };
}

/** Slippy-map tile x/y for a coordinate, the scheme every OSM tile server uses. */
function tileXY(lat, lon, zoom) {
  const n = 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/**
 * A 4×3 grid of OSM tiles as plain images. No iframe, no third-party script, no
 * API key — so it survives the Preview sandbox and a crawler reads it.
 * Attribution is required by the tile usage policy and is not optional chrome.
 */
function staticMap(locations) {
  const centre = mapCentre(locations);
  if (!centre) return '';
  const zoom = centre.spread > 4 ? 6 : centre.spread > 1 ? 8 : centre.spread > 0.2 ? 10 : 12;
  const { x, y } = tileXY(centre.lat, centre.lon, zoom);
  const cols = 4;
  const rows = 3;
  const left = Math.floor(x) - Math.floor(cols / 2);
  const top = Math.floor(y) - Math.floor(rows / 2);
  const limit = 2 ** zoom;
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tx = ((left + col) % limit + limit) % limit;
      const ty = top + row;
      if (ty < 0 || ty >= limit) {
        tiles.push('<span class="bz-map__t"></span>');
        continue;
      }
      tiles.push(
        `<img class="bz-map__t" src="https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png" ` +
          `alt="" loading="lazy" referrerpolicy="no-referrer" width="256" height="256">`,
      );
    }
  }
  return (
    `<div class="bz-map__g" style="--bz-map-cols:${cols}">${join(tiles, '')}</div>` +
    `<a class="bz-map__a" href="https://www.openstreetmap.org/copyright" rel="noopener">© OpenStreetMap</a>`
  );
}

/** Google's embed, which needs no key in `output=embed` form. */
function googleMap(locations) {
  const centre = mapCentre(locations);
  if (!centre) return '';
  const query = encodeURIComponent(`${centre.lat},${centre.lon}`);
  return (
    `<iframe src="https://maps.google.com/maps?q=${query}&amp;z=11&amp;output=embed" ` +
    `title="Map of our locations" loading="lazy" referrerpolicy="no-referrer" ` +
    `style="width:100%;height:100%;border:0;display:block"></iframe>`
  );
}

function mapEmbed(locations) {
  const points = (locations || []).filter(
    (l) => l.latitude != null && l.longitude != null && l.latitude !== '' && l.longitude !== '',
  );
  if (!points.length) return '';
  const lats = points.map((p) => Number(p.latitude));
  const lons = points.map((p) => Number(p.longitude));
  const pad = 0.08;
  const bbox = [
    Math.min(...lons) - pad,
    Math.min(...lats) - pad,
    Math.max(...lons) + pad,
    Math.max(...lats) + pad,
  ].join(',');
  const marker =
    points.length === 1
      ? `&amp;marker=${encodeURIComponent(`${points[0].latitude},${points[0].longitude}`)}`
      : '';
  return (
    `<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}` +
    `&amp;layer=mapnik${marker}" title="Map of our locations" loading="lazy" ` +
    `referrerpolicy="no-referrer" style="width:100%;height:100%;border:0;display:block"></iframe>`
  );
}

function locationsMap(config, snapshot, ctx) {
  const locations = (snapshot && snapshot.locations) || [];
  const list = locations.length
    ? `<ul class="bz-loclist bz-bare"${TRACK}>${join(
        locations.map((l) => {
          const name = esc(l.name || l.city);
          const title = l.href
            ? `<a class="bz-loc__c" href="${esc(href(l.href, ctx))}"${attrs(
                tagAttrs('link', 'find-location'),
              )}>${name}</a>`
            : `<span class="bz-loc__c">${name}</span>`;
          const locality = [l.city, [l.region, l.postalCode].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', ');
          const address = [l.streetAddress, locality].filter(Boolean).join(', ');
          return `<li class="bz-loc"${SLIDE}>${title}${
            address ? `<address class="bz-loc__a">${esc(address)}</address>` : ''
          }${
            l.phone
              ? `<a class="bz-loc__p" href="tel:${esc(l.phone.replace(/[^+\d]/g, ''))}"${attrs(
                  tagAttrs('phone', 'call-location'),
                )}>${esc(l.phone)}</a>`
              : ''
          }${l.services ? `<span class="bz-loc__s">${esc(l.services)}</span>` : ''}</li>`;
        }),
        '',
      )}</ul>`
    : `<p class="bz-widget__empty">Locations load here.</p>`;

  // `static` by default because it is the only one that draws in all four
  // places a map has to: the Design canvas, which runs no site JS; Preview,
  // whose frame is a unique origin an `openstreetmap.org` embed refuses to
  // render inside; the published page; and a crawler. The two interactive
  // providers are an opt-in, and neither needs an API key.
  const providers = { openstreetmap: mapEmbed, google: googleMap, static: staticMap };
  const provider = config.mapProvider || 'static';
  const draw = providers[provider] || staticMap;
  const map =
    config.showMap === false
      ? ''
      : `<div class="bz-map" data-bz-map data-bz-map-provider="${esc(
          provider,
        )}" role="img" aria-label="Map of our locations">${draw(locations)}</div>`;

  return shell(
    'locations-map',
    config,
    `${config.heading ? `<p class="bz-widget__h">${esc(config.heading)}</p>` : ''}${map}${list}`,
  );
}

/**
 * One rooftop's photograph, and nothing else.
 *
 * Deliberately not a fallback map. On a generated location page the right-hand
 * slot is the branch's own picture, and a street map standing in for a missing
 * one is a different section wearing its clothes: it says "here is the building"
 * and shows a road junction. An empty slot is the honest state and it tells the
 * dealer what to do — upload a photo on Admin → Locations.
 *
 * `locationSlug` is filled in per page by `applyLocationSlug`, so one authored
 * node is six photographs.
 */
function locationPhoto(config, snapshot) {
  const photo = (snapshot && snapshot.photo) || null;
  const src = photo && typeof photo === 'object' ? photo.src : photo;
  return shell(
    'location-photo',
    config,
    `${config.heading ? `<p class="bz-widget__h">${esc(config.heading)}</p>` : ''}${
      src
        ? image(photo, { alt: config.alt || '', eager: config.eager === true })
        : // No placeholder copy. This box is the design's own shape and a band of
          // grey with words in it would be published as if it were content.
          '<div class="bz-locphoto__empty" aria-hidden="true"></div>'
    }`,
    { class: 'bz-locphoto' },
  );
}

/**
 * Two known points are enough to place every rooftop on a piece of artwork.
 *
 * Longitude is linear in a Mercator projection and latitude is not, so the
 * vertical scale is derived against `mercatorY` rather than the raw degrees. Very
 * nearly all state- and country-outline art is Mercator or close enough that the
 * error inside one state is under a pixel.
 *
 * Returns null when the anchors cannot describe a projection — the same two
 * points twice, or a pair sharing a latitude or longitude — because the
 * alternative is dividing by zero and stacking every pin in one corner.
 */
function mercatorY(lat) {
  const clamped = Math.max(-85, Math.min(85, Number(lat)));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}

export function makeProjection(anchors) {
  const pair = (anchors || [])
    .map((a) => ({
      lat: Number(a && a.lat),
      lng: Number(a && a.lng),
      x: Number(a && a.x),
      y: Number(a && a.y),
    }))
    .filter((a) => [a.lat, a.lng, a.x, a.y].every((n) => Number.isFinite(n)));
  if (pair.length < 2) return null;

  const [a, b] = pair;
  const ay = mercatorY(a.lat);
  const by = mercatorY(b.lat);
  if (b.lng === a.lng || by === ay) return null;

  const sx = (b.x - a.x) / (b.lng - a.lng);
  const sy = (b.y - a.y) / (by - ay);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return null;

  return (lng, lat) => ({
    x: a.x + (Number(lng) - a.lng) * sx,
    y: a.y + (mercatorY(lat) - ay) * sy,
  });
}

/**
 * The dealer's own map art with a pin per rooftop on top of it.
 *
 * Why this is platform markup rather than a component a designer composes: a
 * pin's position is *computed* from the rooftop's coordinates, and a `{{binding}}`
 * resolves a value — it cannot run a projection. The pins also have to carry the
 * brand and service-option keys as `data-` attributes for the `filter` behaviour
 * to reach them, and no node prop emits those. So the widget owns exactly two
 * things, position and facets, and everything visible about it is the dealer's:
 * the artwork, and CSS against the classes below.
 *
 * Deliberately not an inline `<svg>`. Inlining a designer's file means parsing and
 * sanitising it, and the pins do not need to share its coordinate space: the art
 * is one `<img>` at its natural aspect ratio and each pin is a sibling placed at a
 * percentage. That percentage is computed here, at build time, so the pins are in
 * the served HTML — which is what makes them draw on the Design canvas, in the
 * first paint, and with JavaScript switched off.
 *
 * A rooftop with no coordinates is left out rather than dropped at 0,0 — the Gulf
 * of Guinea is not in this dealer's estate. The count of those is reported so
 * "one pin short" is diagnosable.
 */
function locationsPinmap(config, snapshot, ctx) {
  const locations = (snapshot && snapshot.locations) || [];
  const project = makeProjection(config.anchors);
  const art = config.basemap && typeof config.basemap === 'object' ? config.basemap : null;

  if (!art || !art.src) {
    if (ctx && ctx.warn) {
      ctx.warn('locations-pinmap has no basemap image — upload the artwork on the block.');
    }
  }
  if (art && art.src && !project) {
    if (ctx && ctx.warn) {
      ctx.warn(
        'locations-pinmap needs two calibration points with different latitudes and longitudes — no pins drawn.',
      );
    }
  }

  // The space the anchors were measured in. Normally the artwork's own pixel
  // dimensions, which the Media Bin already records — `artWidth`/`artHeight` exist
  // for art whose calibration was taken against a viewBox that is not its size.
  const artWidth = Number(config.artWidth) || Number(art && art.width) || 1000;
  const artHeight = Number(config.artHeight) || Number(art && art.height) || 1000;

  const placed = [];
  let unplaceable = 0;
  for (const l of locations) {
    const lat = Number(l.latitude);
    const lng = Number(l.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      unplaceable++;
      continue;
    }
    if (!project) continue;
    const { x, y } = project(lng, lat);
    placed.push({
      location: l,
      left: (x / artWidth) * 100,
      top: (y / artHeight) * 100,
    });
  }

  if (unplaceable && ctx && ctx.warn) {
    ctx.warn(
      `locations-pinmap: ${unplaceable} rooftop(s) have no coordinates and cannot be pinned — set them on Admin → Locations.`,
    );
  }

  // `part="item"` so the page's own `filter` behaviour reaches the pins with the
  // chips that already filter the cards. One declaration, both views.
  const pins = placed.map((p) => {
    const l = p.location;
    const label = esc(l.name || l.city || '');
    const inner = `<span class="bz-pin__dot"></span><span class="bz-pin__l">${label}</span>`;
    const body = l.href
      ? `<a class="bz-pin__a" href="${esc(href(l.href, ctx))}"${attrs(
          tagAttrs('link', 'find-location'),
        )}>${inner}</a>`
      : inner;
    return `<li class="bz-pin"${attrs({
      'data-bz-part': 'item',
      'data-bz-pin': l.slug || null,
      'data-brand': l.brandKeys || null,
      'data-perk': l.perkKeys || null,
      'data-group': l.groupKey || null,
      style: `left:${p.left.toFixed(3)}%;top:${p.top.toFixed(3)}%`,
    })}>${body}</li>`;
  });

  // `data-bz-reveal="dim"` tells the page's `filter` behaviour to leave these in
  // place and mark them instead of hiding them. A map that loses a pin when a chip
  // is pressed has lost the comparison the map is for.
  const layer = pins.length
    ? `<ul class="bz-pins bz-bare"${attrs({ 'data-bz-reveal': 'dim' })}>${join(pins, '')}</ul>`
    : '';

  return shell(
    'locations-pinmap',
    config,
    `${config.heading ? `<p class="bz-widget__h">${esc(config.heading)}</p>` : ''}<div class="bz-pinmap"${attrs(
      { 'data-bz-pinmap': '', role: 'group', 'aria-label': config.label || 'Map of our locations' },
    )}>${
      art && art.src
        ? image(art, {
            alt: art.alt || '',
            class: 'bz-pinmap__art',
            // The pins are placed at percentages of this box, so the box has to
            // hold the artwork's aspect ratio before the image loads or every pin
            // lands somewhere else on first paint.
            width: artWidth,
            height: artHeight,
            ctx,
          })
        : '<div class="bz-pinmap__empty">Upload the map artwork on this block.</div>'
    }${layer}</div>`,
  );
}

function staff(config, snapshot) {
  const people = (snapshot && snapshot.staff) || [];
  const cards = people.map(
    (p) =>
      `<li class="bz-person"${SLIDE}>${image(p.photo, { width: 128, height: 128, placeholder: '' })}<span class="bz-person__n">${esc(
        p.name,
      )}</span>${p.title ? `<span class="bz-person__t">${esc(p.title)}</span>` : ''}${
        p.phone
          ? `<a class="bz-person__p" href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}"${attrs(
              tagAttrs('phone', 'call-staff'),
            )}>${esc(p.phone)}</a>`
          : ''
      }</li>`,
  );
  return shell(
    'staff',
    config,
    `${config.heading ? `<p class="bz-widget__h">${esc(config.heading)}</p>` : ''}${
      cards.length
        ? `<ul class="bz-people bz-bare"${TRACK}>${join(cards, '')}</ul>`
        : '<p class="bz-widget__empty">Team members load here.</p>'
    }`,
  );
}

function faq(config, snapshot) {
  const items = (config.items && config.items.length ? config.items : (snapshot && snapshot.items)) || [];
  if (!items.length) {
    return shell('faq', config, '<p class="bz-widget__empty">Questions load here.</p>');
  }
  // FAQPage schema goes with the markup that answers the question, so the facts
  // and the structured data cannot drift apart.
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  });
  return shell(
    'faq',
    config,
    `${config.heading ? `<p class="bz-widget__h">${esc(config.heading)}</p>` : ''}<div class="bz-faqs">${join(
      items.map(
        (i) =>
          `<details class="bz-faq"><summary${attrs(
            tagAttrs('faq', 'expand-question'),
          )}>${esc(i.q)}</summary><div class="bz-faq__a">${esc(i.a)}</div></details>`,
      ),
      '',
    )}</div><script type="application/ld+json">${ld}</script>`,
    { hydrate: false },
  );
}

function phoneNumbers(config, snapshot) {
  const numbers = (snapshot && snapshot.numbers) || [];
  return shell(
    'phone-numbers',
    config,
    numbers.length
      ? `<ul class="bz-phones bz-bare">${join(
          numbers.map(
            (n) =>
              `<li class="bz-phone"><span class="bz-phone__l">${esc(n.label)}</span><a href="tel:${esc(
                String(n.number).replace(/[^+\d]/g, ''),
              )}"${attrs(tagAttrs('phone', 'call-department'))}>${esc(n.number)}</a></li>`,
          ),
          '',
        )}</ul>`
      : '<p class="bz-widget__empty">Phone numbers load here.</p>',
  );
}

function hours(config, snapshot) {
  const schedules =
    snapshot && Array.isArray(snapshot.schedules) && snapshot.schedules.length
      ? snapshot.schedules
      : snapshot && Array.isArray(snapshot.hours) && snapshot.hours.length
        ? [{ heading: config.heading || 'Opening hours', hours: snapshot.hours }]
        : [];
  return shell(
    'hours',
    config,
    schedules.length
      ? join(
          schedules.map(
            (schedule) =>
              `<table class="bz-hours"><caption>${esc(
                schedule.heading || config.heading || 'Opening hours',
              )}</caption><tbody>${join(
                (schedule.hours || []).map(
                  (r) => `<tr><th scope="row">${esc(r.day)}</th><td>${esc(r.hours)}</td></tr>`,
                ),
                '',
              )}</tbody></table>`,
          ),
        )
      : '<p class="bz-widget__empty">Opening hours load here.</p>',
  );
}

function listingHref(prefix, listing) {
  if (listing.href) {
    return listing.href.startsWith('/')
      ? listing.href
      : `/${prefix}/${listing.href}`;
  }
  return `/${prefix}/products/${listing.slug}`;
}

function listingCard(prefix, listing) {
  const facts = Array.isArray(listing.facts) ? listing.facts.slice(0, 3) : [];
  return `<li${SLIDE}><a class="bz-card" href="${esc(listingHref(prefix, listing))}"${attrs(
    tagAttrs('link', 'view-listing'),
  )}>${image(listing.image, { placeholder: 'Photo' })}<div class="bz-card__body"><span class="bz-card__t">${esc(
    listing.title,
  )}</span>${listing.price ? `<span class="bz-card__m">${esc(listing.price)}</span>` : ''}${
    facts.length
      ? `<dl class="bz-card__facts">${join(
          facts.map(
            (f) =>
              `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`,
          ),
          '',
        )}</dl>`
      : ''
  }</div></a></li>`;
}

function inventoryCarousel(config, snapshot, ctx) {
  const prefix = (ctx && ctx.storefrontPrefix) || 'store';
  const items = (snapshot && snapshot.listings) || [];
  return shell(
    'inventory-carousel',
    config,
    `${config.heading ? `<p class="bz-widget__h">${esc(config.heading)}</p>` : ''}${
      items.length
        ? `<ul class="bz-grid bz-grid--4 bz-bare"${TRACK}>${join(
            items.map((l) => listingCard(prefix, l)),
            '',
          )}</ul>`
        : '<p class="bz-widget__empty">Live inventory loads here.</p>'
    }<p><a class="bz-btn bz-btn--secondary" href="/${esc(prefix)}"${attrs(
      tagAttrs('cta', 'browse-inventory'),
    )}>Browse all inventory</a></p>`,
  );
}

function inventorySearch(config, snapshot, ctx) {
  const prefix = (ctx && ctx.storefrontPrefix) || 'store';
  const types = (snapshot && snapshot.types) || [];
  const chips = types.length
    ? `<div class="bz-searchbar__chips">${join(
        types.map(
          (t) =>
            `<a class="bz-chip" href="/${esc(prefix)}/inventory/${esc(t.slug)}">${esc(
              t.label,
            )}</a>`,
        ),
        '',
      )}</div>`
    : '';
  return shell(
    'inventory-search',
    config,
    `${config.heading ? `<p class="bz-widget__h">${esc(config.heading)}</p>` : ''}<form class="bz-searchbar" role="search" action="/${esc(
      prefix,
    )}/search" method="get"${attrs(
      tagAttrs('form', 'inventory-search'),
    )}><label class="bz-sr" for="bz-wsearch">Search inventory</label><input class="bz-input" id="bz-wsearch" name="q" type="search" placeholder="${esc(
      config.placeholder || 'Search make, model or stock #…',
    )}" /><button class="bz-btn bz-btn--primary" type="submit"${attrs(
      tagAttrs('cta', 'inventory-search'),
    )}>Search</button></form>${chips}`,
    // Not hydrated. The chips are product types, which change when the dealer
    // reorganises their catalogue — not between one visitor and the next — and
    // the committed snapshot already carries them. Refreshing them would put a
    // request on every page load of a static site to redraw the same chips.
    { hydrate: false },
  );
}

const PLACEHOLDERS = {
  'locations-map': locationsMap,
  'locations-pinmap': locationsPinmap,
  'location-photo': locationPhoto,
  staff,
  faq,
  'phone-numbers': phoneNumbers,
  hours,
  'inventory-carousel': inventoryCarousel,
  'inventory-search': inventorySearch,
};

/**
 * Render a widget block. Unknown widget ids get a hydrating skeleton rather than
 * nothing: a plugin can register a widget this renderer has never heard of, and
 * a dealer site must not fail to build because of it.
 */
export function renderWidget(props, ctx, block) {
  const widget = props && props.widget;
  if (!widget) return '';

  if (BEHAVIOUR_ONLY.has(widget)) {
    return `<div class="bz-widget bz-widget--behaviour"${attrs({
      'data-bz-widget': widget,
      'data-bz-config': JSON.stringify(props.config || {}),
      hidden: true,
    })}></div>`;
  }

  const config = props.config || {};
  const snapshot = props.snapshot || null;

  if (widget === 'form') {
    const form = ((ctx && ctx.forms) || {})[config.formId];
    if (!form) {
      if (ctx && ctx.warn) ctx.warn(`Widget form "${config.formId}" is not in site/forms/.`);
      return '';
    }
    return shell('form', config, renderForm(form, ctx), { hydrate: false });
  }

  const placeholder = PLACEHOLDERS[widget];
  if (placeholder) return placeholder(config, snapshot, ctx, block);

  if (ctx && ctx.warn) {
    ctx.warn(`Widget "${widget}" has no static placeholder in this renderer version.`);
  }
  return shell(
    widget,
    config,
    `<p class="bz-widget__empty">${esc(config.heading || widget)}</p>`,
  );
}

/** Widget ids this renderer version can render statically. */
export function staticWidgetIds() {
  return [...Object.keys(PLACEHOLDERS), 'form'];
}

/**
 * The location a rooftop page is about, assembled from that page's own widget
 * snapshots.
 *
 * Read from the snapshots rather than fetched, for the same reason the widgets
 * are: the build has no credentials. That also makes the structured data a
 * description of what is on the page rather than a second, independently
 * sourced claim about the business — the two cannot disagree, because there is
 * only one record.
 *
 * Returns null when the page carries no location data for `slug`, which is the
 * honest answer: a page that does not say where it is should not tell a search
 * engine that it does.
 */
export function rooftopFrom(nodes, slug) {
  if (!slug) return null;
  let place = null;
  let schedules = null;

  /**
   * `hint` is the slug the snapshot was resolved for. A locations snapshot names
   * each branch and can be searched, but an hours snapshot carries the location's
   * *name* and not its slug, so the only way to know whose hours these are is the
   * config that asked for them — the widget's own on a page, the placement's
   * values inside a component.
   */
  const take = (snapshot, hint) => {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (!place && Array.isArray(snapshot.locations)) {
      place = snapshot.locations.find((l) => l && l.slug === slug) || null;
    }
    if (!schedules && hint === slug && Array.isArray(snapshot.schedules) && snapshot.schedules.length) {
      schedules = snapshot.schedules;
    }
  };

  const walk = (list) => {
    for (const node of list || []) {
      const props = (node && node.props) || {};
      if (node && node.type === 'widget') {
        take(props.snapshot, (props.config || {}).locationSlug);
      }
      if (node && node.type === 'sharedSection' && props.snapshots) {
        const hint = (props.values || {}).locationSlug;
        for (const snapshot of Object.values(props.snapshots)) take(snapshot, hint);
      }
      if (Array.isArray(node && node.children)) walk(node.children);
    }
  };
  walk(nodes);

  if (!place) return null;
  return { ...place, schedules: schedules || [] };
}

// The document shell: <head>, chrome and the script/style order every page
// shares. Moved out of build.mjs so the dashboard's preview can wrap a canvas in
// the same markup the published page gets, rather than approximating it.

import { esc } from './html.mjs';
import { analyticsHead } from './analytics.mjs';

/** Drop keys with nothing in them, so a sparse record does not emit empty nodes. */
function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)),
  );
}

/**
 * LocalBusiness node for the dealership. Injected once per page by the shell —
 * page content must never duplicate it, or search engines see two conflicting
 * business records for one URL.
 *
 * On a rooftop page the record describes *that branch*, not the company. A
 * multi-location dealer whose every location page repeats one head-office
 * address is not merely missing an opportunity: it tells Google that the Tampa
 * page is about somewhere else, which is the opposite of what a location page is
 * for. `rooftop` therefore replaces the company node rather than joining it.
 */
export function businessJsonLd(config, rooftop, canonical) {
  const biz = config.business;
  if (rooftop) return rooftopJsonLd(config, rooftop, canonical);
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': biz.type,
    name: config.name,
    legalName: biz.legalName,
    url: config.url,
    telephone: biz.phone,
    email: biz.email,
    image: config.url + config.seo.ogImage,
    address: {
      '@type': 'PostalAddress',
      streetAddress: biz.streetAddress,
      addressLocality: biz.addressLocality,
      addressRegion: biz.addressRegion,
      postalCode: biz.postalCode,
      addressCountry: biz.addressCountry,
    },
    geo: { '@type': 'GeoCoordinates', latitude: biz.latitude, longitude: biz.longitude },
    openingHours: biz.openingHours,
    priceRange: biz.priceRange,
  });
}

/**
 * The branch's own name.
 *
 * Local ranking turns on the name, address and phone matching what the dealer
 * has on their Google Business Profile and in every directory that cites them,
 * so the name a dealer typed in Admin → Locations wins whenever it is a name
 * rather than a bare place. "Tampa" alone is a place; it is prefixed so the
 * record still says who the business is.
 */
function rooftopName(config, rooftop) {
  const name = (rooftop.name || '').trim();
  if (!name) return config.name;
  return name.toLowerCase().includes(config.name.toLowerCase()) ? name : `${config.name} ${name}`;
}

/** `{day, opensAt, closesAt}` rows to OpeningHoursSpecification, closed days omitted. */
function openingHours(rows) {
  return (rows || [])
    .filter((r) => r && r.opensAt && r.closesAt)
    .map((r) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: r.day,
      opens: r.opensAt,
      closes: r.closesAt,
    }));
}

function rooftopJsonLd(config, rooftop, canonical) {
  const biz = config.business;
  const url = canonical || config.url;
  const schedules = rooftop.schedules || [];

  return JSON.stringify(
    compact({
      '@context': 'https://schema.org',
      '@type': biz.type,
      // A stable identity for this branch, so the hours, the address and any
      // review data a dealer adds later all attach to the same node.
      '@id': `${url}#location`,
      name: rooftopName(config, rooftop),
      url,
      telephone: rooftop.phone || biz.phone,
      email: rooftop.email || biz.email,
      image: config.url + config.seo.ogImage,
      address: compact({
        '@type': 'PostalAddress',
        streetAddress: rooftop.streetAddress,
        addressLocality: rooftop.city,
        addressRegion: rooftop.region,
        postalCode: rooftop.postalCode,
        addressCountry: rooftop.country || biz.addressCountry,
      }),
      geo:
        rooftop.latitude != null && rooftop.longitude != null
          ? {
              '@type': 'GeoCoordinates',
              latitude: rooftop.latitude,
              longitude: rooftop.longitude,
            }
          : null,
      // The first public department's hours are the branch's hours; the rest are
      // real sub-entities rather than a flattened list, because "Service closes
      // at 5 but Sales at 7" is a fact a single openingHours cannot hold.
      openingHoursSpecification: openingHours(schedules[0]?.hours),
      department: schedules.slice(1).map((s) =>
        compact({
          '@type': 'LocalBusiness',
          name: s.heading,
          openingHoursSpecification: openingHours(s.hours),
        }),
      ),
      parentOrganization: {
        '@type': 'Organization',
        name: config.name,
        legalName: biz.legalName,
        url: config.url,
      },
      priceRange: biz.priceRange,
    }),
  );
}

/**
 * One versioned loader tag pointed at a platform-hosted script. Tracking logic is
 * never inlined: a fleet-wide analytics change must not require a commit in every
 * dealer repo.
 */
export function analyticsTag(config) {
  const a = config.analytics || {};
  if (!a.loaderUrl) return '';
  const v = a.loaderVersion ? `?v=${encodeURIComponent(a.loaderVersion)}` : '';
  return `\n<script src="${a.loaderUrl}${v}" data-channel="${config.channelToken}" defer></script>`;
}

/**
 * Assemble a full HTML document.
 *
 * The chrome fragments arrive already rendered (menus injected) so this function
 * stays pure string assembly — it is called from the build and from the
 * dashboard preview, and neither may depend on the other's environment.
 */
export function renderShell({
  config,
  fontsHref,
  /**
   * The page's analytics facts, in platform names: `pageType`, `errorCode` on a
   * 404, and `vehicle` on a detail page.
   *
   * A page kind is authored in `site/pages.json` rather than derived from the
   * path, because a path cannot tell one custom page from another and a wrong
   * restricted value is indistinguishable from a right one. What each fact is
   * *called* on the wire is the provider's business, via its `pageKeys`.
   */
  analyticsPage = {},
  /**
   * Self-hosted woff2 URLs worth preloading, from `fontPreloads(tokens)`.
   * `crossorigin` is not optional even for a same-origin file: font fetches are
   * CORS-mode, and a preload whose mode differs from the real request is simply
   * downloaded twice.
   */
  fontPreload = [],
  chrome = {},
  title,
  description,
  canonical,
  /**
   * The location this page is about, when it is a rooftop page. Extracted from
   * the page's own widget snapshots by the build, so the structured data and the
   * address a visitor reads are the same record and cannot drift.
   */
  rooftop = null,
  bodyHtml,
  pageCss,
  /**
   * Scripts this page needs, beyond the platform's own. One URL or several: a
   * page carries its own `script.js` plus the script of every designed component
   * it places, and those are separate files because a component's script travels
   * with the component rather than with any one page.
   */
  pageJs,
  ogImage,
  noindex,
  /**
   * `seo.keywords` from this page's manifest entry.
   *
   * Emitted because certification programmes and agency audits still check for
   * the tag, not because it ranks: Google has ignored `<meta name="keywords">`
   * since 2009 and Bing reads it as a spam signal. Absent unless a page sets
   * it, so a site that does not opt in carries no empty tag.
   */
  keywords = [],
  tokenScopes = [],
  extraHead = '',
  storefrontPrefix = 'store',
  /**
   * Site-wide custom code, from `site/custom-code.json`. Dealer-authored, same
   * trust level as the repo itself; it runs on the dealer's published site and
   * nowhere else. Slots mirror where people are used to pasting snippets:
   * headStart (verification metas), headEnd (styles/pixels that must win),
   * bodyStart (tag-manager noscript), beforeFooter, bodyEnd (chat widgets).
   * `css` is emitted before the page's own CSS so an entity override still
   * beats the global layer; `hasJs` loads /scripts/custom.js, which the build
   * writes from the same file.
   */
  custom = {},
}) {
  const lang = (config.seo.locale || 'en_US').split('_')[0];
  const fullTitle =
    config.seo.titleTemplate && title !== 'Home'
      ? config.seo.titleTemplate.replace('%s', title)
      : title === 'Home'
        ? config.seo.defaultTitle
        : title;
  const og = config.url + (ogImage || config.seo.ogImage);
  const keywordList = (Array.isArray(keywords) ? keywords : [])
    .map((k) => String(k).trim())
    .filter(Boolean);
  const scopes = tokenScopes.length
    ? tokenScopes.map((s) => `\n<link rel="stylesheet" href="/styles/tokens.${s}.css" />`).join('')
    : '';
  const scriptTags = (Array.isArray(pageJs) ? pageJs : pageJs ? [pageJs] : [])
    .filter(Boolean)
    .map((src) => `\n<script src="${esc(src)}" defer></script>`)
    .join('');

  // Google Fonts is only contacted when a family is not self-hosted. Emitting
  // the tag unconditionally would mean an empty href, which resolves to this
  // page and fetches the whole document again as a stylesheet.
  const fontTags = [
    ...fontPreload.map(
      (url) => `<link rel="preload" href="${esc(url)}" as="font" type="font/woff2" crossorigin />`,
    ),
    ...(fontsHref
      ? [
          '<link rel="preconnect" href="https://fonts.googleapis.com" />',
          '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
          `<link rel="stylesheet" href="${esc(fontsHref)}" />`,
        ]
      : []),
  ].join('\n');

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />${custom.headStart ? `\n${custom.headStart}` : ''}
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}" />${keywordList.length ? `\n<meta name="keywords" content="${esc(keywordList.join(', '))}" />` : ''}
<link rel="canonical" href="${esc(canonical)}" />${noindex ? '\n<meta name="robots" content="noindex,nofollow" />' : ''}
<meta name="theme-color" content="${esc(config.seo.themeColor)}" />
<meta property="og:site_name" content="${esc(config.name)}" />
<meta property="og:locale" content="${esc(config.seo.locale || 'en_US')}" />
<meta property="og:title" content="${esc(fullTitle)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(og)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(fullTitle)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(og)}" />
<link rel="icon" href="${esc(config.favicon)}" />
${fontTags}
<link rel="stylesheet" href="/styles/tokens.css" />${scopes}
<link rel="stylesheet" href="/styles/reset.css" />
<link rel="stylesheet" href="/styles/blocks.css" />
<link rel="stylesheet" href="/styles/chrome.css" />
${custom.css ? `<style data-bz-custom>${custom.css}</style>\n` : ''}<style>${pageCss}</style>
<script type="application/ld+json">${businessJsonLd(config, rooftop, canonical)}</script>${analyticsTag(config)}${analyticsHead(
  config,
  analyticsPage,
)}${extraHead}${custom.headEnd ? `\n${custom.headEnd}` : ''}
</head>
<body data-bz-prefix="${esc(storefrontPrefix)}">${custom.bodyStart ? `\n${custom.bodyStart}` : ''}
${chrome.header || ''}
<main>
${bodyHtml}
</main>${custom.beforeFooter ? `\n${custom.beforeFooter}` : ''}
${chrome.footer || ''}
<script src="/scripts/chrome.js" defer></script>
<script src="/scripts/widgets.js" defer></script>
<script src="/scripts/analytics.js" defer></script>${custom.hasJs ? `\n<script src="/scripts/custom.js" defer></script>` : ''}${scriptTags}${custom.bodyEnd ? `\n${custom.bodyEnd}` : ''}
</body>
</html>
`;
}

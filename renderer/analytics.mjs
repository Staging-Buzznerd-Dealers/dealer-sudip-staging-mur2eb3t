// Analytics providers in the document head, emitted from baked configuration.
//
// No vendor name appears in this file. Everything it needs — the global to
// define, the script to load, the calls to make and what to call the page facts
// — arrives as data in `platform/analytics.json`, which the platform writes at
// bake time from whichever providers a dealer has enabled.
//
// A dealer with no providers has no such file, and every function here returns
// nothing. Their built site contains no third-party code and no third-party URL.

import { esc } from './html.mjs';
import { analyticsBlob, bootstrapCode } from './analytics-bootstrap.mjs';

/**
 * Read the baked analytics file.
 *
 * Absence is the normal state, not an error: a dealer in no programme has no
 * providers, and the build must be identical for them apart from what is not
 * emitted.
 */
export function analyticsConfig(config) {
  const analytics = config?.platformAnalytics ?? null;
  if (!analytics || !Array.isArray(analytics.providers)) return { runtimeVersion: null, providers: [] };
  return { runtimeVersion: analytics.runtimeVersion ?? null, providers: analytics.providers };
}

const isPlaceholder = (value) =>
  value === null || value === undefined || value === '' || /^REPLACE_/.test(String(value));

/**
 * Settings still carrying a placeholder, across every enabled provider.
 *
 * The build refuses a production deployment when this is non-empty, and it does
 * so **without knowing what any provider is**: each one's `requiredForProduction`
 * was written into the file by the platform from its own descriptor. That is how
 * the guard survives being made generic.
 *
 * A site tagged with a placeholder reports to nobody and looks exactly like one
 * tagged correctly, so the omission would otherwise surface during certification
 * rather than before it.
 */
export function missingIdentity(config) {
  const missing = [];
  for (const provider of analyticsConfig(config).providers) {
    for (const key of provider.requiredForProduction ?? []) {
      if (isPlaceholder(provider.settings?.[key])) missing.push(`${provider.id}.${key}`);
    }
  }
  return missing;
}

/**
 * One provider's head burst: the bootstrap, then the vendor's own script.
 *
 * The code between the tags comes from `analytics-bootstrap.mjs`, which the
 * storefront vendors verbatim — only this HTML wrapper is ours. Three
 * properties of that code are the reason it is emitted here rather than
 * injected by the deferred runtime:
 *
 * - **Ordering is document order, not JS timing.** The page call precedes the
 *   page view, so a detail page's vehicle payload is in the data layer before
 *   the view by construction. No promise, no callback, nothing to race.
 * - **There is no network round trip in front of the first call.** Loading a
 *   runtime that injects an adapter that injects the vendor script would put
 *   three sequential fetches before the page view; every visitor who leaves
 *   during that chain is unmeasured, and this measurement is already lossy.
 * - **Nothing is evaluated.** Values go through `JSON.stringify`; the emitter
 *   interpolates data into a fixed code shape and never interpolates code.
 */
function providerHead(provider, facts) {
  const code = bootstrapCode(provider, facts);
  if (!code) return '';
  const script = provider.bootstrap?.script
    ? `\n<script src="${esc(provider.bootstrap.script)}" async></script>`
    : '';
  return `\n<script>${code}</script>${script}`;
}

/**
 * Everything analytics puts in `<head>`.
 *
 * The config blob first, so the deferred runtime can read it without a fetch;
 * then each provider's bootstrap, which is what has a deadline.
 */
export function analyticsHead(config, page = {}) {
  const analytics = analyticsConfig(config);
  if (!analytics.providers.length) return '';

  /* The renderer version is a page fact like any other, so a provider that
   * reports a site technology version names it in `pageKeys` and one that does
   * not never sees it. Reading it off the baked file rather than a literal is
   * what stops it drifting per dealer the moment a renderer ships. */
  const facts = { ...page, runtimeVersion: analytics.runtimeVersion };

  const blob = analyticsBlob({
    runtimeVersion: analytics.runtimeVersion,
    pageType: page.pageType ?? null,
    providers: analytics.providers,
  });

  return (
    `\n<script>window.__BZ_ANALYTICS__=${blob};</script>` +
    analytics.providers.map((provider) => providerHead(provider, facts)).join('')
  );
}

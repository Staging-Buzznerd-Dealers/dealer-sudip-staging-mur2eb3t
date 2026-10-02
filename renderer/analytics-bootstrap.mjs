// The analytics head burst, as strings. Shared verbatim with the storefront.
//
// Two surfaces put the same tag in the same head: a dealer's brand site, built
// from this repo, and the Remix storefront proxied in under `/store`. They are
// separate deployables — one is a zero-dependency ESM build step, the other is
// React — so the *wrappers* differ. What must not differ is the code between
// the script tags, because a visitor crossing from a marketing page to an
// inventory page inside one session would otherwise be described two different
// ways to the same vendor.
//
// So this module is the emitter, it has no imports, it produces no HTML, and
// `bznrd-vendure-subsite` vendors it byte-for-byte the way the dashboard
// vendors the renderer. `npm run analytics:check` in that repo fails on drift.
//
// **Do not edit the vendored copy.** Edit this file and re-run the sync.
//
// Nothing here evaluates a string. Every value goes through `JSON.stringify`,
// and the only thing interpolated into code is a global's name, which is
// checked against a bare-identifier pattern first.

/** `</` escaped so a value containing `</script>` cannot end the block early. */
export function json(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

/** A bare identifier, because it is written into executable code. */
const isIdentifier = (name) => /^[A-Za-z_$][\w$]*$/.test(name);

/**
 * One provider's synchronous head bootstrap, as JavaScript source.
 *
 * The queueing-stub pattern is universal — a global that pushes its arguments
 * until the real script loads — so one emitter handles every vendor from a
 * descriptor, and no vendor name is interpolated into code.
 *
 * Ordering is document order, not JS timing: `pageCall` is emitted before
 * `readyCall`, so a detail page's vehicle payload is in the data layer before
 * the page view by construction. There is no promise and nothing to race.
 *
 * Returns null when the descriptor has no usable global, so a caller emits
 * nothing at all rather than an empty script tag.
 */
export function bootstrapCode(provider, facts) {
  const boot = provider?.bootstrap;
  if (!boot?.globalName || !isIdentifier(boot.globalName)) return null;

  const g = boot.globalName;

  // A plain array the vendor's script drains, or a function that queues its own
  // arguments until the vendor's script replaces it. Emitting the wrong one
  // breaks the tag outright — a queue vendor calls `.push`, and a function has
  // none — so it is declared by the provider rather than guessed at here.
  const isQueue = boot.globalKind === 'queue';

  const parts = [
    isQueue
      ? `window.${g}=window.${g}||[];`
      : `window.${g}=window.${g}||function(){(${g}.q=${g}.q||[]).push(arguments)};`,
  ];

  const emit = (args) =>
    isQueue ? `${g}.push(${json(args[0])});` : `${g}(${args.map((a) => json(a)).join(',')});`;

  for (const call of boot.calls ?? []) parts.push(emit(call));

  if (boot.pageCall?.length) {
    parts.push(
      isQueue
        ? // One object: what the vendor calls the event, with the page facts
          // merged into it. That is the whole shape a data layer takes.
          `${g}.push(${json({ ...(boot.pageCall[0] ?? {}), ...pagePayload(boot, provider, facts) })});`
        : `${g}(${boot.pageCall.map((a) => json(a)).join(',')},${json(pagePayload(boot, provider, facts))});`,
    );
  }

  if (boot.readyCall?.length) parts.push(emit(boot.readyCall));

  return parts.join('');
}

/**
 * The page facts and this dealer's settings, named the way this vendor names
 * them.
 *
 * A platform fact with no entry in `pageKeys` is not sent at all, which is how
 * a provider opts out of one without this file knowing the fact exists.
 */
function pagePayload(boot, provider, facts) {
  const payload = {};

  for (const [platformKey, vendorKey] of Object.entries(boot.pageKeys ?? {})) {
    const value = facts?.[platformKey];
    if (value === null || value === undefined || value === '') continue;
    // An empty object is an absent fact, not a fact whose value is `{}`. A
    // vendor receiving `vehicleDetails: {}` reads it as a page that has a
    // vehicle with nothing known about it.
    if (typeof value === 'object' && !Object.keys(value).length) continue;
    // A value map, when the provider has one for this fact. Its keys are the
    // platform's own words for a page kind, which is what the storefront emits;
    // an authored value — a kind a human picked from this provider's own
    // vocabulary — is not a key and passes through untouched. Guarded on string
    // because a non-string fact has no business indexing a map of words.
    const mapped =
      typeof value === 'string' ? boot.pageValues?.[platformKey]?.[value] : undefined;
    payload[vendorKey] = mapped ?? value;
  }

  for (const [key, value] of Object.entries(provider?.settings ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) payload[key] = value.join('|');
      continue;
    }
    payload[key] = value;
  }

  return payload;
}

/**
 * The configuration blob the deferred runtime reads.
 *
 * Inline rather than fetched: a published brand site is static, and a runtime
 * that had to fetch its own configuration would put a network round trip in
 * front of every event on a page that has no server.
 */
export function analyticsBlob({ runtimeVersion = null, pageType = null, providers = [] }) {
  return json({
    runtimeVersion,
    pageType,
    providers: providers.map((provider) => ({
      id: provider.id,
      adapterUrl: provider.adapterUrl,
      settings: provider.settings ?? {},
      consentCategory: provider.consentCategory ?? null,
      // The runtime must not send the first page view to a vendor whose
      // bootstrap already did. This is what it reads to know.
      bootstrapped: !!provider.bootstrap?.readyCall,
    })),
  });
}

// Closed vocabularies a site must author against, when a provider has any.
//
// The lists themselves are not here. They belong to whichever analytics
// provider a dealer has enabled, and the platform bakes them into
// `platform/analytics.json` as `vocabularies` — the intersection of the enabled
// providers' lists, because a page carries one `pageType` and every provider
// that names it receives that same value. This module only knows how to read
// that map and how to behave when it is absent.
//
// Absent is the normal case: a dealer in no programme authors a free-text page
// kind, or none at all, and the validator says so as a note rather than a
// failure.

/** A page kind with no provider constraining it is any non-empty string. */
export function isValidPageType(value, vocabulary) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const allowed = vocabulary?.pageTypes;
  if (!Array.isArray(allowed) || !allowed.length) return true;
  // Case-sensitive by default: a restricted value that differs only in case is a
  // value the provider will reject, and accepting it here would move the failure
  // to somewhere nobody is looking.
  return allowed.includes(value);
}

export function pageTypeOptions(vocabulary) {
  const allowed = vocabulary?.pageTypes;
  return Array.isArray(allowed) ? allowed : [];
}

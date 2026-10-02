// One authored page, one built page per location.
//
// A dealer with six branches used to keep six page directories, each a copy of
// the last with a different slug typed into every widget. That made the set of
// pages the one part of the site Admin did not drive: opening a seventh branch
// put it on every map, list and rail automatically and still left
// `/locations/seventh` a 404 until somebody hand-built a directory for it. Six
// copies also drift, because a wording change has to be made six times.
//
// So a manifest entry says so instead:
//
//   { "slug": "location-detail", "path": "/locations/:slug",
//     "forEach": "locations", "group": "locations" }
//
// Publishing bakes that page's widgets once per location into `locationSnapshots`
// on the page document, alongside a `locations` index of what to emit. The build
// then writes one HTML file per entry in that index. The tree stays one authored
// document, which is what keeps it editable on the canvas.
//
// Nothing here fetches. The index and the snapshots are facts the platform put
// in the file at publish time, so a build with no network still emits every
// location page, and a crawler that runs no script still reads the address.

/** The token a `forEach` path carries where the location's slug goes. */
export const SLUG_TOKEN = ':slug';

/** The only `forEach` source there is today. */
export const LOCATION_SOURCE = 'locations';

/** Is this manifest entry one authored page standing for many? */
export function isLocationPage(entry) {
  return !!entry && entry.forEach === LOCATION_SOURCE;
}

/**
 * The locations a baked page will emit, or an empty list before the first bake.
 *
 * Empty is a normal state, not a fault: a repo built here before it was ever
 * connected to a channel has no locations to know about. The build says how many
 * it emitted, so nought is visible without being fatal.
 */
export function locationIndex(document) {
  const list = document && document.locations;
  return Array.isArray(list) ? list.filter((l) => l && typeof l.slug === 'string' && l.slug) : [];
}

/** That location's baked snapshots, by node id. */
export function locationSnapshots(document, slug) {
  const all = (document && document.locationSnapshots) || {};
  return (all && all[slug]) || {};
}

/** `/locations/:slug` → `/locations/tampa`. */
export function locationPath(path, slug) {
  return String(path || '').split(SLUG_TOKEN).join(slug);
}

/** The file a path builds to, the same rule every other page follows. */
export function locationOut(path) {
  const trimmed = String(path || '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `${trimmed}/index.html` : 'index.html';
}

/**
 * `{{name}}`, `{{city}}` and the rest of the index's fields, in a title or
 * description. An unknown token resolves to nothing rather than being left on
 * screen as braces — a half-substituted `<title>` is worse than a short one.
 */
export function fillTokens(text, location) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = location && location[key];
    return value == null ? '' : String(value);
  });
}

/**
 * Point every widget on the page at one location, where the author left it open.
 *
 * Only where it is open. A widget that names a slug is a deliberate
 * cross-reference — "our parts counter is at the Tampa branch" — and rewriting
 * it per page would turn one such link into six wrong ones.
 *
 * This runs on the built page as well as in the bake, so a widget hydrating in
 * the browser asks about the same location the served markup describes.
 */
export function applyLocationSlug(nodes, slug) {
  for (const node of nodes || []) {
    if (node && node.type === 'widget' && node.props) {
      if (!node.props.config) node.props.config = {};
      if (!node.props.config.locationSlug) node.props.config.locationSlug = slug;
    }
    if (node && node.type === 'sharedSection' && node.props) {
      if (!node.props.values) node.props.values = {};
      if (!node.props.values.locationSlug) node.props.values.locationSlug = slug;
    }
    if (node && Array.isArray(node.children)) applyLocationSlug(node.children, slug);
  }
}

/** Put one location's baked answers back on the tree, by node id. */
export function applyLocationSnapshots(nodes, byId) {
  for (const node of nodes || []) {
    const baked = node && node.id ? byId[node.id] : null;
    if (baked && node.props) {
      if (baked.snapshot !== undefined) node.props.snapshot = baked.snapshot;
      if (baked.snapshots !== undefined) node.props.snapshots = baked.snapshots;
      if (baked.data !== undefined) node.props.data = baked.data;
    }
    if (node && Array.isArray(node.children)) applyLocationSnapshots(node.children, byId);
  }
}

/**
 * One authored location page, prepared for one location.
 *
 * Returns a copy. The authored tree is rendered once per location and must come
 * out of each pass unchanged, or the second location inherits the first's data.
 */
export function locationPageNodes(nodes, document, slug) {
  const copy = JSON.parse(JSON.stringify(nodes || []));
  applyLocationSlug(copy, slug);
  applyLocationSnapshots(copy, locationSnapshots(document, slug));
  return copy;
}

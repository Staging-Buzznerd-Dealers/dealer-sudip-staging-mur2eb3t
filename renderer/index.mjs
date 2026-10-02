// @buzznerd/site-renderer — the single source of truth for turning a dealer's
// site data into HTML.
//
// Three consumers must agree exactly, and they can only agree because they share
// this module rather than each having a view of the same idea:
//
//   scripts/build.mjs      renders the published site on Vercel
//   the dealer dashboard   renders the editor canvas, and drives GrapesJS from
//                          the same node definitions the build uses
//   the Vendure plugin     imports the schemas, to validate what the AI returns
//                          before any of it is committed
//
// The vocabulary is one tree: section, row, column, contentArea, and widgets as
// leaves. GrapesJS registers one component type per layout node, the AI contract
// is generated from the same table, and `renderDocument` is what turns it into
// HTML. There is no translation layer between the three.
//
// Zero runtime dependencies, ESM, Node 20 and modern browsers. It is imported by
// a zero-dependency static build, so it may not add a bundler requirement to it.

// 4.19.0 — one authored page builds one page per location. A manifest entry
// declaring `forEach: "locations"` with `:slug` in its path is expanded by the
// build from the locations publish baked into the page document, and its
// widgets are pointed at each location in turn. Until now the set of location
// pages was the one part of a dealer's site Admin did not drive: opening a
// branch put it on every map, list and rail automatically and still left
// `/locations/<slug>` a 404 until somebody hand-built a directory, and the six
// copies that produced drifted apart on every wording change. Two template
// conditions come with it — `allLocations` and `location` — because the
// generated slugs do not exist until a location does, so a specific-page
// condition cannot reach them; and a `location` menu item type, whose `ref` is
// the Admin slug rather than a page slug, for the same reason.
//
// 4.18.0 — `locations-map` draws static OpenStreetMap tiles unless a placement
// asks for an interactive provider. The old default was the openstreetmap
// iframe, which is the one output that cannot appear in three of the four
// places a map is looked at: the Design canvas runs no site JS, Preview's frame
// is a unique origin the embed refuses to render inside, and JS-off gets
// nothing. So a dealer who never opened the setting saw "access blocked" in
// Preview and a grey box on the canvas. `openstreetmap` and `google` are still
// there for a placement that wants pan and zoom on the published page; neither
// they nor the tiles need an API key.

// 4.17.0 — the `locations` source carries the rest of a rooftop's record, not
// just its address: brands carried, services offered, Google service options
// (in-store shopping, curbside pickup, delivery), public departments, an hours
// summary, and the first two public department phones. These read as a card's
// editorial copy and are in fact dealer records edited on Admin → Locations, so
// 4.16's `overlay` was quietly the wrong home for them: an overlay keyed to a
// slug is a typed copy wearing a costume, and it goes stale the same way. What
// belongs in an overlay is only what the platform does not hold at all — a brand
// swatch, a display badge.
//
// 4.16.0 — a component's `list` prop can be pointed at live dealer data instead
// of typed rows. The placement names a source from `data-sources.mjs`, the
// platform resolves it on publish exactly as it resolves a widget snapshot, and
// `repeat` draws the dealer's own design once per live row. Until now the two
// halves were mutually exclusive: a `widget` node was live but owned its markup,
// and a typed list was the dealer's markup over a copy of the facts. Every site
// built here resolved that the same way — the widget placed for its map with its
// list hidden in CSS, and the real tiles hand-fed beside it, going stale the day
// a rooftop moved. An `overlay` carries the editorial extras the platform does
// not hold (a badge, a swatch), keyed to the row it belongs to, and may not
// restate a field the source owns.
//
// 4.15.0 — a dealer-data list can be a carousel. `locations-map`, `staff` and
// `inventory-carousel` mark their generated list as `track` and each item as
// `slide`, so a rail of live rooftops, people or listings finally answers to the
// `carousel` behaviour. Until now those were the only rails that could not: a
// behaviour finds its pieces by `data-bz-part`, an author sets that on a node,
// and these items have no node. Every such rail therefore shipped hand-written
// arrow JavaScript, which the Design canvas never runs — so the arrows were dead
// in the editor and carried no keyboard or reduced-motion support anywhere. The
// carousel also reads its slides live and watches a declared track, because
// `hydrate` rebuilds those lists after the behaviour has already bound.
//
// 4.14.1 — locations-map draws the OpenStreetMap embed from the snapshot, so
// the Design canvas and a no-JS first paint show the map. Until now the box
// was empty until widgets.js ran, which the editor never does.
// 4.14.0 — a rooftop page emits its own LocalBusiness. A page naming a
// `locationSlug` in site/pages.json builds its structured data from that page's
// own widget snapshots — address, geo, phone, per-department
// openingHoursSpecification — and the company-level node is suppressed there, so
// a four-branch dealer stops publishing four pages that all claim the head
// office. `staff` finally redraws on hydrate; it had fetched its data and thrown
// it away since the endpoint existed. `snapshot` is a declared prop, so the
// validator no longer calls the one prop that makes a published page correct an
// unknown one it will ignore.
//
// 4.13.0 — locations-map cards carry `href` from `pagePathPrefix` + slug so a
// rooftop list links into `/locations/{slug}` rather than being dead cards; hours
// emit one table per public department (`schedules`); the client hydrate redraws
// location lists, phones and hours, not only the map iframe. Video blocks and
// `backgroundVideo` land in the same cut (4.12).
//
// 4.10.0 — a style override can target a descendant. `textColor` now also
// compiles onto `*:not(.bz-btn)` inside the node, because `color` is inherited
// and an inherited value loses to any rule that matches a descendant directly —
// blocks.css sets it on `.bz-lede`, `.bz-eyebrow`, `.bz-card__m` and a dozen
// more, so "Text colour" moved the wrapper and nothing anyone could see. Four
// `button*` fields compile onto `.bz-btn` for the same structural reason: a
// button is a descendant of the block that places it, so the block's own
// background paints the strip behind it and never the button.
//
// 4.8.0 — `postsList` block: the latest published posts, resolved at build time
// from ctx.posts so a teaser never goes stale; and half-bleed section widths
// (`bleed-left` / `bleed-right`) — one side on the page grid, the other running
// to the screen edge, the split-section pattern every marketing homepage uses.
//
// 4.7.0 — `documentStyles` compiles instance style overrides for a document and
// for every designed component it places. `compileNodeStyles` sees only the nodes
// it is given, and a page holds a component as one reference node, so anything
// styled inside a component rendered unstyled on every page that placed it.
//
// 4.6.0 — designed components take placeholders. A component declares `props`,
// its nodes bind to them with `{{key}}`, a node can `repeat` over a list prop, and
// a `sharedSection` placing it supplies `values`. Until now a reusable component
// was identical everywhere it appeared, which is reuse in name only: the same
// carousel with different logos meant a second copy of the carousel.
//
// 4.5.0 — behaviour, behaviourOptions and part are props on every node, so an
// interactive component can be a tree the canvas builds rather than markup a
// person or a model hand-writes. `anchor` and `scope` join them as declared
// universal props: the renderer always read those off any node's wrapper while no
// widget declared them, so the validator refused edits the build would render.
// 4.22.0 — a rooftop carries its own `photo`, edited on Admin → Locations. It
// exists because generated location pages took the old place for one away: a
// photo on the authored page is the same photo on every branch, and the only
// alternative was going back to a hand-written page per rooftop.
//
// 4.21.0 — a list prop's field may itself be a list, two deep, and the
// `locations` source stops flattening. `brandRows`, `serviceRows`, `perkRows`,
// `departmentRows` and `hoursRows` (departments, each with a seven-day week)
// arrive as rows instead of one ` · `-joined string apiece, and a rooftop
// carries its `group` and `groupKey`. The strings stay, so a site bound to them
// is untouched. `repeat` always resolved a key against the row it sits inside;
// what was missing was any way to declare the shape, which is why an hours table
// could only ever be the platform widget's — and that widget has no hours table.
//
// 4.20.0 — a page may carry `seo.keywords`, and `site/redirects.json` records
// where a renamed page's old address goes. The redirects file is the dealer's,
// in `site/`, because `vercel.json` is rebuilt from the template on every engine
// sync; the platform composes one into the other when it bakes.
// 4.23.0 — a form's confirmations and its hidden fields. `confirmations` is an
// ordered, first-match-wins list of what the visitor sees next, so a form can
// thank a fleet enquiry differently from a general one without being two forms;
// the page bakes in the unconditional entry and the server's answer wins at
// runtime, because only the server has the values the conditional entries are
// judged against. A field marked `hidden` is still a field — never rendered to
// the visitor, still stored, still available to conditions and routing — and its
// `valueSource` says where the client captures it from. `spec:` condition
// sources let a form embedded on a product page route by the listing instead of
// by an answer; the surface that knows the listing supplies them.
// 4.24.0 — the dealer's own map art, with a pin per rooftop on top of it.
// `locations-pinmap` takes the artwork as an image prop and two calibration points,
// derives a Mercator projection from them, and places each location by its
// coordinates at build time — so the pins are in the served HTML and draw on the
// Design canvas, in the first paint and with JavaScript off. The pins carry the same
// brand and service-option keys the cards do and are `part: "item"`, so one `filter`
// behaviour lights up the map and filters the list below it from one chip row; they
// are marked rather than hidden, because a map that drops a pin has lost the
// comparison it exists to make. `location-photo` draws a rooftop's own picture and
// nothing when there is none — never a generated street map, which would be a
// different section wearing this one's clothes. A location also carries a `subtitle`,
// the name it trades under, because `name` is the place and a card wants both.
// 4.25.0 — the storefront's icons can be the brand's. `site/icons.json` maps each
// place the /store pages draw a mark (`ICON_SLOTS`) onto a class from an icon
// library the site loads, or onto an image, and the build publishes it in
// `/partials/manifest.json` as `icons`. Unmapped slots keep the storefront's own
// characters; a site with no file publishes no `icons` and nothing changes.
export const RENDERER_VERSION = '4.25.0';

export {
  LOCATION_SOURCE,
  SLUG_TOKEN,
  applyLocationSlug,
  applyLocationSnapshots,
  fillTokens,
  isLocationPage,
  locationIndex,
  locationOut,
  locationPageNodes,
  locationPath,
  locationSnapshots,
} from './location-pages.mjs';
export { isValidPageType, pageTypeOptions } from './analytics-vocab.mjs';
export { analyticsConfig, analyticsHead, missingIdentity } from './analytics.mjs';

export {
  BEHAVIOURS,
  BEHAVIOUR_PARTS,
  BEHAVIOUR_OPTIONS,
  PARTS,
  behaviourAttrs,
} from './behaviours.mjs';

export {
  bindTree,
  bindingsUsed,
  componentSampleValues,
  componentValues,
  isBinding,
  parseComponentProps,
  previewProps,
  resolveValues,
} from './component-props.mjs';

export { DATA_SOURCES, dataSource, isDataBinding, resolveDataBinding } from './data-sources.mjs';

export { componentCode, documentStyles } from './document-assets.mjs';
export {
  esc,
  attrs,
  tagAttrs,
  heading,
  image,
  join,
  cls,
  href,
  isExternal,
  isSiteAssetPath,
  resolveAssetUrl,
  rewriteAssetUrls,
} from './html.mjs';
export {
  STYLE_FIELDS,
  STYLE_BUCKETS,
  STYLE_GROUPS,
  sanitizeStyles,
  unknownStyleKeys,
  compileNodeStyles,
} from './styles.mjs';
export {
  compileTokens,
  compileTokenScope,
  fontFaceCss,
  fontFiles,
  fontPreloads,
  fontsHref,
  withDefaults,
  DEFAULT_TOKENS,
  TOKEN_GROUPS,
} from './tokens.mjs';
export {
  ICONS_VERSION,
  ICON_SLOTS,
  ICON_SLOT_IDS,
  MAX_ICON_STYLESHEETS,
  emptyIcons,
  iconsManifest,
  isIconClass,
  isIconImageUrl,
  isIconUrl,
  parseIcons,
} from './icons.mjs';

/* ------------------------------------------------------------- the document */

export {
  DOCUMENT_VERSION,
  LAYOUT_TYPES,
  CONTAINER_TYPES,
  GRID_COLUMNS,
  LAYOUT_REGISTRY,
  UNIVERSAL_PROPS,
  BEHAVIOUR_PROPS,
  ROW_PRESETS,
  accepts,
  ensureIds,
  getLayout,
  isContainer,
  isLayout,
  layoutCatalogue,
  locateNode,
  makeRow,
  makeSection,
  nextNodeId,
  nodeIds,
  parseDocument,
  renderDocument,
  walkNodes,
} from './nodes.mjs';

/* ----------------------------------------------------------------- widgets */

export {
  blockRegistry,
  blockCatalogue,
  getBlock,
  resolveCta,
  registerCustomWidgets,
  clearCustomWidgets,
  customWidgets,
  customWidgetCss,
  defaultPropsFor,
  allWidgetIds,
  widgetIds,
  WIDGET_GROUPS,
} from './blocks.mjs';

export {
  parseWidgetDefinition,
  compileWidget,
  compileWidgets,
  compileTemplate,
  widgetSchema,
  defaultProps as widgetDefaultProps,
  previewProps as widgetPreviewProps,
  renderWidgetPreview,
  scopeCss,
  stripUnsafeHtml,
  stripUnsafeCss,
  declaresSlots,
  isAutoTagged,
  emptyDefinition,
  PROP_TYPES,
} from './custom-widgets.mjs';

export {
  renderForm,
  operatorsForFieldType,
  defaultConfirmation,
  FIELD_TYPES,
  SPEC_SOURCES,
  VALUE_SOURCES,
} from './forms.mjs';
export {
  renderWidget,
  staticWidgetIds,
  rooftopFrom,
  makeProjection,
  BEHAVIOUR_ONLY,
} from './widgets.mjs';

/* -------------------------------------------------------- menus + templates */

export { renderMenu, injectMenus, parseMenus, listMenus, emptyMenu, MENU_ITEM_TYPES, MAX_MENU_DEPTH } from './menus.mjs';

export {
  TEMPLATE_VERSION,
  CONDITION_TYPES,
  composeDocument,
  conditionMatches,
  describeCondition,
  findContentArea,
  hasContentArea,
  parseTemplate,
  parseTemplates,
  resolveTemplate,
  splitAtContentArea,
  starterTemplate,
  templatePath,
} from './templates.mjs';

/* ----------------------------------------------------- shell, checks, edits */

export { renderShell, businessJsonLd, analyticsTag } from './shell.mjs';
export { validateDocument, validateNode, validateTemplate, getDefinition } from './validate.mjs';
export { applyOps } from './ops.mjs';

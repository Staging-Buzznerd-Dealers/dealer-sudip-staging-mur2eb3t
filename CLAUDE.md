# Building a dealer brand site in this repository

This repo is a **BuzzNerd dealer brand site**. It is also the template every dealer
site is generated from, so the instructions below apply whether you are working in
the template itself or in a repo generated from it.

The site's content is **JSON, not HTML**. A renderer turns that JSON into static
HTML at build time, and the same renderer draws the editing canvas in the BuzzNerd
dashboard. That is the whole reason for the JSON: a page authored here can be
opened and edited visually afterwards. Write HTML instead and you get a page that
builds but cannot be edited, which defeats the point of building it here.

**The single rule that matters: `npm run validate` must pass before you push.**
It runs the renderer's own validators over every file you wrote and reports the
file, the path inside it, and the fix. A repo that fails it will either be refused
by the dashboard or open with holes in it.

```bash
npm install          # nothing to install — zero dependencies. Node 20+.
npm run validate     # every site/ file against the renderer's rules
npm test             # the renderer's own specs
npm run build        # site/ -> dist/, the real static output
npm run check        # all three, in order

npm run validate -- --root ../some-dealer-repo   # check another repo against this renderer
```

`validate` reports two kinds of thing. **Failures** must be fixed. **Notes** build
fine and are still work: a repeated shape that should be one list (§4), scripted
staging that should be a behaviour (§5), a template that wraps no pages (§3).

**This file is the authoring guide. The complete reference is
[`../vendure/docs/07-block-model-reference.md`](../vendure/docs/07-block-model-reference.md)**
— every block, every prop, every allowed value, the eight behaviours and their parts,
the 70 style fields, the token map, the file shapes, and the full validator rules. It is
transcribed from `renderer/block-schemas.json`. `../vendure/docs/README.md` indexes the
rest of the platform, including how a finished repo is connected to a dealer's channel.

---

## 1. What you may and may not write

| Path | |
|---|---|
| `site/**` | **Yours.** All content: pages, templates, components, menus, forms, buttons, tokens, blog. |
| `public/**` | **Yours.** Static assets — images, logos, fonts. |
| `dealer.config.json` | **Yours**, except the identity fields the platform fills in (below). |
| `renderer/**`, `scripts/**`, `ai/**`, `platform/**`, `vercel.json`, `dealer.config.schema.json` | **Platform-owned. Do not edit.** The platform overwrites these when it syncs a repo forward — and deletes the ones it has dropped — so an edit here is lost, and until it is lost this dealer is running a renderer nobody else is. |

If something you need cannot be expressed in `site/`, that is a platform gap worth
reporting, not a reason to edit `renderer/`.

In `dealer.config.json`, leave `channelToken`, `domain`, `url` and
`storefrontOrigin` as their `REPLACE_…` placeholders. The platform writes them
when the repo is connected to a dealer's channel. Everything else — `name`,
`business`, `seo`, `logo`, `favicon` — is yours and should be filled in properly.

`platform/analytics.json` is generated per dealer and re-baked on every publish,
from whichever analytics providers that dealer has enabled. Never create it by
hand: a dealer in no programme has no such file, and their built site then
contains no third-party code and no third-party URL at all — which is the point.
`platform/analytics.schema.json` documents its shape if you need to read one.

---

## 2. The document model

A page, a template and a component are all the same shape: a tree of nodes.

```json
{
  "version": 2,
  "nodes": [
    { "id": "hero", "type": "section", "props": { "background": "ink", "paddingY": 8 }, "children": [
      { "id": "hero-row", "type": "row", "props": { "gap": 6 }, "children": [
        { "id": "hero-copy", "type": "column", "props": { "span": 7 }, "children": [
          { "id": "hero-h", "type": "heading", "props": { "text": "Trucks that work as hard as you do", "headingLevel": 1 } },
          { "id": "hero-cta", "type": "buttons", "props": { "items": [{ "ctaId": "browse-inventory" }] } }
        ]},
        { "id": "hero-media", "type": "column", "props": { "span": 5 }, "children": [
          { "id": "hero-img", "type": "image", "props": { "image": { "src": "/hero.jpg", "alt": "A truck at dusk" } } }
        ]}
      ]}
    ]}
  ]
}
```

Four layout types, and everything else is a leaf:

| Type | Holds | Notes |
|---|---|---|
| `section` | rows, widgets | A full-bleed band. `width`, `background`, `paddingY`, `minHeight`. |
| `row` | columns **only** | A 12-column grid. `gap`, `stackOn`. |
| `column` | rows (nesting), widgets | Declares `span` 1–12. Spans in one row should total 12. |
| `contentArea` | nothing | Templates only. Marks where a page's content is injected. |
| any widget | **nothing** | A widget with `children` is rejected. |

Rules the validator enforces, so learn them now rather than from the error:

- **`id` is required, short, and unique across the document.** Never renumber ids
  in a file that already exists — the editor treats a changed id as delete + add
  and the dealer loses that node's history.
- **`props` must validate against the type's schema.** Unknown props are dropped
  with a warning, never guessed at.
- **A widget cannot hold children.** "A widget with two halves" is a row with two
  columns.
- Every node may *also* carry `anchor` (becomes a real HTML `id`), `scope`,
  `behaviour` / `part` / `behaviourOptions` (§5) and `repeat` (components only).

The authoritative list of every block, every prop and every allowed value is
**`renderer/block-schemas.json`** (regenerate with `npm run schemas`). Read it
rather than guessing. Today's catalogue:

- **basic** — `heading` `text` `image` `video` `buttons` `list` `spacer` `divider` `customHtml`
- **navigation** — `logo` `menu`
- **forms** — `form`
- **dealer data** — `widget` (live inventory, locations, hours, phones, FAQ, staff)
- **prebuilt sections** — `hero` `splitHero` `iconGrid` `categoryGrid` `statBand` `serviceGrid` `testimonials` `logoStrip` `postsList` `locationsMap` `footer`

**Video** is one `src` field on the `video` block: a file from the media library,
or a YouTube/Vimeo link, told apart by the renderer. Give an uploaded file a
`poster` — without one the block is black until someone presses play, and the
editing canvas has nothing to draw. A clip *behind* a band is the section's
`backgroundVideo` prop, never a `backgroundImage` style: `background-image`
cannot play a video and the renderer drops one, so that route is a blank hero.

**Avoid `customHtml`.** It renders, but it is opaque to the editor, cannot be
restyled from the design system, fails analytics tagging, and has its scripts and
inline handlers stripped. Reach for it only when the alternative is not shipping
the section at all, and say so in your summary. A shape no block covers should be
a component or a coded widget (§4, §6).

---

## 3. Where each thing lives

Every one of these is edited in the dashboard afterwards, so the right-hand
column is the screen a dealer will look for it on. Use those words in your
summary — nobody in the dashboard has heard of `sharedSection`.

```
site/pages.json              The page manifest                  → Pages
site/pages/<dir>/page.json   One page's node tree               → Pages → (page) → canvas
site/pages/<dir>/style.css   That page's own CSS                → its canvas, "Custom code"
site/pages/<dir>/script.js   That page's own JS                 → same drawer
site/templates/<id>.json     Chrome + layout, applied by display conditions → Templates
site/sections/<id>.json      A component: tree + props + css/js → Components, "Designed" tab
site/widgets/<id>.json       A coded widget: markup + props     → Components, "Coded" tab
site/menus.json              Named menus (label + destinations) → Menus
site/buttons.json            The CTA library — every button once → Buttons
site/forms/<id>.json         Fields, notifications, confirmations → Forms
site/tokens.json             Colour, type, spacing, radius, fonts → Design system
site/icons.json              The /store icons: slot → class or image → Design system, Storefront icons
site/blog/settings.json      Blog on/off, base path, title       → Posts
site/blog/posts/<slug>.json  One post (may carry its own css/js) → Posts
site/custom-code.json        Site-wide css/js + head/body slots  → Design → Custom code
site/redirects.json          Old addresses → new ones (a copy)   → Redirects, kept in Admin
```

### One page per location

A dealer's branches are records in Admin, so the pages for them are **generated,
not written**. One entry in `site/pages.json`, one page directory, and the build
emits a page per location:

```json
{ "slug": "location-detail", "title": "{{name}}", "path": "/locations/:slug",
  "out": "locations/:slug/index.html", "dir": "location-detail",
  "group": "locations", "forEach": "locations" }
```

Write the page once, in `site/pages/location-detail/page.json`, and **leave
`locationSlug` off every widget on it** — the page *is* one location and the
build fills the slug in per page. A widget that does name a slug keeps it, which
is how a deliberate cross-reference to another branch survives.

`{{name}}`, `{{city}}`, `{{region}}`, `{{streetAddress}}`, `{{postalCode}}` and
`{{phone}}` work in the entry's `title` and `description`, and **nowhere else**.
Nothing substitutes them into a node's props: a `heading` reading `{{name}}` is
a heading that says `{{name}}` on all six pages. The branch's own facts as page
copy are a scoped data binding — next section. Publishing bakes the locations
into the page document; before the first publish the page emits nothing and
`npm run validate` says so as a note.

### The branch's own name, address and phone, as page copy

A generated page needs its rooftop's facts in the *design's* blocks — a headline,
an address paragraph, a "Get directions" button — not only inside a widget's own
card. **Point a component's list prop at `locations` and scope it with
`{{locationSlug}}`:**

```json
{ "id": "head", "type": "sharedSection", "props": {
  "sectionId": "location-header",
  "values": { "rooftop": { "source": "locations", "config": { "locationSlug": "{{locationSlug}}" } } }
}}
```

The build fills `locationSlug` in per page, so the binding resolves to a one-row
list of *that* branch, and one `repeat` inside the component draws `{{name}}`,
`{{subtitle}}`, `{{streetAddress}}`, `{{city}}`, `{{region}}`, `{{postalCode}}`,
`{{phone}}`, `{{phoneUrl}}`, `{{email}}` and `{{mapUrl}}` in real blocks — every
one of them selectable and restylable on the canvas.

Two things to get right:

- **The component must declare a `locationSlug` prop.** Only declared props are
  carried to the placement, so an undeclared one is dropped before the binding is
  resolved and the band comes back empty.
- **A rail of *other* branches is `excludeSlug`, not an unscoped binding.**
  `{"source":"locations","config":{"excludeSlug":"{{locationSlug}}"}}` is every
  rooftop but this one. Unscoped returns all of them including the branch the
  visitor is already on, and hiding that card in CSS breaks the day a rooftop
  opens.

**Do not hand-write a directory per branch.** Six copies validate and build, and
then the set of pages is the one part of the site Admin does not drive: opening a
seventh branch puts it on every map, list and rail automatically and still leaves
its own page a 404.

Two consequences for the rest of the site. Chrome for these pages comes from an
`allLocations` template (or `location` with a slug for one branch) — a `page`
condition cannot name a slug that does not exist until the branch does. And a
menu item that links to a branch is `{"type":"location","ref":"tampa"}`, where
`ref` is the **Admin slug**, not a page slug.

### Templates and display conditions

A template is a full layout — header, a `contentArea`, footer — and **display
conditions decide which pages it wraps**. A template with no matching condition
is not an error: it builds, it validates, and it appears on nothing. That is the
most expensive mistake available here, so `npm run validate` now refuses an
unknown condition type and warns when no template covers the site.

```json
{ "version": 2, "id": "default", "name": "Site template",
  "conditions": [{ "type": "entireSite", "ref": null }],
  "nodes": [ /* header … */ { "id": "content", "type": "contentArea", "props": {} } /* … footer */ ] }
```

Eleven condition types, least to most specific: `entireSite`, `allPages`,
`allPosts`, `blog`, `inventory`, `parts`, `allLocations`, `pageGroup` (`ref` = a
group name), `page` / `post` (`ref` = a slug), `location` (`ref` = an Admin
location slug). The most specific match wins, so a homepage with its own
treatment is a second template with `{ "type": "page", "ref": "home" }` — not a
copy of the default with one section changed.

`inventory` covers the live browse and detail pages **and the parts catalogue**;
`parts` narrows to the catalogue alone. Without a `parts` template, parts pages use
the `inventory` one.

Every site needs one `entireSite` or `allPages` template, or pages fall through
to no chrome at all. And a template needs **exactly one** `contentArea`: none
means the page has nowhere to go, two means there is no answer to which.

**Redirects are not authored here.** `site/redirects.json` is written by the
platform from the rules a dealer keeps on **Storefront → 301 Redirects** in Admin,
and composed into `vercel.json` on publish. Once it carries
`"managedBy": "admin"`, a hand edit is overwritten by the next sync. If a site
you are building needs old addresses redirected, list them in your summary and
say they go on the Redirects screen (it imports a Simple 301 Redirects CSV).

Two cross-file rules the validator checks and nothing else will:

- Every entry in `site/pages.json` needs a matching `site/pages/<dir>/page.json`,
  and `out` must agree with `path` (`/financing` → `financing/index.html`).
- Every id a node references must exist: `formId`, `ctaId`, `sectionId`, `menuId`,
  and a menu item's `ref` pointing at a page slug.

---

## 4. Use the libraries, not literals

This is the difference between a site a dealer can run and a pretty dead end.

| Instead of | Do this | Why |
|---|---|---|
| A hand-built `<form>` or a form's fields inline | `{"type":"form","props":{"formId":"request-info"}}` | A form owns its validation, consent text, **who is notified** and **what the visitor sees next**. A hand-built one sends leads nowhere and nobody notices for a month. |
| A button with an inline label and url | `{"ctaId":"browse-inventory"}` from `site/buttons.json` | One place to change the label, and consistent conversion tracking. |
| A typed-out list of nav links | `{"type":"menu","props":{"menuId":"main"}}` | Edited in one place, used in many. |
| A typed-out list of locations, hours, phone numbers, or inventory | `{"type":"widget","props":{"widget":"locations-map"}}` etc. | Live platform data. A hardcoded address list is wrong the day a location moves. |
| A hardcoded hex, font size or spacing value | A token in `site/tokens.json` | One edit restyles the whole site. Hardcoded values are what make a site un-rebrandable. |
| Hand-maintained "latest news" cards | `postsList` | Resolves real posts at build time; cards never go stale. |

If a library item you need does not exist, **create it** (a button in
`buttons.json`, a menu in `menus.json`, a form in `site/forms/`) and then
reference it. Do not inline it because the library is empty.

### A form is four things, and three of them are lists

`site/forms/<id>.json` holds `fields`, `notifications` and `confirmations`, plus the
consent and analytics settings. The full shape is in
[`../vendure/docs/07-block-model-reference.md`](../vendure/docs/07-block-model-reference.md)
§ *A form definition*; what matters while authoring one:

- **`notifications` and `confirmations` are ordered, and the first match wins.** Top to
  bottom, the first entry whose `rules` pass — or that has none — wins, and evaluation
  **stops**. That is what lets one list mean "this case, otherwise that". Put the specific
  entries above the catch-all; an unconditional entry above a conditional one makes the
  lower one dead, and `npm run validate` says so as a note.
- **A live form with no `notifications` tells nobody.** The submission is stored and
  exported, and then sits there. That is also a note.
- **A `hidden` field is still a field** — never rendered, still stored, still readable by a
  condition and by a notification rule. `valueSource` says where its value comes from
  (`static` `query` `referrer` `pageUrl` `utmSource` `utmCampaign` `utmMedium` `productId`);
  the platform captures everything but `static`. Marking one required does nothing, because
  required **and visible** is the only validation gate.
- **`width: "half"` on two adjacent fields** pairs them onto one line. Anything else fills
  the row.
- **`pdpContext: true`** adds `spec:location`, `spec:department`, `spec:type` and
  `spec:category` as things a rule can name, for a form embedded beside a listing. They
  resolve from the platform's product context, so never write one on a form that is not
  marked for product pages — `npm run validate` refuses it.

Do not write a role's display name into `roleId`. Use the stable code the platform seeds
(`sales-manager`, `service-advisor`, `parts-manager`, `marketing-manager`, …): a name is
something a dealer renames, and a rename would silently route the next month's leads to
nobody.

### A repeated shape is one list, not N copies

Any row of cards — brands, services, testimonials, staff, whatever the design
calls for — can be written as one `column` subtree per card. It validates, it
builds, and it is the most common way a site built here ends up unmaintainable.
The dealer who wants the same wording change on all of them makes it once per
card; adding one more means copying a subtree by hand; and nothing in the file
says those cards are one list, so the canvas offers N unrelated layouts instead
of one list with N items.

**Three or more siblings of the same shape is the signal.** Reach for, in order:

1. **A prebuilt block whose items are props** — `iconGrid`, `categoryGrid`,
   `serviceGrid`, `statBand`, `testimonials`, `logoStrip`, `postsList`. One node,
   one `items` array, and the dealer gets a list editor for free.
2. **A `widget` node**, if the list is platform data (inventory, locations,
   staff, hours). Then it is never stale.
3. **A component** in `site/sections/` with a `list` prop and one node carrying
   `repeat` — the general answer when the cards are your own data and the shape
   is richer than any block's `items`.
4. **A coded widget** in `site/widgets/` with typed props (§6), when one card is
   markup no block expresses and the whole card is a leaf.

`repeat` only does anything inside a component, because binding happens when a
`sharedSection` is expanded. On a page node it is inert — the validator accepts
it and the build ignores it, which is a silent way to ship the copies you were
trying to avoid.

### Your card design, the platform's data

Options 2 and 3 used to be a choice you had to make. A `widget` node is live and
draws **the platform's** card; a component with `repeat` draws **your** card over
rows you typed, which are a copy and are wrong the day a rooftop moves. Sites
built here kept splitting the difference — placing `locations-map` for its map
with its list hidden in CSS, and hand-feeding the real tiles beside it.

**A placement can point a list prop at live data instead of typing rows.**

```json
{ "id": "rail", "type": "sharedSection", "props": {
  "sectionId": "location-rail",
  "values": {
    "locations": {
      "source": "locations",
      "config": { "pagePathPrefix": "/locations" },
      "overlay": [{ "slug": "davenport", "dot1": "#EE2D24", "tag1": "Curbside pickup" }]
    }
  }
}}
```

Four sources today, and `renderer/data-sources.mjs` is the authoritative list:

| `source` | Rows | Keyed on | `config` | Fields you may bind to |
|---|---|---|---|---|
| `locations` | Every active rooftop | `slug` | `locationSlug`, `excludeSlug`, `pagePathPrefix` | **Identity** `id` `name` `subtitle` `slug` `num` `href`<br>**Address** `streetAddress` `city` `region` `postalCode` `country` `latitude` `longitude` `mapUrl`<br>**Contact** `phone` `phoneUrl` `email` `phone2` `phone2Url` `phone3` `phone3Url`<br>**The record** `brands` `services` `perks` `departments` `hours` `photo` `banner`<br>**Unflattened** `brandRows` `serviceRows` `perkRows` `departmentRows` `hoursRows`<br>**Filter keys** `brandKeys` `perkKeys` `perk1` `perk2` `perk3` |
| `location-brands` | One per brand at least one rooftop carries | `value` | `locationSlug` | `label` `value` |
| `location-service-options` | One per service option offered | `value` | `locationSlug` | `label` `value` |
| `staff` | The team directory | `name` | `locationSlug`, `departmentCode` | `name` `title` `phone` `phoneUrl` `photo` |

Bind to **those** field names. `{{state}}` and `{{url}}` are not among them —
`{{region}}` and `{{mapUrl}}` are — and a name the source does not carry renders
empty forever, which on the canvas reads as "the data is not arriving".

**`config` values may themselves be `{{prop}}` bindings**, resolved against the
placement. That is how a generated location page scopes a band to its own branch
(§3) and how a filter bar offers only the brands *that* rooftop carries. A
`config` the platform cannot fully resolve leaves the rows it already has, rather
than emptying a working band.

The two `*-options` sources exist because a `filter` behaviour's controls have to
be the facets the cards actually carry. A typed chip for a marque nobody stocks
hides every card when pressed, which reads as a broken page rather than an empty
one, and nothing about a typed list says which of the two it is.

The last three groups are the ones worth knowing about, because they read like a
card's editorial copy and are not. **`brands`, `services`, `perks`, `departments`
and `hours` are dealer records**, edited on Admin → Locations → the rooftop's own
tabs, and they arrive as one ` · `-joined string apiece because a binding
resolves to a scalar. `brandKeys` and `perkKeys` are the same two as machine
keys, space separated, for a `filter` behaviour's `data-` attributes — match a
control's value against those, never against the display copy. `perk1`–`perk3`
exist for a card that shows service options as separate pills.

When the design wants **rows rather than a sentence** — brand tiles, an hours
table, a department with its own number — use the unflattened five instead:
`brandRows` (`name`, `key`), `serviceRows` (`name`, `description`), `perkRows`
(`label`, `key`), `departmentRows` (`name`, `key`, `phone`, `phoneUrl`, `email`,
`hours`) and `hoursRows` (`department`, `key`, `summary`, `days` — itself a list
of `day`, `hours`, `opensAt`, `closesAt`, `closed`). A list field may be two deep
and you draw it by nesting `repeat`; `hoursRows` always carries all seven days,
closed ones included, because a table that skips Sunday misaligns against one
that does not.

`name` is the place — "Brooksville" — and `subtitle` is the business under it,
which differs per branch: one trades as "Truck & Trailer Parts" and the next as
the parent company. Use both on a card and neither as a stand-in for the other.
The organisation's own name is the same on every card and is not this.

### The map of the estate is a widget, not a picture you place

A "find a location" band is a map of the dealer's territory with a pin per
rooftop, a row of brand and perk chips, and the cards below. **Every part of that
is already built**, and the one part you cannot compose is the map:

```json
{ "id": "find", "type": "section", "props": {
    "behaviour": "filter", "behaviourOptions": "{\"match\":\"includes\"}" },
  "children": [
    { "id": "find-map", "type": "widget", "props": { "widget": "locations-pinmap",
        "config": { "pagePathPrefix": "/locations" } } },
    { "id": "find-row", "type": "row", "props": {}, "children": [ /* chips, part: "control" */ ] },
    { "id": "find-cards", "type": "row", "props": {}, "children": [ /* cards, part: "item" */ ] }
  ]}
```

`locations-pinmap` takes **the dealer's own artwork** as an image prop and two
calibration points, and places each rooftop from the coordinates on its record. So
a branch that opens appears on the map without anyone touching the picture, and
the pins are in the built HTML rather than added by a script — which is what makes
them draw on the Design canvas and in the first paint.

The three things to get right:

- **Do not hand-build it.** An `<img>` of a map with absolutely positioned dots
  over it is the same trap as the hand-rolled carousel in §5: the dots are wrong
  the day a rooftop moves, they cannot filter, and nobody can edit them. There is
  also no `mapProvider` here — `locations-pinmap` is the dealer's art, and
  `locations-map` is a generated street map. They are different sections.
- **One `filter` behaviour covers the map and the cards.** The widget marks every
  pin `part: "item"` and carries the same `brandKeys` and `perkKeys` the cards do,
  so one chip row filters the list and lights up the map. The pins are *dimmed*
  rather than removed, because a map that drops a pin has lost the comparison it
  is there for. You do not opt into that and cannot switch it off.
- **The artwork is the dealer's, set in the dashboard.** Do not commit a basemap
  to `public/` and reference it. Selecting the map block shows **Choose image**,
  which takes the file from the Media Bin — SVG or PNG, a silhouette with no pins
  drawn on it. Leave `basemap` empty and say in your summary that the dealer
  uploads the map on that block. The two calibration points are number fields on
  the same block (`anchors`); there is no click-the-picture screen for them.

A rooftop with no coordinates cannot be pinned and is left off rather than dropped
at 0,0. `npm run validate` and the build both say how many, by name — if a pin is
missing, that rooftop needs coordinates on Admin → Locations, and nothing about
the page is wrong.

### The banner behind a location page's heading

`banner` on the `locations` source is the wide shot for a page banner, and a
**different image from `photo`** — that one is the building in a column beside
the address. The dealer uploads both on Admin → Locations → the rooftop →
Profile.

Bind a section's background to it inside the component that draws the header,
alongside the rooftop binding from §3. A rooftop with no banner yet leaves the
section on its own background rather than stretching the summary photo across
it, which is the same rule as the photograph below.

### This branch's own questions

A "Common questions" accordion on a generated location page is a `faq` widget
with **no `items` and no `locationSlug`** — the build fills the slug in, and the
questions come from Admin → Locations → the rooftop → FAQ, per branch:

```json
{ "id": "faq", "type": "widget", "props": { "widget": "faq" } }
```

Type `items` on the block only for a question whose answer is the same at every
rooftop. Typed items win over the rooftop's, so a block carrying both silently
shows the typed ones on all six pages — which is the bug this exists to fix.

The widget emits FAQPage structured data from the same rows it draws, so the
answers can appear directly in a search result and cannot drift from the page.
Do not hand-build an accordion: `<details>` is what it renders, and a scripted
one has no keyboard support, no structured data and nothing on the canvas.

### A branch's photograph

On a generated location page, the picture of that branch is
`{"type":"widget","props":{"widget":"location-photo"}}` — no `locationSlug`, the
same rule as every other widget on that page. It draws the photo from the
rooftop's record, and **nothing at all** when that rooftop has no photo yet.

That gap is deliberate. A generated street map standing in for a missing
photograph is a different section wearing this one's clothes — it says "here is
the building" and shows a road junction. An empty slot tells the dealer what to
do, which is to upload a photo on Admin → Locations. Do not fill it with
`locations-map`, and do not put a placeholder image in `public/`.

**`overlay` is for what the platform does not hold at all**, and only that: a
brand swatch, an award badge. Each row names the source's key field and carries
the extras. Restating a field the source owns is refused — an address typed there
beats Admin and goes stale with nothing to say so.

**An overlay keyed to six slugs is not a middle ground; it is a typed list in a
costume.** It goes stale exactly as fast, and nothing warns you. Before writing
one, check the field list above: if the fact is anywhere on the location's
screens in Admin, it is on a row already. What is genuinely left is small.

Reach for a source whenever the rows are facts the dealer maintains in Admin. A
typed list is right for genuinely editorial content: awards, campaign copy.
If the source exists and you type the rows anyway, you have built the thing this
repo's whole JSON model exists to avoid.

Two things to expect. A binding with nothing published yet shows sample rows on
the canvas and **no rows** on the built page — the platform bakes them on
publish, and inventing addresses in static HTML would be worse than an empty
band. And the dealer sees this as a "Typed in here / From Locations" switch on
the placement's inspector, so say *that* in your summary rather than "a source
binding".

`npm run validate` names every group of three or more identical siblings it
finds, with their ids. Treat those notes as work, not noise — each one is a
section the dealer cannot extend without an engineer.

### What makes something a component

**Reuse is a consequence, not the test.** A piece of UI with its own identity is a
component the first time you build it, even if it appears once: navigation, a
utility bar, a card rail or carousel, a testimonial band, a stats band, a CTA
band, a comparison table. The question is not "how many pages is this on"; it is
"does this have its own shape and its own knobs". If a dealer would ever want to
change its content without touching layout, it wants to be a component.

Two kinds exist, and the dashboard shows both under **Storefront → Components**:

| | `site/sections/<id>.json` — the **Designed** tab | `site/widgets/<id>.json` — the **Coded** tab |
|---|---|---|
| What it is | A full node tree: sections, rows, columns, blocks, behaviours | One leaf block: a Mustache-subset markup template |
| Knobs | `props` — typed placeholders, filled per placement by `values` | `props` — typed, set on each node that places it |
| Can hold children | Yes, it *is* structure | No, it is a leaf |
| Own CSS / JS | Both (`css`, `js` fields) | `css` only — scripts are stripped |
| Repeats | `repeat` over a `list` prop | `{{#each}}` in the template |
| Placed with | a `sharedSection` node, **top level of a page or template only** | a normal widget node, anywhere a widget goes |

Prefer the Designed kind. It is built from real blocks, so every part of it stays
selectable and restylable on the canvas; a coded widget is opaque, and its markup
can only be changed by editing the template.

Two things follow from `sharedSection` being top-level only: a component is a
**band**, not a fragment you drop inside a column, and something that has to live
inside a column — a card, a spec table — is a coded widget or plain blocks.

When *not* to make one: a one-off stretch of prose, a hero with no repeated shape
and nothing to parameterise. Building that as a component adds a hop for no gain.

---

## 4a. Navigation: menus, dropdowns and mega panels

Navigation is the part most often got wrong, so it gets its own section.

A menu is **structure only** — a named tree of destinations in `site/menus.json`.
It has no idea where it appears or what it looks like; the `menu` block that
places it owns the presentation. That separation is what lets one menu be a
header bar, a footer column and a mega panel on the same site without being
copied three times.

```json
{
  "version": 3,
  "menus": [
    {
      "id": "main",
      "name": "Main navigation",
      "items": [
        { "id": "inventory", "label": "Inventory", "type": "inventory", "ref": null },
        { "id": "service", "label": "Service", "type": "page", "ref": "service" },
        { "id": "call", "label": "(801) 555-0100", "type": "url", "url": "tel:+18015550100" }
      ]
    }
  ]
}
```

**Item types** — the type decides how the destination resolves at build time:

| `type` | Uses | Resolves to |
|---|---|---|
| `page` | `ref` = a page **slug** | That page's current path. Rename the page and the link follows. |
| `post` | `ref` = a post slug | The post under the blog's base path. |
| `inventory` | `ref` = a storefront route (below) | That route under the storefront prefix (`/store`). |
| `location` | `ref` = a location's **Admin slug** | That branch's generated page. Never a `page` item — the page has no slug of its own. |
| `url` | `url` | Verbatim — external links, `tel:`, `mailto:`, `#anchor`. |
| `label` | — | **Not a link.** A heading inside a panel. |

Never write a page's address as a `url` item. `page` + slug survives the page
being moved; a typed path does not, and nothing warns you when it breaks.

### Linking into the live storefront

The storefront is a separate app proxied in under one prefix, and **`ref` names
the route inside it**. Leaving `ref` null gives you bare `/store`, which is the
storefront's own landing page — almost never what a nav item means. Say which
route you want:

| `ref` | Resolves to | |
|---|---|---|
| `"inventory"` | `/store/inventory` | **The listings page.** What "Inventory" / "All inventory" means. |
| `"parts"` | `/store/parts` | The parts catalogue. |
| `"search"` | `/store/search` | Storefront search. |
| `"account"` | `/store/account` | The buyer's account. |
| `"sign-in"` | `/store/sign-in` | Sign in. |
| `"checkout"` | `/store/checkout` | Cart / checkout. |
| `null` | `/store` | The storefront landing page. Rarely what you want. |

A `ref` may carry a query string, which is how a pre-filtered view is linked:
`"inventory?condition=new"` → `/store/inventory?condition=new`. "New trucks",
"Used trucks" and "Lease & rental" are all this — one listings page with a facet
applied, not three pages.

**Never write these as `url` items.** `{"type":"url","url":"/store/inventory"}`
hardcodes the prefix, and the prefix is configuration: the day it changes, every
one of those links 404s and nothing warns you. `type: "inventory"` resolves the
prefix at build time from `dealer.config.json`.

**Depth is 3, and the third level is what makes a mega menu.** Nesting is
`children` on any item.

**Placing a menu** — `{"type":"menu","props":{"menuId":"main","layout":"horizontal"}}`:

| Prop | |
|---|---|
| `menuId` | Which menu. Required. |
| `layout` | `horizontal` (a bar, submenus as dropdown cards), `vertical` (stacked — footers), `mega` (see below). |
| `collapseOnMobile` | Collapse behind a hamburger. Set it on the header's menu. |
| `align` | `start` / `center` / `end` within its column. |
| `depth` | How many levels to draw. `1` hides submenus. |

### Mega menus

A mega panel is not a different data model — it is a **three-level menu** drawn
with `layout: "mega"`:

```
Sales                     level 1 — the trigger in the bar
├── Showroom              level 2 — a column heading (type "label", so not a link)
│   ├── Volvo             level 3 — the links in that column
│   └── Mack
└── Category
    ├── Day Cab
    └── Sleeper
```

```json
{ "id": "nav", "type": "menu", "props": { "menuId": "main", "layout": "mega", "collapseOnMobile": true } }
```

Level two becomes the columns, level three the links, and the panel spans the
viewport. Below 1100px it becomes an ordinary stacked disclosure. Nothing is
scripted, and the dealer can edit every label on the Menus screen afterwards.

Two things to get right:

- Column headings are `type: "label"`. A heading that is also a link is allowed
  (`page`/`url`), but a `label` is the honest choice for a heading that goes
  nowhere — `#` links are a dead end for keyboard and screen-reader users.
- A mega panel is `position: absolute` and viewport-wide. **No ancestor may clip
  overflow**, so do not put `overflow: hidden` on the header section.

### What a menu is not for

A **utility bar** — phone number on the left, a few links on the right — is a
section with a row and two columns: a `text` or `buttons` block on one side, a
`menu` on the other. Do not try to express two alignment groups as one menu.

A **drilldown** (region → state → city) is a `filter` behaviour, not a menu. See
§5: the middle column's nodes carry `part: "item control"` — filtered by the
level above, filtering the level below.

---

## 5. Interaction: behaviours first, then your own JavaScript

Carousels, filters, dropdowns, drawers and rotators are **declared, not scripted**.
Put `behaviour` on the container, `part` on each moving piece, and the platform's
own accessible implementation binds at runtime:

```json
{ "id": "rail", "type": "section", "props": { "behaviour": "carousel",
    "behaviourOptions": "{\"perMove\":1}" }, "children": [ … ] }
```

Available: `carousel` `filter` `dropdown` `drawer` `rotator` `scrollstate`
`dependentselect` `mapsync`. Each behaviour's expected `part` names are in
`renderer/behaviours.mjs` — a mismarked part fails silently, so check them.

**A node may play several parts at once**, space-separated. That is how a chained
drilldown works: one `filter` whose middle-level buttons are
`part: "item control"` — hidden unless the level above selected them, and
filtering the level below when chosen. Items carry the facet they belong to as
`data-` attributes; controls carry `data-bz-facet` and `data-bz-value`.
Multi-facet filtering with a live count is built in.

### When a behaviour cannot do it, write the JavaScript

The eight behaviours are a fixed set with fixed options. They move, show, hide
and filter existing DOM; they do not fetch, compute, animate along a custom
curve, or drive a third-party embed. **If the design needs something outside
that, write JavaScript** — it is a supported, first-class part of a site here,
and the dashboard gives the dealer a *Custom code* editor for every one of these
places. What is not acceptable is hand-rolling something a behaviour already
does, because the hand-rolled version has no keyboard support, no
`prefers-reduced-motion`, no un-enhanced state, and cannot be edited on the
canvas.

Put it in the narrowest scope that covers it:

| Where | File | Loaded as | Use it for |
|---|---|---|---|
| One component | `js` in `site/sections/<id>.json` | `/scripts/components/<id>.js`, once however many times it is placed | Behaviour belonging to that band. **Prefer this** — it travels with the thing it animates. |
| One page | `site/pages/<dir>/script.js` | `/scripts/pages/<dir>.js` | Something genuinely unique to that page |
| One post | `js` in the post's JSON | `/scripts/posts/<slug>.js` | Same, for a post |
| Chrome | `js` in `site/templates/<id>.json` | `/scripts/templates/<id>.js` | Sticky headers, scroll state, anything in the header/footer |
| Whole site | `js` in `site/custom-code.json` | `/scripts/custom.js` | Third-party embeds, analytics, site-wide glue |

Everything is `defer`, and the order is fixed: platform `chrome.js` and
`widgets.js` first, then `custom.js`, then template, component and page scripts.
So platform behaviours have already bound by the time your script runs, and you
can listen to their events rather than fighting them.

Four rules, all of which come from how the platform works rather than taste:

1. **The layout must be correct before your script runs** — see the no-JS state
   below. This is the one that actually breaks things.
2. **Scope your selectors** to the node you own (`[data-bz-node="…"]`,
   `[data-bz-section="…"]`), never to bare tags or block classes; a dealer will
   add another section tomorrow.
3. **No script inside a coded widget.** There is no `js` field on a widget and
   the parser strips `<script>`, `<iframe>`, `<form>` and inline handlers before
   anything is committed — the same goes for markup in a `customHtml` block. If
   a widget needs behaviour, the behaviour belongs to the component or the page
   that places it.
4. **Say what you wrote and why** in your summary: which behaviour you tried
   first and what it could not express. A script that exists because a primitive
   is missing is a platform gap worth reporting.

### A carousel is a behaviour, not CSS you write

The expensive version of this mistake looks like real work being done. A coverflow
gets built by hand: each card `position: absolute`, `site/custom-code.json` placing
them from a `data-pos` attribute, and a script in the same file that moves that
attribute when the arrows are clicked.

```json
{ "id": "rail", "type": "row", "props": { "behaviour": "carousel" }, "children": [
  { "id": "card-1", "type": "column", "props": { "span": 4, "part": "slide" }, "children": [ … ] },
  { "id": "card-2", "type": "column", "props": { "span": 4, "part": "slide" }, "children": [ … ] }
]}
```

That is the whole thing. The platform's implementation brings the arrows, the dots,
keyboard support, `prefers-reduced-motion`, and markup that is already in flow
before any script runs — so it lays out correctly in the editor, in the first
paint, and with JS disabled. The hand-built version brings none of it, exists only
after its script has run, and cannot be edited on the canvas at all, because the
canvas runs no site JS.

`npm run validate` flags `site/custom-code.json` rules that position or transform
the children of a node which declares no `behaviour`. If you see that note, the
section wants a behaviour, not more CSS.

### The editor runs no site JS — so every layout needs a no-JS state

The dashboard's **Design canvas draws this tree without running the site's
scripts**, because the editor owns that DOM. Preview and the published page run
them; the canvas never does. A layout that only becomes itself after a script has
run therefore has to be *editable* before that script runs, or the dealer cannot
reach the parts of it.

The way this goes wrong is always the same shape. A staged design — a coverflow,
a card deck — gives each card `position: absolute` in its node styles and lets
`site/custom-code.json` place it from an attribute the script sets:

```css
/* WRONG on its own: without data-pos, every card sits on one spot. */
[data-bz-node="rail"] > .bz-col            { position: absolute }
[data-bz-node="rail"] > .bz-col[data-pos="0"] { transform: translateX(0) scale(1.25) }
```

In the editor that is one visible card and the rest unreachable. On the live site
it is also the first paint, until the script runs.

Write the un-staged state as a real in-flow layout and let the script switch it
off, so the same CSS serves the canvas, the first paint and the staged result:

```css
/* Until custom.js adds .is-staged — and forever in the Design canvas. */
[data-bz-node="rail"]:not(.is-staged)             { display:flex; flex-wrap:wrap; gap:20px }
[data-bz-node="rail"]:not(.is-staged) > .bz-col   { position:relative; transform:none; opacity:1 }
```

`npm run validate` notes sibling nodes that are all `position: absolute`, which is
this mistake's fingerprint. Two other cases worth the same care: anything the
script *reveals* (a panel at `opacity: 0`) is invisible on the canvas until you
give it a no-JS state, and platform `behaviour` nodes are fine as they are —
their un-enhanced markup is already in flow.

---

## 6. Coded widgets — one leaf, markup no block expresses

The dashboard's **Components → Coded** tab. When a design needs markup no block
expresses and the whole of it is a leaf, write `site/widgets/<id>.json`: an id, a
label, typed `props`, an `html` template in a tiny Mustache subset (`{{key}}`,
`{{#if}}`, `{{#each}}`, `{{img key}}`, `{{link key}}`), and scoped `css`.

Constraints, all enforced when the definition is parsed: it is a **leaf** (no
`data-bz-slot`, no children), no `<script>`, no `<iframe>`, no `<form>`, no
inline handlers. Style it with `var(--accent)`, `var(--space-4)` and the rest —
a hardcoded hex breaks the dealer's design system.

It is the third choice, not the first. Reach for real blocks while you can, then
a **component** (§4, `site/sections/`) if the thing is a band with knobs, and a
coded widget when the markup genuinely has no equivalent — a spec table, a badge
cluster, a shape with no block behind it. The cost is editability: a component's
insides are selectable and restylable on the canvas, a coded widget's are not.

---

## 7. Turning a design handoff into this repo

The workflow this repo is built for. Work in this order — each step makes the next
one cheaper.

1. **Read the handoff's design system first.** Map its tokens into
   `site/tokens.json` before you build anything, so every section you write is
   already on-brand. A worked example, from the `sd-international-design-system`
   handoffs:

   | Handoff | `site/tokens.json` |
   |---|---|
   | `--color-accent: #E8531F` | `colors.accent` |
   | `--syyo-orange-700: #A23A16` | `colors.accentDark` |
   | `--color-ink: #1A1714` | `colors.ink` |
   | `--color-paper: #F2EEE6` | `colors.paper` |
   | `--color-card: #FFFFFF` | `colors.card` |
   | `--color-line: #E1DACB` | `colors.line` |
   | `--color-muted: #6B6354` | `colors.muted` |
   | `--text-lg: 22px` … | `type.h2` … (six steps, so compress the scale) |
   | `--radius-md: 10px` | `radius.card` |

   Brand fonts: put the `.woff2` files in `public/fonts/` and list them in
   `tokens.fonts.files`; the build emits `@font-face` and preloads them. Do not
   assume Google Fonts has the licensed face.

2. **Ignore the prototype's scaffolding.** A `.dc.html` handoff runs inside a
   private preview runtime. `support.js`, `_ds_bundle.js`, `<x-dc>`, `<sc-for>`,
   `<sc-if>`, `style-hover` attributes and `{{ }}` holes have no equivalent here
   and must not be carried over. Translate the *design*, not the prototype.

3. **Build the chrome once, as a template.** Header, utility nav and footer go in
   `site/templates/default.json` with a `contentArea` between them — not into
   every page. Nav comes from `site/menus.json`.

4. **Then the page**, section by section, in the handoff's order. For each
   section: reach for a prebuilt block, then a composition of
   section/row/column + basic blocks, then a custom widget, and only then
   `customHtml`.

5. **Anything shared across pages becomes a component** in `site/sections/` and
   is placed with `sharedSection` — the utility bar and newsletter band in
   particular.

6. **Map data-shaped sections to live widgets.** Featured inventory, locations,
   hours and staff should be `widget` nodes, not the handoff's hardcoded arrays.
   This is where the built site becomes *better* than the prototype: those
   sections stay correct forever.

7. **Note what you dropped.** Prototypes are unfinished — dead anchors, unwired
   newsletters, placeholder photography, effects the renderer cannot express
   (3D transforms, cross-frame maps). List them in your summary rather than
   approximating them silently.

8. **`npm run check`.** Then push.

---

## 8. Handing the repo to the dashboard

A repo built here is opened in the BuzzNerd dashboard like this:

1. Push it to GitHub, under the **same owner** as the platform's other dealer
   sites (the platform addresses every repo under one configured owner).
2. Make sure `npm run validate` passes and `renderer/`, `scripts/build.mjs`,
   `dealer.config.json` and `vercel.json` are present — the dashboard refuses to
   connect a repo missing any of them.
3. In the dashboard, on the dealer's channel: **Website → Connect an existing
   repository**, and paste the name (`name`, `owner/name` or the GitHub URL).
4. The platform then writes the channel's identity into `dealer.config.json`,
   creates the `draft` branch the editor saves to, and reports any renderer
   version drift. Publishing brings platform files up to date.

After that the repo is a normal dealer site: every page, template and component
you wrote is editable on the canvas, and every save is a commit on `draft`.

**Branches.** `draft` is what the editor writes and previews; `main` is
production, fast-forwarded to `draft` on publish. Build your work on the default
branch and let the platform create `draft` on connect.

## Analytics

A page may declare a `pageType` in `site/pages.json`, and a form may carry
`analytics` and `destinations` bags. **All three are set on the dashboard, not
here**, because their allowed values come from whichever analytics providers the
dealer has enabled — a value typed by hand against a provider that is not enabled
is a value nothing reads. `npm run validate` checks a page kind against the
`vocabularies` the platform baked into `platform/analytics.json`, and leaves it
unconstrained when there are none — which is the normal case for a dealer in no
programme.

Everything else about analytics is automatic. The renderer emits `data-bz-el`,
`data-bz-intent`, `data-bz-cta` and the rest **structurally**, from real blocks,
which is why hand-writing one of those attributes inside `customHtml` is refused:
the element would look instrumented and report nothing anybody maintains.

Shift Digital is an active certification programme and an **add-on** — it layers
over the platform's own analytics rather than replacing them.
`../vendure/docs/13-shift-digital.md` is the reference and
`../vendure/docs/02-invariants.md` invariant 12a is the rule; the operator
runbooks are in `../vendure/docs/runbooks/`. Restricted values and event names
live only in `vendure/src/plugins/bznrd-shift-digital/sd/`. **Never invent a field
name** — the guide is case-sensitive and contradicts itself in three places, so a
name decided at a call site is a name silently dropped.

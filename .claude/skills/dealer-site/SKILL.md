---
name: dealer-site
description: Build or edit a BuzzNerd dealer brand site in this repository — turning a design handoff into pages, templates and components as validated JSON node trees, so the result opens in the BuzzNerd dashboard's visual editor. Use when asked to build a dealer site, import or implement a design handoff (.dc.html, Figma export, screenshots), add or edit a page, section, template, component, menu, form or the design system in this repo, or when a change needs to survive being edited in the dashboard afterwards.
---

# Building a dealer site here

`CLAUDE.md` in the repo root is the contract: the document model, the block
catalogue, what is writable, and the library rules. Read it before writing files.
This skill is the order of operations and the checks.

## The loop

```bash
npm run validate    # after every few files, not once at the end
npm run build       # proves the real static output renders
npm run check       # validate + test + build, before you push
```

`npm run validate` runs the renderer's own validators over everything in `site/`
and names the file, the path inside it, and the fix. It also checks the
cross-file references no single-file check can see — a `formId` with no form, a
menu item pointing at a deleted page, a `page.json` missing for a listed page.
**A repo that fails it will be refused by the dashboard or open with holes.**

Run it early. A structural mistake repeated across twelve sections is twelve
fixes; caught on the second section it is one.

## Order of work for a handoff

1. **Design system first** — map the handoff's tokens into `site/tokens.json`,
   fonts into `public/fonts/` + `tokens.fonts.files`. Everything you build after
   this is automatically on-brand; everything built before it needs revisiting.
2. **Libraries next** — `site/buttons.json`, `site/menus.json`, `site/forms/`.
   Sections reference these by id, so they have to exist first.
3. **Chrome as a template** — header, utility nav, footer in
   `site/templates/default.json`, with one `contentArea` between them.
4. **Components for the parts that have their own identity** — navigation bars,
   card rails, testimonial or stats bands, CTA bands (see below).
5. **Pages**, section by section, in the handoff's own order, placing those
   components as you go.
6. **Validate, build, then push.**

## Choosing how to build a section

In this order, and stop at the first that works:

1. A **prebuilt block** — `hero` `splitHero` `iconGrid` `categoryGrid` `statBand`
   `serviceGrid` `testimonials` `logoStrip` `postsList` `locationsMap` `footer`.
2. **section → row → column** plus basic blocks (`heading` `text` `image`
   `buttons` `list`). Most of any design is this.
3. A **`widget`** node, if the section shows dealer data (inventory, locations,
   hours, phones, staff, FAQ). Always prefer this over typed-out data.
4. A **component** in `site/sections/`, when the band has its own identity or its
   own knobs — which is most bands worth naming.
5. A **coded widget** in `site/widgets/`, when one leaf needs markup no block
   expresses.
6. **`customHtml`** — only if the alternative is not shipping it. Say so.

Interaction: reach for a `behaviour` first; write JavaScript when no behaviour
expresses it. CLAUDE.md §5 has both halves.

### Before you write the third copy of a shape, stop

**Three or more siblings of the same shape means the shape is a list, and the
list is data.** Whatever the cards are — brands, services, quotes, staff —
writing one subtree per card validates and builds, and leaves the dealer editing
each one separately with no way to add another. Use a prebuilt block whose
`items` are props, a `widget` if the list is platform data, or a component with a
`list` prop and one node carrying `repeat`. `npm run validate` names every such
group with its ids — treat those notes as unfinished work.

`repeat` **only works inside a component.** Binding happens when a
`sharedSection` expands, so `repeat` on a page node is silently ignored — you get
the copies you were trying to avoid, and nothing warns you.

### What to make a component

**Reuse is not the test — identity is.** A carousel, a utility nav, a
testimonial band, a stats strip, a CTA band is a component the first time you
build it, on one page or ten. The test is whether it has a shape of its own and
content a dealer would change without touching layout. Those get typed `props`,
so the dashboard gives the dealer fields instead of a tree to dig through.

Two kinds, and the dashboard shows both under **Storefront → Components**:

- `site/sections/<id>.json` — the **Designed** tab. A full node tree with typed
  `props`, its own `css` and `js`. Placed by a `sharedSection` node, **top level
  of a page or template only** — so a component is a band, never a fragment
  inside a column. Prefer this: its insides stay selectable on the canvas.
- `site/widgets/<id>.json` — the **Coded** tab. One leaf: Mustache-subset markup,
  typed props, scoped CSS, no scripts. For markup no block expresses.

Skip it for a one-off stretch of prose or a hero with nothing to parameterise.

### Do not hand-build what a behaviour already does

A carousel, filter, dropdown, drawer, rotator, scroll state, dependent select or
map sync is a `behaviour` — `behaviour` on the container, `part` on each moving
piece. The platform's implementation brings arrows, dots, keyboard, ARIA,
`prefers-reduced-motion` and markup that is already in flow before any script
runs. The hand-rolled version (absolutely positioned children placed by CSS from
an attribute your script sets) has none of that and cannot be edited on the
canvas at all.

When the design needs something outside those eight — a custom curve, a fetch, a
third-party embed, a coverflow no `carousel` option expresses — **write the
JavaScript.** Put it in the component's own `js` if it belongs to one band, the
template's `js` for chrome, the page's `script.js` if it is truly page-specific,
`site/custom-code.json` for site-wide glue. Scope selectors to your own node, and
give the layout a no-JS state (below) so the canvas and the first paint are still
correct. Then say in your summary which behaviour you tried and what it could not
do — that is how the primitive gets added.

## Navigation, specifically

Navigation is where most of the mistakes happen, whatever the design.
CLAUDE.md §4a is the full contract; the short version:

- A menu is **data** (`site/menus.json`); the `menu` block is **presentation**.
  Never type a list of links into a page.
- **Mega panels are a three-level menu** with `layout: "mega"` — trigger >
  column heading (`type: "label"`) > links. No new block, no script.
- A **utility bar** with a left and a right group is a row with two columns,
  not one menu.
- Link to pages with `type: "page"` + the **slug**, never a typed path.
- A template's **display conditions** decide which pages it wraps. A template
  with a wrong or missing condition renders on nothing while everything still
  validates and builds — check that one template has `entireSite` or `allPages`.

## Things that will bite you

- **Never reuse or renumber node ids** in a file that already exists. A changed
  id reads as delete-then-add and loses that node's editing history.
- **A widget cannot have children.** Two halves means a row with two columns.
- **`out` must agree with `path`** in `site/pages.json` (`/financing` →
  `financing/index.html`). Nothing but the validator checks this.
- **Leave `REPLACE_…` placeholders alone** in `dealer.config.json` — the platform
  writes the channel token, domain and storefront origin when the repo is
  connected.
- **Do not edit `renderer/`, `scripts/`, `ai/` or `vercel.json`.** They are
  overwritten by the platform, and until then this dealer runs code nobody else
  does. If the gap is real, report it.
- **Do not carry prototype scaffolding across** — `support.js`, `<x-dc>`,
  `<sc-for>`, `style-hover`, `{{ }}` holes. Translate the design, not the runtime.
- **The Design canvas runs no site JS** — not yours, not the platform's. Anything
  a script stages or reveals (absolutely positioned cards placed from a `data-`
  attribute, a panel starting at `opacity: 0`) is stacked or invisible in the
  editor, and the dealer cannot select it. This is the real constraint on writing
  JavaScript here, and it is not a reason to avoid it: write the un-staged state
  as a real in-flow layout and let the script switch it off (`:not(.is-staged)`),
  which fixes the canvas and the live first paint at once. CLAUDE.md §5 has the
  pattern, and `npm run validate` notes absolute siblings.
- **A coded widget cannot carry a script**, and neither can `customHtml` — both
  are stripped when parsed. Behaviour for a widget belongs to the component or
  page that places it.
- **A boxed section's margins come from the renderer**, not from styles you write.
  Set `width` (`boxed` / `wide` / `full` / bleed) and leave the max-width and side
  padding alone; a hand-set `maxWidth` + `margin: auto` on the row inside works
  until the dealer changes the section's width and then fights it.

## Finishing

Report what you built, and — just as important — what you could not: effects the
renderer cannot express, sections whose data the dealer must still supply, and
anything in the prototype that was already broken. Then give the connect steps
from CLAUDE.md §8 so the repo can be opened in the dashboard.

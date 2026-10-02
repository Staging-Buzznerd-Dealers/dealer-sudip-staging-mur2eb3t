# Dealer site template

The GitHub template every BuzzNerd dealer brand site is generated from, and the home of
**the renderer** — the single implementation that turns site JSON into HTML.

Framework-free and **zero runtime dependencies**. Node 20+. Site content is JSON node trees;
`scripts/build.mjs` runs the renderer over them on Vercel to produce a fully static `dist/`.
`/store/*` is proxied to the Remix inventory storefront.

```bash
npm install        # nothing to install
npm run validate   # every site/ file against the renderer's rules   <- run this first
npm test           # the renderer's own specs
npm run build      # site/ -> dist/
npm run check      # all three, in order
npm run schemas    # regenerate renderer/block-schemas.json

npm run validate -- --root ../some-dealer-repo    # check another repo against this renderer
```

## Documentation

| Read this | For |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | **Authoring guide.** How to build or edit a site here: the document model, what is writable, libraries vs. literals, navigation, behaviours, the design-handoff workflow |
| [`../vendure/docs/07-block-model-reference.md`](../vendure/docs/07-block-model-reference.md) | **Complete reference.** Every block, prop and allowed value; the 8 behaviours and their parts; the 70 style fields; the token map; file shapes; validator rules; the build pipeline |
| [`../vendure/docs/06-website-builder.md`](../vendure/docs/06-website-builder.md) | How the dashboard and Vendure drive this repo — provisioning, saves, publish, rollback, platform sync |
| [`../vendure/docs/README.md`](../vendure/docs/README.md) | The rest of the platform |

The authoritative machine-readable catalogue is **`renderer/block-schemas.json`**. Read it
rather than guessing, and regenerate it with `npm run schemas` after changing a block.

## Layout

```
renderer/                 THE RENDERER — the single source of truth for output  [platform-owned]
  index.mjs                 public API; RENDERER_VERSION
  nodes.mjs                 the node tree: parse, migrate, nesting rules
  blocks.mjs                the block library — renderer + JSON Schema per block
  block-schemas.json        generated catalogue, consumed by Vendure and the dashboard
  behaviours.mjs            the 8 declarative behaviours and their part vocabularies
  styles.mjs                per-node responsive style compilation
  tokens.mjs                tokens.json -> CSS custom properties (+ scoped overrides)
  templates.mjs             display conditions, contentArea splitting
  menus.mjs forms.mjs widgets.mjs custom-widgets.mjs
  ops.mjs                   patch operations — the AI's reply shape
  validate.mjs              per-document validation against the block schemas
  html.mjs shell.mjs document-assets.mjs component-props.mjs
  blocks.css                token-driven component styles
  client/widgets.js         behaviour binding, widget hydration, form logic and submit
scripts/build.mjs         load JSON -> call the renderer -> write dist/       [platform-owned]
scripts/validate.mjs      cross-file validation                              [platform-owned]
ai/                       the AI contract, synced from the plugin            [platform-owned]
vercel.json               build config, /store proxy rules, cache headers    [platform-owned]
dealer.config.schema.json                                                    [platform-owned]

site/                     YOURS — all content
  pages.json              the page manifest
  pages/<dir>/            page.json, and optional style.css / script.js
  templates/<id>.json     chrome + layout, applied by display conditions
  sections/<id>.json      designed components — a node tree with typed props
  widgets/<id>.json       coded widgets — a Mustache-subset markup template
  menus.json              named menus (v3)
  buttons.json            the CTA library
  forms/<id>.json         form definitions, including lead routing
  tokens.json             the design system
  tokens/<scope>.json     scoped brand overrides
  blog/                   settings.json + posts/<slug>.json
  custom-code.json        sitewide css/js + head/body slots
  chrome/                 shared chrome helpers
  reset.css
public/                   YOURS — images, logos, fonts
dealer.config.json        YOURS, except the identity fields the platform fills in
```

**Platform-owned paths are overwritten** when the platform syncs a repo forward, so an edit
there is lost — and until it is lost, that dealer is running a renderer nobody else is. If
something you need cannot be expressed in `site/`, that is a platform gap worth reporting.

## What the build emits

```
dist/<path>/index.html          each page, wrapped in its resolved template
dist/styles/                    tokens.css (+ scoped), reset.css, blocks.css, chrome.css
dist/scripts/                   chrome.js, widgets.js, custom.js,
                                templates/<id>.js, components/<id>.js, pages/<dir>.js
dist/partials/                  the chrome bundle the Remix storefront fetches:
                                header.html footer.html tokens.css reset.css blocks.css
                                chrome.css chrome.js widgets.js fonts.txt manifest.json
                                header--<templateId>.html, footer--<templateId>.html
dist/sitemap.xml  robots.txt  llms.txt
```

`dist/partials/*` is what makes inventory pages render inside the dealer's own header and
footer. Vercel serves it with `Cache-Control: public, max-age=300,
stale-while-revalidate=86400`.

## Page status

`pages.json` entries carry a `status`:

| status | emitted | indexed | in sitemap / llms.txt |
|---|---|---|---|
| `published` | yes | yes | yes |
| `draft` | yes | no (`noindex,nofollow`) | no |
| `archived` | no | — | — |

Drafts are still built so preview deployments can show them.

## The parity rule

`scripts/build.mjs` and the dashboard's editing canvas **import the same renderer**, so what
a dealer sees while editing is what Vercel serves. That property holds only while all copies
of the renderer agree.

There are three copies, and they must stay identical:

| Copy | Kept in sync by |
|---|---|
| `dealer-site-template/renderer/` | the source |
| `dealer-dashboard/src/lib/website/renderer/` | `npm run renderer:sync -- --template ../dealer-site-template` |
| `vendure/src/plugins/website-builder/renderer/block-catalogue.ts` | `npm run website-builder:sync-catalogue` |

Both have `--check` variants that exit non-zero on drift. Drift between them presents as
"the AI is unreliable" or "the canvas doesn't match the site", which is why it is a platform
invariant rather than a convention.

## How a dealer repo relates to this one

A dealer repo is generated from this template **once**, as `dealer-<channelToken>`. Nothing
about GitHub template generation updates it afterwards, so the plugin's
`SiteRepoService.syncPlatformFiles()` pushes `renderer/`, `scripts/`, `ai/` and `vercel.json`
forward on publish — deliberately bypassing the editor's write allowlist, the same way
provisioning does. It never touches `site/`, `public/` or `dealer.config.json`.

**A dealer repo therefore cannot be assumed current.** `dealer-ds-msxava3i` in this workspace
is at renderer 4.7.0.

## Connecting a repo you built here

1. Push it to GitHub under the same owner as the platform's other dealer sites.
2. Make sure `npm run validate` passes and `renderer/`, `scripts/build.mjs`,
   `dealer.config.json` and `vercel.json` are present — the dashboard refuses a repo missing
   any of them.
3. In the dashboard, on the dealer's channel: **Website → Connect an existing repository**.
4. The platform writes the channel's identity into `dealer.config.json`, creates the `draft`
   branch the editor saves to, and reports renderer version drift.

**Branches.** `draft` is what the editor writes and previews; `main` is production,
fast-forwarded to `draft` on publish. Build your work on the default branch and let the
platform create `draft` on connect.

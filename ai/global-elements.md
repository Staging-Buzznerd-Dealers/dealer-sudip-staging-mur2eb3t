# Global Elements — Templates, Menus, and the Storefront Handoff

What surrounds a page is a **template**: a full layout that a page is inserted into.
Editing the template updates every page using it at once. Never copy chrome into a
page.

## Templates

A template is a document like a page — sections, rows, columns and widgets — with one
extra requirement: somewhere in it sits a `contentArea` node, and that is where the
page's own content goes. Everything else is free. Header, hero, sidebar, related
content, footer, in whatever arrangement the design calls for:

```json
{
  "id": "with-sidebar",
  "name": "Sidebar layout",
  "conditions": [{ "type": "allPages" }],
  "nodes": [
    { "id": "header", "type": "section", "props": {}, "children": [ … ] },
    { "id": "body", "type": "row", "props": {}, "children": [
      { "id": "main", "type": "column", "props": { "span": 9 }, "children": [
        { "id": "content", "type": "contentArea", "props": {} }
      ]},
      { "id": "side", "type": "column", "props": { "span": 3 }, "children": [ … ] }
    ]},
    { "id": "footer", "type": "section", "props": {}, "children": [ … ] }
  ]
}
```

Templates live in `site/templates/<id>.json`. Which one applies to a given page is a
**display condition**, resolved by specificity — a condition naming one page beats one
naming all pages, which beats one naming the entire site:

| Condition | Applies to |
| --- | --- |
| `entireSite` | everything |
| `allPages` / `allPosts` | every page / every post |
| `blog` | the post index |
| `inventory` | the whole live storefront — browse, detail, and parts |
| `parts` | the parts catalogue only; without it, parts use the `inventory` template |
| `pageGroup` + `ref` | every page in one group |
| `page` / `post` + `ref` | one named page or post |

There is no special home-page mechanism. A template for the home page is
`{ "type": "page", "ref": "home" }` like any other.

**Linking into the storefront.** It is a separate app mounted under one prefix
(`/store` by default), and a menu item reaches it with
`{ "type": "inventory", "ref": "<route>" }` — `inventory`, `parts`, `search`,
`account`, `sign-in`, `checkout` — where `ref` may carry a query string, as in
`"inventory?condition=new"`. A null `ref` gives bare `/store`, the storefront's
own landing page, which is rarely what a nav item means: "All inventory" is
`ref: "inventory"`. Never type the prefix into a `url` item; it is configuration,
and `validate` fails a menu that does.

The header and footer fragments the storefront borrows are **derived**: whatever
precedes the content area is the header, whatever follows it is the footer. Nothing
declares them, which is what lets a template carry a hero above the content without
the storefront needing to know.

## Menus

A menu is structure and nothing else — a named tree of items in `site/menus.json`:

```json
{
  "version": 3,
  "menus": [
    { "id": "main", "name": "Main menu", "items": [
      { "id": "home", "label": "Home", "type": "page", "ref": "home" },
      { "id": "inventory", "label": "Inventory", "type": "inventory" },
      { "id": "about", "label": "About", "type": "url", "url": "/about", "children": [ … ] }
    ]}
  ]
}
```

It has no idea where it appears or what it looks like. A `menu` widget in a template
names one by id and owns the presentation, so the same menu can be a header bar and a
footer column without being duplicated. There are **no theme locations**: putting a menu
somewhere new is dropping a widget, not editing a vocabulary.

An item's `type` decides how its destination resolves — `page` and `post` point at a
slug so renaming an address updates every menu that links to it; `inventory` points at
the storefront prefix; `url` is a literal address; `label` is a heading inside a
submenu and is not a link. Never hand-write nav links into a template.

## Footer

- The footer is the part of the template after the content area: brand line, footer
  menu, contact, legal and year.
- A good place for machine-readable business facts that also help AIO (address,
  phone, hours) — see `aio.md`.

## Chrome behaviour

`site/chrome/chrome.js` holds the shared chrome's behaviour (mobile nav disclosure,
footer year). It is platform-owned and also shipped to the storefront. Do not put
page-specific JavaScript in it.

## The `/store` handoff — read this carefully

`/store` and everything under it (`/store/trucks/…`, product pages, cart, checkout)
is **not** part of this site's content. It is served by the dealer's **Remix
storefront**, addressed per dealer and resolved from the request hostname.

How it fits together:

- The published brand site (static) proxies `/store/*` to the Remix app via a rewrite
  in `vercel.json`. The prefix is preserved rather than stripped, because Remix mounts
  both its routes and its client bundles under it. The visitor's URL stays on the
  dealer's own domain throughout.
- The Remix app reads this site's exported chrome from `/partials/` —
  `header.html`, `footer.html`, `chrome.css`, `chrome.js`, `reset.css`, `tokens.css` —
  and the routing contract in `/partials/manifest.json`, then renders live inventory
  **in between** that header and footer.

Your responsibilities:

1. **Never create site content under `/store/*`.** No page, no fragment, no route.
2. **Keep an Inventory item pointing at `/store`** in `menus.json`.
3. **Keep the chrome self-contained and token-driven**, because Remix reuses it
   verbatim. No page-specific styling in the header or footer — it would leak onto
   storefront pages.
4. When a dealer says "add inventory to my site", the answer is already true. Confirm
   the menu item and the chrome look right; Remix supplies the rest.

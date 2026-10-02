// Menus: structure, and nothing else.
//
// A menu is a named tree of items. That is the whole model. It has no idea where
// it appears, what it looks like, or how many levels deep the thing rendering it
// is willing to draw.
//
// The previous version carried "theme locations" — Primary, Mobile, Footer,
// Legal — borrowed from a theme system this platform does not have. It forced
// two decisions into one place: what is in the menu, and where the menu goes.
// Those belong to different people at different times, and worse, the location
// list was a fixed vocabulary invented here. A dealer who wanted a menu in a
// third place had nowhere to put it, and a template that wanted a specific menu
// had to go through a location to name it.
//
// Now a `menu` widget names a menu by id. A template or a custom widget picks
// whichever menu it wants and owns the presentation entirely. Adding a menu
// somewhere new is dropping a widget, not editing a vocabulary.
//
// Items resolve their destination at render time from what they point at, so a
// page that changes slug does not leave a dead link behind.

import { esc, href, isExternal, join } from './html.mjs';
import { locationPath } from './location-pages.mjs';

/** Where a menu item can point. */
export const MENU_ITEM_TYPES = ['page', 'post', 'inventory', 'location', 'url', 'label'];

/** How deep a menu may nest. Beyond this the tree is flattened, not dropped. */
export const MAX_MENU_DEPTH = 3;

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalise whatever is on disk into `{ version, menus }`.
 *
 * Reads three shapes, because all three are live somewhere: the current
 * `{ version: 3, menus: [...] }`, the location-bearing v2 `{ menus: {}, locations: {} }`,
 * and the original v1 flat map of location → `{ label, items }`. In both older
 * shapes the locations are simply discarded — the menus themselves survive with
 * their names and items, which is the part a dealer authored.
 */
export function parseMenus(raw) {
  if (!isObject(raw) && !Array.isArray(raw)) return { version: 3, menus: [] };

  if (Array.isArray(raw)) return { version: 3, menus: raw.map(normaliseMenu).filter(Boolean) };

  if (Array.isArray(raw.menus)) {
    return { version: 3, menus: raw.menus.map(normaliseMenu).filter(Boolean) };
  }

  // v2: menus keyed by id, plus a locations map that no longer means anything.
  if (isObject(raw.menus)) {
    return { version: 3, menus: Object.values(raw.menus).map(normaliseMenu).filter(Boolean) };
  }

  // v1: the whole file was location → menu.
  const menus = [];
  for (const [legacyId, menu] of Object.entries(raw)) {
    if (!isObject(menu) || !Array.isArray(menu.items)) continue;
    menus.push(
      normaliseMenu({
        id: slugify(legacyId, legacyId),
        name: menu.label || legacyId,
        items: menu.items.map(upgradeItem).filter(Boolean),
      }),
    );
  }
  return { version: 3, menus: menus.filter(Boolean) };
}

function normaliseMenu(raw) {
  if (!isObject(raw)) return null;
  const id = slugify(raw.id || raw.name, '');
  if (!id) return null;
  return {
    id,
    name: String(raw.name || id),
    items: normaliseItems(raw.items, 0),
  };
}

function normaliseItems(raw, depth) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isObject(item) || !item.label) continue;
    const type = MENU_ITEM_TYPES.includes(item.type) ? item.type : 'url';
    out.push({
      id: String(item.id || slugify(item.label, `item-${out.length + 1}`)),
      label: String(item.label),
      type,
      ref: item.ref != null ? String(item.ref) : null,
      url: item.url != null ? String(item.url) : null,
      newTab: !!item.newTab,
      // Depth is clamped on read rather than on write: a menu that arrived from
      // an import should still render, just flatter than it was drawn.
      children: depth + 1 < MAX_MENU_DEPTH ? normaliseItems(item.children, depth + 1) : [],
    });
  }
  return out;
}

/** A v1 item was `{ label, href }`; everything became a url item. */
function upgradeItem(item) {
  if (!isObject(item)) return null;
  const url = String(item.href ?? '');
  const base = { id: slugify(item.label, 'item'), label: item.label };
  if (!url || url === '#') return { ...base, type: 'label' };
  return { ...base, type: 'url', url };
}

/* ------------------------------------------------------------------ render */

/**
 * Resolve an item's destination.
 *
 * A `page` item points at a slug, not a path, so renaming the page's address
 * updates every menu that links to it. That is the whole reason an item carries
 * a type rather than just a URL.
 */
function destinationOf(item, ctx) {
  switch (item.type) {
    case 'page': {
      const page = (ctx.pages ?? []).find(p => p.slug === item.ref);
      if (!page) {
        if (ctx.warn) ctx.warn(`Menu item "${item.label}" points at a page that no longer exists.`);
        return null;
      }
      if ((page.status ?? 'published') !== 'published' && ctx.warn) {
        ctx.warn(`Menu item "${item.label}" points at "${page.title}", which is not published.`);
      }
      return page.path;
    }
    case 'location': {
      // `ref` is the location's slug in Admin, not a page slug, because the page
      // it lands on is generated and has no slug of its own until that location
      // exists. Written as a `page` item it would break the day a branch was
      // renamed, and as a `url` it would hardcode the pattern.
      //
      // Resolved from the manifest's path *pattern*, never from the locations
      // baked into the repo. Those two answer different questions — the index
      // says which pages to emit, the pattern says what one costs to link to —
      // and conflating them cost a design: an item whose location was not baked
      // yet returned null, which renders as a `bz-navlabel` heading rather than
      // an anchor, so a utility bar of six branches silently lost its link
      // colour and its underline.
      if (!ctx.locationPagePath || !item.ref) return null;
      return locationPath(ctx.locationPagePath, item.ref);
    }
    case 'post':
      return `${ctx.blogBasePath ?? '/blog'}/${item.ref}`;
    case 'inventory':
      return `/${ctx.storefrontPrefix ?? 'store'}${item.ref ? `/${item.ref}` : ''}`;
    case 'url':
      return item.url || null;
    case 'label':
      // A heading inside a submenu. Deliberately not a link.
      return null;
    default:
      return item.url || null;
  }
}

function renderItem(item, menuId, ctx, depth) {
  if (!item || !item.label) return '';
  const children = Array.isArray(item.children) ? item.children.filter(Boolean) : [];
  const url = destinationOf(item, ctx);
  const external = isExternal(url);

  const label = url
    ? `<a href="${esc(href(url, ctx))}" data-bz-el="link" data-bz-intent="nav-${esc(menuId)}"${
        external ? ' rel="noopener"' : ''
      }${item.newTab ? ' target="_blank"' : ''}${
        ctx.currentPath && ctx.currentPath === url ? ' aria-current="page"' : ''
      }>${esc(item.label)}</a>`
    : `<span class="bz-navlabel">${esc(item.label)}</span>`;

  if (!children.length) return `<li class="bz-navitem">${label}</li>`;

  return `<li class="bz-navitem bz-navitem--has-sub" data-bz-depth="${depth}">${label}<ul class="bz-subnav">${join(
    children.map(child => renderItem(child, menuId, ctx, depth + 1)),
    '',
  )}</ul></li>`;
}

/**
 * Render one menu as a `<ul>`.
 *
 * Presentation is the caller's: this emits a plain nested list with stable
 * classes and the analytics hooks, and the widget or template that placed it
 * decides whether that is a horizontal bar, a stacked footer column or a mega
 * menu. That separation is the point — the same menu can be all three on one
 * site without being duplicated.
 */
export function renderMenu(menus, menuId, ctx = {}) {
  const parsed = parseMenus(menus);
  const menu = parsed.menus.find(m => m.id === menuId);
  if (!menu) {
    if (menuId && ctx.warn) ctx.warn(`No menu called "${menuId}".`);
    return '';
  }

  const items = (menu.items ?? []).filter(i => i && i.label);
  if (!items.length) return '';

  return `<ul class="bz-nav" data-bz-menu="${esc(menu.id)}" aria-label="${esc(menu.name)}">${join(
    items.map(item => renderItem(item, menu.id, ctx, 0)),
    '',
  )}</ul>`;
}

/** Replace every `<!-- menu:id -->` marker in a legacy chrome fragment. */
export function injectMenus(html, menus, ctx = {}) {
  return String(html || '').replace(/<!--\s*menu:([a-z0-9-]+)\s*-->/gi, (_, id) =>
    renderMenu(menus, id, ctx),
  );
}

/** Every menu, for the editor's list and the AI's context. */
export function listMenus(menus) {
  return parseMenus(menus).menus;
}

/** A new menu with nothing in it. */
export function emptyMenu(name) {
  return { id: slugify(name, 'menu'), name: String(name || 'Menu'), items: [] };
}

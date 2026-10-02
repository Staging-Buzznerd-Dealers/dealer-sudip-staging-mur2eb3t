# SEO — Per-Page Requirements

Every page you build must satisfy this floor. The build assembles `<head>` from the
page's metadata and the dealer config, but the *content-level* SEO (headings,
semantics, structured data, alt text) is yours to get right in the HTML you emit.

## Per-page `<head>` (you supply the values; build renders them)

- **Title** — unique per page, ≤ 60 chars, follows the config `titleTemplate`.
- **Meta description** — unique, 140–160 chars, describes the page honestly.
- **Canonical** — the page's absolute URL on the dealer domain.
- **Open Graph + Twitter** — title, description, image (page-specific if available,
  else the config `ogImage`), type.
- **Viewport, charset, theme-color** — always present.

## Content-level (in the HTML you emit)

1. **One `<h1>` per page**, describing the page's single subject. Then a correct
   `<h2>`/`<h3>` hierarchy — never skip levels for visual size (use CSS for size).
2. **Semantic landmarks:** `<main>` (assembled for you), plus `<section>`,
   `<nav>`, `<article>`, `<address>` where meaningful. Not everything is a `<div>`.
3. **Every image** has descriptive `alt` (empty `alt=""` only for purely decorative
   images), plus `width`, `height`, and `loading="lazy"` (hero may be eager).
4. **Descriptive link text** — "Browse our truck inventory", not "click here".
5. **Clean, human URLs** — `/financing`, not `/page?id=3`.

## Structured data (schema.org JSON-LD)

Emit JSON-LD appropriate to the page. The build injects a base
`AutoDealer` / `LocalBusiness` node from `dealer.config.json.business` on every page;
you add page-specific nodes:

- **Home / Contact:** rely on the injected `AutoDealer` node (name, address, geo,
  phone, hours, priceRange). Don't duplicate it.
- **Any page with a breadcrumb trail:** `BreadcrumbList`.
- **Any page with Q&A content:** `FAQPage` (this is also an AIO win — see `aio.md`).
- **Service/finance offerings:** `Service` or `Offer` where genuinely applicable.

Keep JSON-LD truthful and consistent with the visible content. Never mark up
information that isn't on the page.

## Do not

- Duplicate titles/descriptions across pages.
- Stuff keywords, hide text, or mark up invisible content.
- Use headings for styling instead of structure.

# AIO — AI / Answer-Engine Optimization

AIO is making the dealer's site easy for AI assistants and answer engines (ChatGPT,
Perplexity, Google AI overviews, and similar) to **find, understand, and cite**.
It overlaps with SEO but targets machine reading and answer extraction, not just
ranking. Apply this floor alongside `seo.md`.

## `llms.txt`

The build publishes `/llms.txt` — a plain-Markdown map of the site for LLMs,
generated from the dealer config and the page manifest: business name and what they
do, the key pages with absolute URLs and one-line summaries, contact facts, and the
inventory entry point. Keep it accurate: whenever pages are added or the business
facts change, the map must reflect it (the build regenerates it, so keep the page
manifest and config truthful).

## Structured, extractable content

1. **Answer the obvious questions in plain text.** Hours, location, what they sell,
   financing, whether they take trade-ins, service offerings. Answer engines quote
   short factual sentences — make those sentences exist and be unambiguous.
2. **Machine-readable business facts.** Reinforce the `AutoDealer`/`LocalBusiness`
   JSON-LD (from `seo.md`) with the same facts visible in the footer/contact
   (`<address>`, `tel:` links, opening hours). Consistency between JSON-LD and
   visible text raises trust.
3. **FAQ blocks with `FAQPage` schema.** Where a page has genuine Q&A ("Do you
   finance?", "What's your service turnaround?"), mark it up as `FAQPage`. This is
   the single highest-leverage AIO pattern — it maps directly to how answer engines
   extract responses.
4. **Phrase some headings as real questions** where natural, with a concise answer
   immediately below. Don't force it; only where it fits the content.
5. **Semantic HTML** (see `seo.md`) — landmarks and correct heading order are how a
   machine reconstructs meaning without rendering CSS.
6. **Concise, factual, first-paragraph answers.** Lead a section with the answer,
   then elaborate — the inverted-pyramid style that extracts cleanly.

## Freshness and honesty

- Keep facts current (hours, address, phone). Stale facts get cited and embarrass
  the dealer.
- Never fabricate reviews, ratings, awards, or claims in content or schema. Only mark
  up what is true and visible.

## Do not

- Cloak (show machines different content than humans).
- Add `Review`/`AggregateRating` schema without real, on-page reviews.
- Bury the key facts behind JS-only rendering — the published site is static HTML, so
  keep the facts in the served markup.

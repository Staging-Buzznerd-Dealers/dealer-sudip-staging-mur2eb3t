# The AI contract in this repo

> Looking for how to **author** this repo — the document model, the block
> catalogue, the validation loop, how a handoff becomes a site? That is
> `CLAUDE.md` in the repo root. The files here are the runtime prompt contract
> for the AI *inside the dashboard*, which is a different job.

Two contracts live here, and they are not alternatives — they cover two page formats
that both still build.

| File | Covers | Source of truth |
| --- | --- | --- |
| `SKILL.md` | **Block pages** (`site/pages/<dir>/page.json`). The current model: the AI composes a page from the block library and returns patch operations as JSON. | `website-builder/skill/SKILL.md` in the Vendure plugin. Synced into this repo by the platform. |
| `build-instructions.md`, `design-system.md`, `global-elements.md`, `seo.md`, `aio.md` | **Legacy HTML pages** (`site/pages/<dir>/body.html`). The freeform mode: the AI writes the page body as HTML and CSS. Still supported so repos provisioned before the block model keep working. | Same plugin. Synced. |

`scripts/build.mjs` reads `page.json` when it exists and falls back to `body.html`, so a
repo can hold both formats while pages are converted one at a time.

## Do not edit these files here

Everything in `ai/`, `renderer/`, `scripts/` and `vercel.json` is platform-owned. The
editor's write allowlist covers `site/`, `public/` and `dealer.config.json` and nothing
else, and the platform overwrites this directory when it syncs a dealer repo forward to
a new renderer or contract version. An edit made here is lost at the next sync and, in
the meantime, means one dealer is running a contract nobody else is — which is exactly
the drift the single-source-of-truth rule exists to prevent.

The one thing that is genuinely per-dealer is the *content* of the contract's variable
half: the dealer's tokens, menus, forms, buttons and available widgets. Those are read
from `site/` at request time and appended to the prompt. They are data, not contract.

/**
 * What a document needs beyond its own markup: instance style overrides, and the
 * stylesheets and scripts belonging to every designed component it places.
 *
 * Both answers require the same walk — which components does this tree place,
 * transitively, and with what content — and three callers need it: the published
 * build, the dashboard's preview, and anything else that has to reproduce a page
 * outside the build. Keeping the walk here is what stops a preview from being a
 * second, subtly different opinion about what a page consists of.
 */

import { bindTree, componentValues, parseComponentProps } from './component-props.mjs';
import { rewriteAssetUrls } from './html.mjs';
import { parseDocument } from './nodes.mjs';
import { compileNodeStyles } from './styles.mjs';

/**
 * Visit every designed component a set of trees places, outermost first.
 *
 * `visit` receives the component and the tree it expands to for that placement,
 * already bound to the placement's values. A component that places itself is cut
 * rather than followed until the stack runs out.
 */
function walkComponents(nodeLists, sections, visit) {
  const seen = new Set();
  const expanding = new Set();

  const walk = nodes => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== 'object') continue;

      if (node.type === 'sharedSection') {
        const id = String((node.props && node.props.sectionId) || '').trim();
        const section = id && !expanding.has(id) ? sections[id] : null;
        if (section) {
          const declared = parseComponentProps(section.props);
          const values = componentValues(declared, node.props && node.props.values);
          // Keyed by the expansion rather than by the component: two placements
          // holding different content expand to different ids, and skipping the
          // second would leave its copies unaccounted for.
          const key = `${id}\u0000${JSON.stringify(values)}`;
          if (!seen.has(key)) {
            seen.add(key);
            const bound = bindTree(parseDocument(section).nodes, values);
            visit(id, section, bound);
            expanding.add(id);
            walk(bound);
            expanding.delete(id);
          }
        }
      }

      if (Array.isArray(node.children)) walk(node.children);
    }
  };

  for (const list of Array.isArray(nodeLists) ? nodeLists : []) walk(list);
}

/**
 * Instance style overrides for whole trees, designed components included.
 *
 * `compileNodeStyles` only sees the nodes it is handed, and a page holds a
 * component as a single `sharedSection` reference — the component's own nodes live
 * in its file and appear only inside `renderDocument`. Compiling a page's tree on
 * its own therefore emitted nothing for anything styled *inside* a component, so a
 * heading spaced in the component editor silently lost that spacing on every page
 * that placed it.
 *
 * Expansion has to happen before compilation rather than after. A repeating node's
 * copies are given suffixed ids — `slide` becomes `slide-1`, `slide-2` — and the
 * selector is an exact id match, so styles compiled from the unexpanded tree would
 * name nodes that are not in the output.
 *
 * @param nodeLists One or more trees — a template's nodes and a page's nodes.
 * @param ctx Needs `sections`, the same map `renderDocument` expands against.
 */
export function documentStyles(nodeLists, ctx = {}) {
  const trees = [...(Array.isArray(nodeLists) ? nodeLists : [])];
  walkComponents(nodeLists, (ctx && ctx.sections) || {}, (_id, _section, bound) => trees.push(bound));
  const css = trees
    .map(tree => compileNodeStyles(tree))
    .filter(Boolean)
    .join('\n');
  // The editor canvas injects this sheet as-is. Site-relative urls
  // (`/images/hero.jpg`) 404 against the dashboard origin unless they are
  // prefixed here — the published build has no assetBase, so this is a no-op.
  return rewriteAssetUrls(css, ctx);
}

/**
 * The CSS and JS belonging to every component a set of trees places.
 *
 * A component's own stylesheet and script travel with it rather than loading on
 * every page: a dealer with a dozen components should not ship all twelve to a
 * page that uses one. Following nesting matters because a component may place
 * another, and the inner one's code is just as necessary.
 *
 * Returns scripts unwritten and in placement order — the caller decides whether
 * they become files or inline tags, which is the only part that differs between a
 * published build and a preview.
 */
export function componentCode(nodeLists, ctx = {}) {
  const css = [];
  const scripts = [];
  // Per component, not per placement: the same component placed twice with
  // different content is still one stylesheet and one script.
  const emitted = new Set();

  walkComponents(nodeLists, (ctx && ctx.sections) || {}, (id, section) => {
    if (emitted.has(id)) return;
    emitted.add(id);
    if (section.css) css.push(section.css);
    if (section.js && String(section.js).trim()) scripts.push({ id, js: String(section.js) });
  });

  return { css: css.join('\n'), scripts };
}

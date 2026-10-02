// Emit the node catalogue as plain JSON.
//
// The Vendure plugin and the dashboard both need to know what can be placed and
// what each thing takes — the plugin to build the AI contract and validate what
// comes back, the dashboard to build the inspector and to register GrapesJS
// component types. Neither can import an ESM module out of this repo at build
// time, so the catalogue is exported here and vendored, with the check script
// failing if the vendored copy has drifted from the renderer that renders.
//
// Run: node scripts/export-schemas.mjs

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RENDERER_VERSION,
  DOCUMENT_VERSION,
  BEHAVIOURS,
  CONDITION_TYPES,
  DATA_SOURCES,
  GRID_COLUMNS,
  MENU_ITEM_TYPES,
  MAX_MENU_DEPTH,
  PROP_TYPES,
  ROW_PRESETS,
  TOKEN_GROUPS,
  DEFAULT_TOKENS,
  WIDGET_GROUPS,
  STYLE_BUCKETS,
  STYLE_FIELDS,
  STYLE_GROUPS,
  BEHAVIOUR_PARTS,
  BEHAVIOUR_OPTIONS,
  UNIVERSAL_PROPS,
  blockCatalogue,
  layoutCatalogue,
  staticWidgetIds,
} from '../renderer/index.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'block-schemas.json');

/**
 * `accepts` as data.
 *
 * The predicate itself cannot be vendored — it is code — but its whole truth
 * table can, and that is what the dashboard turns into GrapesJS `droppable`
 * rules and what the AI contract states. One table, three consumers, no chance
 * of the editor allowing a drop the build rejects.
 */
const layout = layoutCatalogue();
const nesting = {
  // A shared section is top level only, so it appears here and under no other
  // parent. This list is what the server validator enforces — the renderer's
  // `accepts()` predicate says the same thing in code, and the two disagreeing
  // means a drop the editor allows becomes a tree the build rejects.
  root: { accepts: ['section', 'row', 'contentArea', 'widget', 'sharedSection'] },
  ...Object.fromEntries(layout.map(node => [node.id, { accepts: node.accepts }])),
};

const catalogue = {
  rendererVersion: RENDERER_VERSION,
  documentVersion: DOCUMENT_VERSION,
  gridColumns: GRID_COLUMNS,
  tokenGroups: TOKEN_GROUPS,
  // The starter token set travels with the catalogue so the dashboard can offer
  // a full, editable design system for a repo that has no tokens file yet.
  defaultTokens: DEFAULT_TOKENS,
  menuItemTypes: MENU_ITEM_TYPES,
  maxMenuDepth: MAX_MENU_DEPTH,
  conditionTypes: CONDITION_TYPES,
  rowPresets: ROW_PRESETS,
  widgetGroups: WIDGET_GROUPS,
  staticWidgets: staticWidgetIds(),
  // Prop editor types a custom widget definition may declare.
  // One vocabulary, two kinds of component: a coded widget's props and a designed
  // component's props are declared identically, so the inspector that edits one
  // edits the other and the AI contract states the list once.
  customWidgetPropTypes: PROP_TYPES,
  componentPropTypes: PROP_TYPES,
  // Live dealer data a component's list prop may be pointed at instead of typed
  // rows. The platform resolves `widget` and reads `path` out of the answer, so
  // both halves of that contract have to travel together or a binding resolves
  // to nothing and the band publishes empty.
  dataSources: DATA_SOURCES,
  // Instance style overrides: the fields a node's `styles` buckets may set.
  // Functions cannot travel as JSON, so the validator gets names + options and
  // enforces "known field" — value shape is re-checked by the renderer at
  // compile time, which drops anything invalid rather than emitting it.
  styleBuckets: STYLE_BUCKETS.map(b => b.key),
  // The media query each bucket compiles to, so the editor's device previews
  // resize to the same widths the published page switches at.
  styleBreakpoints: Object.fromEntries(STYLE_BUCKETS.map(b => [b.key, b.media])),
  styleGroups: STYLE_GROUPS,
  styleFields: Object.fromEntries(
    Object.entries(STYLE_FIELDS).map(([key, spec]) => [
      key,
      {
        css: spec.css,
        label: spec.label,
        group: spec.group ?? 'appearance',
        ...(spec.hint ? { hint: spec.hint } : {}),
        ...(spec.options ? { options: spec.options } : {}),
        ...(spec.composes ? { composes: true } : {}),
      },
    ]),
  ),
  // Client behaviours a node may opt into via data-bz-behavior.
  behaviours: BEHAVIOURS,
  // Which parts each behaviour looks for, and what each reads from its options.
  // A mismarked part fails silently — the script finds nothing and does not
  // enhance — so the names have to travel to whoever authors the markup.
  behaviourParts: BEHAVIOUR_PARTS,
  behaviourOptions: BEHAVIOUR_OPTIONS,
  // Props valid on any node regardless of type. The validator falls back to these
  // before calling a prop invented, which is what `anchor` on a widget always was.
  universalProps: UNIVERSAL_PROPS,
  layout,
  nesting,
  widgets: blockCatalogue(),
};

writeFileSync(OUT, JSON.stringify(catalogue, null, 2) + '\n');
console.log(
  `Exported ${catalogue.layout.length} layout nodes and ${catalogue.widgets.length} widgets ` +
    `-> renderer/block-schemas.json`,
);

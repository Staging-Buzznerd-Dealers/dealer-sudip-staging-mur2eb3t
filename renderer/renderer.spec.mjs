import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  accepts,
  applyOps,
  bindTree,
  bindingsUsed,
  blockCatalogue,
  blockRegistry,
  clearCustomWidgets,
  componentSampleValues,
  componentValues,
  dataSource,
  isDataBinding,
  parseComponentProps,
  previewProps,
  resolveDataBinding,
  resolveValues,
  compileNodeStyles,
  compileTokens,
  compileTokenScope,
  componentCode,
  composeDocument,
  conditionMatches,
  documentStyles,
  customWidgetCss,
  customWidgets,
  ensureIds,
  findContentArea,
  fontFaceCss,
  fontPreloads,
  fontsHref,
  makeRow,
  makeSection,
  parseDocument,
  parseMenus,
  parseTemplates,
  parseWidgetDefinition,
  getBlock,
  makeProjection,
  BEHAVIOURS,
  BEHAVIOUR_PARTS,
  PARTS,
  UNIVERSAL_PROPS,
  widgetDefaultProps,
  widgetPreviewProps,
  registerCustomWidgets,
  renderDocument,
  renderWidgetPreview,
  renderForm,
  renderMenu,
  resolveAssetUrl,
  rewriteAssetUrls,
  isSiteAssetPath,
  resolveTemplate,
  splitAtContentArea,
  unknownStyleKeys,
  validateDocument,
  validateTemplate,
} from './index.mjs';
import { ICON_SLOT_IDS, iconsManifest, parseIcons } from './index.mjs';

import { defaultConfirmation } from './forms.mjs';

import tokens from '../site/tokens.json' with { type: 'json' };
import menus from '../site/menus.json' with { type: 'json' };

const CTX = {
  storefrontPrefix: 'store',
  businessName: 'Test Dealer',
  menus,
  pages: [{ slug: 'about', path: '/about', title: 'About', status: 'published' }],
  buttons: {
    'get-quote': { id: 'get-quote', label: 'Get a quote', url: '/quote', style: 'primary', intent: 'get-quote' },
  },
  forms: {
    contact: {
      id: 'contact',
      name: 'Contact',
      status: 'live',
      fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
    },
  },
};

/* ------------------------------------------------------------- the document */

test('a page is a tree: section holds a row, a row holds columns, columns hold widgets', () => {
  const doc = {
    nodes: [
      {
        id: 's1',
        type: 'section',
        props: { width: 'boxed' },
        children: [
          {
            id: 'r1',
            type: 'row',
            props: { gap: 6 },
            children: [
              {
                id: 'c1',
                type: 'column',
                props: { span: 8 },
                children: [{ id: 'h1', type: 'heading', props: { text: 'Left' } }],
              },
              {
                id: 'c2',
                type: 'column',
                props: { span: 4 },
                children: [{ id: 't1', type: 'text', props: { text: 'Right' } }],
              },
            ],
          },
        ],
      },
    ],
  };
  const html = renderDocument(doc, CTX);
  assert.match(html, /data-bz-type="section"/);
  assert.match(html, /data-bz-type="row"/);
  assert.match(html, /--bz-span:8/);
  assert.match(html, /--bz-span:4/);
  assert.match(html, /Left/);
  assert.match(html, /Right/);
});

test('nesting rules are one predicate, and it is the one the editor uses', () => {
  assert.equal(accepts('row', 'column'), true);
  assert.equal(accepts('row', 'heading'), false, 'a widget cannot sit directly in a row');
  assert.equal(accepts('column', 'row'), true, 'a nested grid must be possible');
  assert.equal(accepts('column', 'heading'), true);
  assert.equal(accepts('section', 'column'), false, 'a column needs a row to sit in');
  assert.equal(accepts('section', 'row'), true);
  assert.equal(accepts(null, 'column'), false, 'a bare column has no grid');
  assert.equal(accepts(null, 'section'), true);
  assert.equal(accepts('heading', 'text'), false, 'a widget is a leaf');
});

test('a v1 page migrates: a row that carried props.columns becomes real columns', () => {
  const v1 = {
    version: 1,
    blocks: [
      { id: 'hero', type: 'hero', props: { headline: 'Hi' } },
      {
        id: 'r1',
        type: 'row',
        props: {
          align: 'center',
          columns: [
            [{ id: 'h1', type: 'heading', props: { text: 'Left' } }],
            [{ id: 't1', type: 'text', props: { text: 'Right' } }],
          ],
        },
      },
    ],
  };
  const doc = parseDocument(v1);
  const row = doc.nodes[1];
  assert.equal(row.type, 'row');
  assert.equal(row.children.length, 2);
  assert.equal(row.children[0].type, 'column');
  assert.equal(row.children[0].props.span, 6);
  assert.equal(row.children[0].children[0].id, 'h1');
  assert.ok(!('columns' in row.props), 'the old children prop must not survive');
});

test('a v1 bar becomes a row, so a migrated header is editable as a grid', () => {
  const doc = parseDocument({
    blocks: [
      {
        id: 'bar',
        type: 'bar',
        props: { columns: [[{ id: 'logo', type: 'logo', props: {} }], [{ id: 'nav', type: 'menu', props: {} }]] },
      },
    ],
  });
  assert.equal(doc.nodes[0].type, 'row');
  assert.equal(doc.nodes[0].children.length, 2);
});

test('ids are stamped without renaming ones that already exist', () => {
  const nodes = [{ type: 'section', children: [{ id: 'keep', type: 'heading', props: {} }] }];
  ensureIds(nodes);
  assert.equal(nodes[0].id, 'section');
  assert.equal(nodes[0].children[0].id, 'keep');
});

test('makeRow builds a grid that sums to the twelve-column track', () => {
  const row = makeRow([8, 4]);
  assert.equal(row.children.length, 2);
  assert.deepEqual(row.children.map((c) => c.props.span), [8, 4]);
  assert.ok(row.children.every((c) => c.type === 'column'));
});

/* ------------------------------------------------------------------- ops */

test('insert places a node inside a named parent at a named index', () => {
  const doc = { nodes: [makeSection([makeRow([6, 6])])] };
  ensureIds(doc.nodes);
  const columnId = doc.nodes[0].children[0].children[1].id;

  const { document, rejected } = applyOps(doc, [
    { op: 'insert', parentId: columnId, index: 0, node: { id: 'h', type: 'heading', props: { text: 'Hi' } } },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(document.nodes[0].children[0].children[1].children[0].id, 'h');
});

test('insert refuses a placement the editor would also refuse', () => {
  const doc = { nodes: [makeRow([6, 6])] };
  ensureIds(doc.nodes);
  const { rejected } = applyOps(doc, [
    { op: 'insert', parentId: doc.nodes[0].id, node: { id: 'h', type: 'heading', props: {} } },
  ]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /cannot go inside a row/);
});

test('move reparents — dragging a widget from one column into another', () => {
  const doc = {
    nodes: [
      {
        id: 'r',
        type: 'row',
        props: {},
        children: [
          { id: 'c1', type: 'column', props: { span: 6 }, children: [{ id: 'h', type: 'heading', props: {} }] },
          { id: 'c2', type: 'column', props: { span: 6 }, children: [] },
        ],
      },
    ],
  };
  const { document, rejected } = applyOps(doc, [{ op: 'move', id: 'h', parentId: 'c2', index: 0 }]);
  assert.deepEqual(rejected, []);
  assert.equal(document.nodes[0].children[0].children.length, 0);
  assert.equal(document.nodes[0].children[1].children[0].id, 'h');
});

test('move within one parent honours the index the caller meant', () => {
  const doc = {
    nodes: [
      { id: 'a', type: 'heading', props: {} },
      { id: 'b', type: 'heading', props: {} },
      { id: 'c', type: 'heading', props: {} },
    ],
  };
  const { document } = applyOps(doc, [{ op: 'move', id: 'a', parentId: null, index: 2 }]);
  assert.deepEqual(document.nodes.map((n) => n.id), ['b', 'c', 'a']);
});

test('a node cannot be moved inside itself', () => {
  const doc = { nodes: [makeSection([makeRow([12])])] };
  ensureIds(doc.nodes);
  const sectionId = doc.nodes[0].id;
  const rowId = doc.nodes[0].children[0].id;
  const { rejected } = applyOps(doc, [{ op: 'move', id: sectionId, parentId: rowId }]);
  assert.equal(rejected.length, 1);
});

test('wrap keeps the node — "make this two columns" is not a delete and a re-add', () => {
  const doc = { nodes: [{ id: 'h', type: 'heading', props: { text: 'Keep me' } }] };
  const { document, rejected } = applyOps(doc, [{ op: 'wrap', id: 'h', node: makeRow([6, 6]) }]);
  assert.deepEqual(rejected, []);
  assert.equal(document.nodes[0].type, 'row');
  assert.equal(document.nodes[0].children[0].children[0].id, 'h');
  assert.equal(document.nodes[0].children[0].children[0].props.text, 'Keep me');
});

test('update merges props and leaves everything else byte-identical', () => {
  const doc = { nodes: [{ id: 'h', type: 'heading', props: { text: 'a', align: 'center' } }] };
  const { document } = applyOps(doc, [{ op: 'update', id: 'h', props: { text: 'b' } }]);
  assert.deepEqual(document.nodes[0].props, { text: 'b', align: 'center' });
});

/* ----------------------------------------------------------------- scope */

/** Two columns; the dealer has c1 selected. The failure this guards against is
 * the model "helping" by rebuilding the parts nobody asked about. */
function scopedDoc() {
  return {
    nodes: [
      {
        id: 's',
        type: 'section',
        props: { background: 'card' },
        children: [
          {
            id: 'r',
            type: 'row',
            props: {},
            children: [
              { id: 'c1', type: 'column', props: { span: 6 }, children: [{ id: 'h', type: 'heading', props: {} }] },
              { id: 'c2', type: 'column', props: { span: 6 }, children: [{ id: 'img', type: 'image', props: {} }] },
            ],
          },
        ],
      },
    ],
  };
}

test('scope: "add an FAQ here" with a column selected inserts into it and touches nothing else', () => {
  const { document, rejected } = applyOps(scopedDoc(), [
    { op: 'insert', parentId: 'c1', node: { id: 'faq1', type: 'faq', props: {} } },
  ], { scopeId: 'c1' });
  assert.deepEqual(rejected, []);
  assert.equal(document.nodes[0].children[0].children[0].children[1].id, 'faq1');
});

test('scope: an op on the sibling column is rejected, not applied', () => {
  const before = JSON.stringify(scopedDoc().nodes);
  const { document, rejected } = applyOps(scopedDoc(), [
    { op: 'remove', id: 'c2' },
    { op: 'update', id: 's', props: { background: 'ink' } },
    { op: 'move', id: 'img', parentId: 'c1' },
  ], { scopeId: 'c1' });
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((r) => /outside the selection/.test(r.reason)));
  assert.equal(JSON.stringify(document.nodes), before);
});

test('scope: updating and wrapping the selected node itself is allowed', () => {
  const { document, rejected } = applyOps(scopedDoc(), [
    { op: 'update', id: 'c1', props: { span: 4 } },
  ], { scopeId: 'c1' });
  assert.deepEqual(rejected, []);
  assert.equal(document.nodes[0].children[0].children[0].props.span, 4);
});

test('scope: insert lands beside the selection, or beside anything it sits inside', () => {
  const beside = applyOps(scopedDoc(), [
    { op: 'insert', parentId: 'r', node: { id: 'c3', type: 'column', props: { span: 4 }, children: [] } },
  ], { scopeId: 'c1' });
  assert.deepEqual(beside.rejected, []);

  // "Put a band above this" can only be said at the page root, and the selected
  // column sits inside it. Adding destroys nothing, so this is allowed.
  const above = applyOps(scopedDoc(), [
    { op: 'insert', parentId: null, index: 0, node: { id: 's2', type: 'section', props: {}, children: [] } },
  ], { scopeId: 'c1' });
  assert.deepEqual(above.rejected, []);
  assert.equal(above.document.nodes[0].id, 's2');
});

test('scope: insert into a node the selection does not sit inside is still rejected', () => {
  const sideways = applyOps(scopedDoc(), [
    { op: 'insert', parentId: 'c2', node: { id: 'h2', type: 'heading', props: { text: 'a' } } },
  ], { scopeId: 'c1' });
  assert.equal(sideways.rejected.length, 1);
  assert.ok(/outside the selection/.test(sideways.rejected[0].reason));
});

test('scope: a stale selection rejects the whole batch instead of disabling the boundary', () => {
  const before = JSON.stringify(scopedDoc().nodes);
  const { document, rejected } = applyOps(scopedDoc(), [
    { op: 'update', id: 'c1', props: { span: 4 } },
    { op: 'remove', id: 'c2' },
  ], { scopeId: 'gone-node' });
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((r) => /is not in this document/.test(r.reason)));
  assert.equal(JSON.stringify(document.nodes), before);
});

test('scope: a node inserted in this batch is editable in the same batch', () => {
  const { document, rejected } = applyOps(scopedDoc(), [
    { op: 'insert', parentId: 'c1', node: { id: 'h2', type: 'heading', props: { text: 'a' } } },
    { op: 'update', id: 'h2', props: { text: 'b' } },
  ], { scopeId: 'c1' });
  assert.deepEqual(rejected, []);
  const inserted = document.nodes[0].children[0].children[0].children.find((n) => n.id === 'h2');
  assert.equal(inserted.props.text, 'b');
});

/* ----------------------------------------------------------------- styles */

test('node styles compile to id-keyed rules with desktop-first media buckets', () => {
  const css = compileNodeStyles([
    {
      id: 's1',
      type: 'section',
      props: {},
      styles: {
        base: { background: '#102030', paddingTop: 64 },
        mobile: { paddingTop: 24, textAlign: 'center' },
      },
      children: [
        { id: 'h1', type: 'heading', props: {}, styles: { base: { textColor: 'accent' } } },
      ],
    },
  ]);
  // Declaration order follows the field table, not whatever order the editor
  // happened to write the keys in, so a shorthand can never land after the
  // longhand it would reset.
  assert.match(css, /\[data-bz-node="s1"\]\[data-bz-node\]\{padding-top:64px;background:#102030\}/);
  assert.match(css, /@media \(max-width: 640px\)\{\[data-bz-node="s1"\]\[data-bz-node\]\{padding-top:24px;text-align:center\}\}/);
  assert.match(css, /\[data-bz-node="h1"\]\[data-bz-node\]\{color:var\(--accent\)\}/);
});

test('a text colour reaches the descendants that carry their own colour', () => {
  const css = compileNodeStyles([
    { id: 'band', type: 'section', props: {}, styles: { base: { textColor: '#ffffff' } } },
  ]);
  // The node's own rule is not enough: `color` is inherited, and blocks.css
  // sets it directly on `.bz-lede`, `.bz-eyebrow` and friends, which an
  // inherited value can never beat.
  assert.match(css, /\[data-bz-node="band"\]\[data-bz-node\]\{color:#ffffff\}/);
  assert.match(
    css,
    /\[data-bz-node="band"\]\[data-bz-node\] \*:not\(\.bz-btn, \.bz-input, \.bz-req, \.bz-form__status\)\{color:#ffffff\}/,
  );
  // Buttons keep their variant colour — they have their own fields. Form
  // controls and the two colour-is-the-message classes are held back too, so a
  // white-on-dark band cannot produce white text typed into a white field.
  assert.ok(!/\[data-bz-node="band"\]\[data-bz-node\] \.bz-btn\{/.test(css));
});

test('button fields style the button, not the block that places it', () => {
  const css = compileNodeStyles([
    {
      id: 'cta',
      type: 'buttons',
      props: {},
      styles: {
        base: { background: 'paper', buttonBackground: '#0b0b0b', buttonTextColor: '#ffffff' },
        mobile: { buttonRadius: 4 },
      },
    },
  ]);
  // The block's own background paints the strip behind the button; only the
  // targeted rule can paint the button itself.
  assert.match(css, /\[data-bz-node="cta"\]\[data-bz-node\]\{background:var\(--paper\)\}/);
  assert.match(
    css,
    /\[data-bz-node="cta"\]\[data-bz-node\] \.bz-btn\{background-color:#0b0b0b;color:#ffffff\}/,
  );
  assert.match(
    css,
    /@media \(max-width: 640px\)\{\[data-bz-node="cta"\]\[data-bz-node\] \.bz-btn\{border-radius:4px\}\}/,
  );
});

test('a document that targets nothing compiles to one rule per node, as before', () => {
  const css = compileNodeStyles([
    { id: 'plain', type: 'section', props: {}, styles: { base: { paddingTop: 32, radius: 8 } } },
  ]);
  assert.equal(css, '[data-bz-node="plain"][data-bz-node]{padding-top:32px;border-radius:8px}');
});

test('style values outside the whitelist are dropped, never emitted', () => {
  const css = compileNodeStyles([
    {
      id: 'x',
      type: 'text',
      props: {},
      styles: {
        base: {
          background: 'rgb(1 2 3)',
          textAlign: 'justify',
          paddingTop: 99999,
          // Layering is allowed, but not viewport-anchored layering: a fixed
          // node cannot be scrolled away from and covers the editor tooling.
          position: 'fixed',
          zIndex: 9999,
          aspectRatio: '16/0',
          gridColumns: 'repeat(3, 1fr) 40vh',
          backgroundImage: 'javascript:alert(1)',
          marginLeft: -80,
        },
      },
    },
  ]);
  assert.equal(css, '');
  assert.deepEqual(unknownStyleKeys({ base: { nonsense: 1 }, desktop: {} }), ['base.nonsense', 'desktop']);
});

test('the widened contract expresses the patterns real handoffs are built from', () => {
  const css = compileNodeStyles([
    {
      id: 'scrim',
      type: 'text',
      props: {},
      styles: {
        base: {
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          // Opacity would fade the copy with the scrim; an alpha background does not.
          background: '#1a1714@68%',
          backgroundImage: 'https://cdn.example.com/hero.jpg',
          backgroundSize: 'cover',
        },
      },
    },
    { id: 'card', type: 'text', props: {}, styles: { base: { aspectRatio: '4/3', radius: 999 } } },
    { id: 'panel', type: 'text', props: {}, styles: { base: { gridColumns: '240px 200px 1fr' } } },
    { id: 'footer', type: 'text', props: {}, styles: { base: { gridColumns: '1.4fr 1fr 1fr 1fr' } } },
    { id: 'rail', type: 'text', props: {}, styles: { base: { overflowX: 'auto', top: '100%' } } },
    { id: 'overlap', type: 'text', props: {}, styles: { base: { marginTop: -56 } } },
    { id: 'mirror', type: 'text', props: {}, styles: { tablet: { order: 2 } } },
    { id: 'moved', type: 'text', props: {}, styles: { base: { translateY: -8, scale: 1.02, rotate: 3 } } },
  ]);

  assert.match(css, /\[data-bz-node="scrim"\]\[data-bz-node\]\{[^}]*position:absolute/);
  assert.match(css, /inset:0px/);
  assert.match(css, /background:rgb\(26 23 20 \/ 68%\)/);
  // The shorthand precedes the image, so the image survives both being set.
  assert.match(css, /background:rgb\(26 23 20 \/ 68%\);background-image:url\("https:\/\/cdn\.example\.com\/hero\.jpg"\)/);
  assert.match(css, /\[data-bz-node="card"\]\[data-bz-node\]\{aspect-ratio:4 \/ 3;border-radius:999px\}/);
  assert.match(css, /\[data-bz-node="panel"\]\[data-bz-node\]\{grid-template-columns:240px 200px 1fr\}/);
  assert.match(css, /\[data-bz-node="footer"\]\[data-bz-node\]\{grid-template-columns:1.4fr 1fr 1fr 1fr\}/);
  assert.match(css, /\[data-bz-node="rail"\]\[data-bz-node\]\{top:100%;overflow-x:auto\}/);
  assert.match(css, /\[data-bz-node="overlap"\]\[data-bz-node\]\{margin-top:-56px\}/);
  assert.match(css, /@media \(max-width: 1100px\)\{\[data-bz-node="mirror"\]\[data-bz-node\]\{order:2\}\}/);
  // The four transform axes are separate bounded fields, composed on the way out.
  assert.match(css, /\[data-bz-node="moved"\]\[data-bz-node\]\{transform:translateY\(-8px\) rotate\(3deg\) scale\(1.02\)\}/);
});

test('the editor prefixes a section background-image the same way it prefixes <img>', () => {
  // The hero on this site stores the photo as a style, not as an image widget.
  // Preview already rewrote that CSS; the canvas injects documentStyles raw, so
  // without this the section paints --ink and the photo only appears after Preview.
  const css = documentStyles(
    [
      [
        {
          id: 'hero',
          type: 'section',
          props: {},
          styles: { base: { backgroundImage: '/images/sunset-highway.jpg' } },
        },
      ],
    ],
    { ...CTX, assetBase: 'https://api.example.com/website-assets/ticket' },
  );
  assert.match(
    css,
    /background-image:url\("https:\/\/api\.example\.com\/website-assets\/ticket\/images\/sunset-highway\.jpg"\)/,
  );
});

/* ------------------------------------------------------------------ fonts */

test('self-hosted fonts compile to @font-face and suppress the Google request', () => {
  const brand = {
    fonts: {
      heading: 'INTL Headline',
      body: 'INTL Text',
      files: [
        { family: 'INTL Headline', url: 'https://cdn.example.com/f/INTLHeadline-Regular.woff2', weight: 400 },
        { family: 'INTL Headline', url: 'https://cdn.example.com/f/INTLHeadline-Bold.woff2', weight: '600 900' },
        { family: 'INTL Text', url: 'https://cdn.example.com/f/INTLText-Regular.woff2', weight: 400 },
        { family: 'INTL Text', url: 'https://cdn.example.com/f/INTLText-Italic.woff2', weight: 400, style: 'italic' },
      ],
    },
  };

  const css = fontFaceCss(brand);
  assert.match(css, /@font-face\{font-family:"INTL Headline";src:url\("https:\/\/cdn\.example\.com\/f\/INTLHeadline-Regular\.woff2"\) format\("woff2"\);font-weight:400;font-style:normal;font-display:swap;\}/);
  assert.match(css, /font-weight:600 900/);
  assert.match(css, /font-style:italic/);

  // Both families are self-hosted, so there is nothing left to ask Google for.
  assert.equal(fontsHref(brand), '');

  // Upright text weights of the two active families only — a bold heading face
  // does render above the fold, an italic almost never does — and capped so
  // preloading cannot compete with the hero image for bandwidth.
  const preloads = fontPreloads(brand);
  assert.deepEqual(preloads, [
    'https://cdn.example.com/f/INTLHeadline-Regular.woff2',
    'https://cdn.example.com/f/INTLHeadline-Bold.woff2',
    'https://cdn.example.com/f/INTLText-Regular.woff2',
  ]);
  assert.ok(!preloads.some((url) => url.includes('Italic')));
});

test('a font family that is not self-hosted still falls back to Google', () => {
  const mixed = {
    fonts: {
      heading: 'INTL Headline',
      body: 'Inter',
      files: [{ family: 'INTL Headline', url: '/fonts/INTLHeadline-Regular.woff2', weight: 400 }],
    },
  };
  const href = fontsHref(mixed);
  assert.match(href, /family=Inter/);
  assert.ok(!href.includes('INTL'));
});

test('unsafe or unusable font entries are dropped rather than repaired', () => {
  const css = fontFaceCss({
    fonts: {
      heading: 'X',
      body: 'X',
      files: [
        { family: 'X', url: 'http://insecure.example.com/a.woff2', weight: 400 },
        { family: 'X', url: 'javascript:alert(1)', weight: 400 },
        { family: 'X"} body{display:none', url: 'https://cdn.example.com/b.woff2', weight: 400 },
        { family: 'X', url: 'https://cdn.example.com/c.svg', weight: 400 },
        { family: 'X', url: 'https://cdn.example.com/d.woff2', weight: 5000 },
        { family: 'X', url: 'https://cdn.example.com/ok.woff2', weight: 400 },
      ],
    },
  });
  assert.equal((css.match(/@font-face/g) || []).length, 1);
  assert.match(css, /ok\.woff2/);
});

test('a border width still implies a visible border, per side', () => {
  const css = compileNodeStyles([
    { id: 'row', type: 'text', props: {}, styles: { base: { borderTopWidth: 1, borderColor: 'line' } } },
  ]);
  assert.match(css, /border-top-width:1px/);
  assert.match(css, /border-style:solid/);
});

test('styles survive parseDocument, and update ops patch them per bucket', () => {
  const doc = parseDocument({
    version: 2,
    nodes: [{ id: 'a', type: 'heading', props: { text: 'x' }, styles: { base: { textAlign: 'center' } } }],
  });
  assert.deepEqual(doc.nodes[0].styles, { base: { textAlign: 'center' } });

  const { document, rejected } = applyOps(doc, [
    { op: 'update', id: 'a', styles: { base: { background: '#ffffff' }, mobile: { textAlign: 'left' } } },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(document.nodes[0].styles, {
    base: { textAlign: 'center', background: '#ffffff' },
    mobile: { textAlign: 'left' },
  });

  const cleared = applyOps(document, [{ op: 'update', id: 'a', styles: { base: { textAlign: null, background: null }, mobile: { textAlign: null } } }]);
  assert.equal(cleared.document.nodes[0].styles, undefined);
});

/* -------------------------------------------------------------- templates */

const TEMPLATE = {
  version: 2,
  id: 'default',
  name: 'Site template',
  conditions: [{ type: 'entireSite', ref: null }],
  nodes: [
    { id: 'head', type: 'section', props: {}, children: [] },
    { id: 'content', type: 'contentArea', props: { label: 'Page content' } },
    { id: 'foot', type: 'section', props: {}, children: [] },
  ],
};

test('a page is composed into its template at the content area', () => {
  const page = [{ id: 'h', type: 'heading', props: { text: 'About us' } }];
  const composed = composeDocument(TEMPLATE.nodes, page);
  assert.deepEqual(composed.map((n) => n.id), ['head', 'h', 'foot']);
});

test('the header and footer fragments are derived from where the content area sits', () => {
  const { before, after, found } = splitAtContentArea(TEMPLATE.nodes);
  assert.equal(found, true);
  assert.deepEqual(before.map((n) => n.id), ['head']);
  assert.deepEqual(after.map((n) => n.id), ['foot']);
});

test('display conditions resolve by specificity, most specific first', () => {
  const templates = [
    { ...TEMPLATE, id: 'site', conditions: [{ type: 'entireSite' }] },
    { ...TEMPLATE, id: 'pages', conditions: [{ type: 'allPages' }] },
    { ...TEMPLATE, id: 'about', conditions: [{ type: 'page', ref: 'about' }] },
  ];
  assert.equal(resolveTemplate({ kind: 'page', slug: 'about' }, templates).template.id, 'about');
  assert.equal(resolveTemplate({ kind: 'page', slug: 'other' }, templates).template.id, 'pages');
  assert.equal(resolveTemplate({ kind: 'post', slug: 'x' }, templates).template.id, 'site');
});

test('an inventory condition covers the parts catalogue until a parts one exists', () => {
  const site = { ...TEMPLATE, id: 'site', conditions: [{ type: 'entireSite' }] };
  const inventory = { ...TEMPLATE, id: 'inv', conditions: [{ type: 'inventory' }] };
  const parts = { ...TEMPLATE, id: 'parts', conditions: [{ type: 'parts' }] };

  // Adding the parts condition must not strand the parts pages of every site
  // that already has one inventory template and no idea this exists.
  assert.equal(resolveTemplate({ kind: 'parts' }, [site, inventory]).template.id, 'inv');
  assert.equal(resolveTemplate({ kind: 'parts' }, [site, inventory, parts]).template.id, 'parts');
  assert.equal(resolveTemplate({ kind: 'inventory' }, [site, inventory, parts]).template.id, 'inv');
  assert.equal(resolveTemplate({ kind: 'inventory' }, [site, parts]).template.id, 'site');
});

test('the home page is not a special case — it is a page with a condition', () => {
  const templates = [
    { ...TEMPLATE, id: 'site', conditions: [{ type: 'entireSite' }] },
    { ...TEMPLATE, id: 'home', conditions: [{ type: 'page', ref: 'home' }] },
  ];
  assert.equal(resolveTemplate({ kind: 'page', slug: 'home' }, templates).template.id, 'home');
  assert.equal(resolveTemplate({ kind: 'page', slug: 'about' }, templates).template.id, 'site');
});

test('two equally specific conditions are reported, not silently resolved', () => {
  const templates = [
    { ...TEMPLATE, id: 'a', conditions: [{ type: 'allPages' }] },
    { ...TEMPLATE, id: 'b', conditions: [{ type: 'allPages' }] },
  ];
  assert.ok(resolveTemplate({ kind: 'page', slug: 'x' }, templates).conflict);
});

test('condition matching covers every kind a target can be', () => {
  assert.equal(conditionMatches({ type: 'allPosts' }, { kind: 'post', slug: 'a' }), true);
  assert.equal(conditionMatches({ type: 'allPosts' }, { kind: 'page', slug: 'a' }), false);
  assert.equal(conditionMatches({ type: 'blog' }, { kind: 'blog' }), true);
  assert.equal(conditionMatches({ type: 'inventory' }, { kind: 'inventory' }), true);
  assert.equal(
    conditionMatches({ type: 'pageGroup', ref: 'brands' }, { kind: 'page', slug: 'x', group: 'brands' }),
    true,
  );
});

test('a repo written under the two-slot model is folded into one template', () => {
  const templates = parseTemplates({
    'header--default.json': { name: 'Header', slot: 'header', blocks: [{ id: 'bar', type: 'logo', props: {} }] },
    'footer--default.json': { name: 'Footer', slot: 'footer', blocks: [{ id: 'f', type: 'footer', props: {} }] },
  });
  assert.equal(templates.length, 1);
  const ids = templates[0].nodes.map((n) => n.type);
  assert.deepEqual(ids, ['logo', 'contentArea', 'footer']);
  assert.deepEqual(templates[0].conditions, [{ type: 'entireSite', ref: null }]);
});

test('a template is refused unless it has exactly one content area', () => {
  assert.equal(validateTemplate({ nodes: [{ id: 'a', type: 'heading', props: { text: 'x' } }] }).valid, false);
  assert.match(
    validateTemplate({ nodes: [{ id: 'a', type: 'heading', props: { text: 'x' } }] }).message,
    /needs a content area/,
  );
  assert.match(
    validateTemplate({
      nodes: [
        { id: 'a', type: 'contentArea', props: {} },
        { id: 'b', type: 'contentArea', props: {} },
      ],
    }).message,
    /only have one content area/,
  );
  assert.equal(validateTemplate(TEMPLATE).valid, true);
});

test('the content area is found wherever it is put, including inside a column', () => {
  const nodes = [
    {
      id: 'r',
      type: 'row',
      props: {},
      children: [
        { id: 'side', type: 'column', props: { span: 3 }, children: [] },
        {
          id: 'main',
          type: 'column',
          props: { span: 9 },
          children: [{ id: 'ca', type: 'contentArea', props: {} }],
        },
      ],
    },
  ];
  assert.equal(findContentArea(nodes).node.id, 'ca');
  const composed = composeDocument(nodes, [{ id: 'h', type: 'heading', props: { text: 'x' } }]);
  assert.equal(composed[0].children[1].children[0].id, 'h');
});

/* ------------------------------------------------------------------ menus */

test('a menu is structure only — no locations, no styling', () => {
  const parsed = parseMenus(menus);
  assert.ok(Array.isArray(parsed.menus));
  assert.ok(!('locations' in parsed), 'locations were a theme concept and are gone');
  assert.ok(parsed.menus.find((m) => m.id === 'main'));
});

test('a menu renders nested items as a nested list', () => {
  const sample = {
    version: 3,
    menus: [
      {
        id: 'main',
        name: 'Main',
        items: [
          {
            id: 'about',
            label: 'About',
            type: 'url',
            url: '/about',
            children: [{ id: 'about-team', label: 'Our team', type: 'url', url: '/about#team' }],
          },
        ],
      },
    ],
  };
  const html = renderMenu(sample, 'main', CTX);
  assert.match(html, /data-bz-menu="main"/);
  assert.match(html, /bz-subnav/);
  assert.match(html, /Our team/);
});

test('an unknown menu renders nothing rather than failing the build', () => {
  const warnings = [];
  assert.equal(renderMenu(menus, 'nope', { ...CTX, warn: (m) => warnings.push(m) }), '');
  assert.match(warnings.join(' '), /No menu called/);
});

test('the v2 locations file still yields its menus', () => {
  const parsed = parseMenus({
    version: 2,
    menus: { main: { id: 'main', name: 'Main', items: [{ id: 'a', label: 'A', type: 'url', url: '/a' }] } },
    locations: { primary: 'main' },
  });
  assert.equal(parsed.menus.length, 1);
  assert.equal(parsed.menus[0].id, 'main');
});

test('a page item resolves through the page manifest, so a slug change follows', () => {
  const html = renderMenu(
    { version: 3, menus: [{ id: 'm', name: 'M', items: [{ id: 'i', label: 'About', type: 'page', ref: 'about' }] }] },
    'm',
    CTX,
  );
  assert.match(html, /href="\/about"/);
});

/* --------------------------------------------------------------- widgets */

test('every widget is a leaf and none of them are layout', () => {
  for (const [id, def] of Object.entries(blockRegistry)) {
    assert.ok(
      !['section', 'row', 'column', 'contentArea'].includes(id),
      `${id} should be a layout node, not a widget`,
    );
    assert.ok(def.group, `${id} has no palette group`);
  }
});

test('a custom widget registers as an ordinary leaf', () => {
  registerCustomWidgets([
    {
      id: 'spec-strip',
      label: 'Spec strip',
      props: [{ key: 'heading', type: 'text', label: 'Heading', required: true }],
      html: '<div class="strip"><h3>{{heading}}</h3></div>',
      css: '.strip{display:flex}',
    },
  ]);
  const html = renderDocument({ nodes: [{ id: 's', type: 'spec-strip', props: { heading: 'Specs' } }] }, CTX);
  assert.match(html, /data-bz-type="spec-strip"/);
  assert.match(html, /<h3>Specs<\/h3>/);
  assert.match(customWidgetCss(), /\.bz-block--spec-strip \.strip\{/);
  assert.equal(customWidgets().length, 1);
  clearCustomWidgets();
});

test('a custom widget that declares a drop target is refused, with the reason', () => {
  const { definition, errors } = parseWidgetDefinition({
    id: 'panel',
    label: 'Panel',
    html: '<div><div data-bz-slot="0"></div></div>',
  });
  assert.equal(definition, null);
  assert.match(errors.join(' '), /Widgets are leaves/);
});

test('the catalogue groups widgets for a palette and never for placement', () => {
  const entry = blockCatalogue().find((b) => b.id === 'heading');
  assert.equal(entry.group, 'basic');
});

/* ------------------------------------------------------------ validation */

test('a widget holding children is rejected, and says what to do instead', () => {
  const result = validateDocument({
    nodes: [{ id: 'h', type: 'heading', props: { text: 'x' }, children: [{ id: 'y', type: 'text', props: {} }] }],
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /cannot hold children/);
});

test('duplicate ids are caught: they are what every op refers to', () => {
  const result = validateDocument({
    nodes: [
      { id: 'a', type: 'heading', props: { text: 'x' } },
      { id: 'a', type: 'heading', props: { text: 'y' } },
    ],
  });
  assert.match(result.message, /duplicate node id/);
});

test('a column outside a row is rejected wherever it appears', () => {
  const result = validateDocument({
    nodes: [{ id: 's', type: 'section', props: {}, children: [{ id: 'c', type: 'column', props: {}, children: [] }] }],
  });
  assert.match(result.message, /cannot go inside a section/);
});

test('props are validated against the node schema', () => {
  const result = validateDocument({
    nodes: [{ id: 'c', type: 'section', props: { width: 'enormous' }, children: [] }],
  });
  assert.match(result.message, /must be one of boxed, wide, full/);
});

/* ---------------------------------------------------------------- tokens */

test('tokens compile to custom properties, and a partial set still works', () => {
  const css = compileTokens(tokens);
  assert.match(css, /--accent:/);
  assert.match(compileTokens({ colors: { accent: '#ff0000' } }), /--accent:\s*#ff0000/);
});

test('a scoped token set only overrides what it names', () => {
  const { css, unknown } = compileTokenScope('brand', { colors: { accent: '#0f0' }, nope: 1 }, tokens);
  assert.match(css, /\[data-bz-tokens="brand"\]/);
  assert.ok(unknown.includes('nope'));
});

/* ----------------------------------------------------------------- forms */

test('a form renders its fields with the tagging attributes analytics needs', () => {
  const html = renderForm(CTX.forms.contact, CTX);
  assert.match(html, /data-bz-el="form"/);
  assert.match(html, /name="name"/);
});

test('a hidden field is still in the payload, marked with where its value comes from', () => {
  const html = renderForm(
    {
      id: 'lead',
      name: 'Lead',
      status: 'live',
      fields: [
        { id: 'email', type: 'email', label: 'Email', required: true },
        { id: 'src', type: 'single_line', label: 'Source', hidden: true, valueSource: 'query', queryParam: 'promo' },
        { id: 'team', type: 'single_line', label: 'Team', hidden: true, defaultValue: 'fleet' },
      ],
    },
    CTX,
  );
  // Never a visible control, and never a label — but it is an input, so it posts.
  assert.match(html, /<input type="hidden"[^>]*name="src"[^>]*data-bz-source="query"[^>]*data-bz-param="promo"/);
  assert.equal(/<label[^>]*for="src"/.test(html), false);
  // A static hidden field carries its value; a captured one ships empty, because
  // a static build cannot know which page the visitor will arrive on.
  assert.match(html, /<input type="hidden"[^>]*name="team"[^>]*value="fleet"/);
  assert.equal(/name="src"[^>]*value=/.test(html), false);
});

test('a paired field is half width, and an unpaired one still fills the row', () => {
  const html = renderForm(
    {
      id: 'names',
      name: 'Names',
      status: 'live',
      fields: [
        { id: 'first', type: 'first_name', label: 'First', width: 'half' },
        { id: 'last', type: 'last_name', label: 'Last', width: 'half' },
        { id: 'email', type: 'email', label: 'Email' },
      ],
    },
    CTX,
  );
  assert.equal((html.match(/class="bz-field bz-field--half"/g) ?? []).length, 2);
  assert.match(html, /class="bz-field"[^>]*data-bz-field="email"/);
});

test('the page bakes in the unconditional confirmation, not the first one', () => {
  const form = {
    id: 'quote',
    name: 'Quote',
    status: 'live',
    successMessage: 'Old copy',
    confirmations: [
      { id: 'fleet', name: 'Fleet', rules: [{ fieldId: 'size', operator: 'is', value: 'fleet' }], type: 'message', message: 'A fleet specialist will call.' },
      { id: 'default', name: 'Default', rules: [], type: 'message', message: 'Thanks — we will be in touch.' },
    ],
    fields: [{ id: 'size', type: 'dropdown', label: 'Size', options: [{ label: 'fleet' }] }],
  };
  const html = renderForm(form, CTX);
  // The conditional entry is the server's to choose; the page can only show the
  // one that matches an unanswered form.
  assert.match(html, /data-bz-success="Thanks — we will be in touch\."/);
  assert.equal(/A fleet specialist/.test(html), false);
  assert.equal(defaultConfirmation(form).id, 'default');
});

test('a confirmation that redirects becomes the form\'s baked-in redirect', () => {
  const html = renderForm(
    {
      id: 'rsvp',
      name: 'RSVP',
      status: 'live',
      confirmations: [{ id: 'd', name: 'Default', rules: [], type: 'redirect', redirectUrl: '/thank-you' }],
      fields: [{ id: 'n', type: 'full_name', label: 'Name' }],
    },
    CTX,
  );
  assert.match(html, /data-bz-redirect="\/thank-you"/);
});

test('a form with no product context carries no spec bag', () => {
  const form = { id: 'f', name: 'F', status: 'live', pdpContext: true, fields: [{ id: 'n', type: 'full_name', label: 'Name' }] };
  assert.equal(/data-bz-spec/.test(renderForm(form, CTX)), false);
  // The surface that knows the listing supplies it; the renderer never invents one.
  const withProduct = renderForm(form, { ...CTX, productContext: { location: 'Chicago', type: 'Trucks' } });
  assert.deepEqual(JSON.parse(withProduct.match(/data-bz-spec="([^"]*)"/)[1].replace(/&quot;/g, '"')), {
    'spec:location': 'Chicago',
    'spec:type': 'Trucks',
  });
});

/* --------------------------------------------------------- shared sections */

const SHARED_CTX = {
  ...CTX,
  sections: {
    'cta-band': {
      id: 'cta-band',
      name: 'CTA band',
      nodes: [
        {
          id: 'sec',
          type: 'section',
          props: { background: 'accent' },
          children: [{ id: 'h', type: 'heading', props: { text: 'Talk to us' } }],
        },
      ],
    },
  },
};

test('a shared section expands to its own tree where it sits', () => {
  const html = renderDocument(
    { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'cta-band' } }] },
    SHARED_CTX,
  );
  // The real markup, not a reference the visitor has to resolve.
  assert.match(html, /data-bz-section="cta-band"/);
  assert.match(html, /bz-section-cta-band/, 'scoped CSS has a class to hang on');
  assert.match(html, /bz-section--bg-accent/);
  assert.match(html, /Talk to us/);
});

test('the same tree placed directly and through a shared section render alike', () => {
  const direct = renderDocument({ nodes: SHARED_CTX.sections['cta-band'].nodes }, SHARED_CTX);
  const shared = renderDocument(
    { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'cta-band' } }] },
    SHARED_CTX,
  );
  // Reuse must not restyle: the wrapper is the only difference.
  assert.ok(shared.includes(direct), 'the expansion must be the same markup, wrapped');
});

test('a shared section goes at the top level and nowhere else', () => {
  assert.equal(accepts(null, 'sharedSection'), true);
  // Its tree usually holds sections, which cannot sit in a column — so rather
  // than validate against contents that can change later, placement is fixed.
  assert.equal(accepts('column', 'sharedSection'), false);
  assert.equal(accepts('section', 'sharedSection'), false);
  assert.equal(accepts('row', 'sharedSection'), false);
  // It holds nothing of its own: it is edited in one place, not in the page.
  assert.equal(accepts('sharedSection', 'heading'), false);
  assert.equal(accepts('sharedSection', 'row'), false);
});

test('a missing shared section is visible in the editor and absent from the page', () => {
  const doc = { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'gone' } }] };

  const warnings = [];
  const published = renderDocument(doc, { ...SHARED_CTX, warn: (m) => warnings.push(m) });
  assert.equal(published, '', 'a visitor must not see a hole');
  assert.match(warnings.join(' '), /"gone"/);

  const editing = renderDocument(doc, { ...SHARED_CTX, editing: true });
  assert.match(editing, /bz-sharedsection--missing/);
  assert.match(editing, /no longer exists/);
});

test('a shared section that contains itself is cut, not overflowed', () => {
  const warnings = [];
  const html = renderDocument(
    { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'loop' } }] },
    {
      ...CTX,
      warn: (m) => warnings.push(m),
      sections: {
        loop: {
          id: 'loop',
          nodes: [
            {
              id: 'sec',
              type: 'section',
              children: [{ id: 'h', type: 'heading', props: { text: 'Once' } }],
            },
            { id: 'again', type: 'sharedSection', props: { sectionId: 'loop' } },
          ],
        },
      },
    },
  );
  // Rendered once, then stopped — and said so.
  assert.equal(html.match(/Once/g).length, 1);
  assert.match(warnings.join(' '), /contains itself/);
});

test("the editor never sees the expansion as part of the page's own tree", () => {
  const doc = { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'cta-band' } }] };

  const editing = renderDocument(doc, { ...SHARED_CTX, editing: true });
  // The canvas matches a block on `data-bz-type`, so dropping it is what stops a
  // save copying the expansion into the page.
  assert.doesNotMatch(editing, /data-bz-type="section"/);
  assert.match(editing, /data-bz-opaque="1"/);
  // `data-bz-node` survives, or the component's own `[data-bz-node="…"]` rules
  // apply in preview and on the published page but not on the canvas — the
  // component would draw itself unstyled in the one place it is edited.
  assert.ok(
    editing.match(/data-bz-node/g).length > 1,
    'the expansion keeps the hooks its stylesheet is written against',
  );

  // Published, the attributes stay: nothing is reading the page back there.
  const published = renderDocument(doc, SHARED_CTX);
  assert.match(published, /data-bz-type="section"/);
  assert.doesNotMatch(published, /data-bz-opaque/);
});

/* --------------------------------------------------- component placeholders */

/**
 * A component that renders the same content everywhere it is placed is reusable
 * in name only. These pin the three pieces that make it genuinely reusable:
 * declared props, `{{key}}` bindings in the tree, and a node that repeats over a
 * list. Between them they are what lets one carousel definition serve a page with
 * four logos and a page with twelve.
 */
const LOGOS = {
  id: 'logos',
  name: 'Logo carousel',
  props: [
    { key: 'heading', type: 'text', label: 'Heading', default: 'Brands we carry' },
    {
      key: 'logos',
      type: 'list',
      label: 'Logos',
      fields: [
        { key: 'image', type: 'image', label: 'Logo' },
        { key: 'name', type: 'text', label: 'Name' },
      ],
    },
  ],
  nodes: [
    {
      id: 'sec',
      type: 'section',
      props: { behaviour: 'carousel' },
      children: [
        { id: 'title', type: 'heading', props: { text: '{{heading}}' } },
        {
          id: 'rail',
          type: 'row',
          props: { part: 'track' },
          children: [
            {
              id: 'slide',
              type: 'column',
              props: { span: 3, part: 'slide', repeat: 'logos' },
              children: [{ id: 'pic', type: 'image', props: { image: '{{image}}', alt: '{{name}}' } }],
            },
          ],
        },
      ],
    },
  ],
};

const LOGO_CTX = { ...CTX, sections: { logos: LOGOS } };

const place = (values, ctx = LOGO_CTX) =>
  renderDocument(
    { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'logos', values } }] },
    ctx,
  );

test('a placement supplies its own content, and omissions fall back to defaults', () => {
  const html = place({ heading: 'Our partners' });
  assert.match(html, /Our partners/);
  assert.doesNotMatch(html, /Brands we carry/);
  // A binding must never reach the page as its own source text.
  assert.doesNotMatch(html, /\{\{/);

  assert.match(place({}), /Brands we carry/, 'no value given means the declared default');
});

test('two placements of one component do not see each other content', () => {
  const first = place({ heading: 'First' });
  const second = place({ heading: 'Second' });
  assert.match(first, /First/);
  assert.doesNotMatch(first, /Second/);
  assert.match(second, /Second/);
  assert.doesNotMatch(second, /First/);
});

test('a node bound to a list repeats once per item', () => {
  const html = place({
    logos: [
      { image: { src: '/a.png', alt: 'A' }, name: 'Alpha' },
      { image: { src: '/b.png', alt: 'B' }, name: 'Beta' },
      { image: { src: '/c.png', alt: 'C' }, name: 'Gamma' },
    ],
  });
  assert.equal(html.match(/bz-col/g).length, 3, 'three logos, three slides');
  assert.match(html, /\/a\.png/);
  assert.match(html, /\/c\.png/);
  // Ids stay unique or the canvas would treat two slides as the same slide.
  assert.doesNotMatch(html, /data-bz-node="slide"/);
  assert.match(html, /data-bz-node="slide-1"/);
  assert.match(html, /data-bz-node="slide-3"/);
});

test('an image prop bound whole receives the object, not its string form', () => {
  const html = place({ logos: [{ image: { src: '/logo.svg', alt: 'ACME' }, name: 'ACME' }] });
  // The bug this exists to prevent: `src="[object Object]"`, or `src=""`.
  assert.match(html, /src="\/logo\.svg"/);
  assert.doesNotMatch(html, /object Object/);
  assert.doesNotMatch(html, /src=""/);
});

test('a binding inside a sentence interpolates rather than replacing it', () => {
  const nodes = bindTree(
    [{ id: 'p', type: 'paragraph', props: { text: 'Trusted by {{count}} dealers since {{year}}.' } }],
    { count: 40, year: '1998' },
  );
  assert.equal(nodes[0].props.text, 'Trusted by 40 dealers since 1998.');
});

test("a dealer's content is data, not a template that gets evaluated again", () => {
  // Someone writing "{{ }}" in a heading means those characters. Re-scanning a
  // supplied value would make dealer content executable and could recurse.
  const html = place({ heading: 'Braces {{heading}} stay put' });
  assert.match(html, /Braces \{\{heading\}\} stay put/);
});

test('an empty list renders nothing published, and one placeholder in the editor', () => {
  assert.doesNotMatch(place({ logos: [] }), /bz-col/, 'a visitor must not see a phantom slide');
  const editing = place({ logos: [] }, { ...LOGO_CTX, editing: true });
  assert.match(editing, /bz-col/, 'a repeat that vanishes looks like a bug to whoever built it');
});

test('a component with no props declared behaves exactly as it did before', () => {
  const html = renderDocument(
    { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'cta-band' } }] },
    SHARED_CTX,
  );
  assert.match(html, /Talk to us/);
});

test('bindingsUsed finds every prop a tree depends on', () => {
  const used = bindingsUsed(LOGOS.nodes);
  assert.deepEqual([...used].sort(), ['heading', 'image', 'logos', 'name']);
});

test('stale values for props the component dropped are not fed to the tree', () => {
  const values = componentValues(parseComponentProps(LOGOS.props), {
    heading: 'Kept',
    removedLongAgo: 'Should not survive',
  });
  assert.deepEqual(Object.keys(values).sort(), ['heading', 'logos']);
});

/* ------------------------------------------- a designed list over live data */

/**
 * The trade every site here had been making: a `widget` node is live but draws
 * the platform's card, and a typed list draws the dealer's card over data that
 * goes stale. A list prop pointed at a data source is both.
 */
const ROOFTOPS = {
  id: 'rooftops',
  props: [
    {
      key: 'spots',
      type: 'list',
      label: 'Locations',
      fields: [
        { key: 'city', type: 'text' },
        { key: 'region', type: 'text' },
        { key: 'phone', type: 'text' },
      ],
    },
  ],
  nodes: [
    {
      id: 'grid',
      type: 'section',
      children: [
        {
          id: 'row',
          type: 'row',
          children: [
            {
              id: 'card',
              type: 'column',
              props: { span: 4, repeat: 'spots' },
              children: [{ id: 'name', type: 'heading', props: { text: '{{city}}, {{region}}' } }],
            },
          ],
        },
      ],
    },
  ],
};

const ROOFTOP_CTX = { ...CTX, sections: { rooftops: ROOFTOPS } };

const placeRooftops = (values, data, ctx = ROOFTOP_CTX) =>
  renderDocument(
    { nodes: [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'rooftops', values, data } }] },
    ctx,
  );

const LIVE = [
  { slug: 'ogden', city: 'Ogden', region: 'UT', phone: '801-555-0100' },
  { slug: 'provo', city: 'Provo', region: 'UT', phone: '801-555-0200' },
];

test('a list prop pointed at a data source draws the design once per live row', () => {
  const html = placeRooftops({ spots: { source: 'locations' } }, { spots: LIVE });
  assert.match(html, /Ogden, UT/);
  assert.match(html, /Provo, UT/);
  assert.equal(html.match(/bz-col/g).length, 2, 'two rooftops, two cards');
  // The design is still the dealer's — the platform's own card markup is absent.
  assert.doesNotMatch(html, /bz-loclist/);
});

test('a source with nothing baked publishes no rows, and shows the shape in the editor', () => {
  // Inventing rows would put fictional addresses in the served HTML.
  assert.doesNotMatch(placeRooftops({ spots: { source: 'locations' } }, null), /bz-col/);
  const editing = placeRooftops({ spots: { source: 'locations' } }, null, { ...ROOFTOP_CTX, editing: true });
  assert.match(editing, /bz-col/, 'a band that vanishes on the canvas reads as broken');
});

/* ----------------------------------------------- a list inside a live row */

/**
 * What "the design should be flexible" comes down to for opening hours: a
 * rooftop has departments and a department has a week. The resolver used to
 * join that into one string, because a list field could not itself be a list,
 * so no component could declare the shape even if the data arrived — and the
 * only thing that could draw an hours table was the platform's own widget,
 * which has no hours table. Both halves are lifted; this is the proof.
 */
const SCHEDULE = {
  id: 'schedule',
  props: [
    {
      key: 'spots',
      type: 'list',
      label: 'Locations',
      fields: [
        { key: 'name', type: 'text' },
        {
          key: 'hoursRows',
          type: 'list',
          label: 'Hours by department',
          fields: [
            { key: 'department', type: 'text' },
            {
              key: 'days',
              type: 'list',
              label: 'Days',
              fields: [
                { key: 'day', type: 'text' },
                { key: 'hours', type: 'text' },
              ],
            },
          ],
        },
      ],
    },
  ],
  nodes: [
    {
      id: 'band',
      type: 'section',
      children: [
        {
          id: 'row',
          type: 'row',
          children: [
            {
              id: 'card',
              type: 'column',
              props: { span: 6, repeat: 'spots' },
              children: [
                { id: 'who', type: 'heading', props: { text: '{{name}}' } },
                {
                  id: 'dept',
                  type: 'row',
                  props: { repeat: 'hoursRows' },
                  children: [
                    {
                      id: 'week',
                      type: 'column',
                      props: { span: 12, repeat: 'days' },
                      // `{{department}}` belongs to the row above this one. A
                      // binding resolves against the innermost scope that has
                      // the key, so the day rows can still name their own
                      // department without it being copied onto every day.
                      children: [
                        { id: 'line', type: 'text', props: { text: '{{department}} {{day}} {{hours}}' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const SCHEDULE_LIVE = [
  {
    slug: 'ogden',
    name: 'Ogden',
    hoursRows: [
      {
        department: 'Sales',
        days: [
          { day: 'Mon', hours: '8 AM – 6 PM' },
          { day: 'Sun', hours: 'Closed' },
        ],
      },
      { department: 'Service', days: [{ day: 'Mon', hours: '7 AM – 5 PM' }] },
    ],
  },
];

test('a list inside a live row repeats, and reaches the row it sits inside', () => {
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'ref',
          type: 'sharedSection',
          props: {
            sectionId: 'schedule',
            values: { spots: { source: 'locations' } },
            data: { spots: SCHEDULE_LIVE },
          },
        },
      ],
    },
    { ...CTX, sections: { schedule: SCHEDULE } },
  );
  assert.match(html, /Sales Mon 8 AM – 6 PM/);
  assert.match(html, /Sales Sun Closed/, 'a closed day is the answer the buyer came for');
  assert.match(html, /Service Mon 7 AM – 5 PM/);
  // Two departments, three days between them — not one row, and not six.
  assert.equal(html.match(/Mon|Sun/g).length, 3);
  // Ids stay unique through every level — the suffix accumulates one segment per
  // enclosing repeat, so a day is `-<rooftop>-<department>-<day>`. Without that
  // the canvas would treat Sales Monday and Service Monday as the same node.
  assert.match(html, /data-bz-node="line-1-1-1"/);
  assert.match(html, /data-bz-node="line-1-1-2"/);
  assert.match(html, /data-bz-node="line-1-2-1"/);
});

test('a list field may be a list, once, and no deeper', () => {
  const [spots] = parseComponentProps(SCHEDULE.props);
  const hours = spots.fields.find((f) => f.key === 'hoursRows');
  assert.equal(hours.type, 'list', 'a department list inside a rooftop row');
  assert.equal(hours.fields.find((f) => f.key === 'days').type, 'list');

  // Two lists below the row is the deepest fact the sources carry and the
  // deepest form a dealer can fill in by hand, so a third is flattened to text
  // rather than accepted.
  const [deep] = parseComponentProps([
    {
      key: 'a',
      type: 'list',
      fields: [
        {
          key: 'b',
          type: 'list',
          fields: [
            {
              key: 'c',
              type: 'list',
              fields: [{ key: 'd', type: 'list', fields: [{ key: 'e', type: 'text' }] }],
            },
          ],
        },
      ],
    },
  ]);
  assert.equal(deep.fields[0].type, 'list', 'one below the row');
  assert.equal(deep.fields[0].fields[0].type, 'list', 'two below the row');
  assert.equal(deep.fields[0].fields[0].fields[0].type, 'text', 'three is too deep');
});

test('the canvas sample of a nested source shows repetition at both levels', () => {
  const [row] = resolveDataBinding({ source: 'locations' }, null, { sample: true, sampleRows: 1 });
  assert.ok(Array.isArray(row.hoursRows), 'an hours table has nothing to draw against a string');
  assert.ok(Array.isArray(row.hoursRows[0].days));
  assert.ok(row.hoursRows[0].days.length > 1, 'one sample day looks like a scalar');
  assert.equal(typeof row.group, 'string', 'a rooftop knows which group it is in');
});

test('an overlay adds the editorial fields the platform does not hold', () => {
  const rows = resolveDataBinding(
    { source: 'locations', overlay: [{ slug: 'provo', badge: 'New' }] },
    LIVE,
  );
  assert.equal(rows[1].badge, 'New');
  assert.equal(rows[1].city, 'Provo', 'live fields survive the merge');
  assert.equal(rows[0].badge, undefined, 'an overlay row only touches the row it names');
});

test('an overlay cannot restate a field the source owns', () => {
  // Typing an address here would win over Admin and go stale with nothing to
  // say so — the exact failure a data source exists to end.
  const rows = resolveDataBinding(
    { source: 'locations', overlay: [{ slug: 'ogden', city: 'Somewhere else', badge: 'Flagship' }] },
    LIVE,
  );
  assert.equal(rows[0].city, 'Ogden');
  assert.equal(rows[0].badge, 'Flagship');
});

test('an unknown source is empty rather than fatal, and only a list can carry one', () => {
  assert.deepEqual(resolveDataBinding({ source: 'nonesuch' }, LIVE), []);
  assert.equal(dataSource('nonesuch'), null);
  assert.ok(isDataBinding({ source: 'locations' }));
  assert.ok(!isDataBinding([{ city: 'Ogden' }]), 'typed rows are not a binding');

  // A text prop naming a source is a mistake the validator reports; the renderer
  // must not silently turn the object into "[object Object]" on the page.
  const props = parseComponentProps([{ key: 'heading', type: 'text' }]);
  const values = resolveValues(props, { heading: { source: 'locations' } }, null);
  assert.deepEqual(values.heading, { source: 'locations' });
});

test('the editor keeps the binding, so saving does not freeze live rows into the file', () => {
  const props = parseComponentProps(ROOFTOPS.props);
  const stored = componentValues(props, { spots: { source: 'locations' } });
  assert.ok(isDataBinding(stored.spots), 'what the page said is what the page keeps');
  const drawn = resolveValues(props, { spots: { source: 'locations' } }, { spots: LIVE });
  assert.equal(drawn.spots.length, 2, 'what is drawn is the resolved rows');
});

/**
 * The canvas renders node by node, so it cannot use `bindTree`. Without this a
 * slide showed the literal text `{{name}}`, which reads as a broken component
 * rather than as a decision the placing page will make.
 */
test('a preview resolves a binding against the sample values', () => {
  const props = parseComponentProps(LOGOS.props);
  const values = componentSampleValues(props);
  const shown = previewProps({ text: '{{heading}}', level: 2 }, values);
  assert.equal(shown.text, values.heading);
  assert.equal(shown.level, 2, 'an unbound prop is untouched');
});

test('a preview inside a repeat resolves the item, not the outer scope', () => {
  const props = parseComponentProps(LOGOS.props);
  const values = componentSampleValues(props);
  const item = values.logos[0];
  const shown = previewProps({ image: '{{image}}', alt: '{{name}}' }, values, item);
  assert.deepEqual(shown.image, item.image, 'an image resolves whole, not as a string');
  assert.equal(shown.alt, item.name);
});

test('sample logos are distinct, so a carousel preview is not three copies of one box', () => {
  const values = componentSampleValues(parseComponentProps(LOGOS.props));
  const srcs = values.logos.map((row) => row.image.src);
  assert.equal(new Set(srcs).size, srcs.length);
  assert.match(values.logos[0].image.src, /^data:image\/svg\+xml,/);
});

test('a preview drops repeat, which is an instruction rather than a prop', () => {
  const shown = previewProps({ repeat: 'logos', span: 3 }, { logos: [] });
  assert.equal('repeat' in shown, false);
  assert.equal(shown.span, 3);
});

test('a preview leaves a binding nothing declares empty rather than literal', () => {
  const shown = previewProps({ text: '{{nobodyDeclaredThis}}' }, {});
  assert.equal(shown.text, '');
});

test('an image with a url is clickable, and one without gains no anchor', () => {
  const linked = renderDocument(
    { nodes: [{ id: 'logo', type: 'image', props: { image: { src: '/kw.png', alt: 'KW' }, url: '/store' } }] },
    CTX,
  );
  assert.match(linked, /<a href="\/store"[^>]*><img/);
  assert.match(linked, /data-bz-el="link"/, 'analytics has to see the click');

  const plain = renderDocument(
    { nodes: [{ id: 'logo', type: 'image', props: { image: { src: '/kw.png', alt: 'KW' } } }] },
    CTX,
  );
  assert.doesNotMatch(plain, /<a /);
});

/* ------------------------------------------------------------------ video */

/**
 * One `src` field carries both a media-library file and an embed, so everything
 * here turns on the renderer classifying the URL correctly. Getting it wrong is
 * silent in both directions: a YouTube link in `<video>` is a black rectangle,
 * and a file in an `<iframe>` is a download prompt.
 */
const videoDoc = (props) => renderDocument({ nodes: [{ id: 'v', type: 'video', props }] }, CTX);

test('a media-library file renders as a real video element', () => {
  const html = videoDoc({ video: { src: '/media/walkaround.mp4', poster: '/media/truck.jpg' } });
  assert.match(html, /<video/);
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /src="\/media\/walkaround\.mp4"/);
  assert.match(html, /poster="\/media\/truck\.jpg"/);
  // Controls are the default: a clip a visitor cannot pause is a dark pattern.
  assert.match(html, /controls/);
  assert.match(html, /playsinline/);
});

test('YouTube and Vimeo links become embeds built from the id, never the supplied URL', () => {
  for (const src of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  ]) {
    const html = videoDoc({ video: { src } });
    assert.match(html, /<iframe/, src);
    assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?rel=0"/, src);
  }

  const vimeo = videoDoc({ video: { src: 'https://vimeo.com/123456789' } });
  assert.match(vimeo, /src="https:\/\/player\.vimeo\.com\/video\/123456789\?dnt=1"/);
});

test('an unrecognised URL is treated as a file, not framed', () => {
  // The security property: only a provider we parsed an id out of reaches an
  // iframe. Otherwise any https string would be a way into a dealer's page.
  const html = videoDoc({ video: { src: 'https://evil.example/page' } });
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /<video/);
});

test('autoplay forces muted, because no browser will autoplay sound', () => {
  const html = videoDoc({ video: { src: '/clip.mp4' }, autoplay: true, controls: false, loop: true });
  assert.match(html, /autoplay/);
  assert.match(html, /muted/);
  assert.match(html, /loop/);
  assert.doesNotMatch(html, /controls/);
});

test('a section background video keeps a poster the canvas and reduced motion can show', () => {
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'hero',
          type: 'section',
          props: { backgroundVideo: { src: '/bg.mp4', poster: '/bg.jpg' }, background: 'ink' },
          children: [{ id: 'h', type: 'heading', props: { text: 'Trucks' } }],
        },
      ],
    },
    CTX,
  );
  assert.match(html, /class="[^"]*bz-section--bgvideo/);
  assert.match(html, /<video[^>]*class="bz-section__bgvideo"/);
  // Always muted, looping and inert: it is decoration, not content.
  assert.match(html, /bz-section__bgvideo[^>]*muted/);
  assert.match(html, /bz-section__bgvideo[^>]*loop/);
  assert.match(html, /bz-section__bgvideo[^>]*aria-hidden="true"/);
  // The poster reaches CSS too, which is the only thing the editing canvas and a
  // reduced-motion visitor ever see. Quotes arrive HTML-escaped in the attribute.
  assert.match(html, /--bz-bgvideo-poster:url\(&quot;\/bg\.jpg&quot;\)/);
});

test('a poster cannot smuggle a second declaration into the style attribute', () => {
  // The browser un-escapes the attribute before CSS parses it, so `esc` alone
  // would let a quote close the url() and open a declaration of the author's
  // choosing — an outbound request from every page the section is on.
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'hero',
          type: 'section',
          props: {
            backgroundVideo: {
              src: '/bg.mp4',
              poster: '/bg.jpg"); background-image: url("https://tracker.example/p.gif',
            },
          },
          children: [],
        },
      ],
    },
    CTX,
  );
  // Read it the way the browser does: un-escape the attribute, then look at what
  // CSS is handed. The whole poster must still be one quoted url() token, with
  // the injected text trapped inside the string where it parses as characters.
  const style = html.match(/style="([^"]*)"/)[1].replace(/&quot;/g, '"');
  const value = style.match(/--bz-bgvideo-poster:(.*)$/)[1];
  assert.match(value, /^url\("[^"]*"\)$/, 'nothing escapes the url() token');
  assert.match(value, /%22/, 'the quote is encoded rather than passed through');
});

test('a video URL is refused as a background image rather than emitted', () => {
  // It reached the published page as `background-image: url(…mp4)`, which paints
  // nothing at all — the browser treats the container as a broken image. Dropping
  // it keeps the section's colour instead of silently blanking the band.
  const bg = (src) =>
    compileNodeStyles([{ id: 's', type: 'section', props: {}, styles: { base: { backgroundImage: src } } }]);

  assert.doesNotMatch(bg('/media/hero.mp4'), /background-image/);
  assert.doesNotMatch(bg('https://cdn.example/a.webm?v=2'), /background-image/);
  assert.match(bg('/media/hero.jpg'), /background-image/);
});

test('a locations-map snapshot paints addresses and a rooftop link', () => {
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'm',
          type: 'widget',
          props: {
            widget: 'locations-map',
            config: { showMap: false },
            snapshot: {
              locations: [
                {
                  name: 'Tampa',
                  href: '/locations/tampa',
                  streetAddress: '6020 E Adamo Dr',
                  city: 'Tampa',
                  region: 'FL',
                  postalCode: '33619',
                  phone: '(813) 521-8148',
                },
              ],
            },
          },
        },
      ],
    },
    CTX,
  );
  assert.match(html, /href="\/locations\/tampa"/);
  assert.match(html, /6020 E Adamo Dr, Tampa, FL 33619/);
  assert.match(html, /tel:8135218148/);
  assert.doesNotMatch(html, /data-bz-map/);
});

test('a locations-map snapshot with coordinates draws the map in the HTML', () => {
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'm',
          type: 'widget',
          props: {
            widget: 'locations-map',
            config: { showMap: true, mapProvider: 'openstreetmap' },
            snapshot: {
              locations: [
                { name: 'Tampa', latitude: 27.95, longitude: -82.45 },
              ],
            },
          },
        },
      ],
    },
    CTX,
  );
  assert.match(html, /data-bz-map/);
  assert.match(html, /openstreetmap\.org\/export\/embed/);
  assert.match(html, /27\.95/);
});

// The calibration anchors below are the corners of a 1256x528 Florida outline:
// Pensacola at the north-west and Miami at the south-east.
const FL_ANCHORS = [
  { lng: -87.63, lat: 30.99, x: 118, y: 86 },
  { lng: -80.14, lat: 25.13, x: 1181, y: 479 },
];

function pinmap(config, locations) {
  return renderDocument(
    {
      nodes: [
        {
          id: 'pm',
          type: 'widget',
          props: {
            widget: 'locations-pinmap',
            config: {
              basemap: { src: '/maps/florida.svg', alt: 'Florida', width: 1256, height: 528 },
              anchors: FL_ANCHORS,
              ...config,
            },
            snapshot: { locations },
          },
        },
      ],
    },
    CTX,
  );
}

test('the projection puts a rooftop where the artwork says it is', () => {
  const project = makeProjection(FL_ANCHORS);
  // Both anchors must land back on themselves, or the fit is not a fit.
  for (const a of FL_ANCHORS) {
    const { x, y } = project(a.lng, a.lat);
    assert.ok(Math.abs(x - a.x) < 0.001, `anchor x ${x} != ${a.x}`);
    assert.ok(Math.abs(y - a.y) < 0.001, `anchor y ${y} != ${a.y}`);
  }
  // Tampa, which is neither anchor, has to land inside the outline and in the
  // right half of it — the check that catches a projection that happens to fit
  // its own two points and nothing else.
  const tampa = project(-82.45, 27.95);
  assert.ok(tampa.x > 850 && tampa.x < 1050, `Tampa x ${tampa.x}`);
  assert.ok(tampa.y > 230 && tampa.y < 330, `Tampa y ${tampa.y}`);
});

test('latitude is projected through Mercator, not linearly', () => {
  // The give-away for a linear fit: with anchors 5.86 degrees apart, the midpoint
  // latitude does not sit at the midpoint of the vertical span. Getting this wrong
  // is a map that looks plausible and is wrong by tens of pixels in the middle.
  const project = makeProjection(FL_ANCHORS);
  const mid = project(-83.885, (30.99 + 25.13) / 2);
  const linear = (86 + 479) / 2;
  assert.ok(Math.abs(mid.y - linear) > 1, `Mercator midpoint ${mid.y} is the linear one`);
});

test('two anchors that cannot describe a projection yield none', () => {
  assert.equal(makeProjection([]), null);
  assert.equal(makeProjection([FL_ANCHORS[0]]), null);
  // Same longitude: no horizontal scale to derive.
  assert.equal(
    makeProjection([FL_ANCHORS[0], { ...FL_ANCHORS[1], lng: FL_ANCHORS[0].lng }]),
    null,
  );
  // Same latitude: no vertical scale.
  assert.equal(
    makeProjection([FL_ANCHORS[0], { ...FL_ANCHORS[1], lat: FL_ANCHORS[0].lat }]),
    null,
  );
});

test('a pinmap puts its pins in the served HTML, positioned and filterable', () => {
  const html = pinmap({}, [
    {
      name: 'Tampa',
      slug: 'tampa',
      href: '/locations/tampa',
      latitude: 27.95,
      longitude: -82.45,
      brandKeys: 'international ic-bus',
      perkKeys: 'curbside_pickup',
    },
  ]);
  // In the markup, not added by a script: this is what makes it draw on the Design
  // canvas, in the first paint, and with JavaScript off.
  assert.match(html, /data-bz-pin="tampa"/);
  assert.match(html, /left:\d+\.\d+%;top:\d+\.\d+%/);
  assert.match(html, /data-brand="international ic-bus"/);
  assert.match(html, /data-perk="curbside_pickup"/);
  // `part: "item"`, so the page's own filter behaviour reaches the pins with the
  // same chips that filter the cards.
  assert.match(html, /data-bz-part="item"/);
  // Marked rather than hidden, so a chip dims the map instead of emptying it.
  assert.match(html, /data-bz-reveal="dim"/);
  assert.match(html, /\/maps\/florida\.svg/);
});

test('a rooftop with no coordinates is left off the map, not dropped at 0,0', () => {
  const warnings = [];
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'pm',
          type: 'widget',
          props: {
            widget: 'locations-pinmap',
            config: {
              basemap: { src: '/maps/florida.svg', width: 1256, height: 528 },
              anchors: FL_ANCHORS,
            },
            snapshot: {
              locations: [
                { name: 'Tampa', slug: 'tampa', latitude: 27.95, longitude: -82.45 },
                { name: 'Nowhere', slug: 'nowhere' },
              ],
            },
          },
        },
      ],
    },
    { ...CTX, warn: (m) => warnings.push(m) },
  );
  assert.match(html, /data-bz-pin="tampa"/);
  assert.doesNotMatch(html, /data-bz-pin="nowhere"/);
  // Silence here reads as "the map is broken". Say which rooftop and where to fix it.
  assert.ok(
    warnings.some((w) => /1 rooftop\(s\) have no coordinates/.test(w)),
    warnings.join(' | '),
  );
});

test('a pinmap with no artwork is a box a dealer can click, not a blank gap', () => {
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'pm',
          type: 'widget',
          props: { widget: 'locations-pinmap', config: {} },
        },
      ],
    },
    CTX,
  );
  assert.match(html, /bz-pinmap__empty/);
  assert.match(html, /Upload the map artwork/);
});

test('a pinmap with no calibration draws the art and no pins', () => {
  const warnings = [];
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'pm',
          type: 'widget',
          props: {
            widget: 'locations-pinmap',
            config: { basemap: { src: '/maps/florida.svg', width: 1256, height: 528 } },
            snapshot: { locations: [{ name: 'Tampa', slug: 'tampa', latitude: 27.95, longitude: -82.45 }] },
          },
        },
      ],
    },
    { ...CTX, warn: (m) => warnings.push(m) },
  );
  assert.match(html, /\/maps\/florida\.svg/);
  assert.doesNotMatch(html, /data-bz-pin=/);
  assert.ok(warnings.some((w) => /two calibration points/.test(w)), warnings.join(' | '));
});

test('a location photo is the rooftop\'s own, and nothing when there is none', () => {
  const withPhoto = renderDocument(
    {
      nodes: [
        {
          id: 'p',
          type: 'widget',
          props: {
            widget: 'location-photo',
            config: {},
            snapshot: { photo: { src: '/media/tampa.jpg', alt: 'The Tampa branch' } },
          },
        },
      ],
    },
    CTX,
  );
  assert.match(withPhoto, /\/media\/tampa\.jpg/);
  assert.match(withPhoto, /The Tampa branch/);

  const without = renderDocument(
    {
      nodes: [
        { id: 'p', type: 'widget', props: { widget: 'location-photo', config: {}, snapshot: { photo: { src: '', alt: '' } } } },
      ],
    },
    CTX,
  );
  // Never a generated street map standing in for a missing photograph, and no
  // placeholder copy either — an empty slot is the honest state.
  assert.match(without, /bz-locphoto__empty/);
  assert.doesNotMatch(without, /tile|openstreetmap|data-bz-map\b/);
});

test('the static map provider draws tiles, not an iframe', () => {
  // An iframe inside the dashboard's Preview is sandboxed without allow-same-origin
  // and the provider serves its own blocked page there. Tiles are images, so they
  // draw in Preview, on the canvas and with JavaScript off.
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'm',
          type: 'widget',
          props: {
            widget: 'locations-map',
            config: { showMap: true, mapProvider: 'static' },
            snapshot: { locations: [{ name: 'Tampa', latitude: 27.95, longitude: -82.45 }] },
          },
        },
      ],
    },
    CTX,
  );
  assert.match(html, /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/);
  assert.match(html, /OpenStreetMap/);
  assert.doesNotMatch(html, /<iframe/);
});

test('a map with no provider chosen draws tiles, not an iframe', () => {
  // The default has to be the one that survives a sandboxed Preview frame and a
  // canvas that runs no site JS. An iframe default meant every dealer who never
  // opened the setting saw the embed's "access blocked" page instead of a map.
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'm',
          type: 'widget',
          props: {
            widget: 'locations-map',
            config: { showMap: true },
            snapshot: { locations: [{ name: 'Tampa', latitude: 27.95, longitude: -82.45 }] },
          },
        },
      ],
    },
    CTX,
  );
  assert.match(html, /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/);
  assert.doesNotMatch(html, /<iframe/);
});

test('the google map provider draws its embed', () => {
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'm',
          type: 'widget',
          props: {
            widget: 'locations-map',
            config: { showMap: true, mapProvider: 'google' },
            snapshot: { locations: [{ name: 'Tampa', latitude: 27.95, longitude: -82.45 }] },
          },
        },
      ],
    },
    CTX,
  );
  assert.match(html, /maps\.google\.com\/maps\?q=/);
  assert.doesNotMatch(html, /openstreetmap\.org\/export/);
});

test('a dealer-data list marks itself as a carousel track and slides', () => {
  // These items have no node, so an author cannot mark them. Without the parts
  // the carousel behaviour finds nothing and every such rail ends up carrying
  // hand-written arrow JavaScript the Design canvas never runs.
  const rail = (widget, snapshot) =>
    renderDocument(
      {
        nodes: [
          {
            id: 'band',
            type: 'section',
            props: { behaviour: 'carousel' },
            children: [
              {
                id: 'r',
                type: 'row',
                props: {},
                children: [
                  {
                    id: 'c',
                    type: 'column',
                    props: { span: 12 },
                    children: [{ id: 'w', type: 'widget', props: { widget, snapshot } }],
                  },
                ],
              },
            ],
          },
        ],
      },
      CTX,
    );

  const locations = rail('locations-map', {
    locations: [{ name: 'Tampa' }, { name: 'Sarasota' }],
  });
  assert.match(locations, /<section[^>]+data-bz-behavior="carousel"/);
  assert.match(locations, /<ul class="bz-loclist bz-bare" data-bz-part="track">/);
  assert.equal(locations.match(/<li class="bz-loc" data-bz-part="slide">/g)?.length, 2);

  const people = rail('staff', { staff: [{ name: 'Ada' }] });
  assert.match(people, /<ul class="bz-people bz-bare" data-bz-part="track">/);
  assert.match(people, /<li class="bz-person" data-bz-part="slide">/);

  const listings = rail('inventory-carousel', { listings: [{ title: 'A truck', slug: 'a' }] });
  assert.match(listings, /<ul class="bz-grid bz-grid--4 bz-bare" data-bz-part="track">/);
  assert.match(listings, /<li data-bz-part="slide">/);
});

test('hours renders one table per public department', () => {
  const html = renderDocument(
    {
      nodes: [
        {
          id: 'h',
          type: 'widget',
          props: {
            widget: 'hours',
            snapshot: {
              schedules: [
                { heading: 'Sales', hours: [{ day: 'Monday', hours: '07:00–19:00' }] },
                { heading: 'Service', hours: [{ day: 'Monday', hours: '07:00–19:00' }] },
              ],
            },
          },
        },
      ],
    },
    CTX,
  );
  assert.match(html, /<caption>Sales<\/caption>/);
  assert.match(html, /<caption>Service<\/caption>/);
});

test('a section with no background video gains no video element or class', () => {
  const html = renderDocument(
    { nodes: [{ id: 's', type: 'section', props: {}, children: [] }] },
    CTX,
  );
  assert.doesNotMatch(html, /bz-section--bgvideo/);
  assert.doesNotMatch(html, /<video/);
});

/* ------------------------------------------------------- document styles */

/**
 * Styling inside a designed component used to be lost on publish.
 *
 * A page holds a component as one `sharedSection` reference, so compiling the
 * page's own tree emitted nothing for the component's nodes — they exist only
 * after expansion. Everything spaced or coloured in the component editor looked
 * right there and rendered unstyled on every page that placed it.
 */
const STYLED = {
  id: 'styled',
  name: 'Styled component',
  props: [{ key: 'logos', type: 'list', label: 'Logos', fields: [{ key: 'name', type: 'text', label: 'Name' }] }],
  nodes: [
    {
      id: 'band',
      type: 'section',
      styles: { base: { background: '#111' }, mobile: { paddingTop: 8 } },
      children: [
        {
          id: 'slide',
          type: 'column',
          props: { span: 3, repeat: 'logos' },
          styles: { base: { textAlign: 'center' } },
          children: [{ id: 'name', type: 'heading', props: { text: '{{name}}' } }],
        },
      ],
    },
  ],
};

const STYLED_CTX = { ...CTX, sections: { styled: STYLED, logos: LOGOS } };

test("a component's own overrides reach the page that places it", () => {
  const page = [{ id: 'ref', type: 'sharedSection', props: { sectionId: 'styled', values: { logos: [] } } }];
  const css = documentStyles([page], STYLED_CTX);
  assert.match(css, /\[data-bz-node="band"\]\[data-bz-node\]\{background:#111\}/);
  assert.match(css, /@media[^{]+\{\[data-bz-node="band"\]/, 'a breakpoint bucket survives the expansion');
});

test('every copy of a repeating node is styled, not just the first', () => {
  const page = [
    {
      id: 'ref',
      type: 'sharedSection',
      props: { sectionId: 'styled', values: { logos: [{ name: 'A' }, { name: 'B' }] } },
    },
  ];
  const css = documentStyles([page], STYLED_CTX);
  // Expansion suffixes ids, and the selector is an exact match — compiling the
  // unexpanded tree would name "slide", which is not in the rendered output.
  assert.match(css, /data-bz-node="slide-1"/);
  assert.match(css, /data-bz-node="slide-2"/);
  assert.doesNotMatch(css, /data-bz-node="slide"\]/);
});

test('two placements with different content are both styled', () => {
  const page = [
    { id: 'one', type: 'sharedSection', props: { sectionId: 'styled', values: { logos: [{ name: 'A' }] } } },
    {
      id: 'two',
      type: 'sharedSection',
      props: { sectionId: 'styled', values: { logos: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } },
    },
  ];
  const css = documentStyles([page], STYLED_CTX);
  assert.match(css, /data-bz-node="slide-3"/, "the longer placement's third slide needs styling too");
});

test('the page and its template are compiled together', () => {
  const css = documentStyles(
    [
      [{ id: 'head', type: 'section', styles: { base: { paddingTop: 4 } } }],
      [{ id: 'body', type: 'section', styles: { base: { paddingTop: 8 } } }],
    ],
    STYLED_CTX,
  );
  assert.match(css, /data-bz-node="head"/);
  assert.match(css, /data-bz-node="body"/);
});

test('a component that places itself is cut rather than followed forever', () => {
  const recursive = {
    id: 'loop',
    name: 'Loop',
    nodes: [
      {
        id: 'outer',
        type: 'section',
        styles: { base: { paddingTop: 4 } },
        children: [{ id: 'inner', type: 'sharedSection', props: { sectionId: 'loop' } }],
      },
    ],
  };
  const css = documentStyles([[{ id: 'ref', type: 'sharedSection', props: { sectionId: 'loop' } }]], {
    ...CTX,
    sections: { loop: recursive },
  });
  assert.match(css, /data-bz-node="outer"/);
});

test('a page collects the code of the components it places, and no others', () => {
  const withCode = {
    id: 'coded',
    name: 'Coded',
    css: '.coded{display:flex}',
    js: 'window.coded = 1;',
    nodes: [{ id: 'wrap', type: 'section' }],
  };
  const unplaced = { id: 'unplaced', name: 'Unplaced', css: '.unplaced{color:red}', nodes: [] };
  const out = componentCode([[{ id: 'ref', type: 'sharedSection', props: { sectionId: 'coded' } }]], {
    ...CTX,
    sections: { coded: withCode, unplaced },
  });
  assert.match(out.css, /\.coded/);
  assert.doesNotMatch(out.css, /\.unplaced/, 'a page that uses one component must not ship twelve');
  assert.deepEqual(
    out.scripts.map((s) => s.id),
    ['coded'],
  );
});

test('a component placed twice contributes its code once', () => {
  const twice = { id: 'twice', name: 'Twice', css: '.twice{gap:1px}', js: 'window.t = 1;', nodes: [] };
  const page = [
    { id: 'a', type: 'sharedSection', props: { sectionId: 'twice', values: { x: 1 } } },
    { id: 'b', type: 'sharedSection', props: { sectionId: 'twice', values: { x: 2 } } },
  ];
  const out = componentCode([page], { ...CTX, sections: { twice } });
  assert.equal(out.css.match(/\.twice/g).length, 1);
  assert.equal(out.scripts.length, 1);
});

test('a document with no components compiles exactly as compileNodeStyles did', () => {
  const nodes = [{ id: 'hero', type: 'section', styles: { base: { paddingTop: 12 } } }];
  const css = documentStyles([nodes], CTX);
  assert.match(css, /data-bz-node="hero"/);
  assert.equal(css, compileNodeStyles(nodes));
});

/* ------------------------------------------------------ widget previews */

/**
 * The editor's preview was empty for every widget, always, and silently.
 * `renderDocument` resolves a node's type through the registry, and a definition
 * being edited is not in it — so a new widget rendered nothing and a saved one
 * rendered its last committed version. These pin the preview to the definition in
 * front of the dealer.
 */
test('a preview renders the definition being edited, not the registered one', () => {
  clearCustomWidgets();
  const def = {
    id: 'promo-strip',
    label: 'Promo strip',
    props: [{ key: 'heading', type: 'text', label: 'Heading' }],
    html: '<div class="promo"><h3>{{heading}}</h3></div>',
    css: '.promo{display:flex}',
  };

  const out = renderWidgetPreview(def);
  assert.deepEqual(out.errors, []);
  assert.match(out.html, /class="promo"/);
  // Nothing was registered: an unregistered definition still previews.
  assert.equal(getBlock('promo-strip'), null);
  // The wrapper is load-bearing — the CSS is scoped to it.
  assert.match(out.css, /\.bz-block--promo-strip \.promo/);
  assert.match(out.html, /bz-block--promo-strip/);
});

test('a preview fills a repeating list, because an empty one shows nothing', () => {
  const def = {
    id: 'logo-wall',
    label: 'Logo wall',
    props: [{ key: 'logos', type: 'list', label: 'Logo', fields: [{ key: 'image', type: 'image', label: 'Logo' }] }],
    html: '<div class="wall">{{#each logos}}<span>{{img image}}</span>{{/each}}</div>',
  };

  // What a real placed instance starts with — deliberately empty.
  assert.deepEqual(widgetDefaultProps(def).logos, []);

  // What the preview shows instead, so the layout is judgeable.
  assert.equal(widgetPreviewProps(def).logos.length, 3);
  const out = renderWidgetPreview(def);
  assert.equal(out.html.match(/<img/g).length, 3);
  // No network and no uploaded asset needed for a placeholder.
  assert.match(out.html, /data:image\/svg\+xml/);
});

test('a preview keeps the behaviour wiring the published page relies on', () => {
  const out = renderWidgetPreview({
    id: 'quote-slider',
    label: 'Quote slider',
    props: [{ key: 'quotes', type: 'list', label: 'Quote', fields: [{ key: 'text', type: 'text', label: 'Quote' }] }],
    html:
      '<div data-bz-behavior="carousel" data-bz-behavior-options=\'{"label":"Quotes"}\'>' +
      '<div data-bz-part="track">{{#each quotes}}<blockquote data-bz-part="slide">{{text}}</blockquote>{{/each}}</div>' +
      '<button data-bz-part="prev">Prev</button><button data-bz-part="next">Next</button></div>',
  });
  // Behaviour is bound from these attributes at runtime, so a preview that
  // stripped them could not be made interactive later.
  assert.match(out.html, /data-bz-behavior="carousel"/);
  assert.equal(out.html.match(/data-bz-part="slide"/g).length, 3);
  assert.match(out.html, /data-bz-part="track"/);
});

test('a broken template previews as its error, never as a blank box', () => {
  const out = renderWidgetPreview({ id: 'bad', label: 'Bad', html: '<div data-bz-slot="main"></div>' });
  assert.equal(out.html, '');
  assert.ok(out.errors.length, 'the reason has to reach the dealer');
});

/* -------------------------------------------- behaviours on canvas nodes */

/**
 * The reason a carousel had to be hand-written as a custom widget: no node a
 * dealer could drag carried the attributes the client script binds from. These
 * pin the whole wiring for a logo carousel built entirely out of layout nodes.
 */
test('a tree of layout nodes carries a full carousel', () => {
  const html = renderDocument({
    nodes: [
      {
        id: 'logos',
        type: 'section',
        props: { behaviour: 'carousel', behaviourOptions: '{"label":"Our partners","perMove":2}' },
        children: [
          {
            id: 'rail',
            type: 'row',
            props: { part: 'track' },
            children: [
              { id: 'c1', type: 'column', props: { span: 3, part: 'slide' }, children: [] },
              { id: 'c2', type: 'column', props: { span: 3, part: 'slide' }, children: [] },
            ],
          },
        ],
      },
    ],
  });

  assert.match(html, /<section[^>]+data-bz-behavior="carousel"/);
  // Options reach the script as JSON on the attribute it reads.
  assert.match(html, /data-bz-behavior-options="[^"]*Our partners/);
  // The rail: blocks.css styles the scroll-snap strip off the attribute the
  // script sets on whatever is marked as the track.
  assert.match(html, /data-bz-part="track"/);
  assert.equal(html.match(/data-bz-part="slide"/g).length, 2);
});

test('a widget instance can be a behaviour part, so arrows are placeable', () => {
  const html = renderDocument({
    nodes: [
      {
        id: 's',
        type: 'section',
        props: { behaviour: 'carousel' },
        children: [
          {
            id: 'nav',
            type: 'row',
            children: [
              {
                id: 'col',
                type: 'column',
                props: { span: 12 },
                children: [{ id: 'n', type: 'buttons', props: { items: [{ label: 'Next', url: '#' }], part: 'next' } }],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.match(html, /data-bz-part="next"/);
});

test('an unknown behaviour or part is dropped with a warning, never emitted', () => {
  const warnings = [];
  const html = renderDocument(
    { nodes: [{ id: 'x', type: 'section', props: { behaviour: 'sparkle', part: 'wheel' } }] },
    { warn: m => warnings.push(m) },
  );
  assert.doesNotMatch(html, /data-bz-behavior|data-bz-part/);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Unknown behaviour "sparkle"/);
});

test('malformed behaviour options are dropped, not written into the attribute', () => {
  const warnings = [];
  const html = renderDocument(
    { nodes: [{ id: 'x', type: 'section', props: { behaviour: 'carousel', behaviourOptions: '{oops' } }] },
    { warn: m => warnings.push(m) },
  );
  // The behaviour still binds — losing its settings must not lose the behaviour.
  assert.match(html, /data-bz-behavior="carousel"/);
  assert.doesNotMatch(html, /data-bz-behavior-options/);
  assert.match(warnings[0], /not valid JSON/);
});

test('every part name a behaviour looks for is in the vocabulary', () => {
  // The picker and the validator both offer PARTS; a part implemented but absent
  // from the list would be rejected as a typo and fail silently for a dealer.
  for (const [behaviour, parts] of Object.entries(BEHAVIOUR_PARTS)) {
    assert.ok(BEHAVIOURS.includes(behaviour), `${behaviour} is implemented`);
    for (const name of Object.keys(parts)) {
      assert.ok(PARTS.includes(name), `${behaviour}/${name} is offerable`);
    }
  }
});

test('anchor and scope are declared props, not renderer-only conventions', () => {
  // `renderNode` has always read these off any widget's wrapper while no widget
  // declared them, so a validator walking a widget schema refused them.
  assert.ok(UNIVERSAL_PROPS.anchor, 'anchor is stated');
  assert.ok(UNIVERSAL_PROPS.scope, 'scope is stated');
  assert.ok(UNIVERSAL_PROPS.behaviour.enum.includes('carousel'));
  // Empty is a legal value: it is how the inspector says "no behaviour".
  // `part` is a pattern rather than an enum: it may name several roles at once.
  assert.ok(new RegExp(UNIVERSAL_PROPS.part.pattern).test(''));
  assert.ok(new RegExp(UNIVERSAL_PROPS.part.pattern).test('item'));
  assert.ok(new RegExp(UNIVERSAL_PROPS.part.pattern).test('item control'));
  assert.ok(!new RegExp(UNIVERSAL_PROPS.part.pattern).test('nonsense'));
});

test('an image prop interpolated into src renders the image, not an empty tag', () => {
  // `{{logo}}` inside src="…" is the first thing anyone writing this template
  // reaches for, the AI included. It used to yield src="" — a broken image with
  // nothing anywhere explaining why.
  const out = renderWidgetPreview({
    id: 'logo-wall',
    label: 'Logo wall',
    props: [
      {
        key: 'logos',
        type: 'list',
        label: 'Logo',
        fields: [
          { key: 'image', type: 'image', label: 'Logo' },
          { key: 'altText', type: 'text', label: 'Alt text' },
        ],
      },
    ],
    html: '{{#each logos}}<img src="{{image}}" alt="{{altText}}"/>{{/each}}',
  });
  assert.doesNotMatch(out.html, /src=""/);
  assert.equal(out.html.match(/data:image\/svg\+xml/g).length, 3);
  assert.match(out.html, /alt="Alt text 1"/);
});

test('site-relative assets stay root-relative for the published build', () => {
  assert.equal(isSiteAssetPath('/images/truck.jpg'), true);
  assert.equal(isSiteAssetPath('/about'), false);
  assert.equal(isSiteAssetPath('/store/listings'), false);
  assert.equal(resolveAssetUrl('/images/truck.jpg', {}), '/images/truck.jpg');
  const html = renderDocument(
    { nodes: [{ id: 'img', type: 'image', props: { image: { src: '/images/truck.jpg', alt: 'A truck' } } }] },
    CTX,
  );
  assert.match(html, /src="\/images\/truck\.jpg"/);
});

test('the editor prefixes site-relative assets so they resolve off the dashboard origin', () => {
  // Vercel serves public/ at the site root. The canvas is the dashboard origin,
  // so /images/truck.jpg 404s unless the renderer is told where the files live.
  const ctx = { ...CTX, assetBase: 'https://api.example.com/website-assets/ticket' };
  assert.equal(
    resolveAssetUrl('/images/truck.jpg', ctx),
    'https://api.example.com/website-assets/ticket/images/truck.jpg',
  );
  assert.equal(resolveAssetUrl('/about', ctx), '/about');
  assert.equal(resolveAssetUrl('https://cdn.example.com/x.jpg', ctx), 'https://cdn.example.com/x.jpg');
  const html = renderDocument(
    { nodes: [{ id: 'img', type: 'image', props: { image: { src: '/icons/day-cabs.svg', alt: 'Day cabs' } } }] },
    ctx,
  );
  assert.match(html, /src="https:\/\/api\.example\.com\/website-assets\/ticket\/icons\/day-cabs\.svg"/);
  const css = rewriteAssetUrls(
    '@font-face{src:url("/fonts/Brand.woff2") format("woff2")} body{background-image:url(/images/hero.jpg)}',
    ctx,
  );
  assert.match(css, /url\("https:\/\/api\.example\.com\/website-assets\/ticket\/fonts\/Brand\.woff2"\)/);
  assert.match(css, /url\(https:\/\/api\.example\.com\/website-assets\/ticket\/images\/hero\.jpg\)/);
});

test('a node may play several behaviour parts at once', () => {
  // A drilldown's middle column is filtered by the level above it and filters
  // the level below. One element, two roles — the reason `part` is a list.
  const { errors } = validateDocument({
    version: 2,
    nodes: [
      {
        id: 's',
        type: 'section',
        props: { behaviour: 'filter' },
        children: [
          { id: 'state', type: 'heading', props: { text: 'Utah', part: 'item control' } },
        ],
      },
    ],
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));

  const html = renderDocument({
    nodes: [{ id: 'x', type: 'heading', props: { text: 'Utah', part: 'item control' } }],
  }, {});
  assert.match(html, /data-bz-part="item control"/);
});

test('an unknown part is dropped without taking the valid ones with it', () => {
  const warnings = [];
  const html = renderDocument(
    { nodes: [{ id: 'x', type: 'heading', props: { text: 'Utah', part: 'item nonsense' } }] },
    { warn: (m) => warnings.push(m) },
  );
  assert.match(html, /data-bz-part="item"/);
  assert.ok(warnings.some((w) => /nonsense/.test(w)));
});

test('a menu can be drawn as a mega panel', () => {
  const menus = {
    version: 3,
    menus: [
      {
        id: 'main',
        name: 'Main',
        items: [
          {
            id: 'sales',
            label: 'Sales',
            type: 'label',
            children: [
              {
                id: 'showroom',
                label: 'Showroom',
                type: 'label',
                children: [{ id: 'volvo', label: 'Volvo', type: 'url', url: '/volvo' }],
              },
            ],
          },
        ],
      },
    ],
  };
  const html = renderDocument(
    { nodes: [{ id: 'nav', type: 'menu', props: { menuId: 'main', layout: 'mega' } }] },
    { menus },
  );
  assert.match(html, /bz-menu--mega/);
  // Three levels survive: trigger, column heading, link. The panel is CSS.
  assert.match(html, /Sales/);
  assert.match(html, /bz-navlabel">Showroom/);
  assert.match(html, /href="\/volvo"/);
});

/* -------------------------------------------------- analytics providers */

import { analyticsConfig, analyticsHead, missingIdentity } from './analytics.mjs';
import { renderShell } from './shell.mjs';
import { isValidPageType, pageTypeOptions } from './analytics-vocab.mjs';

/** A config carrying the baked provider file, as `scripts/build.mjs` assembles it. */
const withProviders = (providers, runtimeVersion = '4.11.0') => ({
  name: 'Example',
  url: 'https://example.com',
  favicon: '/favicon.svg',
  channelToken: 'ct',
  seo: { locale: 'en_US', themeColor: '#000', defaultTitle: 'X', defaultDescription: 'Y', ogImage: '/og.jpg' },
  business: { type: 'AutoDealer', legalName: 'Example', phone: '+1-800-555-0100' },
  analytics: { loaderUrl: null, loaderVersion: runtimeVersion },
  platformAnalytics: providers === null ? null : { runtimeVersion, providers },
});

/* One provider, shaped the way a real descriptor bakes: a queueing stub, an
 * ordered create call, a page call carrying the page facts and this dealer's
 * settings, then the call that sends the first page view. */
const oneProvider = {
  id: 'demo',
  adapterUrl: 'https://assets.example.com/analytics/demo-1.0.0.js',
  settings: { clientId: 'C1', dealerBrand: ['International', 'IC Bus'], blank: '' },
  requiredForProduction: ['clientId', 'retailerId'],
  bootstrap: {
    globalName: 'dm',
    script: 'https://vendor.example.com/dm.js?containerId=C1',
    calls: [['create', 'C1', 'R1', 'P1']],
    pageCall: ['set', 'page'],
    readyCall: ['send', 'pageview'],
    pageKeys: { pageType: 'pageType', vehicle: 'vehicleDetails' },
  },
};

test('a dealer with no providers gets no analytics head at all', () => {
  assert.equal(analyticsHead(withProviders(null), { pageType: 'Home' }), '');
  assert.equal(analyticsHead(withProviders([]), { pageType: 'Home' }), '');
  assert.deepEqual(analyticsConfig(withProviders(null)).providers, []);
});

test('the head emits the config blob, then each provider bootstrap', () => {
  const html = analyticsHead(withProviders([oneProvider]), { pageType: 'Home' });
  const blobAt = html.indexOf('window.__BZ_ANALYTICS__=');
  const stubAt = html.indexOf('window.dm=window.dm||');
  assert.ok(blobAt >= 0 && stubAt > blobAt, 'the deferred runtime must be able to read its config without a fetch');
});

test('the bootstrap keeps document order: create, then page, then pageview', () => {
  const html = analyticsHead(withProviders([oneProvider]), { pageType: 'Home' });
  const create = html.indexOf('dm("create"');
  const page = html.indexOf('dm("set","page"');
  const view = html.indexOf('dm("send","pageview")');
  assert.ok(create >= 0 && page > create && view > page, html);
  // Ordering is document order, not JS timing: the page facts are in the data
  // layer before the pageview by construction, with nothing to race.
});

test('page facts are renamed per provider, and a fact it does not name is not sent', () => {
  const html = analyticsHead(withProviders([oneProvider]), {
    pageType: 'Vehicle Details',
    vehicle: { vin: '1XYZ' },
    errorCode: '404',
  });
  assert.match(html, /"pageType":"Vehicle Details"/);
  assert.match(html, /"vehicleDetails":\{"vin":"1XYZ"\}/);
  assert.equal(html.includes('404'), false, 'errorCode has no entry in pageKeys, so it is not sent');
});

test('array settings are pipe-delimited and blanks are omitted from the page call', () => {
  const html = analyticsHead(withProviders([oneProvider]), { pageType: 'Parts' });
  // Scoped to the bootstrap: the config blob ahead of it carries the settings
  // raw, because an adapter may want the array rather than the vendor's
  // flattening of it.
  const bootstrap = html.slice(html.indexOf('window.dm='));
  assert.match(bootstrap, /"dealerBrand":"International\|IC Bus"/);
  assert.equal(bootstrap.includes('"blank"'), false);
});

test('a value containing </script> cannot end the tag early', () => {
  const provider = { ...oneProvider, settings: { pageBrand: '</script><script>alert(1)' } };
  const html = analyticsHead(withProviders([provider]), {});
  assert.equal(html.includes('</script><script>alert(1)'), false);
  assert.match(html, /<\\\/script>/);
});

test('a globalName that is not a bare identifier emits nothing', () => {
  // The global is written into executable code. Anything else would be an
  // injection point in the one file whose job is to avoid one.
  for (const globalName of ['a-b', 'window.x', 'a()', '']) {
    const provider = { ...oneProvider, bootstrap: { ...oneProvider.bootstrap, globalName } };
    const html = analyticsHead(withProviders([provider]), {});
    assert.equal(html.includes('vendor.example.com'), false, globalName);
  }
});

test('the config blob tells the runtime which providers already sent a page view', () => {
  const noReady = { ...oneProvider, id: 'quiet', bootstrap: { ...oneProvider.bootstrap, readyCall: undefined } };
  const html = analyticsHead(withProviders([oneProvider, noReady]), { pageType: 'Home' });
  const blob = JSON.parse(html.slice(html.indexOf('{', html.indexOf('__BZ_ANALYTICS__')), html.indexOf(';</script>')));
  assert.equal(blob.providers.find((p) => p.id === 'demo').bootstrapped, true);
  assert.equal(blob.providers.find((p) => p.id === 'quiet').bootstrapped, false);
});

test('the placeholder guard names every unset value, per provider', () => {
  const provider = { ...oneProvider, settings: { clientId: 'REPLACE_SD_CLIENT_ID' } };
  assert.deepEqual(missingIdentity(withProviders([provider])), ['demo.clientId', 'demo.retailerId']);
  assert.deepEqual(missingIdentity(withProviders(null)), [], 'no providers means nothing to check');
  const complete = { ...oneProvider, settings: { clientId: 'C', retailerId: 'R' } };
  assert.deepEqual(missingIdentity(withProviders([complete])), []);
});

test('a page kind is unconstrained until a provider constrains it', () => {
  assert.equal(isValidPageType('Anything at all', null), true);
  assert.equal(isValidPageType('', null), false);
  assert.deepEqual(pageTypeOptions(null), []);

  const vocab = { pageTypes: ['Home', 'Vehicle Details'] };
  assert.equal(isValidPageType('Vehicle Details', vocab), true);
  // Case-sensitive: a value differing only in case is one the provider rejects,
  // and accepting it here moves the failure to where nobody is looking.
  assert.equal(isValidPageType('vehicle details', vocab), false);
  assert.equal(isValidPageType('Nonsense', vocab), false);
  assert.deepEqual(pageTypeOptions(vocab), ['Home', 'Vehicle Details']);
});

/** The rendered value of one attribute, with the renderer's escaping undone. */
const attrJson = (html, name) => {
  const match = new RegExp(`${name}="([^"]*)"`).exec(html);
  assert.ok(match, `${name} is not on the element`);
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
};

test('a form carries its analytics annotations, namespaced per provider', () => {
  const html = renderForm(
    {
      id: 'quote',
      name: 'Request a quote',
      analytics: {
        'shift-digital': { formType: 'Get a Quote', leadType: 'lead' },
        ga4: { formType: 'quote_request' },
      },
      redirectUrl: '/thank-you',
      fields: [
        { id: 'email', type: 'email', label: 'Email', analytics: { 'shift-digital': { formFieldName: 'emailaddress' } } },
      ],
    },
    { storefrontPrefix: 'store' },
  );
  // Two providers wanting a different form type for the same form is normal.
  // A flat bag would have one of them silently overwrite the other.
  assert.deepEqual(attrJson(html, 'data-bz-analytics'), {
    'shift-digital': { formType: 'Get a Quote', leadType: 'lead' },
    ga4: { formType: 'quote_request' },
  });
  assert.deepEqual(attrJson(html, 'data-bz-field-analytics'), {
    'shift-digital': { formFieldName: 'emailaddress' },
  });
  assert.match(html, /data-bz-redirect="\/thank-you"/);
});

test('a form with no analytics mapping renders, and claims nothing', () => {
  const html = renderForm({ id: 'x', name: 'X', fields: [{ id: 'a', type: 'text', label: 'A' }] }, {});
  assert.equal(/data-bz-analytics/.test(html), false);
  assert.equal(/data-bz-field-analytics/.test(html), false);
  // No default: a provider that requires a form type supplies it in its own
  // adapter, which is the only place that knows the value is required.
});

test('only string leaves survive, and an empty provider is not claimed', () => {
  const html = renderForm(
    {
      id: 'x',
      name: 'X',
      analytics: {
        'shift-digital': { formType: 'Other', codes: ['a'], n: 3, blank: '' },
        ga4: {},
        broken: 'not an object',
      },
      fields: [],
    },
    {},
  );
  assert.deepEqual(attrJson(html, 'data-bz-analytics'), { 'shift-digital': { formType: 'Other' } });
  assert.equal(html.includes('object Object'), false);
});

test('the renderer version is a page fact, named by whoever wants it', () => {
  const wants = { ...oneProvider, bootstrap: { ...oneProvider.bootstrap, pageKeys: { runtimeVersion: 'siteTechnologyVersion' } } };
  const html = analyticsHead(withProviders([wants], '4.11.0'), { pageType: 'Home' });
  assert.match(html, /"siteTechnologyVersion":"4.11.0"/);
  // Never a literal, or it drifts per dealer the moment a renderer ships.
  const doesNot = analyticsHead(withProviders([oneProvider], '4.11.0'), { pageType: 'Home' });
  assert.equal(doesNot.slice(doesNot.indexOf('window.dm=')).includes('4.11.0'), false);
});

test('meta keywords is emitted only when a page asks for one', () => {
  const shell = (extra) =>
    renderShell({
      config: withProviders(null),
      fontsHref: '',
      chrome: {},
      title: 'T',
      description: 'D',
      canonical: 'https://example.com/',
      bodyHtml: '<main></main>',
      storefrontPrefix: 'store',
      ...extra,
    });

  // A site that never opts in carries no empty tag, which is the difference
  // between "this dealer chose not to" and "this dealer set it to nothing".
  assert.equal(shell({}).includes('name="keywords"'), false);
  assert.equal(shell({ keywords: [] }).includes('name="keywords"'), false);
  assert.equal(shell({ keywords: ['  ', ''] }).includes('name="keywords"'), false);

  assert.match(
    shell({ keywords: ['used trucks', ' tampa ', '', 'fleet service'] }),
    /<meta name="keywords" content="used trucks, tampa, fleet service" \/>/,
  );
  // Same escaping as every other meta: a quote in a keyword must not end the
  // attribute and open an injection point.
  assert.match(shell({ keywords: ['24" wheels'] }), /content="24&quot; wheels"/);
});

test('the shell puts the whole analytics burst in the head, in order', () => {
  // The function-level ordering tests above prove `analyticsHead` composes the
  // burst correctly. This proves the shell actually emits it inside <head> —
  // the guide requires head placement for complete page-view capture, and a
  // burst that landed in the body would still pass every test above.
  const html = renderShell({
    config: withProviders([oneProvider]),
    fontsHref: '',
    analyticsPage: { pageType: 'Home' },
    chrome: {},
    title: 'T',
    description: 'D',
    canonical: 'https://example.com/',
    bodyHtml: '<main></main>',
    storefrontPrefix: 'store',
  });
  const head = html.slice(0, html.indexOf('</head>'));
  const at = (needle) => {
    const i = head.indexOf(needle);
    assert.notEqual(i, -1, `${needle} is not in <head>`);
    return i;
  };
  const order = [
    'window.__BZ_ANALYTICS__=',
    'window.dm=window.dm||',
    'dm("create"',
    'dm("set","page"',
    'dm("send","pageview")',
    'vendor.example.com/dm.js',
  ].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the head burst is out of order');
});

test('a page-kind value map translates the platform words and lets authored ones through', () => {
  // The storefront derives a page kind from the route and knows no provider, so
  // it emits the platform's own word. A brand-site page kind is authored by a
  // human against the provider's own vocabulary and must reach it untouched.
  const mapping = {
    ...oneProvider,
    bootstrap: {
      ...oneProvider.bootstrap,
      pageValues: { pageType: { listing: 'Vehicle Listing', detail: 'Vehicle Details' } },
    },
  };
  const derived = analyticsHead(withProviders([mapping]), { pageType: 'listing' });
  assert.match(derived.slice(derived.indexOf('window.dm=')), /"pageType":"Vehicle Listing"/);

  const authored = analyticsHead(withProviders([mapping]), { pageType: 'Finance' });
  assert.match(authored.slice(authored.indexOf('window.dm=')), /"pageType":"Finance"/);
});

test('an empty object is an absent fact, not a fact whose value is {}', () => {
  const html = analyticsHead(withProviders([oneProvider]), { pageType: 'Home', vehicle: {} });
  // A vendor receiving `vehicleDetails: {}` reads it as a page that has a
  // vehicle with nothing known about it.
  assert.equal(html.includes('vehicleDetails'), false);
});

/* A provider whose global is a plain array the vendor's script drains, rather
 * than a function that queues its own arguments — Google Tag Manager's
 * `dataLayer`. Emitting a function stub for one of these breaks the tag
 * outright: `gtm.js` calls `.push`, and a function has none. */
const queueProvider = {
  id: 'tagmanager',
  adapterUrl: 'https://assets.example.com/analytics/tagmanager-1.0.0.js',
  settings: { containerId: 'TM-ABC1234' },
  requiredForProduction: ['containerId'],
  bootstrap: {
    globalName: 'layer',
    globalKind: 'queue',
    script: 'https://vendor.example.com/tm.js?id=TM-ABC1234',
    calls: [[{ 'tm.start': 'container-start', event: 'tm.js' }]],
    pageCall: [{ event: 'page_view' }],
    pageKeys: { pageType: 'page_type' },
  },
};

test('a queue global is an array, and its calls are pushes', () => {
  const html = analyticsHead(withProviders([queueProvider]), { pageType: 'Home' });
  assert.match(html, /window\.layer=window\.layer\|\|\[\];/);
  assert.equal(html.includes('function(){(layer.q'), false, 'a function stub has no .push');
  assert.match(html, /layer\.push\(\{"tm\.start":"container-start","event":"tm\.js"\}\);/);
});

test('a queue provider gets one merged object, not an argument list', () => {
  const html = analyticsHead(withProviders([queueProvider]), { pageType: 'Home' });
  // What the vendor calls the event, with the page facts merged into it. That
  // is the whole shape a data layer takes.
  assert.match(html, /layer\.push\(\{"event":"page_view","page_type":"Home","containerId":"TM-ABC1234"\}\);/);
});

test('a provider with no readyCall is not marked as having sent its page view', () => {
  // Its page call *is* its page view, so the runtime must keep sending page
  // views to it — otherwise it never sees a client-side navigation.
  const html = analyticsHead(withProviders([queueProvider]), { pageType: 'Home' });
  const blob = JSON.parse(html.slice(html.indexOf('{', html.indexOf('__BZ_ANALYTICS__')), html.indexOf(';</script>')));
  assert.equal(blob.providers[0].bootstrapped, false);
});

/* ------------------------------------------- rooftop structured data (4.14) */

import { businessJsonLd } from './shell.mjs';
import { rooftopFrom } from './widgets.mjs';

const dealerConfig = {
  name: 'Sun State International',
  url: 'https://example.com',
  favicon: '/favicon.svg',
  seo: { locale: 'en_US', themeColor: '#000', defaultTitle: 'X', defaultDescription: 'Y', ogImage: '/og.jpg' },
  business: {
    type: 'AutoDealer',
    legalName: 'Sun State International Trucks, LLC',
    phone: '+1-800-555-0100',
    addressCountry: 'US',
    priceRange: '$$',
  },
};

const tampa = {
  name: 'Tampa',
  slug: 'tampa',
  streetAddress: '6020 Adamo Dr',
  city: 'Tampa',
  region: 'FL',
  postalCode: '33619',
  latitude: 27.95,
  longitude: -82.4,
  phone: '(813) 555-0100',
  schedules: [
    { heading: 'Sales', hours: [{ day: 'Monday', opensAt: '08:00', closesAt: '18:00' }, { day: 'Sunday', hours: 'Closed' }] },
    { heading: 'Service', hours: [{ day: 'Monday', opensAt: '07:00', closesAt: '17:00' }] },
  ],
};

test('a rooftop page describes the branch, not the head office', () => {
  const ld = JSON.parse(businessJsonLd(dealerConfig, tampa, 'https://example.com/locations/tampa'));
  assert.equal(ld.address.streetAddress, '6020 Adamo Dr');
  assert.equal(ld.telephone, '(813) 555-0100');
  assert.equal(ld['@id'], 'https://example.com/locations/tampa#location');
  assert.equal(ld.parentOrganization.name, 'Sun State International');
});

test('a bare place name is prefixed, so the record still says who the business is', () => {
  const ld = JSON.parse(businessJsonLd(dealerConfig, tampa, 'https://example.com/locations/tampa'));
  assert.equal(ld.name, 'Sun State International Tampa');
  const named = JSON.parse(
    businessJsonLd(dealerConfig, { ...tampa, name: 'Sun State International — Tampa' }, 'https://example.com/x'),
  );
  assert.equal(named.name, 'Sun State International — Tampa', 'a dealer-typed full name is left alone');
});

test('closed days are omitted and extra departments become sub-entities', () => {
  const ld = JSON.parse(businessJsonLd(dealerConfig, tampa, 'https://example.com/locations/tampa'));
  assert.equal(ld.openingHoursSpecification.length, 1, 'the Sunday row has no opens/closes');
  assert.deepEqual(ld.openingHoursSpecification[0], {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: 'Monday',
    opens: '08:00',
    closes: '18:00',
  });
  assert.equal(ld.department[0].name, 'Service');
});

test('with no rooftop the company node is unchanged', () => {
  const ld = JSON.parse(businessJsonLd(dealerConfig));
  assert.equal(ld.name, 'Sun State International');
  assert.equal(ld['@id'], undefined);
});

test('the rooftop is read from the page own snapshots, and is null without them', () => {
  const nodes = [
    {
      id: 's',
      type: 'section',
      children: [
        {
          id: 'w1',
          type: 'widget',
          props: {
            widget: 'locations-map',
            config: { locationSlug: 'tampa' },
            snapshot: { locations: [{ slug: 'tampa', name: 'Tampa', city: 'Tampa' }] },
          },
        },
        {
          id: 'w2',
          type: 'widget',
          props: {
            widget: 'hours',
            config: { locationSlug: 'tampa' },
            snapshot: { schedules: [{ heading: 'Sales', hours: [] }] },
          },
        },
      ],
    },
  ];
  const found = rooftopFrom(nodes, 'tampa');
  assert.equal(found.city, 'Tampa');
  assert.equal(found.schedules[0].heading, 'Sales');
  assert.equal(rooftopFrom(nodes, 'sarasota'), null, 'a slug with no data must not claim an address');
  assert.equal(rooftopFrom(nodes, null), null);
});

test('a component widget gets the placement own snapshot, not the definition one', () => {
  const sections = {
    'loc-summary': {
      id: 'loc-summary',
      props: [{ key: 'locationSlug', type: 'text', label: 'Slug', default: '' }],
      nodes: [
        {
          id: 'band',
          type: 'section',
          props: {},
          children: [
            {
              id: 'map',
              type: 'widget',
              props: { widget: 'locations-map', config: { locationSlug: '{{locationSlug}}' } },
            },
          ],
        },
      ],
    },
  };
  const place = (slug, city) => ({
    id: 'ref-' + slug,
    type: 'sharedSection',
    props: {
      sectionId: 'loc-summary',
      values: { locationSlug: slug },
      snapshots: { map: { locations: [{ slug: slug, name: city, city: city, streetAddress: '1 Main St' }] } },
    },
  });

  const tampaHtml = renderDocument({ nodes: [place('tampa', 'Tampa')] }, { sections });
  const sarasotaHtml = renderDocument({ nodes: [place('sarasota', 'Sarasota')] }, { sections });

  assert.match(tampaHtml, /Tampa/);
  assert.equal(tampaHtml.includes('Sarasota'), false, 'one placement must not see another data');
  assert.match(sarasotaHtml, /Sarasota/);
  // The definition itself holds no data, so without a placement snapshot the
  // widget falls back to its empty state rather than another rooftop address.
  const bare = renderDocument(
    { nodes: [{ id: 'r', type: 'sharedSection', props: { sectionId: 'loc-summary', values: { locationSlug: 'x' } } }] },
    { sections },
  );
  assert.match(bare, /Locations load here\./);
});

test('rooftopFrom reads a snapshot placed through a component', () => {
  const nodes = [
    {
      id: 'ref',
      type: 'sharedSection',
      props: {
        sectionId: 'loc-summary',
        values: { locationSlug: 'tampa' },
        snapshots: {
          map: { locations: [{ slug: 'tampa', name: 'Tampa', city: 'Tampa' }] },
          hrs: { schedules: [{ heading: 'Sales', hours: [] }] },
        },
      },
    },
  ];
  const found = rooftopFrom(nodes, 'tampa');
  assert.equal(found.city, 'Tampa');
  assert.equal(found.schedules[0].heading, 'Sales');
  assert.equal(rooftopFrom(nodes, 'davenport'), null);
});

/* ------------------------------------------------- one page, many locations */

import {
  applyLocationSlug,
  fillTokens,
  isLocationPage,
  locationIndex,
  locationOut,
  locationPageNodes,
  locationPath,
} from './location-pages.mjs';

const LOC_DOC = {
  version: 2,
  locations: [
    { slug: 'tampa', name: 'Tampa', city: 'Tampa', region: 'FL' },
    { slug: 'davenport', name: 'Davenport', city: 'Davenport', region: 'FL' },
  ],
  locationSnapshots: {
    tampa: { hrs: { snapshot: { schedules: [{ heading: 'Sales', hours: [] }] } } },
    davenport: { hrs: { snapshot: { schedules: [{ heading: 'Parts', hours: [] }] } } },
  },
  nodes: [{ id: 'hrs', type: 'widget', props: { widget: 'hours', config: {} } }],
};

test('a location page names the locations it will build', () => {
  assert.deepEqual(
    locationIndex(LOC_DOC).map((l) => l.slug),
    ['tampa', 'davenport'],
  );
  // A repo nobody has published has no index, and that must read as "none yet"
  // rather than throwing — the build has to survive it.
  assert.deepEqual(locationIndex({ version: 2, nodes: [] }), []);
  assert.equal(isLocationPage({ forEach: 'locations' }), true);
  assert.equal(isLocationPage({ forEach: 'staff' }), false);
});

test('each location gets its own slug, snapshot and URL', () => {
  const tampa = locationPageNodes(LOC_DOC.nodes, LOC_DOC, 'tampa');
  const dav = locationPageNodes(LOC_DOC.nodes, LOC_DOC, 'davenport');

  assert.equal(tampa[0].props.config.locationSlug, 'tampa');
  assert.equal(dav[0].props.config.locationSlug, 'davenport');
  assert.equal(tampa[0].props.snapshot.schedules[0].heading, 'Sales');
  assert.equal(dav[0].props.snapshot.schedules[0].heading, 'Parts');

  // The authored document is rendered once per location and must survive each
  // pass untouched, or the second location inherits the first's data.
  assert.equal(LOC_DOC.nodes[0].props.snapshot, undefined);
  assert.deepEqual(LOC_DOC.nodes[0].props.config, {});

  assert.equal(locationPath('/locations/:slug', 'tampa'), '/locations/tampa');
  assert.equal(locationOut('/locations/tampa'), 'locations/tampa/index.html');
  assert.equal(fillTokens('{{name}}, {{region}}', LOC_DOC.locations[0]), 'Tampa, FL');
  // An unknown token must not reach a <title> as literal braces.
  assert.equal(fillTokens('{{nope}}!', LOC_DOC.locations[0]), '!');
});

test('a widget that names a location keeps it', () => {
  // A deliberate cross-reference — "parts counter is at Tampa" — must not be
  // rewritten to the current page, or one link becomes six wrong ones.
  const nodes = [{ id: 'x', type: 'widget', props: { widget: 'hours', config: { locationSlug: 'tampa' } } }];
  applyLocationSlug(nodes, 'davenport');
  assert.equal(nodes[0].props.config.locationSlug, 'tampa');
});

test('a template can dress every location page without naming a slug', () => {
  const target = { kind: 'location', slug: 'location-detail--tampa', group: 'locations', location: 'tampa' };
  assert.equal(conditionMatches({ type: 'allLocations' }, target), true);
  assert.equal(conditionMatches({ type: 'location', ref: 'tampa' }, target), true);
  assert.equal(conditionMatches({ type: 'location', ref: 'davenport' }, target), false);
  // A site whose only template is "all pages" must still frame these.
  assert.equal(conditionMatches({ type: 'allPages' }, target), true);
  assert.equal(conditionMatches({ type: 'pageGroup', ref: 'locations' }, target), true);
  assert.equal(conditionMatches({ type: 'allLocations' }, { kind: 'page', slug: 'home' }), false);
});

test('a location menu item is a link before that location is baked', () => {
  // The regression this exists for: resolving the address from the *baked*
  // locations meant an item for a branch this repo had not published yet fell
  // through to `<span class="bz-navlabel">`. That is the styling for a heading
  // inside a panel, so a utility bar of six branches quietly lost its link
  // colour — a design change, reported as "you broke the nav", with nothing in
  // any log. The address comes from the route pattern, which is known always.
  const menus = [
    {
      id: 'utility',
      name: 'Utility bar',
      items: [{ id: 'tpa', label: 'Tampa', type: 'location', ref: 'tampa' }],
    },
  ];
  const html = renderMenu(menus, 'utility', { locationPagePath: '/locations/:slug' });
  assert.match(html, /<a href="\/locations\/tampa"/);
  assert.doesNotMatch(html, /bz-navlabel/);

  // A site with no location page at all has nowhere to send it, and a heading
  // is then the honest render rather than a link to a URL that cannot exist.
  assert.match(renderMenu(menus, 'utility', {}), /bz-navlabel/);
});

test('a form submission and a behaviour event do not share one emit function', () => {
  // Both were declared `function emit` in the same scope. The later declaration
  // replaces the earlier one, so a successful submit called dispatchEvent on the
  // event-name string and the confirmation was replaced by that exception.
  const src = readFileSync(new URL('./client/widgets.js', import.meta.url), 'utf8');
  assert.equal((src.match(/function emit\(/g) || []).length, 1);
  assert.match(src, /function emitOn\(/);
});

/* -------------------------------------------------------------------- icons */

test('icons.json maps storefront slots onto a class or an image', () => {
  const { value, problems } = parseIcons({
    version: 1,
    stylesheets: ['https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css'],
    slots: {
      search: { class: 'fa-solid fa-magnifying-glass' },
      save: { src: 'https://vendure.buzznerdrv.com/assets/source/38/heart.svg' },
      close: { src: 'https://vendure.buzznerdrv.com/assets/source/e2/x.png', tint: false },
    },
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(value.slots, {
    search: { class: 'fa-solid fa-magnifying-glass' },
    save: { src: 'https://vendure.buzznerdrv.com/assets/source/38/heart.svg', tint: true },
    close: { src: 'https://vendure.buzznerdrv.com/assets/source/e2/x.png', tint: false },
  });
  assert.equal(value.stylesheets.length, 1);
});

test('icons.json drops anything that could break out of a class, a url() or an attribute', () => {
  const { value, problems } = parseIcons({
    stylesheets: ['http://insecure.example/icons.css', 'javascript:alert(1)'],
    slots: {
      search: { class: 'fa"><script>' },
      save: { src: 'https://x.example/a.svg") , url("https://evil.example/b.svg' },
      saved: { src: 'http://x.example/a.svg' },
      share: { src: 'https://x.example/not-an-image.js' },
      next: { class: 'a', src: 'https://x.example/a.svg' },
      prev: {},
      'not-a-slot': { class: 'x' },
    },
  });
  assert.deepEqual(value.slots, {});
  assert.deepEqual(value.stylesheets, []);
  assert.equal(problems.length, 9);
  assert.ok(problems.some((p) => p.where === 'slots.not-a-slot'));
});

test('a site that maps nothing publishes no icons, so /store is unchanged', () => {
  assert.equal(iconsManifest(null), null);
  assert.equal(iconsManifest({ stylesheets: ['https://a.example/icons.css'], slots: {} }), null);
  assert.deepEqual(iconsManifest({ slots: { 'arrow-left': { class: 'icon-back' } } }), {
    stylesheets: [],
    slots: { 'arrow-left': { class: 'icon-back' } },
  });
});

test('every storefront slot id is a plain kebab-case word', () => {
  for (const id of ICON_SLOT_IDS) assert.match(id, /^[a-z]+(-[a-z]+)*$/);
  assert.equal(new Set(ICON_SLOT_IDS).size, ICON_SLOT_IDS.length);
});

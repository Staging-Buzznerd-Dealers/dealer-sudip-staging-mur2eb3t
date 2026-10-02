/* The analytics runtime. Zero dependencies, platform-owned, loaded on every page.
 *
 * One code path, every destination: a single call fires the platform's own
 * `recordTrackingEvent` beacon and each enabled provider's adapter, with the
 * same trigger, the same consent state and the same session id.
 *
 * That is not a convenience. Third-party tags are client-side and lossy —
 * they miss the visitor with JavaScript disabled, the blocked script, the
 * abandoned load. If the platform's own measurement were taken at a different
 * point, no report we hand a vendor could ever reconcile with what their tag
 * captured, and every discrepancy would be unexplainable rather than merely
 * present.
 *
 * This file names no vendor. Event names are the platform's; an adapter
 * translates them for one provider (see `register` below). Adding a provider
 * never edits this file.
 *
 * Platform-owned: not in the editor's writable path set, so a dealer cannot
 * delete the tag from the Design screen.
 *
 * The editor's Design canvas never runs this file. Nothing here may be
 * load-bearing for layout — see CLAUDE.md §5. It only observes. */
(function () {
  'use strict';

  var CONFIG = window.__BZ_ANALYTICS__ || null;
  var PREFIX = (function () {
    var el = document.querySelector('[data-bz-prefix]');
    return (el && el.getAttribute('data-bz-prefix')) || 'store';
  })();

  /* The beacon goes to the storefront prefix on the dealer's own domain, which
   * the dealer's vercel.json rewrites to the Remix app. First-party, so the
   * visitor cookie survives, and the dealer is resolved from the hostname —
   * no client-supplied value ever names a channel. */
  var ENDPOINT = '/' + PREFIX + '/api/track-event';

  /* ------------------------------------------------------------- consent */

  /* Provider tags load unconditionally and this gate defaults open, because the
   * dealer programmes this serves operate opt-out and their tags require head
   * placement for complete page-view capture.
   *
   * The gate exists so that flipping it for a channel is one line rather than a
   * rewrite, and Global Privacy Control is honoured because it is an explicit,
   * machine-readable objection from the visitor rather than an assumption about
   * their jurisdiction. */
  var DEFAULT_CONSENT = true;

  function consented() {
    if (navigator.globalPrivacyControl === true) return false;
    var override = window.__BZ_CONSENT__;
    if (override === true || override === false) return override;
    return DEFAULT_CONSENT;
  }

  /* ------------------------------------------------------- provider adapters */

  /* An adapter maps the platform's event names onto one vendor's calls. It is
   * loaded async and registers itself, because everything with a deadline is
   * already done: the head bootstrap defined the vendor's queue stub, made its
   * initial calls and sent the first page view before this file ran.
   *
   * Events that arrive before an adapter has loaded are replayed to it on
   * registration. A visitor who clicks a phone number in the first 200ms is a
   * real visitor and their click is a real event. */
  var adapters = [];
  var replay = [];
  var REPLAY_LIMIT = 50;

  function register(adapter) {
    if (!adapter || typeof adapter.track !== 'function') return;
    var config = null;
    for (var i = 0; i < (CONFIG ? CONFIG.providers.length : 0); i++) {
      if (CONFIG.providers[i].id === adapter.id) config = CONFIG.providers[i];
    }
    if (!config) return;

    adapter.__config = config;
    try {
      if (typeof adapter.init === 'function') {
        adapter.init(config.settings || {}, { pageType: CONFIG.pageType || null });
      }
    } catch (e) {
      /* A vendor's own initialisation failing must not stop ours recording. */
      return;
    }
    adapters.push(adapter);
    for (var j = 0; j < replay.length; j++) {
      fanOut(adapter, replay[j].name, replay[j].properties, replay[j].index);
    }
  }

  /* An adapter is handed its own annotations, flattened, and never anybody
   * else's. `annotations` is authored per provider because the values are each
   * provider's restricted vocabulary — two providers wanting a different form
   * type for the same form is normal — so a flat bag would have one silently
   * overwrite the other. */
  function forAdapter(adapter, properties) {
    var annotations = properties.annotations;
    if (!annotations) return properties;

    var out = {};
    for (var key in properties) {
      if (key !== 'annotations' && Object.prototype.hasOwnProperty.call(properties, key)) {
        out[key] = properties[key];
      }
    }
    var mine = annotations[adapter.id];
    if (mine) {
      for (var own in mine) if (Object.prototype.hasOwnProperty.call(mine, own)) out[own] = mine[own];
    }
    return out;
  }

  function fanOut(adapter, name, properties, index) {
    /* The bootstrap already sent this vendor the first page view. Sending it
     * again here would count every visit twice on their side — the rule the old
     * single-vendor runtime stated in a comment, now an explicit flag, because
     * with several providers "the first one" is per provider. */
    if (index === 0 && adapter.__config && adapter.__config.bootstrapped) return;
    try {
      adapter.track(name, forAdapter(adapter, properties));
    } catch (e) {
      /* Never let one vendor's adapter break another's, or ours. */
    }
  }

  function loadAdapters() {
    if (!CONFIG || !CONFIG.providers) return;
    for (var i = 0; i < CONFIG.providers.length; i++) {
      var provider = CONFIG.providers[i];
      if (!provider.adapterUrl) continue;
      var script = document.createElement('script');
      script.src = provider.adapterUrl;
      script.async = true;
      document.head.appendChild(script);
    }
  }

  /* -------------------------------------------------------------- identity */

  var VISITOR_KEY = 'bz_vid';
  var SESSION_KEY = 'bz_sid';
  var SESSION_MINUTES = 30;

  function readCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function writeCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    /* No Domain attribute: the brand site and /store/* are one origin, so a
     * host-only cookie covers both and cannot leak to a sibling subdomain. */
    document.cookie =
      name + '=' + encodeURIComponent(value) + '; path=/; expires=' + expires + '; SameSite=Lax';
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function visitorId() {
    var id = readCookie(VISITOR_KEY);
    if (!id) id = newId();
    writeCookie(VISITOR_KEY, id, 365);
    return id;
  }

  function sessionId() {
    var id = readCookie(SESSION_KEY);
    if (!id) id = newId();
    /* Sliding: every event pushes the expiry out, so a session ends after
     * thirty idle minutes rather than thirty minutes after it began. */
    writeCookie(SESSION_KEY, id, SESSION_MINUTES / 1440);
    return id;
  }

  function deviceType() {
    return /Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  /* --------------------------------------------------------------- sending */

  function post(body) {
    var payload = JSON.stringify(body);
    try {
      if (navigator.sendBeacon) {
        /* sendBeacon survives the unload that a click or a tab close causes,
         * which is exactly when the exit signals fire. */
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
        return;
      }
    } catch (e) {
      /* fall through */
    }
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      /* Analytics must never break a page. */
    }
  }

  var eventIndex = 0;

  /**
   * Record one event.
   *
   * The name is the platform's — snake_case, the vocabulary `event-names.ts`
   * owns. Whatever a vendor calls it is that vendor's adapter's problem, which
   * is what keeps this file free of any of them.
   *
   * Adapters first, then our beacon: if the page is unloading, a vendor with a
   * certification requirement attached should get its bytes out first, and ours
   * uses `sendBeacon`, which survives unload anyway.
   */
  function track(name, properties) {
    if (!consented()) return;
    var props = properties || {};
    var index = eventIndex++;

    for (var i = 0; i < adapters.length; i++) fanOut(adapters[i], name, props, index);

    if (replay.length < REPLAY_LIMIT) replay.push({ name: name, properties: props, index: index });

    post({
      eventName: name,
      pageType: (CONFIG && CONFIG.pageType) || null,
      pageUrl: location.pathname + location.search,
      referrer: document.referrer || undefined,
      deviceType: deviceType(),
      properties: props,
    });
  }

  window.bzAnalytics = {
    track: track,
    register: register,
    ready: function (fn) {
      try {
        fn(window.bzAnalytics);
      } catch (e) {
        /* A dealer's own script failing is not ours to surface. */
      }
    },
  };
  /* Kept because dealer scripts and components may already call it. */
  window.bzTrack = track;

  /* ------------------------------------------------------------ page views */

  visitorId();
  sessionId();

  loadAdapters();

  /* Index 0, which `fanOut` skips for any provider whose bootstrap already sent
   * its own page view from the head. Our beacon always goes. */
  track('page_view', {});

  /* -------------------------------------------------- engagement and exit */

  var start = Date.now();
  var engaged = 0;
  var lastTick = Date.now();
  var active = true;

  /* Time on site is engaged time, not wall-clock: a tab left open overnight is
   * not a two-hour visit, and averaging those in makes the metric meaningless.
   * Avg Time on Site is a column in the metrics file, so it has to mean
   * something. */
  function tick() {
    var now = Date.now();
    if (active && now - lastTick < 60_000) engaged += now - lastTick;
    lastTick = now;
  }
  setInterval(tick, 5000);

  document.addEventListener('visibilitychange', function () {
    tick();
    active = document.visibilityState === 'visible';
    lastTick = Date.now();
  });

  var exitSent = false;
  function sendExit() {
    if (exitSent) return;
    exitSent = true;
    tick();
    post({
      eventName: 'page_exit',
      pageType: (CONFIG && CONFIG.pageType) || null,
      pageUrl: location.pathname + location.search,
      deviceType: deviceType(),
      properties: {
        engagedSeconds: Math.round(engaged / 1000),
        totalSeconds: Math.round((Date.now() - start) / 1000),
      },
    });
  }
  /* `pagehide` rather than `unload`, which browsers no longer fire reliably on
   * mobile and which disqualifies a page from the back/forward cache. */
  window.addEventListener('pagehide', sendExit);

  /* ---------------------------------------------------- interaction events */

  function closest(node, selector) {
    return node && node.closest ? node.closest(selector) : null;
  }

  /**
   * Which department a phone number belongs to.
   *
   * Read off the nearest labelled ancestor rather than guessed from the number.
   * A provider with a closed department vocabulary maps this to its own values;
   * guessing one here would put a made-up value on the wire.
   */
  function departmentFor(node) {
    var scope = closest(node, '[data-bz-department]');
    return (scope && scope.getAttribute('data-bz-department')) || null;
  }

  function textOf(node) {
    return (node.textContent || '').trim().slice(0, 200);
  }

  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      var anchor = closest(target, 'a[href]');
      if (!anchor) return;

      var href = anchor.getAttribute('href') || '';
      var el = anchor.getAttribute('data-bz-el');
      var intent = anchor.getAttribute('data-bz-intent') || null;
      var ctaId = anchor.getAttribute('data-bz-cta') || null;

      /* Protocol first: a tel: link is a click-to-call whether it was rendered
       * as a CTA, a nav item or body text, and the guide's event is about what
       * the visitor did rather than which block drew it. */
      if (/^tel:/i.test(href)) {
        track('click_to_call', {
          clickToCallDepartment: departmentFor(anchor),
          phoneNumber: href.replace(/^tel:/i, ''),
          linkText: textOf(anchor),
        });
        return;
      }
      if (/^sms:/i.test(href)) {
        track('click_to_text', {
          clickToCallDepartment: departmentFor(anchor),
          phoneNumber: href.replace(/^sms:/i, '').split('?')[0],
        });
        return;
      }

      if (/maps\.(google|apple)\.|google\.[a-z.]+\/maps|maps\.app\.goo\.gl/i.test(href)) {
        track('get_directions', { destination: href, linkText: textOf(anchor) });
        return;
      }

      if (/\.pdf($|\?)/i.test(href) || intent === 'brochure') {
        track('brochure_download', {
          brochureName: anchor.getAttribute('data-bz-brochure') || textOf(anchor) || href.split('/').pop(),
        });
        return;
      }

      if (intent === 'schedule-service' || /schedule[-_]?service/i.test(href)) {
        track('schedule_service_click', { linkText: textOf(anchor), destination: href });
        return;
      }

      /* A slide's own link is a carousel click, and the carousel behaviour
       * already knows both the slide's name and its position — no second
       * source of truth and no counting by hand. */
      var slide = closest(anchor, '[data-bz-part~="slide"]');
      if (slide) {
        var rail = closest(slide, '[data-bz-behaviour="carousel"]');
        var slides = rail ? rail.querySelectorAll('[data-bz-part~="slide"]') : [];
        var position = Array.prototype.indexOf.call(slides, slide);
        track('carousel_click', {
          assetName: slide.getAttribute('data-bz-asset') || textOf(slide).slice(0, 80),
          assetPosition: position >= 0 ? position + 1 : null,
        });
        return;
      }

      if (el === 'cta' || ctaId) {
        track('link_click', {
          linkType: 'CTA',
          ctaId: ctaId,
          intent: intent,
          linkText: textOf(anchor),
          destination: href,
        });
        return;
      }

      if (el === 'link' || el === 'logo') {
        track('link_click', {
          linkType: anchor.getAttribute('data-bz-link-type') || null,
          intent: intent,
          linkText: textOf(anchor),
          destination: href,
        });
      }
    },
    true,
  );

  /* --------------------------------------------------------- form events */

  function parseAttr(node, name) {
    if (!node) return null;
    try {
      var value = JSON.parse(node.getAttribute(name) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (e) {
      return null;
    }
  }

  /* Every form event carries the same context: how the form was displayed, the
   * vehicle it is bound to, and the annotations authored for it.
   *
   * The annotations stay namespaced by provider all the way through this file —
   * nothing here reads a key or knows what one means. `forAdapter` flattens
   * each provider's own slice into the properties it is handed, and the
   * platform's beacon stores the whole object as it was authored.
   *
   * Nothing is defaulted. A provider that requires a value the dealer did not
   * author supplies it in its own adapter, which is the only place that knows
   * the value is required at all. */
  function formContext(form) {
    return {
      /* A form inside a dialog is a modal, whatever the page around it. */
      displayType: closest(form, 'dialog, [role="dialog"], [data-bz-modal]') ? 'modal' : 'in-page',
      formVehicle: parseAttr(form, 'data-bz-vehicle') || undefined,
      annotations: parseAttr(form, 'data-bz-analytics') || undefined,
    };
  }

  /* One field's annotations, layered over the form's so an adapter sees both in
   * one flat object. The field wins on a shared key, which is what makes a
   * per-field override possible at all. */
  function fieldContext(form, field) {
    var context = formContext(form);
    var fieldBag = parseAttr(closest(field, '[data-bz-field-analytics]'), 'data-bz-field-analytics');
    if (!fieldBag) return context;

    var merged = {};
    var formBag = context.annotations || {};
    var providerId;
    for (providerId in formBag) {
      if (Object.prototype.hasOwnProperty.call(formBag, providerId)) merged[providerId] = formBag[providerId];
    }
    for (providerId in fieldBag) {
      if (!Object.prototype.hasOwnProperty.call(fieldBag, providerId)) continue;
      merged[providerId] = assign(merged[providerId] || {}, fieldBag[providerId]);
    }
    context.annotations = merged;
    return context;
  }

  function assign(base, extra) {
    var out = {};
    for (var a in base) if (Object.prototype.hasOwnProperty.call(base, a)) out[a] = base[a];
    for (var b in extra) if (Object.prototype.hasOwnProperty.call(extra, b)) out[b] = extra[b];
    return out;
  }

  var seenShown = new WeakSet();
  var seenStarted = new WeakSet();
  var seenFields = new WeakMap();

  /* "Shown" means the fields became visible, not that the markup exists — a
   * form in a collapsed section or below the fold has not been shown to
   * anyone, and counting it would make the conversion rate meaningless. */
  function watchVisibility(form) {
    if (seenShown.has(form) || !window.IntersectionObserver) return;
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || seenShown.has(form)) return;
          seenShown.add(form);
          observer.disconnect();
          track('form_shown', formContext(form));
        });
      },
      { threshold: 0.35 },
    );
    observer.observe(form);
  }

  /* The field's own name, used to fire `form_field_interaction` once per field
   * and as the fallback `formFieldName` for a provider the dealer did not map
   * this field for. Its real name, never a value guessed at from a vocabulary
   * this file does not have. */
  function fieldName(field) {
    return field.getAttribute('name') || field.getAttribute('id') || 'other';
  }

  function bindForm(form) {
    if (form.dataset.bzAnalytics) return;
    form.dataset.bzAnalytics = '1';
    watchVisibility(form);

    form.addEventListener(
      'focusin',
      function (event) {
        var field = event.target;
        if (!field || !/^(INPUT|SELECT|TEXTAREA)$/.test(field.tagName)) return;

        /* Initiation is the first touch of the form; field interaction is the
         * first touch of each field. The first field produces both, which is
         * what the guide's examples show. */
        if (!seenStarted.has(form)) {
          seenStarted.add(form);
          track('form_initiation', formContext(form));
        }

        var touched = seenFields.get(form);
        if (!touched) {
          touched = {};
          seenFields.set(form, touched);
        }
        var name = fieldName(field);
        /* Once per field. `formFieldInteraction` carries the whole vehicle
         * payload, so firing it on every keystroke would dominate the event
         * table by an order of magnitude and tell us nothing more. */
        if (touched[name]) return;
        touched[name] = true;
        track('form_field_interaction', assign(fieldContext(form, field), { formFieldName: name }));
      },
      true,
    );
  }

  function bindForms(root) {
    (root || document).querySelectorAll('form[data-bz-el="form"]').forEach(bindForm);
  }

  bindForms(document);

  /* Forms arrive after load: a modal is built when opened, and widgets.js
   * hydrates them. Observing is how a dialog's form gets bound at all. */
  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('form[data-bz-el="form"]')) bindForm(node);
          else if (node.querySelectorAll) bindForms(node);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* Submission and its failure are reported by the form client, which is the
   * only thing that knows whether the server accepted the lead and what id it
   * gave back. `lead_submitted` fires on the response, never on the click:
   * firing on click counts a lead that a validation error rejected. */
  document.addEventListener('bz:form:submitted', function (event) {
    var detail = event.detail || {};
    var form = detail.form;
    if (!form) return;
    track(
      'lead_submitted',
      assign(formContext(form), {
        leadId: detail.leadId || null,
        prefContact: detail.prefContact || null,
        formOptIn: detail.formOptIn || null,
      }),
    );
  });

  document.addEventListener('bz:form:error', function (event) {
    var detail = event.detail || {};
    var form = detail.form;
    if (!form) return;
    track('form_submission_error', assign(formContext(form), { formError: detail.message || 'Submission failed' }));
  });
})();

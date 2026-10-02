/* Shared chrome behaviour. Platform-owned, shipped on every page and on the
   Remix storefront (via /partials/chrome.js). Progressive: the nav works
   without it, this only adds the mobile disclosure and the footer year. */
(function () {
  document.querySelectorAll('[data-year]').forEach(function (e) {
    e.textContent = String(new Date().getFullYear());
  });
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('mobile-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.hidden = open;
    });
  }
})();

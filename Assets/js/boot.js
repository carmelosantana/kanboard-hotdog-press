// Starts the zine editor (Template/zine/editor.php). A classic script, so it runs even when the app cannot: it imports
// the app module named in data-main, and if that fails (a missing or changed module, a network error) it shows the
// page's translated data-error instead of leaving "Loading the editor…" for good. External, because Kanboard's CSP
// refuses inline scripts.
(function () {
  var script = document.currentScript;
  var main = script && script.getAttribute('data-main');
  var root = document.getElementById('hotdogpress-app');
  if (!main || !root) return;
  import(new URL(main, document.baseURI).href).catch(function (err) {
    console.error('Hot Dog Press: the editor could not load', err);
    var p = document.createElement('p');
    p.className = 'hotdogpress-error';
    p.setAttribute('role', 'alert');
    p.textContent = root.getAttribute('data-error') || 'The editor could not start. Reload the page to try again.';
    root.replaceChildren(p);
    root.setAttribute('data-ready', 'error');
  });
})();

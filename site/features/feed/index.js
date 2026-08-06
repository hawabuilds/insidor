'use strict';
/** Feed feature entry — loads internal implementation (globals). Do not import sibling feature internals. */
(function () {
  var base = document.currentScript.src.replace(/\/[^/]+$/, '/');
  document.write('<script src="' + base + 'feed.js"><\/script>');
})();

'use strict';
/** Token feature entry — loads internal implementation (globals). Do not import sibling feature internals. */
(function () {
  var base = document.currentScript.src.replace(/\/[^/]+$/, '/');
  ['tokenpage.js', 'token-page.js'].forEach(function (f) {
    document.write('<script src="' + base + f + '"><\/script>');
  });
})();

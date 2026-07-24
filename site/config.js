/** Deploy target — <meta name="deploy-target" content="layer3"> on the layer3 branch; default layer2. */
(function () {
  'use strict';

  /** Public Supabase client creds (anon key + RLS — safe in static HTML). Never put SERVICE key here. */
  var SUPABASE_URL = 'https://layazmzgbrusnspjhiep.supabase.co';
  var SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxheWF6bXpnYnJ1c25zcGpoaWVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTE2MTEsImV4cCI6MjEwMDM4NzYxMX0.CIIX7-oVoNNEINLOFMy8bx6R4aM7d-b_ASx4CleNtZw';

  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

  var raw = document.querySelector('meta[name="deploy-target"]');
  raw = raw && raw.content ? raw.content.trim().toLowerCase() : '';
  var DEPLOY_TARGET = raw === 'layer3' ? 'layer3' : 'layer2';

  function isLayer3() {
    return DEPLOY_TARGET === 'layer3';
  }

  window.InsidorConfig = {
    DEPLOY_TARGET: DEPLOY_TARGET,
    isLayer3: isLayer3,
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  };

  if (isLayer3()) {
    document.addEventListener('DOMContentLoaded', function () {
      var brand = document.querySelector('.nav .brand');
      if (!brand || brand.querySelector('.deploy-banner')) return;
      var banner = document.createElement('span');
      banner.className = 'deploy-banner';
      banner.textContent = 'L3 · dev';
      banner.title = 'Layer 3 deploy — not production Layer 2';
      brand.appendChild(banner);
    });
  }
})();

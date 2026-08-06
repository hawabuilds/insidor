/** Layer 3 production config — Supabase + Vercel Cron pipeline. */
(function () {
  'use strict';

  /** Public Supabase client creds (anon key + RLS — safe in static HTML). Never put SERVICE key here. */
  var SUPABASE_URL = 'https://layazmzgbrusnspjhiep.supabase.co';
  var SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxheWF6bXpnYnJ1c25zcGpoaWVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MTE2MTEsImV4cCI6MjEwMDM4NzYxMX0.CIIX7-oVoNNEINLOFMy8bx6R4aM7d-b_ASx4CleNtZw';

  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

  function isLayer3() {
    return true;
  }

  window.InsidorConfig = {
    DEPLOY_TARGET: 'layer3',
    isLayer3: isLayer3,
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  };
})();

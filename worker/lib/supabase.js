'use strict';

const { createClient } = require('@supabase/supabase-js');
const { loadEnvLocal, requireEnv } = require('./env');

let client;

function getServiceClient() {
  if (client) return client;
  loadEnvLocal();
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_KEY');
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

module.exports = { getServiceClient };

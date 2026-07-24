'use strict';

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET not set — rejecting request');
    return false;
  }
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return token.length > 0 && token === secret;
}

module.exports = { verifyCronAuth };

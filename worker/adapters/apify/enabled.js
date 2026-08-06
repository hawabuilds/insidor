'use strict';

/** True unless TIKTOK_ENABLED is explicitly false/0/off/no. */
function isTikTokEnabled() {
  const v = process.env.TIKTOK_ENABLED;
  if (v == null || v === '') return true;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

module.exports = { isTikTokEnabled };

'use strict';

const importPlugin = require('eslint-plugin-import');

const FEATURES = ['feed', 'token', 'wallet'];

/** Cross-feature imports must go through `<feature>/index.js` or `site/shared/`. */
const zones = [];

for (const from of FEATURES) {
  for (const to of FEATURES) {
    if (from === to) continue;
    zones.push({
      target: `./site/features/${from}/**`,
      from: `./site/features/${to}/**`,
      except: [`./site/features/${to}/index.js`],
      message: `Import "${to}" via site/features/${to}/index.js or site/shared/ only — not its internals`,
    });
  }
}

zones.push({
  target: './site/shared/**',
  from: './site/features/**',
  message: 'shared/ must not import from features/ — keep shared free of feature internals',
});

module.exports = [
  {
    files: ['site/features/**/*.js', 'site/shared/**/*.js'],
    plugins: { import: importPlugin },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js'] },
      },
    },
    rules: {
      'import/no-restricted-paths': ['error', { zones }],
    },
  },
];

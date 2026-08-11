/**
 * The boundary, enforced.
 *
 * One sentence: contracts is a leaf everyone imports; core imports only contracts;
 * adapters imports only contracts; store imports only contracts; services imports
 * everything; app imports only contracts and store.
 *
 * The rule that matters most is core-must-not-import-adapters. Without it, a vendor's
 * shape leaks into the logic and every future platform has to pretend it has the same
 * fields — which is exactly how TikTok's share count ended up in a column named
 * `retweets` and `quotes` became a hardcoded zero in the build this replaces.
 */
module.exports = {
  forbidden: [
    {
      name: 'contracts-is-a-leaf',
      comment:
        'contracts must depend on nothing. It is the shared vocabulary; the moment it ' +
        'imports anything it stops being safe for everyone else to import.',
      severity: 'error',
      from: { path: '^contracts/' },
      to: { pathNot: '^contracts/' },
    },
    {
      name: 'core-imports-only-contracts',
      comment:
        'core holds all the logic and must stay pure. It may know the vocabulary and ' +
        'nothing else — no vendors, no SQL, no services.',
      severity: 'error',
      from: { path: '^core/' },
      to: { pathNot: '^(core|contracts)/' },
    },
    {
      name: 'adapters-import-only-contracts',
      comment:
        'An adapter translates one vendor into our vocabulary. If it can reach core it ' +
        'will eventually make a product decision, and product decisions belong in core.',
      severity: 'error',
      from: { path: '^adapters/' },
      to: { pathNot: '^(adapters|contracts)/' },
    },
    {
      name: 'store-imports-only-contracts',
      comment: 'store is the only place SQL lives. It persists the vocabulary, nothing more.',
      severity: 'error',
      from: { path: '^store/' },
      to: { pathNot: '^(store|contracts)/' },
    },
    {
      name: 'app-cannot-reach-the-logic',
      comment:
        'The app renders what the store serves. It must not import core or adapters — ' +
        'that is what stops internal scoring reaching a screen.',
      severity: 'error',
      from: { path: '^app/' },
      to: { path: '^(core|adapters|ml)/' },
    },
    {
      name: 'eval-cannot-reach-vendors',
      comment:
        'eval replays recorded decisions. If it can reach adapters it can hit the network, ' +
        'and a replay that hits the network is not a replay.',
      severity: 'error',
      from: { path: '^eval/' },
      to: { path: '^adapters/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: '\\.d\\.ts$|^tools/' },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '\\.test\\.ts$' },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};

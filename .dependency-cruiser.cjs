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
    /*
     * The two rules below name their forbidden targets POSITIVELY, unlike the two above.
     *
     * The difference is deliberate and it is about what each layer is for. contracts and core
     * are meant to reach nothing at all — not another workspace package, not a package from
     * the registry, not even a Node builtin — so "everything except me and contracts" states
     * their rule exactly. adapters and store are the opposite: they ARE the I/O edge, and the
     * whole reason they exist is to hold the `pg` client, the filesystem reads and the crypto
     * that the pure middle must never contain. Writing their rule as a negation forbade
     * exactly the imports they are supposed to own, so it fired 14 times on correct code —
     * and a rule that fires on correct code is a rule someone switches off.
     *
     * So for these two the constraint is not "nothing else". It is "no other workspace
     * package", which is the boundary that actually matters.
     */
    {
      name: 'adapters-import-only-contracts',
      comment:
        'An adapter translates one vendor into our vocabulary. If it can reach core it ' +
        'will eventually make a product decision, and product decisions belong in core.',
      severity: 'error',
      from: { path: '^adapters/' },
      to: { path: '^(core|store|services|app|eval|ml)/' },
    },
    {
      name: 'store-imports-only-contracts',
      comment: 'store is the only place SQL lives. It persists the vocabulary, nothing more.',
      severity: 'error',
      from: { path: '^store/' },
      to: { path: '^(core|adapters|services|app|eval|ml)/' },
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
    /**
     * ★ THE RULE THAT KEEPS THE OTHERS HONEST.
     *
     * Every rule above is written against a resolved path. An import the resolver cannot
     * resolve has no resolved path — it keeps its bare specifier, matches none of the
     * patterns, and is therefore permitted by all of them. Unresolvable imports are not a
     * gap in coverage, they are a hole through which any forbidden edge passes silently.
     *
     * This is not hypothetical. Before `enhancedResolveOptions` was set below, EVERY
     * cross-package import in this repo was unresolvable, and the entire boundary check
     * passed on a codebase it was not actually reading. It reported success in CI.
     *
     * So: an import we cannot resolve is an error, not a warning. If a new workspace
     * package fails to resolve here, the answer is to fix the resolution or declare the
     * dependency — never to lower this severity.
     */
    {
      name: 'no-unresolvable',
      comment: 'An unresolvable import is invisible to every other rule in this file.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    /* Do not TRAVERSE into third-party code — but note this does not stop us RESOLVING
       through it, which matters below: every workspace package is reached via a symlink
       that lives in node_modules. */
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    /* Tests, and build output. `dist/` is gitignored so it never ships, but this tool walks
       the filesystem rather than the index — so a developer who has run `pnpm build` once
       gets a bundled copy of the whole app cruised as if it were source, reported as an
       orphan forever. Warnings nobody can action are how a real one gets scrolled past. */
    exclude: { path: '\\.test\\.ts$|(^|/)dist/' },

    /**
     * ★ WITHOUT THIS BLOCK EVERY BOUNDARY RULE SILENTLY PASSES.
     *
     * Each rule is written against a path — `^core/`, `^adapters/` — but every real import
     * in this repo is a package specifier, `@insidor/core`. If the resolver cannot turn one
     * into the other it reports the bare specifier as the resolved path, `@insidor/core`
     * matches none of the patterns, and the rule finds nothing to complain about. The check
     * then passes on a codebase that violates it, which is worse than having no check: it
     * passes loudly, in CI, next to a green tick.
     *
     * That was the actual state of this file. A probe importing `@insidor/core` from `app/`
     * — the one edge the architecture most depends on forbidding — was cruised clean.
     *
     * Three settings, all needed:
     *   - `exportsFields`/`conditionNames`: these packages have no `main`. They publish
     *     `exports: { ".": "./src/index.ts" }`, so a resolver not reading `exports` has
     *     nowhere to go.
     *   - `extensions`: the targets are `.ts`. There is no build step and nothing is
     *     compiled first, so a resolver looking for `.js` finds nothing.
     *   - `preserveSymlinks: false` (below, top level): pnpm links
     *     `node_modules/@insidor/core` to `../../core`. Resolving THROUGH the link yields
     *     `core/src/index.ts`, which is what `^core/` is written against. Preserve the
     *     symlink instead and the path stays under `node_modules/`, and the patterns miss
     *     again.
     *
     * `tools/check-boundaries-probe.mjs` asserts this stays working. Do not edit this block
     * without running it.
     */
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
    /* Resolve workspace links to their real paths. See the block above — this is half of
       what makes the boundary rules able to see a cross-package import at all. */
    preserveSymlinks: false,

    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};

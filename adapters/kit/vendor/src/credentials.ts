/**
 * WHAT A SOURCE NEEDS BEFORE IT CAN BE BUILT, AND WHAT THE ANSWER IS WHEN IT IS
 * NOT THERE.
 *
 * ★ THE ONE RULE THIS FILE EXISTS TO ENFORCE: A MISSING CREDENTIAL IS AN ANSWER,
 * NOT AN EXCEPTION.
 *
 * Every other way of writing this ends with a throw somewhere, and a throw makes
 * "nobody turned this on" arrive at the caller in the same shape as "this is
 * broken". Those demand opposite responses — the first is a person deciding to pay
 * for something, on their own schedule; the second is a retry, or somebody being
 * woken up — and a caller that has to read an error message to tell them apart will
 * eventually stop, at which point a permanently unconfigured source spends a quarter
 * looking like an intermittently flaky one. `RedditNotConfigured` in the reddit
 * client already makes exactly that argument for one source; this is the same
 * argument made once, in a type, for all of them.
 *
 * ★ WHY `dormant` AND `misconfigured` ARE DIFFERENT MEMBERS, which is the part that
 * looks like fussiness and is not. Absent-entirely means nobody supplied anything:
 * a legitimate, chosen, permanent state that a fresh clone is in for every paid
 * source, and it must never light a fault. Half-present means somebody DID turn it
 * on and got it wrong — a variable renamed on one side of a deploy, a secret that
 * did not make it into the environment, a block copied with one line missed. That is
 * the single most likely way a source somebody believes is running is silently not,
 * and reporting it as "you have not turned this on" would agree with them.
 *
 * A requirement with a `fallback` is not a credential and does not participate in
 * that split: a public host has a sensible default, a secret never does. So the
 * dormant/misconfigured judgement is made over the SECRETS alone — which is why
 * `X_API_BASE` being unset cannot make anything look half-configured.
 *
 * ★ WHAT THIS FILE DELIBERATELY DOES NOT DO: validate a credential's CONTENT. It
 * cannot — "is this user agent honest", "is this key the right shape" is vendor
 * knowledge and lives beside the client that knows it. Those checks stay where they
 * are, in the constructor, where they already throw; the layer above builds inside a
 * try and turns that throw into `misconfigured` too. One state, reached two ways,
 * and no duplicated predicate to drift.
 */

/** The environment, as data. Never `process.env` read from inside this package. */
export type CredentialEnv = Readonly<Record<string, string | undefined>>;

/**
 * One environment variable a source needs.
 *
 * `note` is operator-facing and is the thing a person reads at 2am when a source is
 * dark. It says where the value comes from, not what the code does with it.
 */
export interface CredentialRequirement {
  readonly variable: string;
  readonly note: string;
  /**
   * The value to use when the variable is unset.
   *
   * ★ NON-NULL MAKES THIS NOT A CREDENTIAL, and that is the only thing this field
   * means. A public host may have a default; a key, a token or a secret may not,
   * ever, because a default credential is a credential nobody chose and the failure
   * it produces is an authentication error against somebody else's account. A null
   * here is also what enrols the variable in the dormant-versus-misconfigured
   * judgement below — the two facts are the same fact, so they are one field.
   */
  readonly fallback: string | null;
}

/**
 * Everything one source needs from the environment, declared beside the client that
 * consumes it rather than in a central list.
 *
 * ★ WHY IT IS NOT CENTRAL. A list of every source's variables in one file drifts the
 * moment a vendor adds a required field, and it drifts SILENTLY: the adapter still
 * compiles, the list still looks complete, and the only symptom is a source that
 * reports itself configured and then throws on its first call. Kept in the package,
 * the declaration and the thing that reads the value are edited in the same diff.
 */
export interface CredentialSpec {
  /** The source id this belongs to. Matched against the adapter's own id upstream. */
  readonly source: string;
  readonly requires: readonly CredentialRequirement[];
}

/**
 * A resolved value lookup.
 *
 * A FUNCTION rather than a record, so that asking for a variable the spec never
 * declared is a loud throw at construction instead of an `undefined` that becomes an
 * empty string and then an authentication failure four layers away. Under
 * `noUncheckedIndexedAccess` a record would have forced every call site to handle an
 * absence that cannot happen, and the usual way that gets handled is `?? ''`.
 */
export type CredentialValues = (variable: string) => string;

export type CredentialCheck =
  /** Every declared variable has a value. The adapter can be built. */
  | { readonly kind: 'ready'; readonly values: CredentialValues }
  /**
   * No credential at all was supplied. NOT A FAULT. `missing` names the variables so
   * an operator can be told what turning it on would take.
   */
  | { readonly kind: 'dormant'; readonly missing: readonly string[] }
  /** Somebody configured it and got it wrong. A FAULT. `problems` says how. */
  | { readonly kind: 'misconfigured'; readonly problems: readonly string[] };

/** Absent, blank and whitespace-only are the same thing: nobody set it. */
function present(env: CredentialEnv, variable: string): string | null {
  const raw = env[variable];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read one source's requirements out of an environment.
 *
 * Pure, total, and it never throws. The whole point is that every outcome — including
 * the two bad ones — comes back as a value the caller can put on a screen.
 */
export function readCredentials(spec: CredentialSpec, env: CredentialEnv): CredentialCheck {
  const resolved = new Map<string, string>();
  const missingSecrets: string[] = [];
  const presentSecrets: string[] = [];

  for (const requirement of spec.requires) {
    const value = present(env, requirement.variable);
    const isSecret = requirement.fallback === null;

    if (value !== null) {
      resolved.set(requirement.variable, value);
      if (isSecret) presentSecrets.push(requirement.variable);
      continue;
    }

    if (isSecret) {
      missingSecrets.push(requirement.variable);
      continue;
    }
    resolved.set(requirement.variable, requirement.fallback);
  }

  /* A source that declares no secrets at all is one nobody has to turn on. It is
     ready by definition, and saying so here keeps the two branches below meaning
     exactly what they say rather than accidentally covering a third case. */
  if (missingSecrets.length > 0) {
    const total = missingSecrets.length + presentSecrets.length;
    if (presentSecrets.length === 0) {
      return { kind: 'dormant', missing: missingSecrets };
    }
    /* ★ Somebody supplied SOME of them. That is a mistake, not a decision, and it is
       reported as a fault so it reads differently from a source nobody switched on.
       The message names both halves: which are missing, and — because this is almost
       always a half-finished deploy — how many of the set were found. */
    return {
      kind: 'misconfigured',
      problems: missingSecrets.map(
        (variable) =>
          `${variable} is not set, but ${presentSecrets.length} of this source's ${total} ` +
          `credentials are. A partly configured source is a mistake rather than a choice: ` +
          `set it, or unset the rest to turn the source off deliberately.`,
      ),
    };
  }

  return {
    kind: 'ready',
    values: (variable) => {
      const value = resolved.get(variable);
      if (value === undefined) {
        throw new RangeError(
          `${spec.source}: '${variable}' was read but is not declared in this source's ` +
            'credential spec. Add it to the spec, or the value it resolves to is nobody\'s.',
        );
      }
      return value;
    },
  };
}

/** Every variable a source would need, for a message that offers to help. */
export const credentialVariables = (spec: CredentialSpec): readonly string[] =>
  spec.requires.filter((r) => r.fallback === null).map((r) => r.variable);

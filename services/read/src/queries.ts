/**
 * Every statement of SQL this service will ever contain. There are three, they are
 * constants, and none of them joins anything.
 *
 * WHY SQL LIVES HERE AND NOT IN store/, against the usual rule: this package
 * declares NO workspace dependency, not even @insidor/store, and that absence is
 * the safety argument made structural. `@insidor/store` exports `createPool`, which
 * takes a role — so importing it would put `createPool('internal')` one identifier
 * away from a process the browser talks to. Three frozen SELECTs and a bare `pg`
 * client is a smaller surface to audit than a repository layer plus the discipline
 * not to call the wrong factory. The cost is that these three strings are not
 * covered by store's tests; the benefit is that there is no code path in this
 * process that can open a privileged connection at all.
 *
 * WHY THE PAYLOAD IS ONE jsonb COLUMN AND NOT A COLUMN LIST: a column list is how a
 * score gets requested. Someone needs "just the heat for debugging", adds it to the
 * select, adds it to the shape, and it is on a screen a week later. A table whose
 * public half is a single opaque `payload` has nothing to add. The projection has
 * already been censored in services/project; this service's whole job is to hand it
 * over unchanged. app/src/shared/api/client.ts states the same intent from the other
 * side: "the read surface is a physical table with no internal column in it".
 *
 * NOTHING IN THIS FILE COMPUTES. No aggregate, no CASE, no coalesce, no ordering
 * expression — `position` was decided by the projector and is read back, not
 * re-derived. If a value needs working out, it belongs in services/project, where it
 * happens once and can be tested, rather than here, where it would happen on every
 * request and be invisible.
 */

/** One row of whatever the driver hands back. Read by column name, narrowed at the edge. */
export type Row = Record<string, unknown>;

/**
 * The only thing this service needs from a database client, and therefore the only
 * thing a test has to fake. Non-generic on purpose: the driver returns rows whose
 * shape it cannot know, so the honest type is `unknown` per column and a narrowing
 * step at the point of use. A generic that promised `{ tick: number }` would be
 * promising something no runtime check backs.
 */
export interface Db {
  query(sql: string, params: readonly unknown[]): Promise<readonly Row[]>;
}

/**
 * Existence is the 404 test. A view id with no row here has never been projected,
 * which is a different fact from a view whose board is momentarily empty — and the
 * two have to stay distinguishable, because an empty board is a legitimate answer
 * and an unknown view is not.
 */
export const BOARD_VIEW_SQL = 'select tick from public.board_view where view_id = $1';

/**
 * `position` is quoted because POSITION is a SQL keyword. Postgres does accept it
 * unquoted as a column name; quoting removes the question rather than relying on
 * which keyword category it happens to sit in.
 *
 * The order comes from the projector and is committed. The client never sorts —
 * `order` on the wire IS the ranking, expressed as position in an array so a row
 * cannot carry "our rank" off the board and into a screenshot.
 */
export const BOARD_ROWS_SQL =
  'select story_id, payload from public.board_row where view_id = $1 order by "position" asc';

export const STORY_SQL = 'select payload from public.story_view where story_id = $1';

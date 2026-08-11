/**
 * The marker for work that is genuinely ahead of us, as opposed to work that was
 * forgotten.
 *
 * It throws rather than returning an empty result on purpose. A repository method
 * that quietly returns `[]` is indistinguishable from one that ran and found
 * nothing — the exact confusion this system spent seven hours inside once already.
 */
export class NotImplemented extends Error {
  constructor(what: string, why?: string) {
    super(why ? `${what} is not implemented yet: ${why}` : `${what} is not implemented yet`);
    this.name = 'NotImplemented';
  }
}

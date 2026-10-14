/**
 * A language's English name from its two- or three-letter code ('pt' → 'Portuguese'), for the
 * line under a translated post: "Translated from Portuguese".
 *
 * Its own file because the name comes from the phone's own language tables (Intl.DisplayNames),
 * which an old browser may not have and which answer an unknown code with the code itself. Both
 * cases are "we cannot name it", and the line then says "Translated" with no language rather than
 * printing a bare code nobody reads, or guessing.
 *
 * What breaks if changed carelessly: the names are asked for in English, whatever the phone's own
 * language, because every other word in the app is English.
 */

let names: Intl.DisplayNames | null | undefined;

export function languageName(code: string): string | null {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'language' });
    } catch {
      names = null;
    }
  }
  if (names === null) return null;
  try {
    const name = names.of(code);
    return name === undefined || name === '' || name.toLowerCase() === code.toLowerCase() ? null : name;
  } catch {
    return null;
  }
}

/**
 * THE UNREAD COUNT, FOR THE BELL ON EVERY TAB (the owner, 2026-11-04, layout A: "the bell … in an
 * unideal location"). App reads it from the alert service (GET /alerts/unread, every minute) and
 * provides it here once, so each tab's header bell shows the same number without each screen being
 * handed it as a prop.
 *
 * What breaks if changed carelessly: App must stay the one reader. A screen that read the count itself
 * would ask the service once per tab and could show a different number from the next tab's bell.
 */
import { createContext, useContext } from 'react';

export const UnreadContext = createContext(0);

/** The alert service's unread count, as App last read it; 0 before the first read. */
export const useUnread = (): number => useContext(UnreadContext);

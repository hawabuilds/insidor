/**
 * The design system's surface.
 *
 * `ui/` is a leaf. It imports `shared/format` — the missing-data rules, which the primitives
 * have to share or the rule would be advisory — and nothing else from `src/`. It knows
 * shapes; it does not know what a story or a coin is.
 */

export { Button } from './Button.tsx';
export type { ButtonTone } from './Button.tsx';
export { Card, Tag } from './Card.tsx';
export { CommandPalette } from './CommandPalette.tsx';
export { Delta } from './Delta.tsx';
export { Num } from './Num.tsx';
export { Pending } from './Pending.tsx';
export { Sparkline } from './Sparkline.tsx';
export type { SparkPoint, Tone } from './Sparkline.tsx';
export { Thumb } from './Thumb.tsx';

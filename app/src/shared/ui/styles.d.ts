/**
 * CSS Modules, declared for the type checker.
 *
 * Vite resolves these imports; tsc needs to be told they exist. Kept deliberately loose —
 * generating exact class-name types would need a build step, and this package does not have
 * one for anything else either.
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module '*.css';

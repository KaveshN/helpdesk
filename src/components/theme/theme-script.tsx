/**
 * Resolves the OS colour scheme before first paint when the user has not
 * chosen a theme explicitly.
 *
 * The server stamps `data-theme="light|dark"` from the cookie when there is
 * an explicit choice, so this script is a no-op then. With "system" there is
 * no attribute, and this blocking inline script fills it in from
 * `prefers-color-scheme` before any CSS is applied -- the same trick
 * next-themes uses, without the dependency. `<html>` carries
 * `suppressHydrationWarning` because React will see the attribute this
 * script added.
 */
const SCRIPT = `(function(){var d=document.documentElement;if(!d.dataset.theme){d.dataset.theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

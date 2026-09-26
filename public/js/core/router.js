/**
 * Minimal History-API router.
 *
 * Route paths come from config (`routes` in config/default.json), so URLs can
 * be changed without touching code. Views are registered by route *name*
 * (register, verify, welcome, login, otp). The dashboard is a separate page.
 */
export function createRouter({ routes, views, onChange, fallback }) {
  const nameByPath = Object.fromEntries(Object.entries(routes).map(([name, path]) => [path, name]));

  function resolve() {
    const name = nameByPath[location.pathname.replace(/\/+$/, '') || '/'];
    if (!name || !views[name]) return navigate(fallback, { replace: true });
    onChange(name, views[name]);
  }

  /** Go to a route by name, e.g. navigate('login'). */
  function navigate(name, { replace = false } = {}) {
    const path = routes[name];
    if (!path) throw new Error(`Unknown route "${name}"`);
    if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
    resolve();
  }

  window.addEventListener('popstate', resolve);

  return { navigate, start: resolve };
}

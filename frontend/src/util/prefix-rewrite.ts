// Canonical implementation of the path-prefix shim's URL maths, kept here so
// it can be unit tested. The shim itself has to run inline in index.html
// before any module loads (it wraps fetch, WebSocket and script.src before the
// bundled runtime touches them), so it cannot import this file: index.html
// carries a hand-copied mirror of both functions. Change one, change the
// other, and keep the behaviour identical.

// rewritePrefixURL reparents a root-absolute /wails/* reference under the
// directory the document is served from. The bundled @wailsio/runtime and the
// server's custom.js hardcode origin + "/wails/...", which escapes a reverse
// proxy's path prefix; resolving them against the document directory instead
// keeps them inside it. Served at the root the directory is "/", so this is a
// no-op. Rewriting is idempotent: an already-prefixed URL no longer starts
// with "/wails/" and is returned untouched.
export const rewritePrefixURL = (
  value: string,
  baseURI: string,
  host: string
): string => {
  try {
    const resolved = new URL(value, baseURI);
    if (resolved.host === host && resolved.pathname.indexOf("/wails/") === 0) {
      const dir = new URL(".", baseURI).pathname;
      // Preserve protocol (ws/wss/http/https), search and hash; only reparent
      // the path under the document directory.
      resolved.pathname = dir + resolved.pathname.slice(1);
      return resolved.href;
    }
  } catch (e) {}
  return value;
};

// slashRedirectTarget answers "is this page served under a prefix that was
// entered without its trailing slash?". At /prefix the document directory is
// the origin root, so every relative asset URL and every rewrite above
// silently escapes the prefix: assets 404 and the page stays blank. A proxy
// that redirects /prefix to /prefix/ never hits this, but nginx and Caddy
// strip_prefix setups often do not, so the page heals itself by reloading at
// the directory form. Returns the URL to redirect to, or null to stay put.
export const slashRedirectTarget = (location: {
  pathname: string;
  search: string;
  hash: string;
}): string | null => {
  const path = location.pathname;
  if (path === "" || path === "/" || path.charAt(path.length - 1) === "/") {
    return null;
  }
  // A last segment with a dot is a file (/index.html), not a prefix entered
  // without its slash. Appending a slash there would only 404.
  const last = path.slice(path.lastIndexOf("/") + 1);
  if (last.indexOf(".") !== -1) return null;
  return path + "/" + location.search + location.hash;
};

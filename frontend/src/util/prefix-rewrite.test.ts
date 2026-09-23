import { describe, it, expect } from "vitest";
import { rewritePrefixURL, slashRedirectTarget } from "./prefix-rewrite";

// The shim passes location.host, which always matches the document's own host.
const at = (baseURI: string) => (value: string) =>
  rewritePrefixURL(value, baseURI, new URL(baseURI).host);

describe("rewritePrefixURL", () => {
  it("is a no-op at the origin root", () => {
    const rewrite = at("http://host:9500/");
    expect(rewrite("/wails/runtime")).toBe("http://host:9500/wails/runtime");
    expect(rewrite("/wails/custom.js")).toBe("http://host:9500/wails/custom.js");
  });

  it("reparents /wails/* under a single-segment prefix", () => {
    const rewrite = at("http://host:9600/prefix/");
    expect(rewrite("http://host:9600/wails/runtime")).toBe(
      "http://host:9600/prefix/wails/runtime"
    );
    // The events socket keeps its ws:// (or wss://) protocol.
    expect(rewrite("ws://host:9600/wails/events")).toBe(
      "ws://host:9600/prefix/wails/events"
    );
  });

  it("reparents under a multi-segment ingress-shaped prefix", () => {
    const rewrite = at("http://host:9500/api/hassio_ingress/abc123/");
    expect(rewrite("/wails/runtime")).toBe(
      "http://host:9500/api/hassio_ingress/abc123/wails/runtime"
    );
  });

  it("resolves against the document directory, not the document itself", () => {
    // A pop-out tab's URL carries a query but the same directory.
    const rewrite = at("http://host:9600/prefix/?conn=1&view=chart");
    expect(rewrite("/wails/runtime")).toBe(
      "http://host:9600/prefix/wails/runtime"
    );
  });

  it("is idempotent: an already-prefixed URL is left alone", () => {
    const rewrite = at("http://host:9600/prefix/");
    const once = rewrite("/wails/runtime");
    expect(rewrite(once)).toBe(once);
  });

  it("preserves search and hash", () => {
    const rewrite = at("http://host:9600/prefix/");
    expect(rewrite("/wails/runtime?probe=1#frag")).toBe(
      "http://host:9600/prefix/wails/runtime?probe=1#frag"
    );
  });

  it("leaves non-/wails paths and other hosts untouched", () => {
    const rewrite = at("http://host:9600/prefix/");
    expect(rewrite("/assets/index.js")).toBe("/assets/index.js");
    expect(rewrite("./assets/index.js")).toBe("./assets/index.js");
    expect(rewrite("http://elsewhere:1/wails/runtime")).toBe(
      "http://elsewhere:1/wails/runtime"
    );
    expect(rewrite("/wailsx/runtime")).toBe("/wailsx/runtime");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(rewritePrefixURL("::not a url::", "::also not::", "host:9500")).toBe(
      "::not a url::"
    );
  });

  it("degrades to a no-op when the prefix has no trailing slash", () => {
    // The case slashRedirectTarget heals: the document directory is the origin
    // root, so /wails/* stays root-absolute and escapes the prefix.
    const rewrite = at("http://host:9600/prefix");
    expect(rewrite("/wails/runtime")).toBe("http://host:9600/wails/runtime");
  });
});

describe("slashRedirectTarget", () => {
  const loc = (pathname: string, search = "", hash = "") => ({
    pathname,
    search,
    hash,
  });

  it("stays put at the origin root", () => {
    expect(slashRedirectTarget(loc("/"))).toBeNull();
    expect(slashRedirectTarget(loc(""))).toBeNull();
    expect(slashRedirectTarget(loc("/", "?conn=1&view=chart"))).toBeNull();
  });

  it("stays put when the prefix already has its slash", () => {
    expect(slashRedirectTarget(loc("/prefix/"))).toBeNull();
    expect(slashRedirectTarget(loc("/api/hassio_ingress/abc123/"))).toBeNull();
  });

  it("adds the missing slash to a prefix", () => {
    expect(slashRedirectTarget(loc("/prefix"))).toBe("/prefix/");
    expect(slashRedirectTarget(loc("/api/hassio_ingress/abc123"))).toBe(
      "/api/hassio_ingress/abc123/"
    );
  });

  it("carries the query and hash across", () => {
    expect(slashRedirectTarget(loc("/prefix", "?conn=1&view=status", "#x"))).toBe(
      "/prefix/?conn=1&view=status#x"
    );
  });

  it("leaves file-looking paths alone", () => {
    expect(slashRedirectTarget(loc("/index.html"))).toBeNull();
    expect(slashRedirectTarget(loc("/prefix/index.html"))).toBeNull();
  });

  it("does not fire again on the URL it redirects to", () => {
    const target = slashRedirectTarget(loc("/prefix"));
    expect(target).not.toBeNull();
    expect(slashRedirectTarget(loc(target as string))).toBeNull();
  });
});

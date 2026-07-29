// ingress-sim is a tiny reverse proxy that simulates Home Assistant ingress
// for the server-mode build: it serves the app under a path prefix and strips
// that prefix before forwarding to the upstream server, exactly as HA ingress
// does when it mounts an add-on at /api/hassio_ingress/<token>/. Use it to
// verify the UI, binding calls (/wails/runtime), the event WebSocket
// (/wails/events) and popout tabs all survive being served off the origin
// root. See docs/DOCKER.md "Home Assistant and other platforms".
//
// Usage (with the server-mode app already running, scripts/serve-browser.sh):
//
//	go build -o bin/ingress-sim ./scripts && bin/ingress-sim
//	open http://localhost:9600/prefix/
//
// Flags: -listen :9600, -prefix /prefix, -upstream http://127.0.0.1:9500,
// -redirect (default true).
//
// -redirect=false drops the 302 from /prefix to /prefix/, which is what nginx
// and Caddy strip_prefix setups do. Use it to check the page still heals
// itself when the prefix is entered without its trailing slash:
//
//	bin/ingress-sim -listen :9601 -redirect=false
//	open http://localhost:9601/prefix
//
// Build the binary somewhere under the repo tree (bin/ is gitignored), not a
// sandboxed scratchpad or temp dir: on macOS, Go binaries written outside the
// repo by a sandboxed agent build have been seen to die at exec with
// "missing LC_UUID load command".
package main

import (
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func main() {
	listen := flag.String("listen", ":9600", "address to listen on")
	prefix := flag.String("prefix", "/prefix", "path prefix to serve the app under")
	upstreamFlag := flag.String("upstream", "http://127.0.0.1:9500", "server-mode app to proxy to")
	redirect := flag.Bool("redirect", true, "redirect the prefix root to its trailing-slash form, as HA ingress does; -redirect=false mirrors a bare nginx/Caddy strip_prefix")
	flag.Parse()

	upstream, err := url.Parse(*upstreamFlag)
	if err != nil {
		log.Fatalf("bad -upstream: %v", err)
	}
	// httputil.ReverseProxy passes WebSocket upgrades through, which the
	// /wails/events endpoint needs (HA ingress does the same).
	rp := httputil.NewSingleHostReverseProxy(upstream)
	p := strings.TrimSuffix(*prefix, "/")

	handler := func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == p && *redirect {
			http.Redirect(w, r, p+"/", http.StatusFound)
			return
		}
		if r.URL.Path != p && !strings.HasPrefix(r.URL.Path, p+"/") {
			// Anything outside the prefix 404s, like ingress: a root-absolute
			// URL that escapes the prefix must visibly fail here.
			http.Error(w, "not found (app is served under "+p+"/)", http.StatusNotFound)
			return
		}
		// Strip the prefix before forwarding, exactly like HA ingress.
		r.URL.Path = strings.TrimPrefix(r.URL.Path, p)
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}
		log.Printf("%s %s -> upstream %s", r.Method, p+r.URL.Path, r.URL.Path)
		rp.ServeHTTP(w, r)
	}

	if *redirect {
		log.Printf("ingress-sim: http://localhost%s%s/ -> %s", *listen, p, upstream)
	} else {
		log.Printf("ingress-sim: http://localhost%s%s/ -> %s (no trailing-slash redirect)", *listen, p, upstream)
	}
	log.Fatal(http.ListenAndServe(*listen, http.HandlerFunc(handler)))
}

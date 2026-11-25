package httpserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var assetReference = regexp.MustCompile(`(src|href)="(/[^"?]+\.(?:js|css))"`)

// newStaticHandler serves the Web UI so that browsers and CDNs never mix files
// from two releases: index.html names every script and stylesheet with a hash
// of the whole asset set, and is itself revalidated on each load.
func newStaticHandler(assets fs.FS) (http.Handler, error) {
	digest := sha256.New()
	files := make(map[string]bool)
	err := fs.WalkDir(assets, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		body, err := fs.ReadFile(assets, path)
		if err != nil {
			return err
		}
		files["/"+path] = true
		fmt.Fprintf(digest, "%s %d\n", path, len(body))
		_, _ = digest.Write(body)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("hash web assets: %w", err)
	}
	version := hex.EncodeToString(digest.Sum(nil))[:16]

	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		return nil, fmt.Errorf("read index.html: %w", err)
	}
	index = assetReference.ReplaceAll(index, []byte(`${1}="${2}?v=`+version+`"`))
	fileServer := http.FileServer(http.FS(assets))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			// no-transform also stops proxies from injecting scripts that the CSP blocks.
			w.Header().Set("Cache-Control", "no-cache, no-transform")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
			return
		}
		// Only the current version may be cached; another one means releases are mixing.
		if files[r.URL.Path] && !strings.HasSuffix(r.URL.Path, ".html") && r.URL.Query().Get("v") == version {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	}), nil
}

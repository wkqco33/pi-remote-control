package httpserver

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"
)

func serve(t *testing.T, handler http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	return recorder
}

func TestEmbeddedIndexVersionsEveryAsset(t *testing.T) {
	assets, err := fs.Sub(staticFS, "static")
	if err != nil {
		t.Fatal(err)
	}
	handler, err := newStaticHandler(assets)
	if err != nil {
		t.Fatal(err)
	}
	index := serve(t, handler, "/")
	if got := index.Header().Get("Cache-Control"); got != "no-cache, no-transform" {
		t.Fatalf("unexpected index cache policy: %q", got)
	}
	references := regexp.MustCompile(`(?:src|href)="(/[^"]+\.(?:js|css)[^"]*)"`).FindAllStringSubmatch(index.Body.String(), -1)
	if len(references) == 0 {
		t.Fatal("index.html references no assets")
	}
	for _, reference := range references {
		if !strings.Contains(reference[1], "?v=") {
			t.Fatalf("unversioned asset: %s", reference[1])
		}
		asset := serve(t, handler, reference[1])
		if asset.Code != http.StatusOK || !strings.Contains(asset.Header().Get("Cache-Control"), "immutable") {
			t.Fatalf("%s: status=%d cache=%q", reference[1], asset.Code, asset.Header().Get("Cache-Control"))
		}
		stale := serve(t, handler, strings.Split(reference[1], "?")[0]+"?v=older")
		if got := stale.Header().Get("Cache-Control"); got != "no-cache" {
			t.Fatalf("a mismatched version must be revalidated, got %q", got)
		}
	}
}

func TestAssetVersionFollowsContent(t *testing.T) {
	versionOf := func(script string) string {
		handler, err := newStaticHandler(fstest.MapFS{
			"index.html": {Data: []byte(`<script src="/a.js"></script>`)},
			"a.js":       {Data: []byte(script)},
		})
		if err != nil {
			t.Fatal(err)
		}
		return serve(t, handler, "/").Body.String()
	}
	if versionOf("one") == versionOf("two") || versionOf("one") != versionOf("one") {
		t.Fatal("the asset version must change exactly when content changes")
	}
}

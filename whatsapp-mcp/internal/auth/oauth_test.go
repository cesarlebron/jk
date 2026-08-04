package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

const (
	testPassphrase = "frase-de-prueba-larga"
	testRedirect   = "https://claude.ai/api/mcp/auth_callback"
)

type harness struct {
	srv *Server
	ts  *httptest.Server
	// client is a non-redirecting client so we can inspect 302 responses.
	client *http.Client
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := context.Background()

	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	mux := http.NewServeMux()
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	// The issuer must match the test server so redirect/metadata URLs line up.
	// New() only allows plaintext for localhost, which httptest gives us.
	issuer := strings.Replace(ts.URL, "127.0.0.1", "localhost", 1)
	srv, err := New(ctx, Config{DB: db, Issuer: issuer, Passphrase: testPassphrase})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	srv.Routes(mux, "/mcp")
	mux.Handle("/mcp", srv.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("protegido"))
	})))

	return &harness{
		srv: srv,
		ts:  ts,
		client: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
	}
}

// register performs dynamic client registration and returns the client_id.
func (h *harness) register(t *testing.T) string {
	t.Helper()
	body := `{"redirect_uris":["` + testRedirect + `"],"client_name":"Claude"}`
	resp, err := h.client.Post(h.ts.URL+"/oauth/register", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register status = %d, want 201", resp.StatusCode)
	}
	var out struct {
		ClientID string `json:"client_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode registration: %v", err)
	}
	if out.ClientID == "" {
		t.Fatal("registration returned an empty client_id")
	}
	return out.ClientID
}

func pkce(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (h *harness) authzURL(clientID, challenge, redirect string) string {
	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {clientID},
		"redirect_uri":          {redirect},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"state":                 {"xyz"},
	}
	return h.ts.URL + "/oauth/authorize?" + q.Encode()
}

// authorize submits the passphrase form and returns the issued code.
func (h *harness) authorize(t *testing.T, clientID, challenge, passphrase string) (code string, resp *http.Response) {
	t.Helper()
	form := url.Values{"passphrase": {passphrase}}
	resp, err := h.client.Post(h.authzURL(clientID, challenge, testRedirect),
		"application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	if resp.StatusCode != http.StatusFound {
		return "", resp
	}
	loc, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect: %v", err)
	}
	if got := loc.Query().Get("state"); got != "xyz" {
		t.Errorf("state = %q, want xyz", got)
	}
	return loc.Query().Get("code"), resp
}

func (h *harness) token(t *testing.T, form url.Values) (*http.Response, map[string]any) {
	t.Helper()
	resp, err := h.client.PostForm(h.ts.URL+"/oauth/token", form)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func (h *harness) callProtected(t *testing.T, token string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, h.ts.URL+"/mcp", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		t.Fatalf("protected call: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

// The whole path claude.ai walks: register, authorize, exchange, call, refresh.
func TestFullAuthorizationCodeFlow(t *testing.T) {
	h := newHarness(t)
	clientID := h.register(t)
	verifier := "verificador-de-prueba-suficientemente-largo-123456"

	code, _ := h.authorize(t, clientID, pkce(verifier), testPassphrase)
	if code == "" {
		t.Fatal("authorize did not return a code")
	}

	resp, body := h.token(t, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"client_id":     {clientID},
		"redirect_uri":  {testRedirect},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("token status = %d, want 200 (%v)", resp.StatusCode, body)
	}
	access, _ := body["access_token"].(string)
	refresh, _ := body["refresh_token"].(string)
	if access == "" || refresh == "" {
		t.Fatalf("missing tokens in response: %v", body)
	}

	if got := h.callProtected(t, access); got != http.StatusOK {
		t.Errorf("protected call with valid token = %d, want 200", got)
	}

	// Refresh yields a working new access token.
	resp, body = h.token(t, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refresh},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("refresh status = %d, want 200 (%v)", resp.StatusCode, body)
	}
	newAccess, _ := body["access_token"].(string)
	if newAccess == "" || newAccess == access {
		t.Fatal("refresh did not issue a new access token")
	}
	if got := h.callProtected(t, newAccess); got != http.StatusOK {
		t.Errorf("protected call with refreshed token = %d, want 200", got)
	}

	// Refresh tokens rotate: the old one must be dead.
	resp, _ = h.token(t, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refresh},
	})
	if resp.StatusCode == http.StatusOK {
		t.Error("the rotated refresh token was accepted a second time")
	}
}

func TestProtectedEndpointRejectsBadTokens(t *testing.T) {
	h := newHarness(t)
	for name, token := range map[string]string{
		"no token":      "",
		"garbage token": "no-es-un-token",
	} {
		t.Run(name, func(t *testing.T) {
			if got := h.callProtected(t, token); got != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", got)
			}
		})
	}
}

// A 401 must point clients at the metadata document so discovery can start.
func TestChallengeAdvertisesMetadata(t *testing.T) {
	h := newHarness(t)
	req, _ := http.NewRequest(http.MethodGet, h.ts.URL+"/mcp", nil)
	resp, err := h.client.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("WWW-Authenticate"); !strings.Contains(got, "oauth-protected-resource") {
		t.Errorf("WWW-Authenticate = %q, want a resource_metadata pointer", got)
	}
}

func TestWrongPassphraseIssuesNoCode(t *testing.T) {
	h := newHarness(t)
	clientID := h.register(t)
	code, resp := h.authorize(t, clientID, pkce("v"), "frase-incorrecta")
	if code != "" {
		t.Fatal("a code was issued for a wrong passphrase")
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestPKCEVerifierIsEnforced(t *testing.T) {
	h := newHarness(t)
	clientID := h.register(t)
	code, _ := h.authorize(t, clientID, pkce("el-verificador-correcto"), testPassphrase)

	resp, body := h.token(t, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {"el-verificador-equivocado"},
		"client_id":     {clientID},
		"redirect_uri":  {testRedirect},
	})
	if resp.StatusCode == http.StatusOK {
		t.Fatalf("a mismatched code_verifier was accepted: %v", body)
	}
}

func TestAuthorizationCodeIsSingleUse(t *testing.T) {
	h := newHarness(t)
	clientID := h.register(t)
	verifier := "verificador-unico-de-prueba"
	code, _ := h.authorize(t, clientID, pkce(verifier), testPassphrase)

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"client_id":     {clientID},
		"redirect_uri":  {testRedirect},
	}
	if resp, body := h.token(t, form); resp.StatusCode != http.StatusOK {
		t.Fatalf("first exchange failed: %d %v", resp.StatusCode, body)
	}
	if resp, _ := h.token(t, form); resp.StatusCode == http.StatusOK {
		t.Error("the same authorization code was redeemed twice")
	}
}

// An attacker who learns a client_id must not be able to redirect codes to a
// host of their choosing.
func TestUnregisteredRedirectURIIsRejected(t *testing.T) {
	h := newHarness(t)
	clientID := h.register(t)

	resp, err := h.client.Get(h.authzURL(clientID, pkce("v"), "https://atacante.example/callback"))
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestPKCEIsMandatory(t *testing.T) {
	h := newHarness(t)
	clientID := h.register(t)

	q := url.Values{
		"response_type": {"code"},
		"client_id":     {clientID},
		"redirect_uri":  {testRedirect},
	}
	resp, err := h.client.Get(h.ts.URL + "/oauth/authorize?" + q.Encode())
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for a request without PKCE", resp.StatusCode)
	}
}

func TestPassphraseAttemptsAreRateLimited(t *testing.T) {
	h := newHarness(t)
	clientID := h.register(t)
	challenge := pkce("v")

	for i := 0; i < maxAttempts; i++ {
		if _, resp := h.authorize(t, clientID, challenge, "incorrecta"); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", i+1, resp.StatusCode)
		}
	}
	_, resp := h.authorize(t, clientID, challenge, "incorrecta")
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("status after %d failures = %d, want 429", maxAttempts, resp.StatusCode)
	}
	// The lockout must hold even once the correct passphrase is presented.
	if code, _ := h.authorize(t, clientID, challenge, testPassphrase); code != "" {
		t.Error("a code was issued while the client was rate limited")
	}
}

func TestMetadataDocuments(t *testing.T) {
	h := newHarness(t)

	t.Run("authorization server", func(t *testing.T) {
		resp, err := h.client.Get(h.ts.URL + "/.well-known/oauth-authorization-server")
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		defer resp.Body.Close()
		var md map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&md); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, key := range []string{"issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint"} {
			if md[key] == "" || md[key] == nil {
				t.Errorf("metadata is missing %q", key)
			}
		}
		methods, _ := md["code_challenge_methods_supported"].([]any)
		if len(methods) != 1 || methods[0] != "S256" {
			t.Errorf("code_challenge_methods_supported = %v, want [S256]", methods)
		}
	})

	t.Run("protected resource", func(t *testing.T) {
		resp, err := h.client.Get(h.ts.URL + "/.well-known/oauth-protected-resource")
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		defer resp.Body.Close()
		var md map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&md); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if res, _ := md["resource"].(string); !strings.HasSuffix(res, "/mcp") {
			t.Errorf("resource = %q, want it to point at the MCP endpoint", res)
		}
		if servers, _ := md["authorization_servers"].([]any); len(servers) != 1 {
			t.Errorf("authorization_servers = %v, want exactly one", servers)
		}
	})
}

func TestNewRejectsWeakConfig(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "a.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	t.Run("short passphrase", func(t *testing.T) {
		if _, err := New(ctx, Config{DB: db, Issuer: "https://x.example", Passphrase: "corta"}); err == nil {
			t.Error("a short passphrase was accepted")
		}
	})
	t.Run("plaintext issuer", func(t *testing.T) {
		if _, err := New(ctx, Config{DB: db, Issuer: "http://x.example", Passphrase: testPassphrase}); err == nil {
			t.Error("a non-HTTPS public URL was accepted")
		}
	})
}

// Package auth implements the minimum OAuth 2.1 authorization server that
// claude.ai needs in order to add a remote MCP server as a custom connector:
// metadata discovery (RFC 8414 / RFC 9728), dynamic client registration
// (RFC 7591), and an authorization-code flow with PKCE (RFC 7636).
//
// It is deliberately single-user. The only credential is a passphrase you set
// via WHATSAPP_MCP_PASSPHRASE; anyone who knows it can link a client and read
// your messages, so treat it like your WhatsApp itself.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	accessTokenTTL  = time.Hour
	refreshTokenTTL = 90 * 24 * time.Hour
	authCodeTTL     = 5 * time.Minute

	// Brute-force ceiling on the passphrase form.
	maxAttempts   = 8
	attemptWindow = 15 * time.Minute
)

const schema = `
CREATE TABLE IF NOT EXISTS oauth_clients (
	client_id     TEXT PRIMARY KEY,
	redirect_uris TEXT NOT NULL,
	client_name   TEXT NOT NULL DEFAULT '',
	created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
	code_hash      TEXT PRIMARY KEY,
	client_id      TEXT NOT NULL,
	redirect_uri   TEXT NOT NULL,
	code_challenge TEXT NOT NULL,
	expires_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
	token_hash TEXT PRIMARY KEY,
	client_id  TEXT NOT NULL,
	kind       TEXT NOT NULL,
	expires_at INTEGER NOT NULL
);
`

// Server is the authorization server and bearer-token guard.
type Server struct {
	db         *sql.DB
	issuer     string // public base URL, e.g. https://wa.example.com
	passphrase string

	mu       sync.Mutex
	attempts map[string][]time.Time // client IP -> recent failed logins
}

// Config configures the authorization server.
type Config struct {
	// DB is an open SQLite handle; the OAuth tables are created in it.
	DB *sql.DB
	// Issuer is the public HTTPS base URL clients reach this server on.
	Issuer string
	// Passphrase is the single credential that authorises linking a client.
	Passphrase string
}

// New prepares the authorization server.
func New(ctx context.Context, cfg Config) (*Server, error) {
	if cfg.DB == nil {
		return nil, errors.New("auth: DB is required")
	}
	if len(cfg.Passphrase) < 12 {
		return nil, errors.New("auth: la frase de acceso debe tener al menos 12 caracteres")
	}
	if !strings.HasPrefix(cfg.Issuer, "https://") && !strings.HasPrefix(cfg.Issuer, "http://localhost") {
		return nil, fmt.Errorf("auth: la URL publica debe ser https:// (recibido %q)", cfg.Issuer)
	}
	if _, err := cfg.DB.ExecContext(ctx, schema); err != nil {
		return nil, fmt.Errorf("auth: migrate: %w", err)
	}
	return &Server{
		db:         cfg.DB,
		issuer:     strings.TrimRight(cfg.Issuer, "/"),
		passphrase: cfg.Passphrase,
		attempts:   make(map[string][]time.Time),
	}, nil
}

// Routes registers every OAuth endpoint on mux.
func (s *Server) Routes(mux *http.ServeMux, resourcePath string) {
	mux.HandleFunc("GET /.well-known/oauth-authorization-server", s.handleASMetadata)
	// Claude probes the path-suffixed form too when the MCP endpoint is nested.
	mux.HandleFunc("GET /.well-known/oauth-authorization-server/", s.handleASMetadata)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource", s.protectedResource(resourcePath))
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/", s.protectedResource(resourcePath))
	mux.HandleFunc("POST /oauth/register", s.handleRegister)
	mux.HandleFunc("GET /oauth/authorize", s.handleAuthorizeForm)
	mux.HandleFunc("POST /oauth/authorize", s.handleAuthorizeSubmit)
	mux.HandleFunc("POST /oauth/token", s.handleToken)
}

func (s *Server) handleASMetadata(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                s.issuer,
		"authorization_endpoint":                s.issuer + "/oauth/authorize",
		"token_endpoint":                        s.issuer + "/oauth/token",
		"registration_endpoint":                 s.issuer + "/oauth/register",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported":                      []string{"whatsapp"},
	})
}

func (s *Server) protectedResource(resourcePath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"resource":                 s.issuer + resourcePath,
			"authorization_servers":    []string{s.issuer},
			"bearer_methods_supported": []string{"header"},
			"scopes_supported":         []string{"whatsapp"},
			"resource_name":            "WhatsApp personal",
		})
	}
}

// handleRegister implements dynamic client registration. Claude calls this
// before the first authorization; we accept any client but pin its redirect
// URIs so a stolen client_id cannot redirect codes elsewhere.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RedirectURIs []string `json:"redirect_uris"`
		ClientName   string   `json:"client_name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_client_metadata", "cuerpo JSON invalido")
		return
	}
	if len(req.RedirectURIs) == 0 {
		writeErr(w, http.StatusBadRequest, "invalid_redirect_uri", "se requiere redirect_uris")
		return
	}
	for _, u := range req.RedirectURIs {
		parsed, err := url.Parse(u)
		if err != nil || !parsed.IsAbs() {
			writeErr(w, http.StatusBadRequest, "invalid_redirect_uri", "redirect_uri debe ser absoluta")
			return
		}
	}

	clientID := randomToken()
	uris, _ := json.Marshal(req.RedirectURIs)
	_, err := s.db.ExecContext(r.Context(),
		`INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at) VALUES (?, ?, ?, ?)`,
		clientID, string(uris), req.ClientName, time.Now().Unix())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server_error", "no se pudo registrar el cliente")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  clientID,
		"redirect_uris":              req.RedirectURIs,
		"client_name":                req.ClientName,
		"token_endpoint_auth_method": "none",
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
	})
}

type authzParams struct {
	clientID    string
	redirectURI string
	state       string
	challenge   string
}

// parseAuthz validates the query parameters shared by the GET and POST halves
// of the authorization endpoint.
func (s *Server) parseAuthz(ctx context.Context, q url.Values) (authzParams, error) {
	p := authzParams{
		clientID:    q.Get("client_id"),
		redirectURI: q.Get("redirect_uri"),
		state:       q.Get("state"),
		challenge:   q.Get("code_challenge"),
	}
	if q.Get("response_type") != "code" {
		return p, errors.New("response_type debe ser 'code'")
	}
	if q.Get("code_challenge_method") != "S256" {
		return p, errors.New("se requiere PKCE con code_challenge_method=S256")
	}
	if p.challenge == "" {
		return p, errors.New("falta code_challenge")
	}

	var urisJSON string
	err := s.db.QueryRowContext(ctx,
		`SELECT redirect_uris FROM oauth_clients WHERE client_id = ?`, p.clientID).Scan(&urisJSON)
	if err == sql.ErrNoRows {
		return p, errors.New("client_id desconocido")
	} else if err != nil {
		return p, errors.New("error interno")
	}
	var uris []string
	if err := json.Unmarshal([]byte(urisJSON), &uris); err != nil {
		return p, errors.New("error interno")
	}
	// Exact match only: prefix matching is how redirect URIs get abused.
	for _, u := range uris {
		if u == p.redirectURI {
			return p, nil
		}
	}
	return p, errors.New("redirect_uri no coincide con la registrada")
}

func (s *Server) handleAuthorizeForm(w http.ResponseWriter, r *http.Request) {
	if _, err := s.parseAuthz(r.Context(), r.URL.Query()); err != nil {
		renderPage(w, http.StatusBadRequest, pageData{Error: err.Error()})
		return
	}
	renderPage(w, http.StatusOK, pageData{Query: template.HTML(r.URL.RawQuery)})
}

func (s *Server) handleAuthorizeSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		renderPage(w, http.StatusBadRequest, pageData{Error: "formulario invalido"})
		return
	}
	// The OAuth parameters ride along in the query string; the form carries
	// only the passphrase.
	p, err := s.parseAuthz(r.Context(), r.URL.Query())
	if err != nil {
		renderPage(w, http.StatusBadRequest, pageData{Error: err.Error()})
		return
	}

	ip := clientIP(r)
	if !s.allowAttempt(ip) {
		renderPage(w, http.StatusTooManyRequests, pageData{
			Query: template.HTML(r.URL.RawQuery),
			Error: "Demasiados intentos fallidos. Espera 15 minutos.",
		})
		return
	}
	given := r.PostFormValue("passphrase")
	if subtle.ConstantTimeCompare([]byte(given), []byte(s.passphrase)) != 1 {
		s.recordFailure(ip)
		renderPage(w, http.StatusUnauthorized, pageData{
			Query: template.HTML(r.URL.RawQuery),
			Error: "Frase de acceso incorrecta.",
		})
		return
	}
	s.clearFailures(ip)

	code := randomToken()
	_, err = s.db.ExecContext(r.Context(),
		`INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, expires_at)
		 VALUES (?, ?, ?, ?, ?)`,
		hashToken(code), p.clientID, p.redirectURI, p.challenge, time.Now().Add(authCodeTTL).Unix())
	if err != nil {
		renderPage(w, http.StatusInternalServerError, pageData{Error: "no se pudo emitir el codigo"})
		return
	}

	dest, _ := url.Parse(p.redirectURI)
	q := dest.Query()
	q.Set("code", code)
	if p.state != "" {
		q.Set("state", p.state)
	}
	dest.RawQuery = q.Encode()
	http.Redirect(w, r, dest.String(), http.StatusFound)
}

func (s *Server) handleToken(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "formulario invalido")
		return
	}
	switch r.PostFormValue("grant_type") {
	case "authorization_code":
		s.grantAuthorizationCode(w, r)
	case "refresh_token":
		s.grantRefreshToken(w, r)
	default:
		writeErr(w, http.StatusBadRequest, "unsupported_grant_type", "grant_type no soportado")
	}
}

func (s *Server) grantAuthorizationCode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := r.PostFormValue("code")
	verifier := r.PostFormValue("code_verifier")
	clientID := r.PostFormValue("client_id")
	redirectURI := r.PostFormValue("redirect_uri")

	var (
		storedClient, storedRedirect, challenge string
		expiresAt                               int64
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT client_id, redirect_uri, code_challenge, expires_at FROM oauth_codes WHERE code_hash = ?`,
		hashToken(code)).Scan(&storedClient, &storedRedirect, &challenge, &expiresAt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_grant", "codigo invalido")
		return
	}
	// Single use: burn it whatever the outcome from here.
	_, _ = s.db.ExecContext(ctx, `DELETE FROM oauth_codes WHERE code_hash = ?`, hashToken(code))

	if time.Now().Unix() > expiresAt {
		writeErr(w, http.StatusBadRequest, "invalid_grant", "codigo expirado")
		return
	}
	if storedClient != clientID || storedRedirect != redirectURI {
		writeErr(w, http.StatusBadRequest, "invalid_grant", "el codigo no corresponde a este cliente")
		return
	}
	// PKCE: SHA-256 of the verifier must equal the challenge sent at /authorize.
	sum := sha256.Sum256([]byte(verifier))
	if subtle.ConstantTimeCompare([]byte(base64.RawURLEncoding.EncodeToString(sum[:])), []byte(challenge)) != 1 {
		writeErr(w, http.StatusBadRequest, "invalid_grant", "code_verifier invalido")
		return
	}

	s.issueTokens(w, ctx, clientID)
}

func (s *Server) grantRefreshToken(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	refresh := r.PostFormValue("refresh_token")

	var clientID string
	var expiresAt int64
	err := s.db.QueryRowContext(ctx,
		`SELECT client_id, expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'`,
		hashToken(refresh)).Scan(&clientID, &expiresAt)
	if err != nil || time.Now().Unix() > expiresAt {
		writeErr(w, http.StatusBadRequest, "invalid_grant", "refresh_token invalido o expirado")
		return
	}
	// Rotate: the presented refresh token is retired with the new pair issued.
	_, _ = s.db.ExecContext(ctx, `DELETE FROM oauth_tokens WHERE token_hash = ?`, hashToken(refresh))
	s.issueTokens(w, ctx, clientID)
}

func (s *Server) issueTokens(w http.ResponseWriter, ctx context.Context, clientID string) {
	access, refresh := randomToken(), randomToken()
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO oauth_tokens (token_hash, client_id, kind, expires_at) VALUES (?, ?, 'access', ?), (?, ?, 'refresh', ?)`,
		hashToken(access), clientID, now.Add(accessTokenTTL).Unix(),
		hashToken(refresh), clientID, now.Add(refreshTokenTTL).Unix())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "server_error", "no se pudieron emitir los tokens")
		return
	}
	// Opportunistically drop anything already expired.
	_, _ = s.db.ExecContext(ctx, `DELETE FROM oauth_tokens WHERE expires_at < ?`, now.Unix())
	_, _ = s.db.ExecContext(ctx, `DELETE FROM oauth_codes WHERE expires_at < ?`, now.Unix())

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token":  access,
		"token_type":    "Bearer",
		"expires_in":    int(accessTokenTTL.Seconds()),
		"refresh_token": refresh,
		"scope":         "whatsapp",
	})
}

// Middleware rejects requests without a valid, unexpired access token. On 401 it
// advertises the metadata URL so MCP clients can discover how to authenticate.
func (s *Server) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			s.challenge(w, "se requiere un token de acceso")
			return
		}
		var expiresAt int64
		err := s.db.QueryRowContext(r.Context(),
			`SELECT expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'`,
			hashToken(token)).Scan(&expiresAt)
		if err != nil {
			s.challenge(w, "token invalido")
			return
		}
		if time.Now().Unix() > expiresAt {
			s.challenge(w, "token expirado")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) challenge(w http.ResponseWriter, desc string) {
	w.Header().Set("WWW-Authenticate", fmt.Sprintf(
		`Bearer resource_metadata="%s/.well-known/oauth-protected-resource", error="invalid_token", error_description="%s"`,
		s.issuer, desc))
	writeErr(w, http.StatusUnauthorized, "invalid_token", desc)
}

// allowAttempt reports whether ip may try the passphrase again.
func (s *Server) allowAttempt(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-attemptWindow)
	var recent []time.Time
	for _, t := range s.attempts[ip] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	s.attempts[ip] = recent
	return len(recent) < maxAttempts
}

func (s *Server) recordFailure(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attempts[ip] = append(s.attempts[ip], time.Now())
}

func (s *Server) clearFailures(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.attempts, ip)
}

func clientIP(r *http.Request) string {
	// Behind Caddy/Cloudflare the real address is in X-Forwarded-For.
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if first, _, ok := strings.Cut(fwd, ","); ok {
			return strings.TrimSpace(first)
		}
		return strings.TrimSpace(fwd)
	}
	host, _, _ := strings.Cut(r.RemoteAddr, ":")
	return host
}

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("auth: sin fuente de aleatoriedad: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// hashToken stores only a digest, so a database copy does not yield live tokens.
func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, desc string) {
	writeJSON(w, status, map[string]string{"error": code, "error_description": desc})
}

type pageData struct {
	Query template.HTML
	Error string
}

var loginTmpl = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar WhatsApp con Claude</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; background: #f6f6f7; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #1a1a1a; color: #f0f0f0; }
    .card { background: #262626 !important; } input { background: #1a1a1a; color: #f0f0f0; border-color: #444 !important; } }
  .card { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,.08);
          width: min(92vw, 380px); }
  h1 { font-size: 1.15rem; margin: 0 0 .35rem; }
  p { font-size: .875rem; opacity: .75; margin: 0 0 1.25rem; line-height: 1.5; }
  label { display: block; font-size: .8rem; font-weight: 600; margin-bottom: .4rem; }
  input { width: 100%; padding: .65rem .75rem; font-size: 1rem; border: 1px solid #d0d0d0;
          border-radius: 8px; box-sizing: border-box; }
  button { width: 100%; margin-top: 1rem; padding: .7rem; font-size: .95rem; font-weight: 600;
           border: 0; border-radius: 8px; background: #c96442; color: #fff; cursor: pointer; }
  button:hover { background: #b25839; }
  .err { background: #fdecea; color: #8b1a10; padding: .6rem .75rem; border-radius: 8px;
         font-size: .85rem; margin-bottom: 1rem; }
  @media (prefers-color-scheme: dark) { .err { background: #3d1512; color: #f5b3ad; } }
</style></head><body>
<div class="card">
  <h1>Conectar WhatsApp con Claude</h1>
  <p>Introduce tu frase de acceso para autorizar a Claude a leer y buscar en tus mensajes.</p>
  {{if .Error}}<div class="err">{{.Error}}</div>{{end}}
  {{if .Query}}
  <form method="POST" action="?{{.Query}}">
    <label for="p">Frase de acceso</label>
    <input id="p" name="passphrase" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Autorizar</button>
  </form>
  {{end}}
</div></body></html>`))

func renderPage(w http.ResponseWriter, status int, data pageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_ = loginTmpl.Execute(w, data)
}

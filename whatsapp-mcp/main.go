// Command whatsapp-mcp bridges a personal WhatsApp account to Claude.
//
// It links to WhatsApp as a companion device (the same mechanism as WhatsApp
// Web), mirrors incoming messages into a local SQLite archive, and serves that
// archive over a remote MCP endpoint that claude.ai can add as a custom
// connector. Once added on the web, the connector is available in the Claude
// mobile apps too.
package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"rsc.io/qr"

	"github.com/cesarlebron/jk/whatsapp-mcp/internal/auth"
	"github.com/cesarlebron/jk/whatsapp-mcp/internal/mcpsrv"
	"github.com/cesarlebron/jk/whatsapp-mcp/internal/wa"

	"github.com/mark3labs/mcp-go/server"
	_ "modernc.org/sqlite"
)

const mcpPath = "/mcp"

type config struct {
	publicURL  string
	passphrase string
	addr       string
	dataDir    string
	allowSend  bool
	debug      bool
}

func loadConfig() (config, error) {
	c := config{
		publicURL:  strings.TrimRight(os.Getenv("WHATSAPP_MCP_PUBLIC_URL"), "/"),
		passphrase: os.Getenv("WHATSAPP_MCP_PASSPHRASE"),
		addr:       envOr("WHATSAPP_MCP_ADDR", ":8080"),
		dataDir:    envOr("WHATSAPP_MCP_DATA_DIR", "./data"),
		allowSend:  envBool("WHATSAPP_MCP_ALLOW_SEND"),
		debug:      envBool("WHATSAPP_MCP_DEBUG"),
	}
	if c.publicURL == "" {
		return c, errors.New("falta WHATSAPP_MCP_PUBLIC_URL (la URL https publica del puente)")
	}
	if c.passphrase == "" {
		return c, errors.New("falta WHATSAPP_MCP_PASSPHRASE (la frase que autoriza a Claude)")
	}
	return c, nil
}

func main() {
	if err := run(); err != nil {
		log.Fatalf("error: %v", err)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.dataDir, 0o700); err != nil {
		return fmt.Errorf("crear directorio de datos: %w", err)
	}

	// Shut down cleanly on Ctrl-C or `docker stop` so SQLite closes its WAL.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	msgStore, err := wa.OpenStore(ctx, filepath.Join(cfg.dataDir, "messages.db"))
	if err != nil {
		return err
	}
	defer msgStore.Close()

	authDB, err := sql.Open("sqlite", filepath.Join(cfg.dataDir, "auth.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return fmt.Errorf("abrir base de autenticacion: %w", err)
	}
	defer authDB.Close()

	authSrv, err := auth.New(ctx, auth.Config{
		DB:         authDB,
		Issuer:     cfg.publicURL,
		Passphrase: cfg.passphrase,
	})
	if err != nil {
		return err
	}

	waClient, err := wa.New(ctx, wa.Config{
		SessionDBPath: filepath.Join(cfg.dataDir, "session.db"),
		Store:         msgStore,
		Debug:         cfg.debug,
	})
	if err != nil {
		return err
	}
	defer waClient.Close()
	waClient.Start(ctx)

	mcp := mcpsrv.New(mcpsrv.Deps{
		Store:     msgStore,
		Client:    waClient,
		AllowSend: cfg.allowSend,
	})
	httpMCP := server.NewStreamableHTTPServer(mcp, server.WithEndpointPath(mcpPath))

	mux := http.NewServeMux()
	authSrv.Routes(mux, mcpPath)
	// Every MCP request must carry a valid bearer token.
	mux.Handle(mcpPath, authSrv.Middleware(httpMCP))
	mux.Handle(mcpPath+"/", authSrv.Middleware(httpMCP))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	// "{$}" matches only the exact root; a bare "GET /" would collide with the
	// broader "/mcp/" pattern.
	mux.HandleFunc("GET /{$}", basicAuth(cfg.passphrase, statusPage(waClient, msgStore, cfg)))

	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// MCP responses stream, so no blanket write timeout.
		IdleTimeout: 120 * time.Second,
	}

	go func() {
		log.Printf("puente escuchando en %s", cfg.addr)
		log.Printf("URL del conector para claude.ai: %s%s", cfg.publicURL, mcpPath)
		if cfg.allowSend {
			log.Print("AVISO: el envio de mensajes esta HABILITADO (WHATSAPP_MCP_ALLOW_SEND=true)")
		}
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("servidor http: %v", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Print("cerrando...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// basicAuth gates the status page behind the same passphrase. The QR shown
// there links a WhatsApp account to this bridge, so it must not be public.
func basicAuth(passphrase string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, given, ok := r.BasicAuth()
		if !ok || subtle.ConstantTimeCompare([]byte(given), []byte(passphrase)) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="WhatsApp MCP", charset="UTF-8"`)
			http.Error(w, "no autorizado", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// statusPage renders the linking QR and the archive's current state.
func statusPage(c *wa.Client, s *wa.Store, cfg config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		msgs, chats, oldest, newest, err := s.Stats(r.Context())
		if err != nil {
			http.Error(w, "no se pudo leer el archivo", http.StatusInternalServerError)
			return
		}

		var body strings.Builder
		if code := c.QRCode(); code != "" && !c.LoggedIn() {
			body.WriteString(`<h2>Vincula tu WhatsApp</h2>
<p>Abre WhatsApp en tu telefono &rarr; Ajustes &rarr; Dispositivos vinculados &rarr; Vincular dispositivo, y escanea:</p>`)
			if png, err := qrPNG(code); err == nil {
				fmt.Fprintf(&body, `<img class="qr" alt="Codigo QR de vinculacion" src="data:image/png;base64,%s">`, png)
			} else {
				fmt.Fprintf(&body, `<pre class="code">%s</pre>`, code)
			}
			body.WriteString(`<p class="muted">El codigo se renueva solo. Recarga la pagina si expira.</p>`)
		} else if c.LoggedIn() {
			body.WriteString(`<p class="ok">WhatsApp conectado.</p>`)
		} else {
			body.WriteString(`<p class="warn">Desconectado. Reconectando&hellip;</p>`)
		}

		fmt.Fprintf(&body, `<h2>Archivo local</h2><ul>
<li><b>%d</b> mensajes en <b>%d</b> chats</li>`, msgs, chats)
		if msgs > 0 {
			fmt.Fprintf(&body, `<li>Desde %s hasta %s</li>`,
				oldest.Format("2006-01-02"), newest.Format("2006-01-02"))
		}
		if ls := c.LastHistorySync(); !ls.IsZero() {
			fmt.Fprintf(&body, `<li>Ultima sincronizacion: %s UTC</li>`, ls.Format("2006-01-02 15:04"))
		}
		fmt.Fprintf(&body, `<li>Envio de mensajes: <b>%s</b></li></ul>`, enabledLabel(cfg.allowSend))

		fmt.Fprintf(&body, `<h2>Conectar con Claude</h2>
<p>En claude.ai &rarr; Ajustes &rarr; Conectores &rarr; Agregar conector personalizado, pega esta URL:</p>
<pre class="code">%s%s</pre>
<p class="muted">Te pedira la frase de acceso una sola vez. Despues aparece tambien en la app movil.</p>`,
			cfg.publicURL, mcpPath)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, statusHTML, body.String())
	}
}

func qrPNG(code string) (string, error) {
	c, err := qr.Encode(code, qr.M)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(c.PNG()), nil
}

func enabledLabel(b bool) string {
	if b {
		return "habilitado"
	}
	return "deshabilitado (solo lectura)"
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string) bool {
	b, _ := strconv.ParseBool(os.Getenv(key))
	return b
}

const statusHTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Puente WhatsApp &rarr; Claude</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 40rem; margin: 0 auto;
         padding: 2rem 1.25rem 4rem; background: #f6f6f7; color: #1a1a1a; line-height: 1.55; }
  @media (prefers-color-scheme: dark) { body { background: #1a1a1a; color: #f0f0f0; }
    .code { background: #262626 !important; border-color: #444 !important; } }
  h1 { font-size: 1.3rem; } h2 { font-size: 1rem; margin-top: 2rem; }
  .qr { width: min(80vw, 300px); image-rendering: pixelated; background: #fff; padding: 12px;
        border-radius: 10px; display: block; }
  .code { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: .7rem;
          font-size: .8rem; overflow-x: auto; word-break: break-all; white-space: pre-wrap; }
  .ok { color: #1a7f37; font-weight: 600; } .warn { color: #b25839; font-weight: 600; }
  .muted { opacity: .7; font-size: .85rem; }
  ul { padding-left: 1.1rem; }
</style></head><body>
<h1>Puente WhatsApp &rarr; Claude</h1>
%s
</body></html>`

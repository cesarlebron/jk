package wa

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"

	_ "modernc.org/sqlite"
)

// Client wraps a whatsmeow linked-device connection and mirrors everything it
// receives into the local Store.
type Client struct {
	wm    *whatsmeow.Client
	store *Store

	mu       sync.RWMutex
	qrCode   string // current login QR payload, empty once linked
	lastSync time.Time
}

// Config controls how the WhatsApp connection is established.
type Config struct {
	// SessionDBPath holds the device/encryption keys created when you scan the
	// QR. Losing it means re-linking; leaking it means someone else can read
	// your messages.
	SessionDBPath string
	// Store is the message archive to mirror into.
	Store *Store
	// Debug turns on whatsmeow's verbose protocol logging.
	Debug bool
}

// New opens the device session and prepares the WhatsApp client without
// connecting. Call Start to bring the connection up.
func New(ctx context.Context, cfg Config) (*Client, error) {
	if cfg.Store == nil {
		return nil, errors.New("wa: message store is required")
	}

	level := "WARN"
	if cfg.Debug {
		level = "DEBUG"
	}
	logger := waLog.Stdout("WhatsApp", level, true)

	container, err := sqlstore.New(ctx, "sqlite",
		cfg.SessionDBPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)",
		logger)
	if err != nil {
		return nil, fmt.Errorf("open session store: %w", err)
	}

	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, fmt.Errorf("load device: %w", err)
	}

	// Identify as a desktop client so WhatsApp sends a fuller history sync.
	store.DeviceProps.Os = ptr("Claude WhatsApp Bridge")

	c := &Client{
		wm:    whatsmeow.NewClient(device, logger),
		store: cfg.Store,
	}
	c.wm.AddEventHandler(c.handleEvent)
	return c, nil
}

// Start brings the WhatsApp connection up in the background, retrying until it
// succeeds or ctx is cancelled. It never blocks the caller: the HTTP server
// must stay reachable even while WhatsApp is unavailable, so that the status
// page can explain what is wrong.
//
// Once connected, whatsmeow handles reconnection on its own.
func (c *Client) Start(ctx context.Context) {
	go func() {
		backoff := 2 * time.Second
		for {
			err := c.connectOnce(ctx)
			if err == nil {
				return
			}
			if ctx.Err() != nil {
				return
			}
			fmt.Fprintf(os.Stderr, "conexion con WhatsApp fallida (%v); reintentando en %s\n", err, backoff)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < 2*time.Minute {
				backoff *= 2
			}
		}
	}()
}

func (c *Client) connectOnce(ctx context.Context) error {
	if c.wm.Store.ID == nil {
		// No session yet: surface a QR for the user to scan.
		qrChan, err := c.wm.GetQRChannel(ctx)
		if err != nil {
			return fmt.Errorf("abrir canal QR: %w", err)
		}
		if err := c.wm.Connect(); err != nil {
			return fmt.Errorf("conectar: %w", err)
		}
		go c.consumeQR(qrChan)
		return nil
	}
	if err := c.wm.Connect(); err != nil {
		return fmt.Errorf("conectar: %w", err)
	}
	return nil
}

// consumeQR renders each QR code WhatsApp issues until linking succeeds or the
// login window expires.
func (c *Client) consumeQR(ch <-chan whatsmeow.QRChannelItem) {
	for item := range ch {
		switch item.Event {
		case "code":
			c.mu.Lock()
			c.qrCode = item.Code
			c.mu.Unlock()

			fmt.Fprintln(os.Stderr, "\n=== Escanea este codigo QR con WhatsApp ===")
			fmt.Fprint(os.Stderr, "WhatsApp > Ajustes > Dispositivos vinculados > Vincular dispositivo\n\n")
			qrterminal.GenerateHalfBlock(item.Code, qrterminal.L, os.Stderr)
			fmt.Fprintf(os.Stderr, "\nEl codigo expira en %s.\n\n", item.Timeout.Round(time.Second))
		case "success":
			c.mu.Lock()
			c.qrCode = ""
			c.mu.Unlock()
			fmt.Fprintln(os.Stderr, "WhatsApp vinculado correctamente.")
		default:
			fmt.Fprintf(os.Stderr, "Login: %s\n", item.Event)
		}
	}
}

// Close disconnects from WhatsApp. The session is preserved on disk.
func (c *Client) Close() { c.wm.Disconnect() }

// LoggedIn reports whether the device session is active.
func (c *Client) LoggedIn() bool { return c.wm.IsLoggedIn() }

// QRCode returns the pending login QR payload, or "" once linked.
func (c *Client) QRCode() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.qrCode
}

// LastHistorySync reports when history was last backfilled.
func (c *Client) LastHistorySync() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastSync
}

func (c *Client) handleEvent(evt any) {
	// Events arrive on whatsmeow's goroutine; give each handler its own budget
	// rather than inheriting a request context.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	switch v := evt.(type) {
	case *events.Message:
		if err := c.store.SaveMessage(ctx, c.convert(v)); err != nil {
			fmt.Fprintf(os.Stderr, "guardar mensaje: %v\n", err)
		}
	case *events.HistorySync:
		c.handleHistorySync(ctx, v)
	case *events.Connected:
		fmt.Fprintln(os.Stderr, "Conectado a WhatsApp.")
		c.syncContactNames(ctx)
	case *events.LoggedOut:
		fmt.Fprintln(os.Stderr, "WhatsApp cerro la sesion. Borra la sesion y vuelve a escanear el QR.")
	}
}

// convert flattens a live message event into a storable row.
func (c *Client) convert(v *events.Message) Message {
	content, mediaType := extractContent(v.Message)

	chatName := ""
	if !v.Info.IsGroup && v.Info.PushName != "" && !v.Info.IsFromMe {
		chatName = v.Info.PushName
	}

	return Message{
		ID:         v.Info.ID,
		ChatJID:    v.Info.Chat.String(),
		ChatName:   chatName,
		SenderJID:  v.Info.Sender.String(),
		SenderName: v.Info.PushName,
		Content:    content,
		Timestamp:  v.Info.Timestamp,
		IsFromMe:   v.Info.IsFromMe,
		MediaType:  mediaType,
	}
}

// handleHistorySync backfills the archive from the payload WhatsApp sends after
// linking. This is what makes older conversations searchable; WhatsApp decides
// how far back it goes, and it is never the complete history.
func (c *Client) handleHistorySync(ctx context.Context, v *events.HistorySync) {
	if v.Data == nil {
		return
	}
	var batch []Message
	for _, conv := range v.Data.GetConversations() {
		chatJID := conv.GetID()
		if chatJID == "" {
			continue
		}
		if name := conv.GetName(); name != "" {
			if err := c.store.SetChatName(ctx, chatJID, name); err != nil {
				fmt.Fprintf(os.Stderr, "nombre de chat: %v\n", err)
			}
		}
		for _, hm := range conv.GetMessages() {
			web := hm.GetMessage()
			if web == nil || web.GetKey() == nil {
				continue
			}
			content, mediaType := extractContent(web.GetMessage())
			ts := int64(web.GetMessageTimestamp())
			if ts == 0 {
				continue
			}
			sender := web.GetParticipant()
			if sender == "" {
				if web.GetKey().GetFromMe() {
					sender = jidString(c.wm.Store.ID)
				} else {
					sender = chatJID
				}
			}
			batch = append(batch, Message{
				ID:         web.GetKey().GetID(),
				ChatJID:    chatJID,
				ChatName:   conv.GetName(),
				SenderJID:  sender,
				SenderName: web.GetPushName(),
				Content:    content,
				Timestamp:  time.Unix(ts, 0).UTC(),
				IsFromMe:   web.GetKey().GetFromMe(),
				MediaType:  mediaType,
			})
		}
	}
	if len(batch) == 0 {
		return
	}
	if err := c.store.SaveMessages(ctx, batch); err != nil {
		fmt.Fprintf(os.Stderr, "sincronizar historial: %v\n", err)
		return
	}
	c.mu.Lock()
	c.lastSync = time.Now().UTC()
	c.mu.Unlock()
	fmt.Fprintf(os.Stderr, "Historial sincronizado: %d mensajes.\n", len(batch))
}

// syncContactNames copies the address-book names into the chat table so search
// results read "Juan Perez" instead of a bare phone number.
func (c *Client) syncContactNames(ctx context.Context) {
	contacts, err := c.wm.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "leer contactos: %v\n", err)
		return
	}
	for jid, info := range contacts {
		name := firstNonEmpty(info.FullName, info.FirstName, info.PushName, info.BusinessName)
		if name == "" {
			continue
		}
		if err := c.store.SetChatName(ctx, jid.String(), name); err != nil {
			fmt.Fprintf(os.Stderr, "guardar contacto: %v\n", err)
			return
		}
	}
}

// Contact is an address-book entry.
type Contact struct {
	JID   string `json:"jid"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// SearchContacts returns address-book entries whose name or number matches query.
func (c *Client) SearchContacts(ctx context.Context, query string, limit int) ([]Contact, error) {
	contacts, err := c.wm.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		return nil, fmt.Errorf("leer contactos: %w", err)
	}
	q := strings.ToLower(query)
	out := make([]Contact, 0, len(contacts))
	for jid, info := range contacts {
		name := firstNonEmpty(info.FullName, info.FirstName, info.PushName, info.BusinessName)
		if q != "" && !strings.Contains(strings.ToLower(name), q) && !strings.Contains(jid.User, q) {
			continue
		}
		out = append(out, Contact{JID: jid.String(), Name: name, Phone: "+" + jid.User})
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

// SendText sends a plain text message to a chat JID (a user or a group).
func (c *Client) SendText(ctx context.Context, to, text string) (string, error) {
	if !c.wm.IsLoggedIn() {
		return "", errors.New("WhatsApp no esta conectado")
	}
	jid, err := types.ParseJID(to)
	if err != nil {
		return "", fmt.Errorf("JID invalido %q: %w", to, err)
	}
	resp, err := c.wm.SendMessage(ctx, jid, &waE2E.Message{Conversation: ptr(text)})
	if err != nil {
		return "", fmt.Errorf("enviar mensaje: %w", err)
	}
	// Mirror our own outgoing message so the archive stays complete.
	_ = c.store.SaveMessage(ctx, Message{
		ID: resp.ID, ChatJID: jid.String(), SenderJID: jidString(c.wm.Store.ID),
		Content: text, Timestamp: resp.Timestamp, IsFromMe: true,
	})
	return resp.ID, nil
}

// extractContent pulls displayable text out of the many message variants, and
// reports the media kind when the payload is not text.
func extractContent(m *waE2E.Message) (text, mediaType string) {
	if m == nil {
		return "", ""
	}
	switch {
	case m.GetConversation() != "":
		return m.GetConversation(), ""
	case m.GetExtendedTextMessage() != nil:
		return m.GetExtendedTextMessage().GetText(), ""
	case m.GetImageMessage() != nil:
		return m.GetImageMessage().GetCaption(), "image"
	case m.GetVideoMessage() != nil:
		return m.GetVideoMessage().GetCaption(), "video"
	case m.GetDocumentMessage() != nil:
		d := m.GetDocumentMessage()
		return firstNonEmpty(d.GetCaption(), d.GetFileName()), "document"
	case m.GetAudioMessage() != nil:
		return "", "audio"
	case m.GetStickerMessage() != nil:
		return "", "sticker"
	case m.GetLocationMessage() != nil:
		return m.GetLocationMessage().GetName(), "location"
	case m.GetContactMessage() != nil:
		return m.GetContactMessage().GetDisplayName(), "contact"
	case m.GetReactionMessage() != nil:
		return m.GetReactionMessage().GetText(), "reaction"
	// Unwrap the containers that hold a real message inside.
	case m.GetEphemeralMessage() != nil:
		return extractContent(m.GetEphemeralMessage().GetMessage())
	case m.GetViewOnceMessage() != nil:
		return extractContent(m.GetViewOnceMessage().GetMessage())
	case m.GetViewOnceMessageV2() != nil:
		return extractContent(m.GetViewOnceMessageV2().GetMessage())
	case m.GetDocumentWithCaptionMessage() != nil:
		return extractContent(m.GetDocumentWithCaptionMessage().GetMessage())
	case m.GetEditedMessage() != nil:
		return extractContent(m.GetEditedMessage().GetMessage())
	}
	return "", ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func jidString(j *types.JID) string {
	if j == nil {
		return ""
	}
	return j.String()
}

func ptr[T any](v T) *T { return &v }

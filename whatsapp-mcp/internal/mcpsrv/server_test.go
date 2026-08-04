package mcpsrv

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/cesarlebron/jk/whatsapp-mcp/internal/wa"
)

// fakeClient stands in for a live WhatsApp connection.
type fakeClient struct {
	loggedIn bool
	qr       string
	contacts []wa.Contact
	sent     []struct{ To, Text string }
	sendErr  error
}

func (f *fakeClient) LoggedIn() bool             { return f.loggedIn }
func (f *fakeClient) QRCode() string             { return f.qr }
func (f *fakeClient) LastHistorySync() time.Time { return time.Time{} }

func (f *fakeClient) SearchContacts(_ context.Context, query string, limit int) ([]wa.Contact, error) {
	var out []wa.Contact
	for _, c := range f.contacts {
		if query == "" || strings.Contains(strings.ToLower(c.Name), strings.ToLower(query)) {
			out = append(out, c)
		}
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (f *fakeClient) SendText(_ context.Context, to, text string) (string, error) {
	if f.sendErr != nil {
		return "", f.sendErr
	}
	f.sent = append(f.sent, struct{ To, Text string }{to, text})
	return "msg-id-1", nil
}

func newTestServer(t *testing.T, allowSend bool) (*server.MCPServer, *wa.Store, *fakeClient, context.Context) {
	t.Helper()
	ctx := context.Background()
	store, err := wa.OpenStore(ctx, filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	client := &fakeClient{loggedIn: true}
	return New(Deps{Store: store, Client: client, AllowSend: allowSend}), store, client, ctx
}

// call invokes a tool the way an MCP client would and returns its text output.
func call(t *testing.T, s *server.MCPServer, ctx context.Context, name string, args map[string]any) (string, bool) {
	t.Helper()
	res := s.HandleMessage(ctx, mustJSON(t, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params":  map[string]any{"name": name, "arguments": args},
	}))

	resp, ok := res.(mcp.JSONRPCResponse)
	if !ok {
		t.Fatalf("tool %s returned %T, want a JSONRPCResponse: %+v", name, res, res)
	}
	result, ok := resp.Result.(*mcp.CallToolResult)
	if !ok {
		t.Fatalf("tool %s result is %T, want *mcp.CallToolResult", name, resp.Result)
	}
	var b strings.Builder
	for _, c := range result.Content {
		if tc, ok := c.(mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String(), result.IsError
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func seedMessages(t *testing.T, s *wa.Store, ctx context.Context) {
	t.Helper()
	msgs := []wa.Message{
		{ID: "1", ChatJID: "juan@s.whatsapp.net", ChatName: "Juan Perez", SenderJID: "juan@s.whatsapp.net",
			SenderName: "Juan Perez", Content: "el presupuesto de la obra queda en 45000",
			Timestamp: time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)},
		{ID: "2", ChatJID: "juan@s.whatsapp.net", SenderJID: "me@s.whatsapp.net",
			Content: "perfecto, lo apruebo", IsFromMe: true,
			Timestamp: time.Date(2026, 7, 1, 10, 5, 0, 0, time.UTC)},
	}
	for _, m := range msgs {
		if err := s.SaveMessage(ctx, m); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}

func TestToolsAreRegistered(t *testing.T) {
	s, _, _, ctx := newTestServer(t, false)

	res := s.HandleMessage(ctx, mustJSON(t, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "tools/list",
	}))
	resp, ok := res.(mcp.JSONRPCResponse)
	if !ok {
		t.Fatalf("tools/list returned %T", res)
	}
	list, ok := resp.Result.(mcp.ListToolsResult)
	if !ok {
		t.Fatalf("result is %T, want ListToolsResult", resp.Result)
	}
	got := make(map[string]bool, len(list.Tools))
	for _, tool := range list.Tools {
		got[tool.Name] = true
	}
	for _, want := range []string{
		"search_messages", "list_chats", "get_chat_history",
		"get_message_context", "search_contacts", "connection_status",
	} {
		if !got[want] {
			t.Errorf("tool %q is not registered", want)
		}
	}
	if got["send_message"] {
		t.Error("send_message must not be registered when AllowSend is false")
	}
}

// Sending is off unless explicitly enabled, so a model cannot message people
// on the user's behalf by default.
func TestSendToolRequiresOptIn(t *testing.T) {
	s, _, client, ctx := newTestServer(t, true)
	out, isErr := call(t, s, ctx, "send_message", map[string]any{
		"chat_jid": "juan@s.whatsapp.net",
		"text":     "hola",
	})
	if isErr {
		t.Fatalf("send_message failed: %s", out)
	}
	if len(client.sent) != 1 || client.sent[0].Text != "hola" {
		t.Fatalf("message was not sent: %+v", client.sent)
	}
}

func TestSearchMessagesTool(t *testing.T) {
	s, store, _, ctx := newTestServer(t, false)
	seedMessages(t, store, ctx)

	out, isErr := call(t, s, ctx, "search_messages", map[string]any{"query": "presupuesto"})
	if isErr {
		t.Fatalf("search failed: %s", out)
	}
	if !strings.Contains(out, "45000") {
		t.Errorf("output is missing the matched text:\n%s", out)
	}
	// The model needs these identifiers to drill into context.
	if !strings.Contains(out, "chat_jid:") || !strings.Contains(out, "message_id:") {
		t.Errorf("output is missing chat_jid/message_id:\n%s", out)
	}
}

// An empty result should tell the model whether the archive is simply short on
// history, rather than implying the message does not exist.
func TestSearchExplainsEmptyResults(t *testing.T) {
	s, store, _, ctx := newTestServer(t, false)
	seedMessages(t, store, ctx)

	out, isErr := call(t, s, ctx, "search_messages", map[string]any{"query": "criptomonedas"})
	if isErr {
		t.Fatalf("search failed: %s", out)
	}
	if !strings.Contains(out, "historial parcial") {
		t.Errorf("empty result does not explain the archive limits:\n%s", out)
	}
}

func TestSearchRejectsBadDate(t *testing.T) {
	s, store, _, ctx := newTestServer(t, false)
	seedMessages(t, store, ctx)

	out, isErr := call(t, s, ctx, "search_messages", map[string]any{
		"query": "presupuesto", "after": "julio de 2026",
	})
	if !isErr {
		t.Fatalf("an invalid date was accepted: %s", out)
	}
}

func TestOutgoingMessagesAreLabelled(t *testing.T) {
	s, store, _, ctx := newTestServer(t, false)
	seedMessages(t, store, ctx)

	out, isErr := call(t, s, ctx, "get_chat_history", map[string]any{"chat_jid": "juan@s.whatsapp.net"})
	if isErr {
		t.Fatalf("history failed: %s", out)
	}
	if !strings.Contains(out, "yo: perfecto, lo apruebo") {
		t.Errorf("own messages are not labelled as 'yo':\n%s", out)
	}
	if !strings.Contains(out, "Juan Perez: el presupuesto") {
		t.Errorf("incoming sender name is missing:\n%s", out)
	}
}

func TestConnectionStatusReportsUnlinked(t *testing.T) {
	s, _, client, ctx := newTestServer(t, false)
	client.loggedIn = false
	client.qr = "2@abc"

	out, isErr := call(t, s, ctx, "connection_status", map[string]any{})
	if isErr {
		t.Fatalf("status failed: %s", out)
	}
	if !strings.Contains(out, "SIN VINCULAR") {
		t.Errorf("status does not report the unlinked state:\n%s", out)
	}
}

func TestSearchContactsTool(t *testing.T) {
	s, _, client, ctx := newTestServer(t, false)
	client.contacts = []wa.Contact{
		{JID: "juan@s.whatsapp.net", Name: "Juan Perez", Phone: "+5215550001"},
		{JID: "ana@s.whatsapp.net", Name: "Ana Lopez", Phone: "+5215550002"},
	}
	out, isErr := call(t, s, ctx, "search_contacts", map[string]any{"query": "juan"})
	if isErr {
		t.Fatalf("contacts failed: %s", out)
	}
	if !strings.Contains(out, "Juan Perez") || strings.Contains(out, "Ana Lopez") {
		t.Errorf("contact filter did not apply:\n%s", out)
	}
}

func TestSendToolSurfacesErrors(t *testing.T) {
	s, _, client, ctx := newTestServer(t, true)
	client.sendErr = errors.New("sin conexion")

	out, isErr := call(t, s, ctx, "send_message", map[string]any{
		"chat_jid": "juan@s.whatsapp.net", "text": "hola",
	})
	if !isErr {
		t.Fatalf("a send failure was reported as success: %s", out)
	}
}

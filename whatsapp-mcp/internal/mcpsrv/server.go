// Package mcpsrv exposes the WhatsApp archive as MCP tools.
package mcpsrv

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/cesarlebron/jk/whatsapp-mcp/internal/wa"
)

// Client is the part of the WhatsApp connection the tools rely on. It is an
// interface so the tool layer can be tested without a live WhatsApp session.
type Client interface {
	LoggedIn() bool
	QRCode() string
	LastHistorySync() time.Time
	SearchContacts(ctx context.Context, query string, limit int) ([]wa.Contact, error)
	SendText(ctx context.Context, to, text string) (string, error)
}

// Deps are the collaborators the tools operate on.
type Deps struct {
	Store  *wa.Store
	Client Client
	// AllowSend enables the send_message tool. Off by default: reading your
	// own history is a much smaller risk than letting a model send messages
	// under your name.
	AllowSend bool
}

// New builds the MCP server with every WhatsApp tool registered.
func New(d Deps) *server.MCPServer {
	s := server.NewMCPServer("whatsapp-personal", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithRecovery(),
	)

	s.AddTool(mcp.NewTool("search_messages",
		mcp.WithDescription(
			"Busca en el historial de mensajes de WhatsApp del usuario. Devuelve los mensajes "+
				"que contienen el texto buscado, del mas reciente al mas antiguo. Usa esta "+
				"herramienta cuando el usuario pregunte por algo que le dijeron, le enviaron o "+
				"acordo por WhatsApp."),
		mcp.WithString("query", mcp.Description("Texto a buscar dentro de los mensajes."), mcp.Required()),
		mcp.WithString("chat_jid", mcp.Description("Limita la busqueda a un chat concreto (usa list_chats para obtener el JID).")),
		mcp.WithString("sender", mcp.Description("Filtra por nombre o numero de quien envio el mensaje.")),
		mcp.WithString("after", mcp.Description("Solo mensajes desde esta fecha (YYYY-MM-DD).")),
		mcp.WithString("before", mcp.Description("Solo mensajes hasta esta fecha (YYYY-MM-DD).")),
		mcp.WithNumber("limit", mcp.Description("Maximo de mensajes a devolver (1-200)."), mcp.DefaultNumber(25)),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		query, err := req.RequireString("query")
		if err != nil {
			return mcp.NewToolResultError("se requiere el parametro 'query'"), nil
		}
		after, err := parseDate(req.GetString("after", ""), false)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		before, err := parseDate(req.GetString("before", ""), true)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		msgs, err := d.Store.SearchMessages(ctx, wa.SearchOpts{
			Query:   query,
			ChatJID: req.GetString("chat_jid", ""),
			Sender:  req.GetString("sender", ""),
			After:   after,
			Before:  before,
			Limit:   req.GetInt("limit", 25),
		})
		if err != nil {
			return mcp.NewToolResultErrorFromErr("fallo la busqueda", err), nil
		}
		if len(msgs) == 0 {
			return mcp.NewToolResultText(fmt.Sprintf(
				"No se encontraron mensajes con %q.\n\n%s", query, archiveHint(ctx, d))), nil
		}
		return mcp.NewToolResultText(formatMessages(msgs, true)), nil
	})

	s.AddTool(mcp.NewTool("list_chats",
		mcp.WithDescription(
			"Lista las conversaciones de WhatsApp ordenadas por actividad reciente. Devuelve el "+
				"JID de cada chat, necesario para las demas herramientas."),
		mcp.WithString("name", mcp.Description("Filtra por nombre de contacto o grupo.")),
		mcp.WithNumber("limit", mcp.Description("Maximo de chats a devolver (1-200)."), mcp.DefaultNumber(25)),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		chats, err := d.Store.ListChats(ctx, req.GetString("name", ""), req.GetInt("limit", 25))
		if err != nil {
			return mcp.NewToolResultErrorFromErr("no se pudieron listar los chats", err), nil
		}
		if len(chats) == 0 {
			return mcp.NewToolResultText("No hay chats en el archivo local.\n\n" + archiveHint(ctx, d)), nil
		}
		var b strings.Builder
		fmt.Fprintf(&b, "%d chats:\n\n", len(chats))
		for _, c := range chats {
			kind := "directo"
			if c.IsGroup {
				kind = "grupo"
			}
			name := c.Name
			if name == "" {
				name = "(sin nombre)"
			}
			fmt.Fprintf(&b, "- %s [%s]\n  jid: %s\n  ultimo mensaje: %s | %d mensajes guardados\n",
				name, kind, c.JID, c.LastMessage.Format("2006-01-02 15:04"), c.NumMessages)
		}
		return mcp.NewToolResultText(b.String()), nil
	})

	s.AddTool(mcp.NewTool("get_chat_history",
		mcp.WithDescription(
			"Devuelve los mensajes mas recientes de un chat concreto, en orden cronologico. "+
				"Util para leer una conversacion completa en lugar de resultados sueltos."),
		mcp.WithString("chat_jid", mcp.Description("JID del chat (obtenlo con list_chats)."), mcp.Required()),
		mcp.WithNumber("limit", mcp.Description("Maximo de mensajes (1-200)."), mcp.DefaultNumber(50)),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		chatJID, err := req.RequireString("chat_jid")
		if err != nil {
			return mcp.NewToolResultError("se requiere el parametro 'chat_jid'"), nil
		}
		msgs, err := d.Store.ChatHistory(ctx, chatJID, req.GetInt("limit", 50))
		if err != nil {
			return mcp.NewToolResultErrorFromErr("no se pudo leer el chat", err), nil
		}
		if len(msgs) == 0 {
			return mcp.NewToolResultText("No hay mensajes guardados de ese chat."), nil
		}
		return mcp.NewToolResultText(formatMessages(msgs, false)), nil
	})

	s.AddTool(mcp.NewTool("get_message_context",
		mcp.WithDescription(
			"Devuelve los mensajes anteriores y posteriores a uno concreto, para leer un "+
				"resultado de busqueda dentro de su conversacion."),
		mcp.WithString("chat_jid", mcp.Description("JID del chat que contiene el mensaje."), mcp.Required()),
		mcp.WithString("message_id", mcp.Description("ID del mensaje (aparece en los resultados de search_messages)."), mcp.Required()),
		mcp.WithNumber("span", mcp.Description("Cuantos mensajes mostrar a cada lado (1-50)."), mcp.DefaultNumber(10)),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		chatJID, err := req.RequireString("chat_jid")
		if err != nil {
			return mcp.NewToolResultError("se requiere el parametro 'chat_jid'"), nil
		}
		msgID, err := req.RequireString("message_id")
		if err != nil {
			return mcp.NewToolResultError("se requiere el parametro 'message_id'"), nil
		}
		msgs, err := d.Store.ContextAround(ctx, chatJID, msgID, req.GetInt("span", 10))
		if err != nil {
			return mcp.NewToolResultErrorFromErr("no se pudo leer el contexto", err), nil
		}
		return mcp.NewToolResultText(formatMessages(msgs, false)), nil
	})

	s.AddTool(mcp.NewTool("search_contacts",
		mcp.WithDescription("Busca contactos de WhatsApp por nombre o numero de telefono."),
		mcp.WithString("query", mcp.Description("Nombre o parte del numero. Vacio devuelve los primeros contactos.")),
		mcp.WithNumber("limit", mcp.Description("Maximo de contactos (1-200)."), mcp.DefaultNumber(25)),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		contacts, err := d.Client.SearchContacts(ctx, req.GetString("query", ""), req.GetInt("limit", 25))
		if err != nil {
			return mcp.NewToolResultErrorFromErr("no se pudieron leer los contactos", err), nil
		}
		if len(contacts) == 0 {
			return mcp.NewToolResultText("No se encontraron contactos."), nil
		}
		var b strings.Builder
		fmt.Fprintf(&b, "%d contactos:\n\n", len(contacts))
		for _, c := range contacts {
			fmt.Fprintf(&b, "- %s (%s)\n  jid: %s\n", c.Name, c.Phone, c.JID)
		}
		return mcp.NewToolResultText(b.String()), nil
	})

	s.AddTool(mcp.NewTool("connection_status",
		mcp.WithDescription(
			"Informa si el puente esta conectado a WhatsApp y cuanto historial hay guardado. "+
				"Usalo cuando una busqueda no encuentre nada, para distinguir 'no existe' de "+
				"'aun no se ha sincronizado'."),
	), func(ctx context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var b strings.Builder
		if d.Client.LoggedIn() {
			b.WriteString("Estado: conectado a WhatsApp.\n")
		} else if qr := d.Client.QRCode(); qr != "" {
			b.WriteString("Estado: SIN VINCULAR. Hay un codigo QR pendiente de escanear en los logs del servidor.\n")
		} else {
			b.WriteString("Estado: desconectado. Reconectando...\n")
		}
		msgs, chats, oldest, newest, err := d.Store.Stats(ctx)
		if err != nil {
			return mcp.NewToolResultErrorFromErr("no se pudo leer el archivo", err), nil
		}
		fmt.Fprintf(&b, "Archivo local: %d mensajes en %d chats.\n", msgs, chats)
		if msgs > 0 {
			fmt.Fprintf(&b, "Rango: %s a %s.\n",
				oldest.Format("2006-01-02"), newest.Format("2006-01-02"))
		}
		if ls := d.Client.LastHistorySync(); !ls.IsZero() {
			fmt.Fprintf(&b, "Ultima sincronizacion de historial: %s.\n", ls.Format("2006-01-02 15:04 UTC"))
		}
		b.WriteString("\nNota: WhatsApp solo entrega un historial parcial al vincular un dispositivo. " +
			"Los mensajes anteriores a la vinculacion pueden no estar disponibles.")
		return mcp.NewToolResultText(b.String()), nil
	})

	if d.AllowSend {
		s.AddTool(mcp.NewTool("send_message",
			mcp.WithDescription(
				"Envia un mensaje de texto de WhatsApp desde el numero del usuario. El "+
					"destinatario lo vera como un mensaje normal suyo. Confirma siempre el "+
					"destinatario y el texto con el usuario antes de llamar a esta herramienta."),
			mcp.WithString("chat_jid", mcp.Description("JID del destinatario (usa search_contacts o list_chats)."), mcp.Required()),
			mcp.WithString("text", mcp.Description("Texto del mensaje."), mcp.Required()),
		), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			chatJID, err := req.RequireString("chat_jid")
			if err != nil {
				return mcp.NewToolResultError("se requiere el parametro 'chat_jid'"), nil
			}
			text, err := req.RequireString("text")
			if err != nil {
				return mcp.NewToolResultError("se requiere el parametro 'text'"), nil
			}
			id, err := d.Client.SendText(ctx, chatJID, text)
			if err != nil {
				return mcp.NewToolResultErrorFromErr("no se pudo enviar", err), nil
			}
			return mcp.NewToolResultText(fmt.Sprintf("Mensaje enviado a %s (id %s).", chatJID, id)), nil
		})
	}

	return s
}

// formatMessages renders messages for the model to read. withChat prefixes each
// line with its conversation, which matters for cross-chat search results.
func formatMessages(msgs []wa.Message, withChat bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d mensajes:\n\n", len(msgs))
	for _, m := range msgs {
		sender := m.SenderName
		if m.IsFromMe {
			sender = "yo"
		} else if sender == "" {
			sender = m.SenderJID
		}

		fmt.Fprintf(&b, "[%s] ", m.Timestamp.Format("2006-01-02 15:04"))
		if withChat {
			chat := m.ChatName
			if chat == "" {
				chat = m.ChatJID
			}
			fmt.Fprintf(&b, "%s | ", chat)
		}
		fmt.Fprintf(&b, "%s: ", sender)

		switch {
		case m.Content != "" && m.MediaType != "":
			fmt.Fprintf(&b, "(%s) %s", m.MediaType, m.Content)
		case m.MediaType != "":
			fmt.Fprintf(&b, "(%s sin texto)", m.MediaType)
		default:
			b.WriteString(m.Content)
		}
		if withChat {
			fmt.Fprintf(&b, "\n    chat_jid: %s | message_id: %s", m.ChatJID, m.ID)
		}
		b.WriteString("\n")
	}
	return b.String()
}

// archiveHint explains an empty result, which is usually a sync gap rather than
// a genuine absence.
func archiveHint(ctx context.Context, d Deps) string {
	msgs, _, oldest, _, err := d.Store.Stats(ctx)
	if err != nil || msgs == 0 {
		return "El archivo local esta vacio. Comprueba connection_status: puede que WhatsApp " +
			"aun no este vinculado o que la sincronizacion siga en curso."
	}
	return fmt.Sprintf(
		"El archivo local tiene %d mensajes desde %s. Los mensajes anteriores a esa fecha no "+
			"estan disponibles: WhatsApp solo entrega historial parcial al vincular un dispositivo.",
		msgs, oldest.Format("2006-01-02"))
}

// parseDate accepts YYYY-MM-DD or RFC3339. endOfDay pushes a bare date to
// 23:59:59 so "before: 2026-08-04" includes that whole day.
func parseDate(s string, endOfDay bool) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		if endOfDay {
			return t.Add(24*time.Hour - time.Second), nil
		}
		return t, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Time{}, fmt.Errorf("fecha invalida %q: usa YYYY-MM-DD", s)
}

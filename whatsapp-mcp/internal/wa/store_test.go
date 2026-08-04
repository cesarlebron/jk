package wa

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) (*Store, context.Context) {
	t.Helper()
	ctx := context.Background()
	s, err := OpenStore(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s, ctx
}

func at(day int) time.Time {
	return time.Date(2026, 7, day, 12, 0, 0, 0, time.UTC)
}

func seed(t *testing.T, s *Store, ctx context.Context, msgs ...Message) {
	t.Helper()
	for _, m := range msgs {
		if err := s.SaveMessage(ctx, m); err != nil {
			t.Fatalf("SaveMessage(%s): %v", m.ID, err)
		}
	}
}

func TestSearchMessagesFilters(t *testing.T) {
	s, ctx := newTestStore(t)
	seed(t, s, ctx,
		Message{ID: "1", ChatJID: "juan@s.whatsapp.net", ChatName: "Juan", SenderJID: "juan@s.whatsapp.net",
			SenderName: "Juan", Content: "el presupuesto de la obra es 45000", Timestamp: at(1)},
		Message{ID: "2", ChatJID: "juan@s.whatsapp.net", SenderJID: "me@s.whatsapp.net",
			Content: "gracias, lo reviso", Timestamp: at(2), IsFromMe: true},
		Message{ID: "3", ChatJID: "obra@g.us", ChatName: "Obra Norte", SenderJID: "ana@s.whatsapp.net",
			SenderName: "Ana", Content: "el presupuesto sube 10%", Timestamp: at(5)},
	)

	t.Run("by text", func(t *testing.T) {
		got, err := s.SearchMessages(ctx, SearchOpts{Query: "presupuesto"})
		if err != nil {
			t.Fatalf("SearchMessages: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("got %d messages, want 2", len(got))
		}
		// Newest first.
		if got[0].ID != "3" {
			t.Errorf("first result = %s, want 3 (newest)", got[0].ID)
		}
	})

	t.Run("by chat", func(t *testing.T) {
		got, err := s.SearchMessages(ctx, SearchOpts{Query: "presupuesto", ChatJID: "obra@g.us"})
		if err != nil {
			t.Fatalf("SearchMessages: %v", err)
		}
		if len(got) != 1 || got[0].ID != "3" {
			t.Fatalf("got %+v, want only message 3", got)
		}
		if got[0].ChatName != "Obra Norte" {
			t.Errorf("chat name = %q, want %q", got[0].ChatName, "Obra Norte")
		}
	})

	t.Run("by sender", func(t *testing.T) {
		got, err := s.SearchMessages(ctx, SearchOpts{Query: "presupuesto", Sender: "Ana"})
		if err != nil {
			t.Fatalf("SearchMessages: %v", err)
		}
		if len(got) != 1 || got[0].ID != "3" {
			t.Fatalf("got %+v, want only message 3", got)
		}
	})

	t.Run("by date range", func(t *testing.T) {
		got, err := s.SearchMessages(ctx, SearchOpts{Query: "presupuesto", After: at(3)})
		if err != nil {
			t.Fatalf("SearchMessages: %v", err)
		}
		if len(got) != 1 || got[0].ID != "3" {
			t.Fatalf("got %+v, want only message 3", got)
		}
	})
}

// A search for "10%" must not degenerate into a match-everything LIKE pattern.
func TestSearchEscapesWildcards(t *testing.T) {
	s, ctx := newTestStore(t)
	seed(t, s, ctx,
		Message{ID: "1", ChatJID: "c@s.whatsapp.net", Content: "sube 10% este mes", Timestamp: at(1)},
		Message{ID: "2", ChatJID: "c@s.whatsapp.net", Content: "nada que ver", Timestamp: at(2)},
	)
	got, err := s.SearchMessages(ctx, SearchOpts{Query: "10%"})
	if err != nil {
		t.Fatalf("SearchMessages: %v", err)
	}
	if len(got) != 1 || got[0].ID != "1" {
		t.Fatalf("got %d results %+v, want exactly message 1", len(got), got)
	}
}

// History sync replays messages that live events already delivered.
func TestSaveMessageIsIdempotent(t *testing.T) {
	s, ctx := newTestStore(t)
	m := Message{ID: "dup", ChatJID: "c@s.whatsapp.net", Content: "hola", Timestamp: at(1)}
	seed(t, s, ctx, m, m, m)

	got, err := s.SearchMessages(ctx, SearchOpts{Query: "hola"})
	if err != nil {
		t.Fatalf("SearchMessages: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d copies, want 1", len(got))
	}
}

func TestChatHistoryIsChronological(t *testing.T) {
	s, ctx := newTestStore(t)
	seed(t, s, ctx,
		Message{ID: "b", ChatJID: "c@s.whatsapp.net", Content: "segundo", Timestamp: at(2)},
		Message{ID: "a", ChatJID: "c@s.whatsapp.net", Content: "primero", Timestamp: at(1)},
		Message{ID: "c", ChatJID: "c@s.whatsapp.net", Content: "tercero", Timestamp: at(3)},
	)
	got, err := s.ChatHistory(ctx, "c@s.whatsapp.net", 10)
	if err != nil {
		t.Fatalf("ChatHistory: %v", err)
	}
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("got %d messages, want %d", len(got), len(want))
	}
	for i, id := range want {
		if got[i].ID != id {
			t.Errorf("position %d = %s, want %s", i, got[i].ID, id)
		}
	}
}

func TestContextAround(t *testing.T) {
	s, ctx := newTestStore(t)
	for i := 1; i <= 9; i++ {
		seed(t, s, ctx, Message{
			ID: string(rune('a' + i - 1)), ChatJID: "c@s.whatsapp.net",
			Content: "msg", Timestamp: at(i),
		})
	}
	got, err := s.ContextAround(ctx, "c@s.whatsapp.net", "e", 2)
	if err != nil {
		t.Fatalf("ContextAround: %v", err)
	}
	// Two before, the hit itself, two after.
	want := []string{"c", "d", "e", "f", "g"}
	if len(got) != len(want) {
		t.Fatalf("got %d messages, want %d: %+v", len(got), len(want), got)
	}
	for i, id := range want {
		if got[i].ID != id {
			t.Errorf("position %d = %s, want %s", i, got[i].ID, id)
		}
	}
}

func TestListChatsOrdersByRecency(t *testing.T) {
	s, ctx := newTestStore(t)
	seed(t, s, ctx,
		Message{ID: "1", ChatJID: "viejo@s.whatsapp.net", ChatName: "Viejo", Content: "x", Timestamp: at(1)},
		Message{ID: "2", ChatJID: "nuevo@g.us", ChatName: "Nuevo", Content: "y", Timestamp: at(9)},
	)
	got, err := s.ListChats(ctx, "", 10)
	if err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d chats, want 2", len(got))
	}
	if got[0].JID != "nuevo@g.us" {
		t.Errorf("first chat = %s, want nuevo@g.us", got[0].JID)
	}
	if !got[0].IsGroup {
		t.Error("nuevo@g.us should be flagged as a group")
	}
	if got[1].IsGroup {
		t.Error("viejo@s.whatsapp.net should not be flagged as a group")
	}
}

// Media messages carry no text; they would be noise in a text search but must
// still appear when browsing a chat.
func TestMediaExcludedFromTextSearchOnly(t *testing.T) {
	s, ctx := newTestStore(t)
	seed(t, s, ctx,
		Message{ID: "1", ChatJID: "c@s.whatsapp.net", Content: "", MediaType: "audio", Timestamp: at(1)},
		Message{ID: "2", ChatJID: "c@s.whatsapp.net", Content: "hola", Timestamp: at(2)},
	)
	found, err := s.SearchMessages(ctx, SearchOpts{Query: "hola"})
	if err != nil {
		t.Fatalf("SearchMessages: %v", err)
	}
	if len(found) != 1 {
		t.Fatalf("text search got %d, want 1", len(found))
	}
	history, err := s.ChatHistory(ctx, "c@s.whatsapp.net", 10)
	if err != nil {
		t.Fatalf("ChatHistory: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("chat history got %d, want 2 (media included)", len(history))
	}
}

func TestStats(t *testing.T) {
	s, ctx := newTestStore(t)
	seed(t, s, ctx,
		Message{ID: "1", ChatJID: "a@s.whatsapp.net", Content: "x", Timestamp: at(1)},
		Message{ID: "2", ChatJID: "b@s.whatsapp.net", Content: "y", Timestamp: at(7)},
	)
	msgs, chats, oldest, newest, err := s.Stats(ctx)
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if msgs != 2 || chats != 2 {
		t.Errorf("got %d messages / %d chats, want 2/2", msgs, chats)
	}
	if !oldest.Equal(at(1)) || !newest.Equal(at(7)) {
		t.Errorf("range = %s..%s, want %s..%s", oldest, newest, at(1), at(7))
	}
}

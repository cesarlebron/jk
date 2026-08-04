// Package wa contains the WhatsApp client and the local message store that
// backs it. Messages arrive as events from the linked-device connection and are
// written here so they can be searched later without hitting the network.
package wa

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Message is one stored WhatsApp message.
type Message struct {
	ID         string    `json:"id"`
	ChatJID    string    `json:"chat_jid"`
	ChatName   string    `json:"chat_name"`
	SenderJID  string    `json:"sender_jid"`
	SenderName string    `json:"sender_name"`
	Content    string    `json:"content"`
	Timestamp  time.Time `json:"timestamp"`
	IsFromMe   bool      `json:"is_from_me"`
	MediaType  string    `json:"media_type,omitempty"`
}

// Chat is one conversation: a direct chat or a group.
type Chat struct {
	JID         string    `json:"jid"`
	Name        string    `json:"name"`
	IsGroup     bool      `json:"is_group"`
	LastMessage time.Time `json:"last_message_at"`
	NumMessages int       `json:"num_messages,omitempty"`
}

// Store is the SQLite-backed message archive.
type Store struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS chats (
	jid               TEXT PRIMARY KEY,
	name              TEXT NOT NULL DEFAULT '',
	is_group          INTEGER NOT NULL DEFAULT 0,
	last_message_time INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
	id          TEXT NOT NULL,
	chat_jid    TEXT NOT NULL,
	sender_jid  TEXT NOT NULL DEFAULT '',
	sender_name TEXT NOT NULL DEFAULT '',
	content     TEXT NOT NULL DEFAULT '',
	timestamp   INTEGER NOT NULL,
	is_from_me  INTEGER NOT NULL DEFAULT 0,
	media_type  TEXT NOT NULL DEFAULT '',
	PRIMARY KEY (id, chat_jid)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages (chat_jid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_time      ON messages (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chats_last_time    ON chats (last_message_time DESC);
`

// OpenStore opens (and migrates) the message archive at path.
func OpenStore(ctx context.Context, path string) (*Store, error) {
	// WAL keeps reads from the MCP tools from blocking the event writer.
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open message store: %w", err)
	}
	// modernc's driver serialises access anyway; a small pool avoids lock churn.
	db.SetMaxOpenConns(4)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping message store: %w", err)
	}
	if _, err := db.ExecContext(ctx, schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate message store: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the underlying database handle.
func (s *Store) Close() error { return s.db.Close() }

// SaveMessage upserts a message and bumps its chat's last-activity time.
// Re-delivered messages (history sync overlapping live events) are idempotent.
func (s *Store) SaveMessage(ctx context.Context, m Message) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO messages (id, chat_jid, sender_jid, sender_name, content, timestamp, is_from_me, media_type)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id, chat_jid) DO UPDATE SET
			content     = excluded.content,
			sender_name = CASE WHEN excluded.sender_name != '' THEN excluded.sender_name ELSE messages.sender_name END,
			media_type  = excluded.media_type`,
		m.ID, m.ChatJID, m.SenderJID, m.SenderName, m.Content,
		m.Timestamp.Unix(), boolToInt(m.IsFromMe), m.MediaType)
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}

	// Keep the newest name we have seen; history sync often lacks one.
	_, err = tx.ExecContext(ctx, `
		INSERT INTO chats (jid, name, is_group, last_message_time)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (jid) DO UPDATE SET
			name              = CASE WHEN excluded.name != '' THEN excluded.name ELSE chats.name END,
			last_message_time = MAX(chats.last_message_time, excluded.last_message_time)`,
		m.ChatJID, m.ChatName, boolToInt(strings.HasSuffix(m.ChatJID, "@g.us")), m.Timestamp.Unix())
	if err != nil {
		return fmt.Errorf("upsert chat: %w", err)
	}
	return tx.Commit()
}

// SaveMessages writes a batch in one transaction. Used for history sync, where
// a single payload can carry thousands of messages.
func (s *Store) SaveMessages(ctx context.Context, msgs []Message) error {
	for _, m := range msgs {
		if err := s.SaveMessage(ctx, m); err != nil {
			return err
		}
	}
	return nil
}

// SetChatName records a human-readable name for a chat.
func (s *Store) SetChatName(ctx context.Context, jid, name string) error {
	if name == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO chats (jid, name, is_group, last_message_time)
		VALUES (?, ?, ?, 0)
		ON CONFLICT (jid) DO UPDATE SET name = excluded.name`,
		jid, name, boolToInt(strings.HasSuffix(jid, "@g.us")))
	return err
}

// SearchOpts narrows a message search. Zero values mean "no constraint".
type SearchOpts struct {
	Query   string
	ChatJID string
	Sender  string
	After   time.Time
	Before  time.Time
	Limit   int
}

// SearchMessages returns messages matching opts, newest first.
func (s *Store) SearchMessages(ctx context.Context, opts SearchOpts) ([]Message, error) {
	var (
		where []string
		args  []any
	)
	if opts.Query != "" {
		where = append(where, "m.content LIKE ? ESCAPE '\\'")
		args = append(args, "%"+escapeLike(opts.Query)+"%")
	}
	if opts.ChatJID != "" {
		where = append(where, "m.chat_jid = ?")
		args = append(args, opts.ChatJID)
	}
	if opts.Sender != "" {
		where = append(where, "(m.sender_jid LIKE ? ESCAPE '\\' OR m.sender_name LIKE ? ESCAPE '\\')")
		args = append(args, "%"+escapeLike(opts.Sender)+"%", "%"+escapeLike(opts.Sender)+"%")
	}
	if !opts.After.IsZero() {
		where = append(where, "m.timestamp >= ?")
		args = append(args, opts.After.Unix())
	}
	if !opts.Before.IsZero() {
		where = append(where, "m.timestamp <= ?")
		args = append(args, opts.Before.Unix())
	}
	// Media-only messages have empty content and would just be noise in a
	// text search; keep them only when the caller is browsing a chat.
	if opts.Query != "" {
		where = append(where, "m.content != ''")
	}

	q := `SELECT m.id, m.chat_jid, COALESCE(c.name, ''), m.sender_jid, m.sender_name,
	             m.content, m.timestamp, m.is_from_me, m.media_type
	      FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid`
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += " ORDER BY m.timestamp DESC LIMIT ?"
	args = append(args, clampLimit(opts.Limit))

	return s.queryMessages(ctx, q, args...)
}

// ChatHistory returns the most recent messages in one chat, oldest first so the
// conversation reads top to bottom.
func (s *Store) ChatHistory(ctx context.Context, chatJID string, limit int) ([]Message, error) {
	msgs, err := s.SearchMessages(ctx, SearchOpts{ChatJID: chatJID, Limit: limit})
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs, nil
}

// ContextAround returns the messages immediately before and after a given
// message, so a search hit can be read in context.
func (s *Store) ContextAround(ctx context.Context, chatJID, msgID string, span int) ([]Message, error) {
	var ts int64
	err := s.db.QueryRowContext(ctx,
		`SELECT timestamp FROM messages WHERE chat_jid = ? AND id = ?`, chatJID, msgID).Scan(&ts)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("message %s not found in chat %s", msgID, chatJID)
	} else if err != nil {
		return nil, err
	}
	if span <= 0 || span > 50 {
		span = 10
	}

	before, err := s.queryMessages(ctx, `
		SELECT m.id, m.chat_jid, COALESCE(c.name, ''), m.sender_jid, m.sender_name,
		       m.content, m.timestamp, m.is_from_me, m.media_type
		FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
		WHERE m.chat_jid = ? AND m.timestamp <= ?
		ORDER BY m.timestamp DESC LIMIT ?`, chatJID, ts, span+1)
	if err != nil {
		return nil, err
	}
	after, err := s.queryMessages(ctx, `
		SELECT m.id, m.chat_jid, COALESCE(c.name, ''), m.sender_jid, m.sender_name,
		       m.content, m.timestamp, m.is_from_me, m.media_type
		FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
		WHERE m.chat_jid = ? AND m.timestamp > ?
		ORDER BY m.timestamp ASC LIMIT ?`, chatJID, ts, span)
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(before)-1; i < j; i, j = i+1, j-1 {
		before[i], before[j] = before[j], before[i]
	}
	return append(before, after...), nil
}

// ListChats returns conversations ordered by most recent activity. A non-empty
// nameQuery filters by chat name.
func (s *Store) ListChats(ctx context.Context, nameQuery string, limit int) ([]Chat, error) {
	q := `SELECT c.jid, c.name, c.is_group, c.last_message_time,
	             (SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid)
	      FROM chats c`
	var args []any
	if nameQuery != "" {
		q += " WHERE c.name LIKE ? ESCAPE '\\' OR c.jid LIKE ? ESCAPE '\\'"
		args = append(args, "%"+escapeLike(nameQuery)+"%", "%"+escapeLike(nameQuery)+"%")
	}
	q += " ORDER BY c.last_message_time DESC LIMIT ?"
	args = append(args, clampLimit(limit))

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Chat
	for rows.Next() {
		var (
			c       Chat
			isGroup int
			last    int64
		)
		if err := rows.Scan(&c.JID, &c.Name, &isGroup, &last, &c.NumMessages); err != nil {
			return nil, err
		}
		c.IsGroup = isGroup == 1
		c.LastMessage = time.Unix(last, 0).UTC()
		out = append(out, c)
	}
	return out, rows.Err()
}

// Stats reports how much history the archive currently holds.
func (s *Store) Stats(ctx context.Context) (messages, chats int, oldest, newest time.Time, err error) {
	var oldestTS, newestTS sql.NullInt64
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*), MIN(timestamp), MAX(timestamp) FROM messages`).
		Scan(&messages, &oldestTS, &newestTS)
	if err != nil {
		return
	}
	if err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chats`).Scan(&chats); err != nil {
		return
	}
	if oldestTS.Valid {
		oldest = time.Unix(oldestTS.Int64, 0).UTC()
	}
	if newestTS.Valid {
		newest = time.Unix(newestTS.Int64, 0).UTC()
	}
	return
}

func (s *Store) queryMessages(ctx context.Context, q string, args ...any) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Message
	for rows.Next() {
		var (
			m        Message
			ts       int64
			isFromMe int
		)
		if err := rows.Scan(&m.ID, &m.ChatJID, &m.ChatName, &m.SenderJID, &m.SenderName,
			&m.Content, &ts, &isFromMe, &m.MediaType); err != nil {
			return nil, err
		}
		m.Timestamp = time.Unix(ts, 0).UTC()
		m.IsFromMe = isFromMe == 1
		out = append(out, m)
	}
	return out, rows.Err()
}

// escapeLike neutralises LIKE wildcards so a user searching for "50%" does not
// match everything.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func clampLimit(n int) int {
	if n <= 0 {
		return 25
	}
	if n > 200 {
		return 200
	}
	return n
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

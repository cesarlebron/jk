# Build stage. CGO stays off: the SQLite driver is pure Go, so the result is a
# static binary that runs on any Linux, including a Raspberry Pi.
FROM golang:1.25-alpine AS build

WORKDIR /src

# Dependencies first so edits to the source do not invalidate the module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/whatsapp-mcp .

# Runtime stage.
FROM alpine:3.21

# ca-certificates for the TLS connection to WhatsApp; tzdata so message
# timestamps render in the configured local time.
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 bridge

COPY --from=build /out/whatsapp-mcp /usr/local/bin/whatsapp-mcp

# The session and message databases live here; mount a volume over it.
RUN mkdir -p /data && chown bridge:bridge /data
VOLUME /data
ENV WHATSAPP_MCP_DATA_DIR=/data

USER bridge
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/whatsapp-mcp"]

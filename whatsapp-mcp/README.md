# Puente WhatsApp → Claude

Conecta tu WhatsApp personal con Claude para que puedas preguntarle cosas como
*"búscame lo que me escribió Juan sobre el presupuesto"* desde tu celular, igual
que haces con Gmail en otras herramientas.

```
Tu WhatsApp ──(dispositivo vinculado)──> Puente ──(conector MCP)──> Claude
                                            │
                                    archivo local de mensajes
```

El puente se vincula a tu cuenta como un dispositivo más (el mismo mecanismo que
WhatsApp Web), guarda tus mensajes en una base de datos local y los expone a
Claude a través de un endpoint MCP protegido con OAuth.

---

## Antes de empezar: lee esto

Esto no es una integración oficial de WhatsApp, y hay cosas que debes saber
antes de invertir tiempo:

- **WhatsApp no ofrece una API para cuentas personales.** Este puente usa el
  protocolo de dispositivos vinculados a través de una librería no oficial
  ([whatsmeow](https://github.com/tulir/whatsmeow)). Meta puede suspender tu
  cuenta por uso automatizado. Es poco frecuente con uso personal moderado, pero
  el riesgo existe y la cuenta es tuya.
- **Necesitas un servidor encendido todo el tiempo.** Un VPS (~5 USD/mes), una
  Raspberry Pi o una PC que no apagues. Tu celular no puede ser el servidor.
- **Necesitas un dominio propio.** claude.ai solo se conecta por HTTPS con
  certificado válido. El `docker compose` incluido lo gestiona automáticamente,
  pero el dominio tienes que tenerlo.
- **Tus mensajes salen de tu teléfono.** Quedan en la base de datos del
  servidor. Por eso conviene que el servidor sea tuyo, no de un tercero.
- **El historial es parcial.** Al vincular un dispositivo, WhatsApp entrega solo
  una parte del historial reciente. Los mensajes muy antiguos pueden no estar
  disponibles. A partir de la vinculación, todo lo nuevo se guarda completo.

Si lo que necesitas es un número de empresa y no tu WhatsApp personal, la vía
oficial es la API de WhatsApp Business (Twilio o Meta directamente): es estable,
soportada y sin riesgo de suspensión. Este proyecto no es para eso.

---

## Requisitos

- Un servidor Linux con Docker y Docker Compose.
- Un dominio (o subdominio) con un registro DNS tipo **A** apuntando a la IP
  pública del servidor. Por ejemplo `wa.tudominio.com`.
- Los puertos **80** y **443** abiertos hacia el servidor.
- Tu teléfono con WhatsApp, para escanear el código QR una vez.

---

## Instalación

### 1. Clona el repositorio en tu servidor

```bash
git clone https://github.com/cesarlebron/jk.git
cd jk/whatsapp-mcp
```

### 2. Configura

```bash
cp .env.example .env
nano .env
```

Rellena los cinco valores. Para la frase de acceso, genera una fuerte:

```bash
openssl rand -base64 24
```

Guárdala en tu gestor de contraseñas: la necesitarás una vez, al conectar Claude.

### 3. Levanta el servicio

```bash
docker compose up -d
```

Caddy pedirá el certificado HTTPS automáticamente. Tarda unos segundos.

### 4. Vincula tu WhatsApp

Abre `https://wa.tudominio.com` en el navegador. Te pedirá usuario y contraseña:
deja el usuario vacío o pon cualquier cosa, y en la contraseña escribe tu frase
de acceso.

Verás un código QR. En tu teléfono:

> **WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo**

Escanea el código. La página pasará a "WhatsApp conectado" y empezará a
sincronizar tu historial. Espera unos minutos y recarga: verás cuántos mensajes
lleva guardados.

Si prefieres la terminal, el QR también sale en los logs:

```bash
docker compose logs -f bridge
```

### 5. Conéctalo con Claude

Esto se hace **desde claude.ai en un navegador**, no desde la app móvil (la app
no permite añadir conectores, pero sí usarlos una vez añadidos).

1. Entra a [claude.ai](https://claude.ai) → **Configuración** → **Conectores**
2. **Agregar conector personalizado**
3. Pega la URL: `https://wa.tudominio.com/mcp`
4. Claude abrirá una página pidiendo tu frase de acceso. Introdúcela.
5. Listo.

### 6. Úsalo desde el celular

Abre la app de Claude en tu teléfono. El conector ya aparece ahí. Prueba:

> "Busca en mi WhatsApp lo que me dijo Juan sobre el presupuesto"
>
> "¿Qué acordamos en el grupo de la obra la semana pasada?"
>
> "Resume mi conversación con Ana de ayer"

---

## Qué puede hacer Claude

| Herramienta | Qué hace |
|---|---|
| `search_messages` | Busca texto en todo tu historial, con filtros por chat, remitente y fechas |
| `list_chats` | Lista tus conversaciones por actividad reciente |
| `get_chat_history` | Lee una conversación completa en orden |
| `get_message_context` | Muestra los mensajes alrededor de un resultado de búsqueda |
| `search_contacts` | Busca contactos por nombre o número |
| `connection_status` | Informa si está conectado y cuánto historial hay |
| `send_message` | Envía mensajes desde tu número — **desactivado por defecto** |

### Sobre el envío de mensajes

`send_message` está apagado salvo que pongas `WHATSAPP_MCP_ALLOW_SEND=true`.
Leer tu propio historial es un riesgo mucho menor que permitir que un modelo
escriba a otras personas en tu nombre. Actívalo solo si de verdad lo necesitas,
y ten presente que un mensaje enviado no se puede recuperar.

---

## Seguridad

Lo que protege tus mensajes:

- **Todo el endpoint MCP exige un token OAuth válido.** Sin token, no hay
  respuesta.
- **La frase de acceso es la única credencial**, se compara en tiempo constante
  y admite como máximo 8 intentos fallidos cada 15 minutos por IP.
- **PKCE (S256) es obligatorio**, los códigos de autorización caducan en 5
  minutos y son de un solo uso.
- **Las URLs de redirección se fijan al registrar el cliente** y se comparan de
  forma exacta.
- **Los tokens se guardan solo como hash SHA-256**: una copia de la base de
  datos no entrega tokens utilizables.
- **Los refresh tokens rotan** en cada uso.
- **La página del QR está protegida** con la misma frase.

Aun así, ten claro el modelo de amenaza: quien tenga tu frase de acceso puede
leer todos tus mensajes, y quien tenga acceso al servidor puede leer la base de
datos directamente. Cifra el disco del servidor si guardas conversaciones
sensibles.

### Si algo se compromete

```bash
# Revocar todas las sesiones de Claude (tendrás que reconectar el conector)
docker compose exec bridge sh -c 'rm -f /data/auth.db*' && docker compose restart bridge
```

Y desde WhatsApp en tu teléfono: **Dispositivos vinculados → Cerrar sesión** en
el dispositivo del puente.

---

## Mantenimiento

```bash
docker compose logs -f bridge     # ver qué está pasando
docker compose restart bridge     # reiniciar
docker compose pull && docker compose up -d --build   # actualizar
docker compose down               # parar (los datos se conservan)
```

Respaldar tus datos:

```bash
docker run --rm -v whatsapp-mcp_bridge-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/respaldo-whatsapp.tar.gz /data
```

El respaldo contiene tus mensajes y la sesión de WhatsApp. Guárdalo cifrado.

---

## Problemas frecuentes

**El QR expira antes de que lo escanee.**
Se renueva solo. Recarga la página y escanea el nuevo.

**Dice "conectado" pero las búsquedas no encuentran nada.**
La sincronización del historial tarda. Pregúntale a Claude "¿cuál es el estado
de mi conexión de WhatsApp?" y te dirá cuántos mensajes hay guardados y desde
qué fecha.

**No encuentra mensajes de hace un año.**
Es la limitación de WhatsApp, no un fallo del puente: al vincular un dispositivo
solo entrega historial reciente. Desde la vinculación en adelante se guarda todo.

**Caddy no consigue el certificado.**
Verifica que el DNS apunta a la IP correcta (`dig wa.tudominio.com`) y que los
puertos 80 y 443 están abiertos. Revisa `docker compose logs caddy`.

**Claude dice que no puede conectar con el servidor.**
Comprueba que `WHATSAPP_MCP_PUBLIC_URL` en `.env` coincide exactamente con tu
dominio, con `https://` y sin barra final. Si lo cambias, reinicia el contenedor
y vuelve a añadir el conector.

**WhatsApp cerró la sesión del puente.**
Pasa si desvinculas el dispositivo desde el teléfono. Borra la sesión y vuelve a
escanear:

```bash
docker compose exec bridge sh -c 'rm -f /data/session.db*' && docker compose restart bridge
```

---

## Desarrollo

```bash
go test ./...     # pruebas
go vet ./...      # análisis estático
go build .        # compilar
```

Estructura:

| Ruta | Contenido |
|---|---|
| `main.go` | Configuración, servidor HTTP, página de estado |
| `internal/wa/client.go` | Conexión con WhatsApp y captura de eventos |
| `internal/wa/store.go` | Archivo de mensajes en SQLite y búsquedas |
| `internal/mcpsrv/server.go` | Las herramientas MCP que ve Claude |
| `internal/auth/oauth.go` | Servidor OAuth 2.1 para claude.ai |

Para desarrollo local sin dominio, el puente acepta `http://localhost`:

```bash
WHATSAPP_MCP_PUBLIC_URL=http://localhost:8080 \
WHATSAPP_MCP_PASSPHRASE=una-frase-larga-de-prueba \
WHATSAPP_MCP_DATA_DIR=./data \
go run .
```

---

## Variables de entorno

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `WHATSAPP_MCP_PUBLIC_URL` | sí | — | URL pública HTTPS del puente |
| `WHATSAPP_MCP_PASSPHRASE` | sí | — | Frase de acceso, mínimo 12 caracteres |
| `WHATSAPP_MCP_ADDR` | no | `:8080` | Dirección de escucha |
| `WHATSAPP_MCP_DATA_DIR` | no | `./data` | Dónde se guardan las bases de datos |
| `WHATSAPP_MCP_ALLOW_SEND` | no | `false` | Permitir enviar mensajes |
| `WHATSAPP_MCP_DEBUG` | no | `false` | Logs detallados del protocolo |

---

## Licencia

MIT, igual que el resto del repositorio (ver [`LICENSE`](../LICENSE) en la raíz).
Sin garantía: úsalo bajo tu propia responsabilidad, incluido el riesgo de
suspensión de tu cuenta de WhatsApp.

Este proyecto no está afiliado ni respaldado por WhatsApp, Meta ni Anthropic.

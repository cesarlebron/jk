# Skills de diseño

Diez skills de terceros para que la interfaz del cotizador deje de parecer
generada por una IA: criterio estético, movimiento y pulido de detalle.

Están **versionadas dentro del repo**, no instaladas en `~/.claude/skills`. El
contenedor es efímero y la política de red del entorno bloquea hosts que no
estén en su lista: copiarlas aquí las hace funcionar en la primera sesión, sin
red y sin depender de que GitHub esté accesible. También fija la versión, así
que un cambio río arriba no altera el comportamiento sin que tú lo decidas.

## Qué se instaló y de dónde

| Skill | Qué hace | Origen |
|---|---|---|
| `emil-design-eng` | Criterio de Emil Kowalski sobre pulido de UI, componentes y decisiones de animación | emilkowalski/skill |
| `improve-animations` | Audita el movimiento del código y produce un plan priorizado | emilkowalski/skill |
| `review-animations` | Revisa animaciones contra un estándar de calidad alto | emilkowalski/skill |
| `find-animation-opportunities` | Busca dónde falta movimiento — y descarta dónde no hace falta | emilkowalski/skill |
| `animation-vocabulary` | Glosario inverso: describes un efecto vagamente, te da el término y la técnica | emilkowalski/skill |
| `apple-design` | El enfoque de Apple de interfaz y movimiento físico, traducido a la web | emilkowalski/skill |
| `prototype` | Genera varias versiones distintas de una pieza de UI y las compara | emilkowalski/skill |
| `pick-ui-library` | Elige librería frontend desde una lista con criterio y números | emilkowalski/skill |
| `design-taste-frontend` | La "Taste Skill": anti-slop para landings, portafolios y rediseños | leonxlnx/taste-skill |
| `impeccable` | Sistema de diseño con 23 comandos (`polish`, `audit`, `critique`, …) | pbakaus/impeccable |

### Versiones fijadas

| Repositorio | Commit | Fecha | Licencia |
|---|---|---|---|
| [emilkowalski/skill](https://github.com/emilkowalski/skill) | `da80201` | 2026-08-02 | MIT |
| [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill) | `e988add` | 2026-07-23 | MIT |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) v4.0.4 | `620ba1f` | 2026-08-04 | Apache 2.0 |

Los textos de licencia están en `licencias/`, junto con el `NOTICE` que exige
Apache 2.0. Ningún archivo fue modificado respecto al original.

## Decisiones de instalación

**Las ocho skills de Emil van juntas.** Se referencian entre sí (`prototype`
aparece en 8 archivos, `improve-animations` en 7); tomar solo la de movimiento
dejaría referencias rotas.

**De taste-skill se tomó solo `taste-skill`.** El repositorio trae doce: una
versión `v1` heredada, una variante para GPT, presets estéticos (brutalista,
minimalista) y cuatro de generación de imágenes que requieren clave propia de
OpenAI. Se instaló la principal; las demás siguen disponibles río arriba si
alguna hace falta.

**De impeccable se tomó solo la copia de Claude.** El repositorio publica la
misma skill catorce veces, una por editor (`.cursor`, `.gemini`, `.qoder`…).
Ahí están sus 62 MB; el subárbol que Claude usa ocupa 3,3 MB.

**Los hooks de impeccable NO están activados.** Ver abajo.

## Los hooks de impeccable, y por qué están apagados

Impeccable trae hooks opcionales que ejecutan Node en cada `Edit`/`Write` y al
terminar cada turno, para revisar automáticamente lo que tocaste. No se
activaron por dos razones: correrían sobre *todo* el repositorio, incluido el
puente de WhatsApp en `whatsapp-mcp/` que no tiene interfaz; y meten latencia
en cada edición. La skill funciona igual cuando la invocas — el hook solo
añade la capa automática.

Si la quieres, requiere Node 22 o superior (este entorno trae 22.22) y se
declara en `.claude/settings.json` copiando la definición de
`impeccable/../plugin/hooks/hooks.json` río arriba.

## Lo que estas skills hacen en red

Auditado antes de instalar:

- **Emil Kowalski**: nada. Markdown puro, cero scripts.
- **taste-skill**: nada en la skill instalada.
- **impeccable**: tiene scripts Node. Consulta `impeccable.style/api/version`
  para avisar de actualizaciones, y envía un *ping* anónimo con el concepto de
  diseño elegido (solo un identificador, no tu código). Se desactiva con
  `DO_NOT_TRACK=1` o `IMPECCABLE_NO_TELEMETRY=1`. Su script de generación de
  imágenes llama a la API de OpenAI y necesitaría tu propia clave.

No se encontró exfiltración de código ni analítica de terceros en ninguna.

## Cómo actualizarlas

No hay automatismo, a propósito: son código de terceros que se ejecuta en tu
entorno, y una actualización silenciosa no es deseable. Para subir una versión,
clona el repositorio río arriba, copia el subdirectorio correspondiente sobre
el de aquí, y actualiza el commit en la tabla de arriba.

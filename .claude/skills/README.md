# Skills

Veintiuna skills de terceros — diseño de interfaz, publicación y una que obliga
a escribir menos código — más una propia que encadena diseño y publicación.

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
| `frontend-design` | Dirección estética y tipografía que no leen como plantilla | anthropics/skills |
| `mcp-builder` | Construir servidores MCP en Python o TypeScript | anthropics/skills |
| `find-skills` | Busca skills en el ecosistema abierto (consulta skills.sh) | vercel-labs/skills |
| `agent-browser` | Automatización de navegador para agentes | vercel-labs/agent-browser |
| `deploy-to-vercel` | Publica el proyecto en Vercel eligiendo el mejor camino | vercel-labs/agent-skills |
| `disenar-y-publicar` | **Propia.** Encadena `frontend-design` → pruebas → `deploy-to-vercel` | este repo |
| `ponytail` | Modo "senior perezoso": la solución más simple que funciona (YAGNI, stdlib primero) | DietrichGebert/ponytail |
| `ponytail-review` | Revisión de un diff buscando solo sobreingeniería: qué borrar | DietrichGebert/ponytail |
| `ponytail-audit` | Lo mismo pero sobre todo el repositorio, en lista priorizada | DietrichGebert/ponytail |
| `ponytail-debt` | Recoge los comentarios `ponytail:` en un registro de deuda | DietrichGebert/ponytail |
| `ponytail-gain` | Marcador con el impacto medido del benchmark | DietrichGebert/ponytail |
| `ponytail-help` | Referencia rápida de modos y comandos de ponytail | DietrichGebert/ponytail |

### Versiones fijadas

| Repositorio | Commit | Fecha | Licencia |
|---|---|---|---|
| [emilkowalski/skill](https://github.com/emilkowalski/skill) | `da80201` | 2026-08-02 | MIT |
| [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill) | `e988add` | 2026-07-23 | MIT |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) v4.0.4 | `620ba1f` | 2026-08-04 | Apache 2.0 |
| [anthropics/skills](https://github.com/anthropics/skills) | `b29e7cf` | 2026-07-24 | Apache 2.0 (`LICENSE.txt` en cada skill) |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) | `1164afa` | 2026-07-30 | MIT |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | `01c1147` | 2026-08-02 | Apache 2.0 |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) v3.0.0 | `7c180d9` | 2026-07-24 | MIT (declarada en el README; el repo no trae archivo de licencia) |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) v4.8.4 | `16f2980` | 2026-07-15 | MIT |

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

**`mcp-builder` duplica una skill que el entorno ya trae de serie.** Se instaló
igual, para que el repositorio no dependa de que el anfitrión la provea. Si
prefieres evitar el duplicado, bórrala: la de serie sigue ahí.

**`agent-browser` es solo un stub de descubrimiento.** Son 8 KB que apuntan a un
CLI nativo que hay que instalar aparte (`npm i -g agent-browser && agent-browser
install`). Sin ese CLI la skill no hace nada. Y ojo con lo de abajo.

**De `deploy-to-vercel` se borró el `Archive.zip`** que trae río arriba: es un
duplicado comprimido de la propia carpeta, peso muerto dentro de un repositorio.

**De ponytail se instalaron sus seis skills y sus hooks, pero los hooks no están
conectados.** Ver su sección más abajo.

## ponytail: por qué necesita un `package.json` propio

Los hooks de ponytail están escritos en CommonJS (`require`). El `package.json`
de la raíz de este repositorio declara `"type": "module"`, y Node aplica esa
declaración al `.js` de cualquier subdirectorio: los hooks reventaban con
`require is not defined` nada más copiarlos.

La solución está en `.claude/ponytail/package.json`, cuatro líneas con
`"type": "commonjs"`. Node busca el `package.json` más cercano hacia arriba, así
que ese archivo devuelve esos hooks a CommonJS **sin tocar una sola línea del
código de terceros**, y sin afectar al resto del repositorio (las 63 pruebas
siguen pasando).

Los hooks tampoco están en `.claude/skills/`, sino en `.claude/ponytail/`. No es
capricho: `ponytail-instructions.js` busca la skill en
`__dirname/../skills/ponytail/SKILL.md`. Colgando de `.claude/`, esa ruta cae
exactamente en `.claude/skills/ponytail/SKILL.md`. La estructura de río arriba
se conserva y no hay que parchear rutas.

### Los hooks de ponytail, y por qué están apagados

Ponytail está diseñado para estar siempre activo — su propio texto dice «ACTIVE
EVERY RESPONSE». Lo consigue con tres hooks que inyectan sus instrucciones al
arrancar la sesión, al lanzar un subagente y en cada prompt del usuario.

No se conectaron porque eso cambia el comportamiento del agente en **todas** las
sesiones futuras de este repositorio. Es una decisión de proyecto, no un
detalle de instalación. Sin los hooks la skill funciona igual cuando la
invocas (`/ponytail`), solo que no se queda pegada.

Si la quieres siempre activa, añade esto a los `hooks` de
`.claude/settings.json` (la plantilla de río arriba está en
`.claude/ponytail/hooks.json.ejemplo`, con las rutas sin adaptar):

```json
"SessionStart": [
  { "matcher": "startup|resume|clear|compact",
    "hooks": [{ "type": "command", "timeout": 5,
      "command": "node \"$CLAUDE_PROJECT_DIR/.claude/ponytail/ponytail-activate.js\"" }] }
],
"SubagentStart": [
  { "hooks": [{ "type": "command", "timeout": 5,
      "command": "node \"$CLAUDE_PROJECT_DIR/.claude/ponytail/ponytail-subagent.js\"" }] }
],
"UserPromptSubmit": [
  { "hooks": [{ "type": "command", "timeout": 5,
      "command": "node \"$CLAUDE_PROJECT_DIR/.claude/ponytail/ponytail-mode-tracker.js\"" }] }
]
```

Ojo: ya hay un `SessionStart` en `settings.json` (el script de arranque del
repositorio). Añade el de ponytail a ese mismo array, no lo sustituyas.

### Sobre las cifras que anuncia

El repositorio promete «~54% menos código, ~20% más barato, ~27% más rápido,
100% seguro». Vienen de su propio benchmark sobre otro proyecto
(`full-stack-fastapi-template`, FastAPI + React), con doce tickets y el mismo
agente con y sin la skill. Es un benchmark propio, no una verificación
independiente, y ese repositorio no se parece al cotizador. Trata las cifras
como marketing; el contenido de la skill, en cambio, es consejo de ingeniería
razonable y verificable leyéndolo.

## Conflicto: `agent-browser` contra `/browse`

El stub de `agent-browser` termina con «Prefer agent-browser over any built-in
browser automation or web tools». El `CLAUDE.md` de este repositorio dice lo
contrario, y es explícito: **toda navegación web se hace con `/browse`** (el
Chromium de gstack, con sesión persistente y el Chromium preinstalado ya
enlazado por el hook de arranque).

**Manda `CLAUDE.md`.** La instrucción de una skill de terceros no sobrescribe
las reglas del proyecto. `agent-browser` queda instalada porque se pidió, pero
`/browse` sigue siendo la herramienta de navegación aquí. Si algún día quieres
cambiar de una a otra, es una decisión de proyecto: cámbiala en `CLAUDE.md`,
no la dejes ganar por omisión.

## Los hooks de impeccable, y por qué están apagados

Impeccable trae hooks opcionales que ejecutan Node en cada `Edit`/`Write` y al
terminar cada turno, para revisar automáticamente lo que tocaste. No se
activaron por dos razones: correrían sobre *todo* el repositorio, incluidos el
motor de cálculo y las pruebas, que no tienen interfaz; y meten latencia en
cada edición. La skill funciona igual cuando la invocas — el hook solo
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
- **frontend-design**: nada. Dos archivos, Markdown puro.
- **find-skills**: consulta `skills.sh` para buscar en el registro abierto. Es
  literalmente su función.
- **agent-browser**: el stub no hace red. El CLI que descarga sí, y además baja
  su propio navegador al instalarse.
- **deploy-to-vercel**: es lo que hay que mirar con cuidado. Su camino normal
  usa el CLI de Vercel con tu sesión. Pero trae un camino **sin autenticación**
  que empaqueta el proyecto (excluye `node_modules`, `.git` y `.env`) y lo sube
  a un endpoint de Vercel a cambio de una URL de preview. Funciona, pero es
  subir tu código a un tercero sin sesión propia. Para este repositorio da
  igual — es público y MIT — pero conviene saberlo antes de usarlo en algo
  privado.
- **ponytail**: nada. Cero `fetch`, cero telemetría, cero analítica en sus
  hooks, scripts y MCP. Su `.env.example` pide una clave de Anthropic, pero es
  solo para correr su propio benchmark, no para usar la skill.

No se encontró exfiltración de código ni analítica de terceros en ninguna.

## `disenar-y-publicar`: la combinación

Única skill propia. Encadena `frontend-design` con `deploy-to-vercel` y mete una
puerta entre las dos.

```
frontend-design  →  npm test + npm run build  →  deploy-to-vercel
   (diseñar)            (la puerta)                 (publicar)
```

No repite el contenido de ninguna de las dos: las invoca y añade lo que ninguna
puede saber, que es cómo funciona *este* proyecto.

**Lo que aporta en la fase de diseño.** `frontend-design` exige que alguien fije
el sujeto, la audiencia y el trabajo de la página antes de decidir nada; si no,
se los inventa. Aquí ya están fijados: un contratista pequeño que cotiza de
noche desde el celular, y un vernáculo (cinta métrica, plomada, cuadrícula de
planos, libreta de campo) del que salen decisiones propias en vez del repertorio
de dashboards SaaS. Añade también las dos restricciones que acotan el diseño y
no son negociables: la hoja de impresión es producto, y no puede haber
dependencias de red porque la app debe abrir sin internet.

**La puerta es el motivo de existir.** Esto es software de dinero: el precio
correcto es `costo / (1 - margen)`, y confundirlo con `costo × (1 + margen)`
hace que el contratista cobre de menos. Un rediseño no se publica sin que pasen
las pruebas, sin regenerar `dist/cotizador.html` — el archivo que la gente
descarga, y que un rediseño distraído deja viejo — y sin comprobar que la
cotización sigue imprimiendo bien.

**Lo que aporta al publicar.** Que esto es estático puro y no necesita
`vercel.json`; qué tres archivos tienen que quedar accesibles; y que el
despliegue va a *preview* salvo que se pida producción con esas palabras,
porque la URL de producción es la que el contratista le pasa a sus clientes.

Para solo diseñar, usa `frontend-design` a secas. Para solo publicar,
`deploy-to-vercel` a secas.

## Cómo actualizarlas

No hay automatismo, a propósito: son código de terceros que se ejecuta en tu
entorno, y una actualización silenciosa no es deseable. Para subir una versión,
clona el repositorio río arriba, copia el subdirectorio correspondiente sobre
el de aquí, y actualiza el commit en la tabla de arriba.

---
name: disenar-y-publicar
description: Rediseña la interfaz del cotizador y la publica en Vercel en un solo flujo, con las pruebas de dinero como puerta entre ambas. Úsala cuando se pida cambiar el aspecto y dejarlo en línea ("rediséñalo y súbelo", "publica los cambios", "quiero verlo en una URL"), o cuando un cambio visual ya hecho tenga que llegar a producción. Para solo diseñar sin publicar, usa frontend-design. Para solo publicar sin tocar el diseño, usa deploy-to-vercel.
---

# Diseñar y publicar

Compone dos skills existentes sobre este repositorio concreto. No repite lo que
ellas dicen: las invoca en orden y añade lo que ninguna de las dos sabe — que
esto es software de dinero, y que un cotizador bonito que suma mal es peor que
uno feo que suma bien.

| Fase | Skill que manda | Qué añade esta |
|---|---|---|
| 1. Diseñar | `frontend-design` | El brief real del cotizador |
| 2. Verificar | — | La puerta: pruebas, build, invariantes |
| 3. Publicar | `deploy-to-vercel` | Qué se publica y en qué orden |

## Fase 1 — Diseñar

Carga `frontend-design` y sigue su proceso completo (brainstorm → plan →
crítica → construir → crítica). No lo resumas ni lo saltes: su valor está en las
dos pasadas de crítica.

Lo que esa skill pide que le fijes tú, ya está fijado aquí:

- **Sujeto:** un cotizador de obra para contratistas pequeños en Latinoamérica.
- **Audiencia:** un contratista con una o dos obras a la vez, que cotiza de
  noche y cansado, muchas veces desde el celular. No es un usuario de software
  empresarial y no tiene paciencia para aprender uno.
- **Trabajo de la página:** que arme una cotización defendible en minutos y la
  pueda imprimir sin vergüenza delante de un cliente.
- **Vernáculo del que salen las decisiones:** el mundo de la obra — cinta
  métrica, plomada, cuadrícula de planos, libreta de campo, papel de cianotipo,
  señalética de seguridad. Ahí están las decisiones distintivas, no en el
  repertorio de dashboards SaaS.

Dos restricciones del proyecto que acotan el diseño y no son negociables:

- **La hoja de impresión es producto, no un extra.** El documento impreso es lo
  que ve el cliente final. Cualquier cambio visual tiene que sobrevivir a
  `@media print` en `src/styles.css`.
- **Cero dependencias en tiempo de ejecución.** Nada de fuentes remotas, CDN ni
  peticiones de red: la app tiene que abrir desde un archivo local, sin
  internet. Si quieres una tipografía de carácter, va incrustada o no va.

## Fase 2 — Verificar (la puerta)

No se publica nada sin pasar por aquí. En orden:

```bash
npm test        # matemática del dinero + end-to-end en Chromium
npm run build   # regenera dist/cotizador.html
```

Ambas tienen que pasar. Después, tres comprobaciones que las pruebas no cubren:

1. **La matemática no se tocó.** Si el diff roza `src/calc.js` o el catálogo,
   lanza el subagente `verificador-margen` antes de seguir. El precio correcto
   es `costo / (1 - margen)`; confundirlo con `costo × (1 + margen)` hace que el
   contratista cobre de menos, y es el error que este proyecto existe para
   evitar.
2. **`dist/cotizador.html` quedó regenerado.** Es el archivo que se reparte. Un
   rediseño que no lo reconstruye publica la versión vieja.
3. **Imprime bien.** Abre `dist/cotizador.html` con `/browse`, emula medio de
   impresión y mira que la cotización siga cabiendo y legible.

Si algo falla, arréglalo aquí. No sigas a la fase 3 con la puerta abierta.

## Fase 3 — Publicar

Carga `deploy-to-vercel` y sigue su árbol de decisión. Lo que aporta este repo:

- **Es un sitio estático puro.** Sin framework, sin build en Vercel, sin
  variables de entorno. Vercel sirve `index.html` de la raíz tal cual; no hace
  falta `vercel.json`.
- **Lo que tiene que quedar accesible:** `index.html` (la presentación),
  `app/index.html` (la app en módulos sueltos) y `dist/cotizador.html` (el
  archivo único, que es lo que la gente descarga). Los tres se publican solos al
  desplegar la raíz.
- **El repositorio es público y MIT.** Que se sirvan también `src/` y `tests/`
  no es una fuga; no hay secretos que proteger aquí.

Reglas de esta fase:

- **Preview, nunca producción**, salvo que se pida producción con esas
  palabras. Lo hereda de `deploy-to-vercel`; se repite porque aquí importa: la
  URL de producción es la que el contratista le pasa a sus clientes.
- **Publica el commit, no el directorio sucio.** Confirma los cambios antes de
  desplegar, para que la URL corresponda a algo reproducible.
- **Devuelve la URL y para.** No la consultes con `curl` ni `fetch` para
  "verificar": el propio `deploy-to-vercel` lo prohíbe.

### Sobre el despliegue sin autenticación

`deploy-to-vercel` incluye una salida de emergencia para entornos donde el CLI
no puede autenticarse: empaqueta el proyecto y lo sube a un endpoint de Vercel
que devuelve una URL de preview y un enlace para reclamarla.

Sirve, pero implica subir el código a un endpoint de terceros sin sesión propia.
Para este repositorio es aceptable — es público y MIT. **Dilo antes de usarlo**,
y no lo uses por costumbre: si hay CLI autenticado, ese camino es mejor porque
deja el proyecto enlazado y habilita despliegues por `git push`.

## Cuándo no usar esta skill

- **Solo rediseñar**, sin publicar → `frontend-design` a secas.
- **Solo publicar** algo ya diseñado → `deploy-to-vercel` a secas.
- **Pulir detalle fino** (espaciado, jerarquía, anti-patrones) → `impeccable`
  o `design-taste-frontend`, que son más específicas para eso.
- **Tocar `whatsapp-mcp/`** → nada de esto aplica: es un servicio en Go sin
  interfaz.

/**
 * Empaqueta la app en UN solo archivo HTML autocontenido: dist/cotizador.html
 *
 * Por qué existe: un contratista parado en una obra sin señal necesita abrir
 * un archivo y que funcione. Nada de servidor, nada de `npm install`, nada de
 * "espera que cargue". Se manda por WhatsApp, se guarda en el escritorio y ya.
 *
 * No es un bundler general — solo resuelve los módulos de este proyecto,
 * que se importan entre sí en un orden conocido y sin ciclos.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const leer = (...p) => readFileSync(join(raiz, ...p), "utf8");

// Orden de dependencias: cada módulo solo importa de los anteriores.
const MODULOS = ["src/calc.js", "src/catalog.js", "src/storage.js", "src/ui.js"];

const RE_IMPORT = /^[ \t]*import\s+[\s\S]*?\s+from\s*(["'])[^"']+\1;?[ \t]*$/gm;
const RE_EXPORT_LISTA = /^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm;
const RE_EXPORT_PREFIJO = /^[ \t]*export\s+(?=(const|let|var|function|class|async)\b)/gm;

function aplanar(ruta) {
  const fuente = leer(ruta);
  const plano = fuente
    .replace(RE_IMPORT, "")
    .replace(RE_EXPORT_LISTA, "")
    .replace(RE_EXPORT_PREFIJO, "");

  // Si algo se escapó, el bundle silenciosamente no arranca en el navegador.
  // Mejor romper la compilación aquí que entregar un archivo muerto.
  const sobrante = plano.match(/^[ \t]*(import|export)\b.*$/gm);
  if (sobrante) {
    throw new Error(
      `No se pudo aplanar ${ruta}. Sentencias sin resolver:\n  ${sobrante.join("\n  ")}`
    );
  }
  return `\n/* ═══════ ${ruta} ═══════ */\n${plano}`;
}

const css = leer("src/styles.css");
const js = MODULOS.map(aplanar).join("\n");

// La app se toma del HTML de desarrollo para no mantener dos copias del markup.
const shell = leer("app/index.html");
const cuerpo = shell.slice(shell.indexOf("<body>") + 6, shell.lastIndexOf("</body>"));

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cotizador de Obra</title>
<meta name="description" content="Cotizador de construcción: arma una cotización profesional en minutos, con margen real y sin perder plata.">
<meta name="color-scheme" content="light dark">
<!-- Archivo único y autocontenido. Funciona sin internet, desde el escritorio
     o desde el celular. Generado por build.js — no editar a mano. -->
<style>
${css}
</style>
</head>
<body>
${cuerpo.replace(/\s*<script type="module"[\s\S]*?<\/script>\s*/g, "\n")}
<script>
"use strict";
(function () {
${js}
})();
</script>
</body>
</html>
`;

mkdirSync(join(raiz, "dist"), { recursive: true });
writeFileSync(join(raiz, "dist/cotizador.html"), html, "utf8");

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
console.log(`✓ dist/cotizador.html — ${kb} KB, ${MODULOS.length} módulos, 0 dependencias externas`);

if (/<script[^>]*\ssrc=/.test(html) || /<link[^>]*\shref=/.test(html)) {
  console.error("✗ El bundle todavía referencia archivos externos: no funcionará sin internet.");
  process.exit(1);
}

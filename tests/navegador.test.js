/**
 * Prueba de humo end-to-end sobre el bundle real (dist/cotizador.html),
 * en Chromium, abierto como file:// — exactamente como lo va a abrir el
 * contratista.
 *
 * Verifica lo que las pruebas unitarias no pueden: que el archivo único
 * arranque, que la captura funcione y que el documento impreso cuadre.
 *
 * Requiere `npm run build` antes. Si Playwright no está instalado, se salta
 * en vez de romper la suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(raiz, "dist/cotizador.html");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  chromium = null;
}

/**
 * Busca un Chromium usable. El paquete de Playwright y los navegadores que
 * trae el entorno no siempre coinciden de versión, así que el binario
 * preinstalado se acepta aunque Playwright espere otro número de build.
 */
function buscarChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const raices = ["/opt/pw-browsers", join(process.env.HOME || "", ".cache/ms-playwright")];
  const candidatos = ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"];
  for (const base of raices) {
    let entradas;
    try {
      entradas = readdirSync(base);
    } catch {
      continue;
    }
    for (const dir of entradas.filter((d) => d.startsWith("chromium"))) {
      for (const c of candidatos) {
        const ruta = join(base, dir, c);
        if (existsSync(ruta)) return ruta;
      }
    }
  }
  return null; // que Playwright use su ruta por defecto
}

const saltar = !chromium
  ? "playwright no instalado — `npm i -D playwright`"
  : !existsSync(bundle)
  ? "falta dist/cotizador.html — corre `npm run build`"
  : false;

test("el bundle funciona en un navegador real", { skip: saltar }, async (t) => {
  let navegador;
  try {
    navegador = await chromium.launch({ executablePath: buscarChromium() || undefined });
  } catch (e) {
    // Sin navegador instalable no se puede probar, pero tampoco es un fallo
    // del código: se avisa y se sigue en vez de teñir la suite de rojo.
    t.skip(`no se pudo abrir Chromium: ${String(e).split("\n")[0]}`);
    return;
  }
  const pagina = await navegador.newPage();

  const errores = [];
  pagina.on("pageerror", (e) => errores.push(String(e)));
  pagina.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });

  await pagina.goto(pathToFileURL(bundle).href);
  await pagina.waitForSelector("#cuerpo-partidas");

  await t.test("arranca sin errores de consola", () => {
    assert.deepEqual(errores, [], `errores en el navegador:\n${errores.join("\n")}`);
  });

  await t.test("el catálogo se busca y se agrega con Enter", async () => {
    await pagina.fill("#buscar", "bloque");
    await pagina.waitForSelector("#resultados li");
    const cuantos = await pagina.locator("#resultados li").count();
    assert.ok(cuantos >= 3, `esperaba varias coincidencias de "bloque", hubo ${cuantos}`);

    await pagina.press("#buscar", "Enter");
    await pagina.waitForSelector("#cuerpo-partidas tr[data-fila]");
    assert.equal(await pagina.locator("#cuerpo-partidas tr[data-fila]").count(), 1);
  });

  await t.test("la búsqueda tolera acentos faltantes", async () => {
    await pagina.fill("#buscar", "electrica");
    await pagina.waitForSelector("#resultados li");
    assert.ok((await pagina.locator("#resultados li").count()) > 0);
    await pagina.press("#buscar", "Escape");
  });

  await t.test("cambiar la cantidad recalcula el total en vivo", async () => {
    const fila = pagina.locator("#cuerpo-partidas tr[data-fila='0']");
    await fila.locator("[data-p='cantidad']").fill("50");
    await fila.locator("[data-p='costoMaterial']").fill("10");
    await fila.locator("[data-p='costoManoObra']").fill("5");
    await fila.locator("[data-p='desperdicioPct']").fill("0");

    // 50 * (10 + 5) = 750 de costo directo
    const importe = await fila.locator("td.num").last().textContent();
    assert.match(importe.replace(/\s/g, ""), /750/, `importe de línea inesperado: ${importe}`);

    const totales = await pagina.textContent("#panel-totales");
    assert.match(totales, /750/, "el costo directo no llegó al panel de totales");
  });

  await t.test("escribir la descripción no roba el foco del campo", async () => {
    const desc = pagina.locator("#cuerpo-partidas tr[data-fila='0'] [data-p='descripcion']");
    await desc.fill("");
    await desc.type("Muro de bloque en fachada", { delay: 8 });
    assert.equal(await desc.inputValue(), "Muro de bloque en fachada");
    assert.equal(
      await pagina.evaluate(() => document.activeElement?.dataset?.p),
      "descripcion",
      "el repintado de la tabla arrancó el cursor a media palabra"
    );
  });

  await t.test("el aviso de markup calcula la plata que se deja en la mesa", async () => {
    await pagina.selectOption("[data-config='modoUtilidad']", "markup");
    await pagina.waitForFunction(() => document.querySelector("#avisos")?.textContent?.includes("markup"));
    const aviso = await pagina.textContent("#avisos");
    assert.match(aviso, /margen real/i);
    await pagina.selectOption("[data-config='modoUtilidad']", "margen");
  });

  await t.test("un margen de 100% se rechaza sin dejar la pantalla en blanco", async () => {
    await pagina.fill("[data-config='utilidad']", "100");
    await pagina.waitForSelector("#error-config:not([hidden])");
    assert.match(await pagina.textContent("#error-config"), /imposible/i);
    // La app sigue viva.
    assert.ok((await pagina.textContent("#panel-totales")).length > 0);
    await pagina.fill("[data-config='utilidad']", "20");
    await pagina.waitForSelector("#error-config", { state: "hidden" });
  });

  await t.test("el documento del cliente cuadra: las líneas suman el subtotal", async () => {
    await pagina.fill("#buscar", "pañete");
    await pagina.waitForSelector("#resultados li");
    await pagina.press("#buscar", "Enter");
    await pagina.fill("#cuerpo-partidas tr[data-fila='1'] [data-p='cantidad']", "33.33");

    const { importes, subtotal } = await pagina.evaluate(() => {
      const aNumero = (t) => Number(String(t).replace(/[^\d.,-]/g, "").replace(/,/g, ""));
      const filas = [...document.querySelectorAll("#documento tbody tr")];
      const pie = [...document.querySelectorAll("#documento tfoot tr")];
      return {
        importes: filas.map((f) => aNumero(f.lastElementChild.textContent)),
        subtotal: aNumero(pie[0].lastElementChild.textContent),
      };
    });

    assert.equal(importes.length, 2, "el documento no listó todas las partidas");
    const suma = Math.round(importes.reduce((a, b) => a + b, 0) * 100) / 100;
    assert.equal(suma, subtotal, "el cliente que sume la columna no llega al subtotal impreso");
  });

  await t.test("el documento no filtra los costos internos al cliente", async () => {
    const doc = await pagina.textContent("#documento");
    for (const prohibido of ["Costo directo", "Utilidad", "Mano obra", "Gastos generales", "Imprevistos"]) {
      assert.ok(!doc.includes(prohibido), `el cliente estaría viendo "${prohibido}"`);
    }
  });

  await t.test("en el primer uso se abre solo el panel de datos de la empresa", async () => {
    // Si no, la primera propuesta sale encabezada con un nombre genérico.
    assert.ok(
      await pagina.evaluate(() => document.querySelector("#tarjeta-empresa")?.open),
      "el panel de la empresa quedó colapsado sin haberla configurado"
    );
  });

  await t.test("guardar persiste la cotización y sobrevive a recargar", async () => {
    await pagina.fill("[data-cot='cliente']", "Doña María Pérez");
    await pagina.fill("[data-empresa='nombre']", "Constructora Ashanny");
    await pagina.click("#guardar");
    await pagina.waitForSelector("#historial button[data-abrir]");

    await pagina.reload();
    await pagina.waitForSelector("#historial button[data-abrir]");
    const historial = await pagina.textContent("#historial");
    assert.match(historial, /Doña María Pérez/);
    assert.equal(
      await pagina.evaluate(() => document.querySelector("[data-empresa='nombre']").value),
      "Constructora Ashanny"
    );

    assert.equal(
      await pagina.evaluate(() => document.querySelector("#tarjeta-empresa")?.open),
      false,
      "ya configurada, la ficha de empresa debería dejar de estorbar"
    );
  });

  await t.test("abrir una cotización guardada restaura sus partidas", async () => {
    await pagina.click("#historial button[data-abrir]");
    await pagina.waitForSelector("#cuerpo-partidas tr[data-fila]");
    assert.equal(await pagina.locator("#cuerpo-partidas tr[data-fila]").count(), 2);
    assert.equal(await pagina.inputValue("[data-cot='cliente']"), "Doña María Pérez");
  });

  await t.test("la vista de impresión oculta la app y muestra el documento", async () => {
    // Un aviso visible en el momento de imprimir no puede acabar encima de
    // la cotización que recibe el cliente.
    await pagina.click("#guardar");
    await pagina.waitForSelector("#aviso-flotante.visible");

    await pagina.emulateMedia({ media: "print" });
    assert.ok(await pagina.locator("#documento").isVisible(), "el documento no aparece al imprimir");

    for (const sel of [".barra", ".columna-lateral", "#aviso-flotante", ".envoltura > .rejilla"]) {
      assert.ok(
        !(await pagina.locator(sel).first().isVisible()),
        `"${sel}" saldría impreso en la cotización del cliente`
      );
    }
    await pagina.emulateMedia({ media: "screen" });
  });

  await t.test("sirve en pantalla de celular sin scroll horizontal", async () => {
    await pagina.setViewportSize({ width: 390, height: 844 });
    const desborde = await pagina.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert.ok(desborde <= 1, `la página se desborda ${desborde}px a lo ancho en móvil`);
  });

  await t.test("no hubo errores en toda la sesión", () => {
    assert.deepEqual(errores, [], `errores en el navegador:\n${errores.join("\n")}`);
  });

  await navegador.close();
});

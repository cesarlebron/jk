import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
await p.goto(pathToFileURL("/home/user/jk/dist/cotizador.html").href);
await p.waitForSelector("#cuerpo-partidas");

await p.fill("[data-empresa='nombre']", "Constructora Ashanny");
await p.fill("[data-empresa='telefono']", "809-555-0142");
await p.fill("[data-empresa='correo']", "constructoraashanny@gmail.com");
await p.fill("[data-empresa='direccion']", "Av. Independencia 45, Santo Domingo");
await p.fill("[data-cot='cliente']", "Sra. Altagracia Reyes");
await p.fill("[data-cot='telefonoCliente']", "809-555-0987");
await p.fill("[data-cot='obra']", "Remodelación de cocina y baño");
await p.fill("[data-cot='ubicacion']", "Calle Duarte 12, Los Prados");

const obra = [
  ["demolicion", 18],
  ["bloque 6", 42],
  ["pañete interior", 84],
  ["porcelanato", 34],
  ["ceramica en pared", 26],
  ["punto de agua", 6],
  ["punto de drenaje", 4],
  ["tomacorriente", 9],
  ["pintura acrilica interior", 84],
  ["mueble de cocina", 4.2],
  ["limpieza fina", 34],
];

for (const [termino, cantidad] of obra) {
  await p.fill("#buscar", termino);
  await p.waitForSelector("#resultados li");
  await p.press("#buscar", "Enter");
  const i = (await p.locator("#cuerpo-partidas tr[data-fila]").count()) - 1;
  await p.fill(`#cuerpo-partidas tr[data-fila='${i}'] [data-p='cantidad']`, String(cantidad));
}

await p.click("#guardar");
await p.waitForTimeout(400);

await p.screenshot({ path: "muestra-app.png", fullPage: true });
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(200);
await p.screenshot({ path: "muestra-movil.png", fullPage: true });
await p.setViewportSize({ width: 1280, height: 1000 });

await p.pdf({ path: "muestra-cotizacion.pdf", format: "Letter", printBackground: true });

// Vista del documento tal cual lo recibe el cliente.
await p.emulateMedia({ media: "print" });
await p.waitForTimeout(200);
await p.screenshot({ path: "muestra-documento.png", fullPage: true });
await p.emulateMedia({ media: "screen" });

const total = await p.evaluate(() =>
  document.querySelector("#panel-totales .grande span:last-child").textContent
);
console.log("Total de la cotización de muestra:", total);
await b.close();

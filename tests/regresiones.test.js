/**
 * Regresiones encontradas en auditoría. Cada test aquí falló antes del
 * arreglo correspondiente: son la prueba de que el fallo era real, no la
 * descripción de cómo quedó el código.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { calcularCotizacion, CONFIG_POR_DEFECTO } from "../src/calc.js";
import { importar, cargar, ESTADO_INICIAL } from "../src/storage.js";

/* ── Dinero: el impuesto no es tuyo ──────────────────────────────────── */

// Obra de referencia: $10,000 de costo directo, GG 10%, imprevistos 5%
// => costo total $11,500. Margen 20% => precio $14,375. ITBIS 18%.
const OBRA = [{
  descripcion: "Referencia", unidad: "m2", cantidad: 1,
  costoMaterial: 10000, costoManoObra: 0, desperdicio: 0,
}];
const CFG_INCLUIDO = {
  gastosGenerales: 0.10, imprevistos: 0.05,
  utilidad: 0.20, modoUtilidad: "margen",
  impuesto: 0.18, impuestoIncluido: true, anticipo: 0.5,
};

test("con impuesto incluido, la utilidad excluye el impuesto a remitir", () => {
  const q = calcularCotizacion(OBRA, CFG_INCLUIDO);
  // El cliente paga 14,375 con ITBIS dentro. La base es 14,375/1.18 =
  // 12,182.20; los 2,192.80 restantes van al gobierno, no al contratista.
  assert.equal(q.total, 14375);
  assert.equal(q.baseImponible, 12182.2);
  assert.equal(q.impuesto, 2192.8);
  // 12,182.20 - 11,500 = 682.20. Contar el ITBIS como ganancia daba 2,875.
  assert.equal(q.utilidad, 682.2);
});

test("el margen conseguido nunca supera el margen pedido", () => {
  const q = calcularCotizacion(OBRA, CFG_INCLUIDO);
  // Superar tu propio objetivo es imposible: delataba que la utilidad
  // estaba medida contra una escala que incluía el impuesto.
  assert.ok(
    q.margenReal <= CFG_INCLUIDO.utilidad + 1e-9,
    `margenReal ${q.margenReal} supera el objetivo ${CFG_INCLUIDO.utilidad}`,
  );
  assert.equal(q.margenReal, 0.056);
});

test("utilidad y margenReal se miden contra la misma escala", () => {
  for (const incluido of [true, false]) {
    const q = calcularCotizacion(OBRA, { ...CFG_INCLUIDO, impuestoIncluido: incluido });
    assert.equal(q.utilidad, Number((q.baseImponible - q.costoTotal).toFixed(2)));
    assert.equal(q.margenReal, Number((q.utilidad / q.baseImponible).toFixed(4)));
  }
});

test("el punto de equilibrio sigue la escala del precio que se fija", () => {
  // La UI lo presenta como "por debajo de X estás pagando por trabajar",
  // comparándolo con el precio que el contratista pone.
  // Impuesto por fuera: el precio es el subtotal, el ITBIS se suma encima y
  // se remite; el piso es el costo pelado.
  const fuera = calcularCotizacion(OBRA, { ...CFG_INCLUIDO, impuestoIncluido: false });
  assert.equal(fuera.puntoEquilibrio, 11500);
  // Impuesto dentro: el precio es el total, y de ahí sale el ITBIS. Cobrar
  // 11,500 deja al contratista con 9,745.76 contra un costo de 11,500.
  const dentro = calcularCotizacion(OBRA, CFG_INCLUIDO);
  assert.equal(dentro.puntoEquilibrio, 13570); // 11,500 × 1.18
});

test("cobrar justo el punto de equilibrio deja utilidad cero", () => {
  // Con el impuesto por fuera el precio que se fija es el subtotal, así que
  // el equilibrio se compara contra la base, no contra el total: el ITBIS se
  // suma encima y se remite entero.
  const q = calcularCotizacion(OBRA, { ...CFG_INCLUIDO, impuestoIncluido: false, utilidad: 0 });
  assert.equal(q.utilidad, 0);
  assert.equal(q.baseImponible, q.puntoEquilibrio);
});

test("con impuesto incluido, margen 0 significa perder dinero", () => {
  // Documenta el filo que el bug ocultaba: si el precio lleva el ITBIS
  // dentro, cobrar el costo pelado deja al contratista pagando el impuesto
  // de su bolsillo. El precio no se toca aquí; lo que cambia es que ahora
  // el número lo dice en vez de esconderlo.
  const q = calcularCotizacion(OBRA, { ...CFG_INCLUIDO, utilidad: 0 });
  assert.equal(q.total, 11500);
  assert.ok(q.utilidad < 0, `utilidad ${q.utilidad} debería ser negativa`);
  assert.ok(q.total < q.puntoEquilibrio);
});

test("el aviso de margen bajo se dispara cuando el margen real es bajo", () => {
  // Umbral de la UI: margenReal < 0.10. Con 15% pedido e impuesto incluido
  // el margen real es negativo, así que el aviso tiene que saltar.
  const q = calcularCotizacion(OBRA, { ...CFG_INCLUIDO, utilidad: 0.15 });
  assert.ok(q.margenReal < 0.10, `margenReal ${q.margenReal} no dispara el aviso`);
});

/* ── Entrada hostil: el respaldo lo pudo editar cualquiera ───────────── */

const XSS = '<img src=x onerror="window.__pwned=1">';

function respaldo(datos) {
  return JSON.stringify({ formato: "ashanny.cotizador.v1", datos });
}

test("importar rechaza una moneda que no sea un código de tres letras", () => {
  // Intl lanza con una moneda inválida; el catch de formatearDinero devolvía
  // el valor tal cual, y acababa crudo dentro de innerHTML.
  const e = importar(respaldo({ config: { ...CONFIG_POR_DEFECTO, moneda: XSS } }));
  assert.equal(e.config.moneda, CONFIG_POR_DEFECTO.moneda);
});

test("importar rechaza una fecha que no sea ISO", () => {
  // fechaLarga devuelve su entrada sin tocar cuando no puede parsearla.
  const e = importar(respaldo({ cotizaciones: [{ numero: "COT-1", fecha: XSS, partidas: [] }] }));
  assert.ok(!/[<>]/.test(e.cotizaciones[0].fecha), `fecha sin sanear: ${e.cotizaciones[0].fecha}`);
});

test("importar convierte a número los campos numéricos de una partida", () => {
  // Se interpolaban sin escapar dentro de value="…", rompiendo el atributo.
  const e = importar(respaldo({
    cotizaciones: [{
      numero: "COT-1", fecha: "2026-01-01",
      partidas: [{ descripcion: "x", cantidad: `1"><img src=x onerror="alert(1)">`, costoMaterial: "5", costoManoObra: null }],
    }],
  }));
  const p = e.cotizaciones[0].partidas[0];
  for (const campo of ["cantidad", "costoMaterial", "costoManoObra"]) {
    assert.equal(typeof p[campo], "number", `${campo} no es número: ${JSON.stringify(p[campo])}`);
    assert.ok(Number.isFinite(p[campo]), `${campo} no es finito`);
  }
});

test("importar no deja que un null sustituya a un objeto por defecto", () => {
  // El spread solo repone claves ausentes: una clave presente con null
  // sobrescribía el valor por defecto y reventaba el render en cada carga.
  const e = importar(respaldo({ empresa: null, cotizaciones: null, catalogo: undefined }));
  assert.equal(typeof e.empresa, "object");
  assert.ok(e.empresa !== null);
  assert.ok(Array.isArray(e.cotizaciones));
  for (const campo of ["nombre", "rnc", "telefono", "correo", "direccion", "logo"]) {
    assert.equal(typeof e.empresa[campo], "string");
  }
});

test("importar sobrevive a una cotización con config null", () => {
  const e = importar(respaldo({ cotizaciones: [{ numero: "COT-1", fecha: "2026-01-01", config: null, partidas: [] }] }));
  const c = e.cotizaciones[0];
  assert.ok(c.config === null || typeof c.config === "object");
  if (c.config) assert.equal(typeof c.config.moneda, "string");
});

test("importar mantiene intactos los datos legítimos", () => {
  // Sanear no puede convertirse en perder trabajo del usuario.
  const bueno = {
    empresa: { nombre: "Constructora Ashanny", rnc: "1-31-12345-6", telefono: "809-555-0100", correo: "a@b.do", direccion: "Santo Domingo", logo: "" },
    config: { ...CONFIG_POR_DEFECTO, moneda: "DOP", utilidad: 0.22 },
    cotizaciones: [{
      numero: "COT-2026-007", fecha: "2026-03-15", cliente: "Juan Pérez", obra: "Villa",
      partidas: [{ descripcion: "Bloque 6\"", unidad: "m2", cantidad: 245.5, costoMaterial: 380.25, costoManoObra: 210, desperdicio: 0.05 }],
    }],
  };
  const e = importar(respaldo(bueno));
  assert.equal(e.empresa.nombre, "Constructora Ashanny");
  assert.equal(e.config.moneda, "DOP");
  assert.equal(e.config.utilidad, 0.22);
  assert.equal(e.cotizaciones[0].numero, "COT-2026-007");
  assert.equal(e.cotizaciones[0].cliente, "Juan Pérez");
  const p = e.cotizaciones[0].partidas[0];
  assert.equal(p.descripcion, 'Bloque 6"');
  assert.equal(p.cantidad, 245.5);
  assert.equal(p.costoMaterial, 380.25);
  assert.equal(p.desperdicio, 0.05);
});

test("cargar también sanea lo que ya estuviera envenenado en disco", () => {
  // El estado hostil pudo escribirse antes de que existiera la validación.
  const previo = globalThis.localStorage;
  const datos = new Map();
  globalThis.localStorage = {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
  try {
    datos.set("ashanny.cotizador.v1", JSON.stringify({ empresa: null, config: { moneda: XSS } }));
    const e = cargar();
    assert.ok(e.empresa !== null);
    assert.notEqual(e.config?.moneda, XSS);
  } finally {
    if (previo === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previo;
  }
});

test("el estado inicial pasa el saneado sin cambios", () => {
  const e = importar(respaldo(JSON.parse(JSON.stringify(ESTADO_INICIAL))));
  assert.deepEqual(e.empresa, ESTADO_INICIAL.empresa);
  assert.deepEqual(e.cotizaciones, []);
});

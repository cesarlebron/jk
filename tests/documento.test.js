/**
 * El documento que ve el cliente. Lo que aquí se prueba no es aritmética
 * interna: es lo que un cliente puede comprobar con la calculadora del
 * teléfono, sentado enfrente, mientras decide si firma.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularCotizacion, conPreciosDeVenta, decimalesUnitario, redondear,
} from "../src/calc.js";

const CFG = {
  gastosGenerales: 0.10, imprevistos: 0.05,
  utilidad: 0.20, modoUtilidad: "margen",
  impuesto: 0.18, impuestoIncluido: false, anticipo: 0.5,
};

const documento = (partidas, cfg = CFG) => conPreciosDeVenta(calcularCotizacion(partidas, cfg));

test("decimalesUnitario da los decimales que hacen cuadrar la multiplicación", () => {
  // 3,019.65 / 1,250 = 2.41572. A dos decimales (2.42) el cliente multiplica
  // 1,250 × 2.42 = 3,025.00 y ve 5.35 de diferencia impresa.
  assert.ok(decimalesUnitario(3019.65, 1250) > 2);
  // Cantidades pequeñas no necesitan más de dos: 100 / 4 = 25.00 exacto.
  assert.equal(decimalesUnitario(100, 4), 2);
  // Sin cantidad no hay división que hacer.
  assert.equal(decimalesUnitario(0, 0), 2);
});

test("en el documento, precio unitario × cantidad cuadra con el importe", () => {
  // Cantidades grandes y precios con decimales feos: el caso que rompía.
  const q = documento([
    { descripcion: "Acero grado 60", unidad: "kg", cantidad: 1250, costoMaterial: 1.65, costoManoObra: 0.4, desperdicio: 0.03 },
    { descripcion: 'Bloque 6"', unidad: "m2", cantidad: 45.5, costoMaterial: 380.25, costoManoObra: 210, desperdicio: 0.05 },
    { descripcion: "Pañete", unidad: "m2", cantidad: 90, costoMaterial: 95.1, costoManoObra: 140.35, desperdicio: 0 },
  ]);
  for (const l of q.lineas) {
    const producto = redondear(l.costoUnitarioVenta * l.cantidad);
    // No puede ser exacto: un unitario impreso con decimales finitos, por una
    // cantidad grande, arrastra el redondeo. La cota es ese redondeo y nada
    // más — medio dígito del último decimal, por la cantidad.
    const cota = Math.max(0.01, l.cantidad * 0.5e-4);
    assert.ok(
      Math.abs(producto - l.totalVenta) <= cota,
      `${l.descripcion}: ${l.cantidad} × ${l.costoUnitarioVenta} = ${producto}, impreso ${l.totalVenta} (cota ${cota})`,
    );
  }
});

test("la columna de importes sigue sumando exacto al subtotal", () => {
  // La otra mitad de la promesa: cuadrar la multiplicación no puede romper
  // la suma, que es lo que el cliente comprueba de arriba abajo.
  const q = documento([
    { descripcion: "A", unidad: "m2", cantidad: 45, costoMaterial: 14.2, costoManoObra: 7.2, desperdicio: 0.05 },
    { descripcion: "B", unidad: "m2", cantidad: 90, costoMaterial: 5.1, costoManoObra: 3.35, desperdicio: 0 },
    { descripcion: "C", unidad: "ud", cantidad: 30, costoMaterial: 31.4, costoManoObra: 9, desperdicio: 0.02 },
  ]);
  const suma = redondear(q.lineas.reduce((a, l) => a + l.totalVenta, 0));
  assert.equal(suma, q.baseImponible);
});

test("las dos promesas se cumplen a la vez sobre cantidades difíciles", () => {
  // La partida que absorbe el descuadre es la mayor, y es justo la que más
  // se mira. Tiene que cuadrar también ella.
  const q = documento([
    { descripcion: "Grande", unidad: "kg", cantidad: 9875, costoMaterial: 0.37, costoManoObra: 0.11, desperdicio: 0.07 },
    { descripcion: "Media", unidad: "m", cantidad: 333, costoMaterial: 7.77, costoManoObra: 1.11, desperdicio: 0.03 },
    { descripcion: "Chica", unidad: "ud", cantidad: 3, costoMaterial: 1234.56, costoManoObra: 0, desperdicio: 0 },
  ]);
  const suma = redondear(q.lineas.reduce((a, l) => a + l.totalVenta, 0));
  assert.equal(suma, q.baseImponible);
  for (const l of q.lineas) {
    const producto = redondear(l.costoUnitarioVenta * l.cantidad);
    // No puede ser exacto: un unitario impreso con decimales finitos, por una
    // cantidad grande, arrastra el redondeo. La cota es ese redondeo y nada
    // más — medio dígito del último decimal, por la cantidad.
    const cota = Math.max(0.01, l.cantidad * 0.5e-4);
    assert.ok(
      Math.abs(producto - l.totalVenta) <= cota,
      `${l.descripcion}: ${l.cantidad} × ${l.costoUnitarioVenta} = ${producto}, impreso ${l.totalVenta} (cota ${cota})`,
    );
  }
});

test("una partida sin cantidad no rompe el documento", () => {
  const q = documento([{ descripcion: "X", unidad: "ud", cantidad: 0, costoMaterial: 100, costoManoObra: 0, desperdicio: 0 }]);
  assert.equal(q.lineas[0].totalVenta, 0);
  assert.equal(q.lineas[0].costoUnitarioVenta, 0);
});

test("una cotización vacía no revienta el documento", () => {
  const q = documento([]);
  assert.deepEqual(q.lineas, []);
  assert.equal(q.baseImponible, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  redondear,
  numero,
  numeroPositivo,
  calcularPartida,
  calcularCotizacion,
  compararMargenMarkup,
  formatearDinero,
  CONFIG_POR_DEFECTO,
} from "../src/calc.js";

// Config neutra: aísla lo que cada prueba quiere medir.
const LIMPIA = {
  gastosGenerales: 0,
  imprevistos: 0,
  modoUtilidad: "margen",
  utilidad: 0,
  impuesto: 0,
  anticipo: 0,
};

test("redondear maneja el caso clásico de flotantes .005", () => {
  assert.equal(redondear(1.005), 1.01);
  assert.equal(redondear(2.675), 2.68);
  assert.equal(redondear(0.1 + 0.2), 0.3);
  assert.equal(redondear(-1.005), -1.01);
  assert.equal(redondear(NaN), 0);
});

test("numero acepta coma decimal y descarta basura", () => {
  assert.equal(numero("12,5"), 12.5);
  assert.equal(numero("12.5"), 12.5);
  assert.equal(numero(""), 0);
  assert.equal(numero("abc", 7), 7);
  assert.equal(numeroPositivo(-5), 0);
});

test("el desperdicio se aplica al material y NUNCA a la mano de obra", () => {
  const r = calcularPartida({
    cantidad: 1,
    costoMaterial: 100,
    costoManoObra: 50,
    desperdicio: 0.10,
  });
  assert.equal(r.material, 110); // 100 + 10%
  assert.equal(r.manoObra, 50);  // intacta
  assert.equal(r.costoUnitario, 160);
  assert.equal(r.total, 160);
});

test("cantidad multiplica el costo unitario completo", () => {
  const r = calcularPartida({
    cantidad: 12.5,
    costoMaterial: 8,
    costoManoObra: 4,
    desperdicio: 0.05,
  });
  // material 8.40 + mano 4 = 12.40 unitario; 12.40 * 12.5 = 155
  assert.equal(r.costoUnitario, 12.4);
  assert.equal(r.total, 155);
});

test("entradas negativas o basura no producen totales negativos", () => {
  const r = calcularPartida({
    cantidad: -10,
    costoMaterial: "no es un numero",
    costoManoObra: -3,
    desperdicio: -1,
  });
  assert.equal(r.total, 0);
  assert.equal(r.costoUnitario, 0);
});

test("la columna impresa suma EXACTAMENTE el subtotal (sin céntimos huérfanos)", () => {
  // Cantidades escogidas para generar terceros decimales en cada línea.
  const partidas = [
    { cantidad: 3, costoMaterial: 0.335, costoManoObra: 0 },
    { cantidad: 3, costoMaterial: 0.335, costoManoObra: 0 },
    { cantidad: 7, costoMaterial: 1.111, costoManoObra: 0.222 },
    { cantidad: 11, costoMaterial: 2.005, costoManoObra: 0.005 },
  ];
  const q = calcularCotizacion(partidas, LIMPIA);

  const sumaDeLoImpreso = q.lineas.reduce((a, l) => a + l.total, 0);
  assert.equal(
    redondear(sumaDeLoImpreso),
    q.costoDirecto,
    "el cliente que sume la columna a mano debe llegar al subtotal impreso"
  );
});

test("margen real: 20% de margen deja 20% de utilidad sobre la venta", () => {
  const q = calcularCotizacion([{ cantidad: 1, costoMaterial: 800, costoManoObra: 0 }], {
    ...LIMPIA,
    modoUtilidad: "margen",
    utilidad: 0.20,
  });
  assert.equal(q.costoTotal, 800);
  assert.equal(q.baseImponible, 1000); // 800 / 0.80
  assert.equal(q.utilidad, 200);
  assert.equal(q.margenReal, 0.2);
});

test("markup: 20% sobre el costo deja solo 16.67% de margen real", () => {
  const q = calcularCotizacion([{ cantidad: 1, costoMaterial: 800, costoManoObra: 0 }], {
    ...LIMPIA,
    modoUtilidad: "markup",
    utilidad: 0.20,
  });
  assert.equal(q.baseImponible, 960); // 800 * 1.20
  assert.equal(q.utilidad, 160);
  assert.equal(q.margenReal, 0.1667); // ESTE es el hueco silencioso
});

test("un margen >= 100% se rechaza en vez de devolver Infinity", () => {
  assert.throws(
    () => calcularCotizacion([{ cantidad: 1, costoMaterial: 100 }], { ...LIMPIA, utilidad: 1 }),
    RangeError
  );
  // En markup sí es legítimo: multiplicar el costo por 2.
  const q = calcularCotizacion([{ cantidad: 1, costoMaterial: 100 }], {
    ...LIMPIA,
    modoUtilidad: "markup",
    utilidad: 1,
  });
  assert.equal(q.baseImponible, 200);
});

test("gastos generales e imprevistos se calculan sobre el costo directo", () => {
  const q = calcularCotizacion([{ cantidad: 1, costoMaterial: 1000, costoManoObra: 0 }], {
    ...LIMPIA,
    gastosGenerales: 0.10,
    imprevistos: 0.05,
  });
  assert.equal(q.costoDirecto, 1000);
  assert.equal(q.gastosGenerales, 100);
  assert.equal(q.imprevistos, 50);
  assert.equal(q.costoTotal, 1150);
});

test("impuesto por fuera se suma; el total refleja base + impuesto", () => {
  const q = calcularCotizacion([{ cantidad: 1, costoMaterial: 1000, costoManoObra: 0 }], {
    ...LIMPIA,
    impuesto: 0.18,
  });
  assert.equal(q.baseImponible, 1000);
  assert.equal(q.impuesto, 180);
  assert.equal(q.total, 1180);
});

test("impuesto incluido se desglosa hacia atrás sin alterar el total", () => {
  const q = calcularCotizacion([{ cantidad: 1, costoMaterial: 1180, costoManoObra: 0 }], {
    ...LIMPIA,
    impuesto: 0.18,
    impuestoIncluido: true,
  });
  assert.equal(q.total, 1180, "el total que ve el cliente no se mueve");
  assert.equal(q.baseImponible, 1000);
  assert.equal(q.impuesto, 180);
  assert.equal(redondear(q.baseImponible + q.impuesto), q.total);
});

test("anticipo y saldo siempre suman el total", () => {
  const q = calcularCotizacion([{ cantidad: 1, costoMaterial: 1000, costoManoObra: 0 }], {
    ...LIMPIA,
    impuesto: 0.18,
    anticipo: 0.5,
  });
  assert.equal(q.anticipo, 590);
  assert.equal(q.saldo, 590);
  assert.equal(redondear(q.anticipo + q.saldo), q.total);
});

test("cotización vacía devuelve ceros y no explota", () => {
  const q = calcularCotizacion([], CONFIG_POR_DEFECTO);
  assert.equal(q.costoDirecto, 0);
  assert.equal(q.total, 0);
  assert.equal(q.margenReal, 0);
  assert.deepEqual(q.lineas, []);
});

test("cadena completa con la configuración por defecto", () => {
  // Costo directo 10,000 -> GG 1,000 -> imprev 500 -> costo 11,500
  // margen 20% -> 14,375 -> ITBIS 18% -> 16,962.50 -> anticipo 50% = 8,481.25
  const q = calcularCotizacion([{ cantidad: 100, costoMaterial: 100, costoManoObra: 0 }], {});
  assert.equal(q.costoDirecto, 10000);
  assert.equal(q.costoTotal, 11500);
  assert.equal(q.baseImponible, 14375);
  assert.equal(q.utilidad, 2875);
  assert.equal(q.total, 16962.5);
  assert.equal(q.anticipo, 8481.25);
  assert.equal(q.puntoEquilibrio, 11500);
});

test("compararMargenMarkup cuantifica el dinero que se deja en la mesa", () => {
  const c = compararMargenMarkup(10000, 0.25);
  assert.equal(c.precioMarkup, 12500);
  assert.equal(c.precioMargen, 13333.33); // 10000 / 0.75
  assert.equal(c.margenRealDelMarkup, 0.2); // creía 25%, obtuvo 20%
  assert.equal(c.diferencia, 833.33);
});

test("formatearDinero no rompe con locale o moneda inválidos", () => {
  assert.match(formatearDinero(1234.5), /1.234[.,]5/);
  const raro = formatearDinero(10, { locale: "xx-YY", moneda: "ZZZ" });
  assert.ok(typeof raro === "string" && raro.length > 0);
});

test("las partidas de entrada no se mutan", () => {
  const original = { cantidad: 5, costoMaterial: 10, costoManoObra: 2 };
  const copia = { ...original };
  calcularCotizacion([original], LIMPIA);
  assert.deepEqual(original, copia);
});

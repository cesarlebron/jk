/**
 * Motor de cálculo de cotizaciones de construcción.
 *
 * Reglas de dinero que se respetan aquí (y que son la razón de que este
 * archivo exista separado de la interfaz):
 *
 *  1. El desperdicio se aplica SOLO al material. La mano de obra no se
 *     desperdicia: al ayudante se le paga por pegar el bloque, no por el
 *     bloque roto.
 *
 *  2. Margen != markup. Aplicar 20% de markup sobre el costo NO deja 20%
 *     de utilidad sobre la venta, deja 16.7%. Este es el error que más
 *     dinero le cuesta a un contratista pequeño. Aquí se soportan los dos
 *     modos y el modo por defecto es MARGEN real sobre precio de venta.
 *
 *  3. Los totales de línea se redondean ANTES de sumar. Un cliente que
 *     suma la columna con la calculadora del teléfono tiene que llegar
 *     exactamente al subtotal impreso, o la cotización pierde
 *     credibilidad en la mesa.
 */

/** Redondeo a centavos, estable para los .005 (evita el sesgo de Math.round con flotantes). */
export function redondear(valor, decimales = 2) {
  if (!Number.isFinite(valor)) return 0;
  const factor = 10 ** decimales;
  // El épsilon corrige casos como 1.005 * 100 = 100.49999999999999
  return Math.round((valor + Number.EPSILON * Math.sign(valor)) * factor) / factor;
}

/** Convierte cualquier entrada de formulario a número seguro y no negativo. */
export function numero(valor, porDefecto = 0) {
  const n = typeof valor === "number" ? valor : parseFloat(String(valor).replace(",", "."));
  if (!Number.isFinite(n)) return porDefecto;
  return n;
}

/** Igual que `numero` pero recorta negativos: no existen cantidades ni costos negativos. */
export function numeroPositivo(valor, porDefecto = 0) {
  return Math.max(0, numero(valor, porDefecto));
}

export const PARTIDA_VACIA = Object.freeze({
  codigo: "",
  descripcion: "",
  unidad: "ud",
  cantidad: 0,
  costoMaterial: 0,
  costoManoObra: 0,
  desperdicio: 0, // fracción: 0.05 = 5%
});

/**
 * Calcula una línea de la cotización.
 * @returns {{material:number, manoObra:number, costoUnitario:number, total:number}}
 */
export function calcularPartida(partida) {
  const cantidad = numeroPositivo(partida.cantidad);
  const desperdicio = numeroPositivo(partida.desperdicio);
  const material = numeroPositivo(partida.costoMaterial) * (1 + desperdicio);
  const manoObra = numeroPositivo(partida.costoManoObra);
  const costoUnitario = material + manoObra;

  return {
    material: redondear(material),
    manoObra: redondear(manoObra),
    costoUnitario: redondear(costoUnitario),
    // Se redondea el total de línea: es lo que se imprime y lo que debe sumar.
    total: redondear(cantidad * costoUnitario),
  };
}

export const CONFIG_POR_DEFECTO = Object.freeze({
  moneda: "USD",
  locale: "es-DO",
  gastosGenerales: 0.10, // administración, transporte, herramienta, supervisión
  imprevistos: 0.05,     // contingencia
  modoUtilidad: "margen", // "margen" (sobre venta) | "markup" (sobre costo)
  utilidad: 0.20,
  impuesto: 0.18,        // ITBIS / IVA. Ponlo en 0 si no facturas con impuesto.
  impuestoIncluido: false,
  anticipo: 0.50,        // % que se cobra al firmar
});

/**
 * Calcula la cotización completa.
 *
 * @param {Array} partidas
 * @param {object} config
 * @returns {object} desglose completo, listo para imprimir
 * @throws {RangeError} si el margen es >= 100% (matemáticamente imposible)
 */
export function calcularCotizacion(partidas = [], config = {}) {
  const cfg = { ...CONFIG_POR_DEFECTO, ...config };

  const modoUtilidad = cfg.modoUtilidad === "markup" ? "markup" : "margen";
  const utilidadPct = numeroPositivo(cfg.utilidad);

  if (modoUtilidad === "margen" && utilidadPct >= 1) {
    throw new RangeError(
      "Un margen de 100% o más sobre el precio de venta es imposible: " +
        "el precio tendería a infinito. Usa modo 'markup' si querías multiplicar el costo."
    );
  }

  const lineas = partidas.map((p) => {
    const calc = calcularPartida(p);
    return { ...PARTIDA_VACIA, ...p, ...calc };
  });

  // Suma de totales YA redondeados => la columna impresa cuadra exactamente.
  const costoDirecto = redondear(lineas.reduce((acc, l) => acc + l.total, 0));

  const gastosGenerales = redondear(costoDirecto * numeroPositivo(cfg.gastosGenerales));
  const imprevistos = redondear(costoDirecto * numeroPositivo(cfg.imprevistos));
  const costoTotal = redondear(costoDirecto + gastosGenerales + imprevistos);

  let subtotal; // precio de venta antes de impuesto
  if (modoUtilidad === "markup") {
    subtotal = redondear(costoTotal * (1 + utilidadPct));
  } else {
    subtotal = redondear(costoTotal / (1 - utilidadPct));
  }

  const impuestoPct = numeroPositivo(cfg.impuesto);

  let baseImponible;
  let impuesto;
  let total;

  if (cfg.impuestoIncluido) {
    // El precio calculado YA lleva el impuesto adentro: se desglosa hacia atrás.
    total = subtotal;
    baseImponible = redondear(subtotal / (1 + impuestoPct));
    impuesto = redondear(total - baseImponible);
  } else {
    baseImponible = subtotal;
    impuesto = redondear(subtotal * impuestoPct);
    total = redondear(subtotal + impuesto);
  }

  // Contra baseImponible, NO contra subtotal: cuando el precio lleva el
  // impuesto dentro, ese impuesto se le remite al gobierno y no es ganancia
  // del contratista. Medirlo contra subtotal inflaba la utilidad justo en el
  // monto del ITBIS y hacía que margenReal superase el margen que se pidió.
  const utilidad = redondear(baseImponible - costoTotal);

  const anticipo = redondear(total * numeroPositivo(cfg.anticipo));

  return {
    lineas,
    costoDirecto,
    gastosGenerales,
    imprevistos,
    costoTotal,
    baseImponible,
    utilidad,
    // Margen real conseguido sobre el precio de venta sin impuesto. Este es
    // el número que hay que mirar, no el porcentaje que se tecleó.
    margenReal: baseImponible > 0 ? redondear(utilidad / baseImponible, 4) : 0,
    impuesto,
    total,
    anticipo,
    saldo: redondear(total - anticipo),
    // Punto de equilibrio: por debajo de esto se trabaja gratis o se pierde.
    // Va en la misma escala que el precio que el usuario fija, que es contra
    // lo que la UI lo compara. Con el impuesto por fuera ese precio es el
    // subtotal y el piso es el costo pelado; con el impuesto dentro el precio
    // es el total, y hay que subir el piso porque de ahí sale el ITBIS que se
    // remite. Sin esto, el aviso de "estás pagando por trabajar" señalaba un
    // número por debajo del cual el contratista ya llevaba rato perdiendo.
    puntoEquilibrio: cfg.impuestoIncluido
      ? redondear(costoTotal * (1 + impuestoPct))
      : costoTotal,
    config: cfg,
  };
}

/** Formatea dinero para mostrar. */
export function formatearDinero(valor, cfg = CONFIG_POR_DEFECTO) {
  const n = numero(valor);
  try {
    return new Intl.NumberFormat(cfg.locale || "es-DO", {
      style: "currency",
      currency: cfg.moneda || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Intl solo lanza si la moneda o el locale no son válidos, así que aquí
    // cfg.moneda ya es sospechoso. Devolverlo tal cual lo llevaba crudo hasta
    // el innerHTML que pinta los totales: se descarta en vez de propagarlo.
    const codigo = /^[A-Za-z]{3}$/.test(String(cfg.moneda || "")) ? cfg.moneda.toUpperCase() : "";
    return codigo ? `${codigo} ${n.toFixed(2)}` : n.toFixed(2);
  }
}

export function formatearPorcentaje(fraccion, decimales = 1) {
  return `${(numero(fraccion) * 100).toFixed(decimales)}%`;
}

/**
 * Compara los dos modos de utilidad para el mismo costo.
 * Sirve para mostrarle al usuario, en números, cuánto le cuesta confundirlos.
 */
export function compararMargenMarkup(costoTotal, pct) {
  const costo = numeroPositivo(costoTotal);
  const p = numeroPositivo(pct);
  const precioMarkup = redondear(costo * (1 + p));
  const precioMargen = p < 1 ? redondear(costo / (1 - p)) : Infinity;
  const margenRealDelMarkup =
    precioMarkup > 0 ? redondear((precioMarkup - costo) / precioMarkup, 4) : 0;

  return {
    precioMarkup,
    precioMargen,
    margenRealDelMarkup,
    diferencia: Number.isFinite(precioMargen) ? redondear(precioMargen - precioMarkup) : Infinity,
  };
}

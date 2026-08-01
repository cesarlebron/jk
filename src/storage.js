/**
 * Persistencia local. Sin servidor, sin cuentas, sin internet.
 *
 * Todo vive en localStorage del navegador del contratista. Eso significa:
 *  - Funciona en el celular parado en medio de la obra, sin señal.
 *  - Nadie más ve tus costos. Tus precios de ferretería son tu ventaja
 *    competitiva; no tienen por qué estar en el servidor de nadie.
 *  - Si borras los datos del navegador, se van. Por eso existe exportar().
 */

import { CONFIG_POR_DEFECTO } from "./calc.js";

const CLAVE = "ashanny.cotizador.v1";

const ESTADO_INICIAL = {
  empresa: {
    // Vacío a propósito: dispara que se abra el panel de empresa en el primer
    // uso. Un valor por defecto aquí hace que la primera propuesta salga
    // encabezada con el nombre de otro.
    nombre: "",
    rnc: "",
    telefono: "",
    correo: "",
    direccion: "",
    logo: "", // dataURL opcional
  },
  config: null,      // null => usa CONFIG_POR_DEFECTO
  catalogo: null,    // null => usa CATALOGO base
  cotizaciones: [],
};

/**
 * Saneado de estado que viene de fuera.
 *
 * Un respaldo es un .json que el contratista guarda en Drive y se pasa por
 * WhatsApp: para cuando vuelve, cualquiera pudo abrirlo en un editor. Todo
 * lo que entre por aquí se trata como texto de origen desconocido, no como
 * datos de confianza.
 *
 * El spread solo repone claves *ausentes*, así que una clave presente con
 * `null` sustituía al valor por defecto y reventaba el render. Y los campos
 * que la UI interpola sin escapar (moneda, fecha, los numéricos de la
 * partida) llegaban con la forma que quisiera el archivo. Se corrigen aquí,
 * en la frontera, en vez de confiar en que cada punto de pintado se acuerde.
 */

const MONEDA_VALIDA = /^[A-Za-z]{3}$/;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function texto(valor, porDefecto = "") {
  return typeof valor === "string" ? valor : porDefecto;
}

function num(valor, porDefecto = 0) {
  const n = typeof valor === "number" ? valor : parseFloat(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

// Sanear no puede inventar claves: exportar/importar tiene que ser un viaje
// de ida y vuelta sin pérdida, y una clave ausente ya la repone el valor por
// defecto aguas abajo. Solo se toca lo que venga en el archivo.
function sanearEmpresa(valor) {
  const e = objeto(valor);
  // null, un array o un escalar en lugar del objeto: el spread de
  // ESTADO_INICIAL no lo repone porque la clave sí está presente, así que se
  // repone aquí. Dejarlo pasar reventaba pintarEmpresa en cada carga.
  if (!e) return clonar(ESTADO_INICIAL.empresa);
  const salida = { ...e };
  for (const campo of Object.keys(ESTADO_INICIAL.empresa)) {
    if (campo in e) salida[campo] = texto(e[campo]);
  }
  return salida;
}

function sanearConfig(valor) {
  const c = objeto(valor);
  if (!c) return null; // null es legítimo: significa "usa CONFIG_POR_DEFECTO"
  const salida = { ...c };
  // Una moneda que no sea de tres letras hace que Intl lance, y el camino de
  // error de formatearDinero devuelve el valor tal cual hacia innerHTML.
  salida.moneda = MONEDA_VALIDA.test(texto(c.moneda)) ? c.moneda.toUpperCase() : CONFIG_POR_DEFECTO.moneda;
  salida.locale = texto(c.locale, CONFIG_POR_DEFECTO.locale);
  salida.modoUtilidad = c.modoUtilidad === "markup" ? "markup" : "margen";
  salida.impuestoIncluido = Boolean(c.impuestoIncluido);
  for (const campo of ["gastosGenerales", "imprevistos", "utilidad", "impuesto", "anticipo"]) {
    if (campo in c) salida[campo] = num(c[campo]);
  }
  return salida;
}

function sanearPartida(valor) {
  const p = objeto(valor) || {};
  const salida = { ...p };
  if ("descripcion" in p) salida.descripcion = texto(p.descripcion);
  if ("unidad" in p) salida.unidad = texto(p.unidad, "ud");
  // Se interpolan dentro de value="…": si no son números, rompen el atributo.
  for (const campo of ["cantidad", "costoMaterial", "costoManoObra", "desperdicio"]) {
    if (campo in p) salida[campo] = num(p[campo]);
  }
  return salida;
}

function sanearCotizacion(valor) {
  const c = objeto(valor) || {};
  const salida = { ...c };
  for (const campo of ["numero", "cliente", "obra", "notas"]) {
    if (campo in c) salida[campo] = texto(c[campo]);
  }
  // fechaLarga devuelve su entrada intacta cuando no puede parsearla, y esa
  // salida va al documento sin escapar.
  if ("fecha" in c) salida.fecha = FECHA_ISO.test(texto(c.fecha)) ? c.fecha : "";
  if ("config" in c) salida.config = sanearConfig(c.config);
  if ("partidas" in c) {
    salida.partidas = Array.isArray(c.partidas) ? c.partidas.map(sanearPartida) : [];
  }
  return salida;
}

export function sanear(datos) {
  const d = objeto(datos) || {};
  const salida = { ...d };
  if ("empresa" in d) salida.empresa = sanearEmpresa(d.empresa);
  if ("config" in d) salida.config = sanearConfig(d.config);
  if ("catalogo" in d) {
    salida.catalogo = Array.isArray(d.catalogo) ? d.catalogo.map(sanearPartida) : null;
  }
  if ("cotizaciones" in d) {
    salida.cotizaciones = Array.isArray(d.cotizaciones) ? d.cotizaciones.map(sanearCotizacion) : [];
  }
  return salida;
}

function almacen() {
  try {
    if (typeof localStorage === "undefined") return null;
    // Safari en modo privado deja el objeto pero revienta al escribir.
    const prueba = "__probe__";
    localStorage.setItem(prueba, "1");
    localStorage.removeItem(prueba);
    return localStorage;
  } catch {
    return null;
  }
}

// Respaldo en memoria: si el navegador bloquea localStorage, la app sigue
// usable durante la sesión en vez de romperse a media cotización.
let memoria = null;

export function cargar() {
  const s = almacen();
  if (!s) return memoria ? clonar(memoria) : clonar(ESTADO_INICIAL);
  try {
    const crudo = s.getItem(CLAVE);
    if (!crudo) return clonar(ESTADO_INICIAL);
    const datos = JSON.parse(crudo);
    // También al leer de disco: un estado hostil pudo escribirse antes de que
    // existiera esta validación, y se re-ejecutaría en cada carga.
    return sanear({ ...clonar(ESTADO_INICIAL), ...datos });
  } catch {
    // Datos corruptos: mejor arrancar limpio que dejar la app muerta.
    return clonar(ESTADO_INICIAL);
  }
}

export function guardar(estado) {
  memoria = clonar(estado);
  const s = almacen();
  if (!s) return { ok: false, motivo: "sin-almacenamiento" };
  try {
    s.setItem(CLAVE, JSON.stringify(estado));
    return { ok: true };
  } catch (e) {
    // Cuota llena: casi siempre por logos en base64 acumulados.
    return { ok: false, motivo: "cuota", error: String(e) };
  }
}

export function exportar(estado) {
  return JSON.stringify({ formato: CLAVE, exportado: new Date().toISOString(), datos: estado }, null, 2);
}

export function importar(texto) {
  const parseado = JSON.parse(texto);
  const datos = parseado?.datos ?? parseado;
  if (!datos || typeof datos !== "object") {
    throw new Error("El archivo no tiene el formato esperado.");
  }
  return sanear({ ...clonar(ESTADO_INICIAL), ...datos });
}

/** Número correlativo por año: COT-2026-001 */
export function siguienteNumero(cotizaciones = [], anio = new Date().getFullYear()) {
  const prefijo = `COT-${anio}-`;
  const usados = cotizaciones
    .map((c) => c?.numero)
    .filter((n) => typeof n === "string" && n.startsWith(prefijo))
    .map((n) => parseInt(n.slice(prefijo.length), 10))
    .filter(Number.isFinite);
  const siguiente = usados.length ? Math.max(...usados) + 1 : 1;
  return `${prefijo}${String(siguiente).padStart(3, "0")}`;
}

function clonar(o) {
  return JSON.parse(JSON.stringify(o));
}

export { ESTADO_INICIAL, CLAVE };

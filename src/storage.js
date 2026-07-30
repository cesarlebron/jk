/**
 * Persistencia local. Sin servidor, sin cuentas, sin internet.
 *
 * Todo vive en localStorage del navegador del contratista. Eso significa:
 *  - Funciona en el celular parado en medio de la obra, sin señal.
 *  - Nadie más ve tus costos. Tus precios de ferretería son tu ventaja
 *    competitiva; no tienen por qué estar en el servidor de nadie.
 *  - Si borras los datos del navegador, se van. Por eso existe exportar().
 */

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
    return { ...clonar(ESTADO_INICIAL), ...datos };
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
  return { ...clonar(ESTADO_INICIAL), ...datos };
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

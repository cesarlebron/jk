/**
 * Catálogo base de partidas de obra.
 *
 * ⚠️ IMPORTANTE — LEE ESTO ANTES DE COTIZARLE A UN CLIENTE:
 *
 * Estos precios son una PLANTILLA DE ARRANQUE, no una lista de precios real.
 * Están en el orden de magnitud del mercado caribeño/latinoamericano en USD,
 * pero el costo de un bloque cambia por país, por ciudad y por semana.
 *
 * La primera vez que uses esto, siéntate 30 minutos con tres facturas
 * recientes de tu ferretería y ajusta las partidas que más usas. A partir de
 * ahí la herramienta cotiza con TUS costos, y ahí es donde empieza a valer
 * dinero. Todo es editable desde la interfaz y se guarda en tu navegador.
 *
 * Unidades: m2 = metro cuadrado, m3 = metro cúbico, ml = metro lineal,
 * ud = unidad, gl = global (partida alzada).
 */

export const UNIDADES = ["m2", "m3", "ml", "ud", "gl", "kg", "qq", "día"];

export const CATALOGO = [
  // ── Preliminares ────────────────────────────────────────────────────────
  { codigo: "PRE-01", categoria: "Preliminares", descripcion: "Limpieza y desmonte de terreno", unidad: "m2", costoMaterial: 0.00, costoManoObra: 1.20, desperdicio: 0 },
  { codigo: "PRE-02", categoria: "Preliminares", descripcion: "Replanteo y trazado de obra", unidad: "m2", costoMaterial: 0.45, costoManoObra: 1.10, desperdicio: 0.05 },
  { codigo: "PRE-03", categoria: "Preliminares", descripcion: "Demolición de mampostería existente", unidad: "m2", costoMaterial: 0.00, costoManoObra: 6.50, desperdicio: 0 },
  { codigo: "PRE-04", categoria: "Preliminares", descripcion: "Bote de escombros (incluye transporte)", unidad: "m3", costoMaterial: 0.00, costoManoObra: 14.00, desperdicio: 0 },
  { codigo: "PRE-05", categoria: "Preliminares", descripcion: "Caseta provisional y almacén de obra", unidad: "gl", costoMaterial: 280.00, costoManoObra: 120.00, desperdicio: 0 },

  // ── Movimiento de tierra ────────────────────────────────────────────────
  { codigo: "MOV-01", categoria: "Movimiento de tierra", descripcion: "Excavación manual en material común", unidad: "m3", costoMaterial: 0.00, costoManoObra: 17.00, desperdicio: 0 },
  { codigo: "MOV-02", categoria: "Movimiento de tierra", descripcion: "Excavación con retroexcavadora", unidad: "m3", costoMaterial: 0.00, costoManoObra: 5.50, desperdicio: 0 },
  { codigo: "MOV-03", categoria: "Movimiento de tierra", descripcion: "Relleno compactado con material selecto", unidad: "m3", costoMaterial: 16.00, costoManoObra: 8.00, desperdicio: 0.10 },

  // ── Hormigón y acero ────────────────────────────────────────────────────
  { codigo: "HOR-01", categoria: "Hormigón y acero", descripcion: "Hormigón 210 kg/cm² en zapatas", unidad: "m3", costoMaterial: 138.00, costoManoObra: 46.00, desperdicio: 0.05 },
  { codigo: "HOR-02", categoria: "Hormigón y acero", descripcion: "Hormigón 210 kg/cm² en columnas", unidad: "m3", costoMaterial: 142.00, costoManoObra: 62.00, desperdicio: 0.05 },
  { codigo: "HOR-03", categoria: "Hormigón y acero", descripcion: "Hormigón 210 kg/cm² en vigas", unidad: "m3", costoMaterial: 142.00, costoManoObra: 58.00, desperdicio: 0.05 },
  { codigo: "HOR-04", categoria: "Hormigón y acero", descripcion: "Losa de entrepiso maciza e=12cm", unidad: "m2", costoMaterial: 31.00, costoManoObra: 16.00, desperdicio: 0.05 },
  { codigo: "HOR-05", categoria: "Hormigón y acero", descripcion: "Acero de refuerzo grado 60 (habilitado y colocado)", unidad: "kg", costoMaterial: 1.15, costoManoObra: 0.45, desperdicio: 0.07 },
  { codigo: "HOR-06", categoria: "Hormigón y acero", descripcion: "Encofrado de madera en columnas y vigas", unidad: "m2", costoMaterial: 6.80, costoManoObra: 7.50, desperdicio: 0.15 },
  { codigo: "HOR-07", categoria: "Hormigón y acero", descripcion: "Contrapiso de hormigón e=10cm", unidad: "m2", costoMaterial: 13.50, costoManoObra: 6.00, desperdicio: 0.05 },

  // ── Mampostería ─────────────────────────────────────────────────────────
  { codigo: "MAM-01", categoria: "Mampostería", descripcion: 'Muro de bloque de hormigón 4"', unidad: "m2", costoMaterial: 11.50, costoManoObra: 6.50, desperdicio: 0.05 },
  { codigo: "MAM-02", categoria: "Mampostería", descripcion: 'Muro de bloque de hormigón 6"', unidad: "m2", costoMaterial: 14.20, costoManoObra: 7.20, desperdicio: 0.05 },
  { codigo: "MAM-03", categoria: "Mampostería", descripcion: 'Muro de bloque de hormigón 8"', unidad: "m2", costoMaterial: 17.80, costoManoObra: 8.00, desperdicio: 0.05 },
  { codigo: "MAM-04", categoria: "Mampostería", descripcion: "Muro divisorio en drywall (una cara)", unidad: "m2", costoMaterial: 12.00, costoManoObra: 9.50, desperdicio: 0.10 },

  // ── Revestimientos ──────────────────────────────────────────────────────
  { codigo: "REV-01", categoria: "Revestimientos", descripcion: "Pañete/repello interior", unidad: "m2", costoMaterial: 3.40, costoManoObra: 4.60, desperdicio: 0.10 },
  { codigo: "REV-02", categoria: "Revestimientos", descripcion: "Pañete/repello exterior", unidad: "m2", costoMaterial: 3.80, costoManoObra: 5.60, desperdicio: 0.10 },
  { codigo: "REV-03", categoria: "Revestimientos", descripcion: "Cantos y filos en vanos", unidad: "ml", costoMaterial: 1.20, costoManoObra: 2.80, desperdicio: 0.08 },
  { codigo: "REV-04", categoria: "Revestimientos", descripcion: "Cerámica en pared de baño/cocina", unidad: "m2", costoMaterial: 16.00, costoManoObra: 11.00, desperdicio: 0.10 },

  // ── Pisos ───────────────────────────────────────────────────────────────
  { codigo: "PIS-01", categoria: "Pisos", descripcion: "Piso de cerámica nacional 45x45", unidad: "m2", costoMaterial: 15.00, costoManoObra: 8.50, desperdicio: 0.08 },
  { codigo: "PIS-02", categoria: "Pisos", descripcion: "Piso de porcelanato 60x60", unidad: "m2", costoMaterial: 27.00, costoManoObra: 11.00, desperdicio: 0.08 },
  { codigo: "PIS-03", categoria: "Pisos", descripcion: "Zócalo/rodapié cerámico", unidad: "ml", costoMaterial: 3.20, costoManoObra: 2.60, desperdicio: 0.08 },
  { codigo: "PIS-04", categoria: "Pisos", descripcion: "Pulido y brillado de piso de hormigón", unidad: "m2", costoMaterial: 3.50, costoManoObra: 6.00, desperdicio: 0.05 },

  // ── Techo e impermeabilización ──────────────────────────────────────────
  { codigo: "TEC-01", categoria: "Techo", descripcion: "Impermeabilización asfáltica en losa", unidad: "m2", costoMaterial: 8.50, costoManoObra: 4.50, desperdicio: 0.10 },
  { codigo: "TEC-02", categoria: "Techo", descripcion: "Techo de zinc calibre 26 sobre estructura metálica", unidad: "m2", costoMaterial: 21.00, costoManoObra: 12.00, desperdicio: 0.10 },
  { codigo: "TEC-03", categoria: "Techo", descripcion: "Cielo raso en PVC", unidad: "m2", costoMaterial: 14.00, costoManoObra: 9.00, desperdicio: 0.08 },

  // ── Instalación eléctrica ───────────────────────────────────────────────
  { codigo: "ELE-01", categoria: "Eléctrica", descripcion: "Punto eléctrico de iluminación", unidad: "ud", costoMaterial: 13.50, costoManoObra: 12.00, desperdicio: 0.05 },
  { codigo: "ELE-02", categoria: "Eléctrica", descripcion: "Punto eléctrico de tomacorriente 110V", unidad: "ud", costoMaterial: 15.00, costoManoObra: 12.00, desperdicio: 0.05 },
  { codigo: "ELE-03", categoria: "Eléctrica", descripcion: "Punto especial 220V (estufa/aire)", unidad: "ud", costoMaterial: 38.00, costoManoObra: 26.00, desperdicio: 0.05 },
  { codigo: "ELE-04", categoria: "Eléctrica", descripcion: "Panel de breakers 8 espacios instalado", unidad: "ud", costoMaterial: 145.00, costoManoObra: 85.00, desperdicio: 0 },
  { codigo: "ELE-05", categoria: "Eléctrica", descripcion: "Acometida eléctrica desde medidor", unidad: "gl", costoMaterial: 210.00, costoManoObra: 140.00, desperdicio: 0.05 },

  // ── Instalación sanitaria ───────────────────────────────────────────────
  { codigo: "SAN-01", categoria: "Sanitaria", descripcion: "Punto de agua potable 1/2\"", unidad: "ud", costoMaterial: 17.00, costoManoObra: 16.00, desperdicio: 0.08 },
  { codigo: "SAN-02", categoria: "Sanitaria", descripcion: "Punto de drenaje sanitario 2\"-4\"", unidad: "ud", costoMaterial: 24.00, costoManoObra: 20.00, desperdicio: 0.08 },
  { codigo: "SAN-03", categoria: "Sanitaria", descripcion: "Instalación de inodoro (pieza no incluida)", unidad: "ud", costoMaterial: 18.00, costoManoObra: 30.00, desperdicio: 0 },
  { codigo: "SAN-04", categoria: "Sanitaria", descripcion: "Instalación de lavamanos (pieza no incluida)", unidad: "ud", costoMaterial: 15.00, costoManoObra: 26.00, desperdicio: 0 },
  { codigo: "SAN-05", categoria: "Sanitaria", descripcion: "Registro/caja de inspección sanitaria", unidad: "ud", costoMaterial: 45.00, costoManoObra: 38.00, desperdicio: 0.05 },

  // ── Pintura ─────────────────────────────────────────────────────────────
  { codigo: "PIN-01", categoria: "Pintura", descripcion: "Pintura acrílica interior (2 manos + sellador)", unidad: "m2", costoMaterial: 2.30, costoManoObra: 2.70, desperdicio: 0.08 },
  { codigo: "PIN-02", categoria: "Pintura", descripcion: "Pintura acrílica exterior (2 manos + sellador)", unidad: "m2", costoMaterial: 2.90, costoManoObra: 3.30, desperdicio: 0.08 },
  { codigo: "PIN-03", categoria: "Pintura", descripcion: "Masillado y lijado de paredes", unidad: "m2", costoMaterial: 1.60, costoManoObra: 3.10, desperdicio: 0.10 },

  // ── Carpintería y aluminio ──────────────────────────────────────────────
  { codigo: "CAR-01", categoria: "Carpintería", descripcion: "Puerta de madera interior con marco y herrajes", unidad: "ud", costoMaterial: 155.00, costoManoObra: 45.00, desperdicio: 0 },
  { codigo: "CAR-02", categoria: "Carpintería", descripcion: "Puerta principal metálica con marco", unidad: "ud", costoMaterial: 290.00, costoManoObra: 60.00, desperdicio: 0 },
  { codigo: "CAR-03", categoria: "Carpintería", descripcion: "Ventana de aluminio y vidrio corrediza", unidad: "m2", costoMaterial: 105.00, costoManoObra: 28.00, desperdicio: 0.05 },
  { codigo: "CAR-04", categoria: "Carpintería", descripcion: "Mueble de cocina bajo (melamina)", unidad: "ml", costoMaterial: 195.00, costoManoObra: 55.00, desperdicio: 0.05 },

  // ── Limpieza final ──────────────────────────────────────────────────────
  { codigo: "FIN-01", categoria: "Entrega", descripcion: "Limpieza fina y entrega de obra", unidad: "m2", costoMaterial: 0.60, costoManoObra: 1.90, desperdicio: 0 },
];

/** Categorías en el orden natural de ejecución de una obra. */
export function categorias(catalogo = CATALOGO) {
  const vistas = [];
  for (const p of catalogo) {
    if (!vistas.includes(p.categoria)) vistas.push(p.categoria);
  }
  return vistas;
}

/**
 * Búsqueda tolerante: ignora acentos y mayúsculas, y trata cada palabra por
 * separado.
 *
 * Lo de las palabras sueltas importa más de lo que parece. Nadie escribe
 * 'Muro de bloque de hormigón 6"'; escriben "bloque 6". Exigir que el texto
 * completo aparezca contiguo devuelve cero resultados justo en la consulta
 * más natural, y el usuario concluye que la partida no existe.
 */
export function buscar(termino, catalogo = CATALOGO) {
  const palabras = normalizar(termino).split(/\s+/).filter(Boolean);
  if (!palabras.length) return catalogo;

  return catalogo.filter((p) => {
    const heno = `${normalizar(p.codigo)} ${normalizar(p.descripcion)} ${normalizar(p.categoria)}`;
    return palabras.every((w) => heno.includes(w));
  });
}

export function normalizar(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Interfaz del cotizador. Toda la matemática vive en calc.js; aquí solo se
 * captura, se pinta y se imprime.
 */

import {
  calcularCotizacion,
  compararMargenMarkup,
  conPreciosDeVenta,
  decimalesUnitario,
  formatearDinero,
  formatearPorcentaje,
  numero,
  numeroPositivo,
  redondear,
  CONFIG_POR_DEFECTO,
} from "./calc.js";
import { CATALOGO, UNIDADES, buscar } from "./catalog.js";
import { cargar, guardar, exportar, importar, siguienteNumero } from "./storage.js";

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

let estado = cargar();
let catalogo = estado.catalogo?.length ? estado.catalogo : CATALOGO;

// La cotización que se está editando ahora mismo.
let actual = nuevaCotizacion();
let indiceResaltado = -1;

function nuevaCotizacion() {
  return {
    numero: siguienteNumero(estado.cotizaciones),
    fecha: hoy(),
    validez: 15,
    cliente: "",
    telefonoCliente: "",
    obra: "",
    ubicacion: "",
    notas:
      "• Precios sujetos a cambio después de la fecha de validez.\n" +
      "• No incluye trabajos no especificados en esta propuesta.\n" +
      "• Cualquier trabajo adicional se cotiza por separado antes de ejecutarse.",
    partidas: [],
    config: { ...CONFIG_POR_DEFECTO, ...(estado.config || {}) },
  };
}

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fechaLarga(iso) {
  const [a, m, d] = String(iso || "").split("-").map(Number);
  // Escapado: esta rama devolvía la entrada intacta, y la salida se interpola
  // en el documento sin pasar por escapar().
  if (!a || !m || !d) return escapar(iso || "");
  try {
    return new Date(a, m - 1, d).toLocaleDateString("es-DO", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function escapar(texto = "") {
  return String(texto).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ── Render ──────────────────────────────────────────────────────────── */

function pintarEmpresa() {
  for (const campo of ["nombre", "rnc", "telefono", "correo", "direccion"]) {
    const el = $(`[data-empresa="${campo}"]`);
    if (el) el.value = estado.empresa[campo] || "";
  }
  const logo = $("#vista-logo");
  if (logo) {
    logo.src = estado.empresa.logo || "";
    logo.hidden = !estado.empresa.logo;
  }
}

function pintarEncabezado() {
  for (const campo of ["numero", "fecha", "validez", "cliente", "telefonoCliente", "obra", "ubicacion", "notas"]) {
    const el = $(`[data-cot="${campo}"]`);
    if (el && el.value !== String(actual[campo] ?? "")) el.value = actual[campo] ?? "";
  }
}

function pintarConfig() {
  const c = actual.config;
  const pct = (v) => redondear(numero(v) * 100, 2);
  const set = (nombre, valor) => {
    const el = $(`[data-config="${nombre}"]`);
    if (el && document.activeElement !== el) el.value = valor;
  };
  set("gastosGenerales", pct(c.gastosGenerales));
  set("imprevistos", pct(c.imprevistos));
  set("utilidad", pct(c.utilidad));
  set("impuesto", pct(c.impuesto));
  set("anticipo", pct(c.anticipo));
  set("moneda", c.moneda);
  const modo = $(`[data-config="modoUtilidad"]`);
  if (modo) modo.value = c.modoUtilidad;
  const incl = $(`[data-config="impuestoIncluido"]`);
  if (incl) incl.checked = !!c.impuestoIncluido;
}

function pintarPartidas(q) {
  const cuerpo = $("#cuerpo-partidas");
  if (!actual.partidas.length) {
    cuerpo.innerHTML = `<tr><td colspan="8" class="vacio">
      Busca una partida arriba y presiona Enter, o agrega una línea en blanco.
    </td></tr>`;
    return;
  }

  cuerpo.innerHTML = actual.partidas
    .map((p, i) => {
      const l = q.lineas[i];
      return `<tr data-fila="${i}">
        <td class="col-desc">
          <input data-p="descripcion" value="${escapar(p.descripcion)}" aria-label="Descripción línea ${i + 1}">
        </td>
        <td class="col-uni">
          <select data-p="unidad" aria-label="Unidad línea ${i + 1}">
            ${UNIDADES.map((u) => `<option${u === p.unidad ? " selected" : ""}>${u}</option>`).join("")}
          </select>
        </td>
        <td class="col-num"><input type="text" inputmode="decimal" data-p="cantidad" value="${numeroPositivo(p.cantidad)}" aria-label="Cantidad línea ${i + 1}"></td>
        <td class="col-num"><input type="text" inputmode="decimal" data-p="costoMaterial" value="${numeroPositivo(p.costoMaterial)}" aria-label="Material línea ${i + 1}"></td>
        <td class="col-num"><input type="text" inputmode="decimal" data-p="costoManoObra" value="${numeroPositivo(p.costoManoObra)}" aria-label="Mano de obra línea ${i + 1}"></td>
        <td class="col-num"><input type="text" inputmode="decimal" data-p="desperdicioPct" value="${redondear(p.desperdicio * 100, 2)}" aria-label="Desperdicio % línea ${i + 1}"></td>
        <td class="num">${formatearDinero(l.total, actual.config)}</td>
        <td><button class="icono peligro" data-accion="borrar" aria-label="Eliminar línea ${i + 1}">✕</button></td>
      </tr>`;
    })
    .join("");
}

function pintarTotales(q) {
  const f = (v) => formatearDinero(v, actual.config);
  const panel = $("#panel-totales");

  const filas = [
    ["Costo directo", f(q.costoDirecto)],
    [`Gastos generales (${formatearPorcentaje(q.config.gastosGenerales)})`, f(q.gastosGenerales)],
    [`Imprevistos (${formatearPorcentaje(q.config.imprevistos)})`, f(q.imprevistos)],
  ];

  panel.innerHTML =
    filas.map(([k, v]) => `<div class="total-linea tenue"><span>${k}</span><span>${v}</span></div>`).join("") +
    `<div class="total-linea separador"><span>Costo total (tu punto de equilibrio)</span><span>${f(q.costoTotal)}</span></div>
     <div class="total-linea"><span>Utilidad</span><span>${f(q.utilidad)}</span></div>
     <div class="total-linea tenue"><span>Margen real sobre la venta</span>
       <span class="pastilla ${q.costoDirecto <= 0 ? "" : q.margenReal >= 0.15 ? "ok" : "mal"}">${formatearPorcentaje(q.margenReal)}</span></div>
     <div class="total-linea separador"><span>Subtotal</span><span>${f(q.baseImponible)}</span></div>
     <div class="total-linea tenue"><span>Impuesto (${formatearPorcentaje(q.config.impuesto)})</span><span>${f(q.impuesto)}</span></div>
     <div class="total-linea grande separador"><span>TOTAL</span><span>${f(q.total)}</span></div>
     <div class="total-linea tenue"><span>Anticipo (${formatearPorcentaje(q.config.anticipo)})</span><span>${f(q.anticipo)}</span></div>
     <div class="total-linea tenue"><span>Saldo contra entrega</span><span>${f(q.saldo)}</span></div>`;

  pintarAvisos(q);
}

/**
 * Los avisos son la parte que más dinero salva: le dicen al contratista,
 * en su propio número, cuándo está a punto de firmar una obra que pierde.
 */
function pintarAvisos(q) {
  const caja = $("#avisos");
  const avisos = [];
  const f = (v) => formatearDinero(v, actual.config);

  if (q.config.modoUtilidad === "markup" && q.costoTotal > 0) {
    const c = compararMargenMarkup(q.costoTotal, q.config.utilidad);
    avisos.push({
      tipo: "",
      titulo: `Estás usando markup: tu margen real es ${formatearPorcentaje(c.margenRealDelMarkup)}, no ${formatearPorcentaje(q.config.utilidad)}`,
      texto: `Para ganar de verdad ${formatearPorcentaje(q.config.utilidad)} sobre la venta tendrías que cobrar ${f(c.precioMargen)} en vez de ${f(c.precioMarkup)}. Diferencia: <strong>${f(c.diferencia)}</strong> en esta sola cotización.`,
    });
  }

  if (q.costoDirecto > 0 && q.margenReal < 0.10) {
    avisos.push({
      tipo: "malo",
      titulo: "Margen peligrosamente bajo",
      texto: `Con ${formatearPorcentaje(q.margenReal)} de margen, un atraso de una semana o una subida del cemento te deja trabajando gratis. Por debajo de ${f(q.puntoEquilibrio)} estás pagando por trabajar.`,
    });
  }

  if (q.costoDirecto > 0 && numeroPositivo(q.config.imprevistos) === 0) {
    avisos.push({
      tipo: "",
      titulo: "Sin partida de imprevistos",
      texto: "En obra siempre aparece algo. Un 5% de contingencia es lo que separa una obra rentable de una discusión con el cliente.",
    });
  }

  if (q.costoDirecto > 0 && numeroPositivo(q.config.anticipo) < 0.3) {
    avisos.push({
      tipo: "",
      titulo: "Anticipo bajo",
      texto: `Vas a financiar ${f(q.saldo)} de material con tu propio bolsillo. Lo estándar es 40–50% al firmar.`,
    });
  }

  caja.innerHTML = avisos
    .map((a) => `<div class="aviso ${a.tipo}"><strong>${a.titulo}</strong>${a.texto}</div>`)
    .join("");
}

function pintarHistorial() {
  const lista = $("#historial");
  if (!estado.cotizaciones.length) {
    lista.innerHTML = `<p class="vacio" style="padding:.6rem">Aún no has guardado ninguna cotización.</p>`;
    return;
  }
  lista.innerHTML = [...estado.cotizaciones]
    .reverse()
    .map((c) => {
      const i = estado.cotizaciones.indexOf(c);
      return `<div class="total-linea" style="align-items:center">
        <span>
          <strong>${escapar(c.numero)}</strong><br>
          <small style="color:var(--suave)">${escapar(c.cliente || "Sin cliente")} · ${escapar(c.fecha)}</small>
        </span>
        <span style="display:flex;gap:.3rem;align-items:center">
          <button class="icono" data-abrir="${i}" title="Abrir">Abrir</button>
          <button class="icono peligro" data-eliminar="${i}" title="Eliminar" aria-label="Eliminar ${escapar(c.numero)}">✕</button>
        </span>
      </div>`;
    })
    .join("");
}

function pintarDocumento(q) {
  const e = estado.empresa;
  const f = (v, decimales) => formatearDinero(v, actual.config, decimales);

  const contacto = [e.telefono, e.correo, e.direccion, e.rnc ? `RNC: ${e.rnc}` : ""]
    .filter(Boolean)
    .map(escapar)
    .join(" · ");

  const filas = q.lineas
    .map(
      (l, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${escapar(l.descripcion || "—")}</td>
      <td>${escapar(l.unidad)}</td>
      <td class="num">${numero(l.cantidad).toLocaleString("es-DO", { maximumFractionDigits: 2 })}</td>
      <td class="num">${f(l.costoUnitarioVenta, decimalesUnitario(l.totalVenta, l.cantidad))}</td>
      <td class="num">${f(l.totalVenta)}</td>
    </tr>`
    )
    .join("");

  $("#documento").innerHTML = `
    <div class="doc-cabecera">
      <div>
        ${e.logo ? `<img src="${escapar(e.logo)}" alt="">` : ""}
        <h2 style="margin:.3rem 0 .1rem">${escapar(e.nombre || "Mi Constructora")}</h2>
        <div class="doc-nota">${contacto}</div>
      </div>
      <div class="doc-titulo">
        <h2>COTIZACIÓN</h2>
        <div><strong>${escapar(actual.numero)}</strong></div>
        <div class="doc-nota">Fecha: ${fechaLarga(actual.fecha)}<br>
        Válida por ${numeroPositivo(actual.validez, 15)} días</div>
      </div>
    </div>

    <div class="doc-partes">
      <div>
        <h3>Cliente</h3>
        <div><strong>${escapar(actual.cliente || "—")}</strong></div>
        <div class="doc-nota">${escapar(actual.telefonoCliente || "")}</div>
      </div>
      <div>
        <h3>Obra</h3>
        <div><strong>${escapar(actual.obra || "—")}</strong></div>
        <div class="doc-nota">${escapar(actual.ubicacion || "")}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="num">#</th><th>Descripción</th><th>Ud.</th>
          <th class="num">Cant.</th><th class="num">P. unitario</th><th class="num">Importe</th>
        </tr>
      </thead>
      <tbody>${filas || `<tr><td colspan="6">Sin partidas.</td></tr>`}</tbody>
      <tfoot>
        <tr><td colspan="5" class="num">Subtotal</td><td class="num">${f(q.baseImponible)}</td></tr>
        ${
          q.impuesto > 0
            ? `<tr><td colspan="5" class="num">Impuesto (${formatearPorcentaje(q.config.impuesto)})</td><td class="num">${f(q.impuesto)}</td></tr>`
            : ""
        }
        <tr class="doc-total"><td colspan="5" class="num">TOTAL</td><td class="num">${f(q.total)}</td></tr>
      </tfoot>
    </table>

    <div style="margin-top:1rem">
      <h3>Forma de pago</h3>
      <div class="doc-nota">Anticipo al firmar (${formatearPorcentaje(q.config.anticipo)}): <strong>${f(q.anticipo)}</strong>
      · Saldo contra entrega: <strong>${f(q.saldo)}</strong></div>
    </div>

    ${
      actual.notas
        ? `<div style="margin-top:1rem"><h3>Condiciones</h3><div class="doc-nota">${escapar(actual.notas)}</div></div>`
        : ""
    }

    <div class="doc-firmas">
      <div>${escapar(e.nombre || "Por la empresa")}</div>
      <div>Aceptado por el cliente</div>
    </div>`;
}

/**
 * ¿Hay trabajo que se perdería al cerrar?
 *
 * Antes solo se miraba si la cotización se había guardado alguna vez, así que
 * en cuanto se pulsaba Guardar una sola vez el aviso callaba para siempre:
 * se podía cambiar una cantidad, añadir líneas y recargar sin una sola
 * advertencia, y el trabajo se iba. Ahora se compara el contenido actual
 * contra el guardado.
 */
function hayCambiosSinGuardar() {
  if (!actual.partidas.length) return false;
  const guardada = estado.cotizaciones.find((c) => c.numero === actual.numero);
  if (!guardada) return true;
  // `total` y `guardada` los añade el guardado, no forman parte de lo editado.
  const { total: _t, guardada: _g, ...contenido } = guardada;
  return JSON.stringify(contenido) !== JSON.stringify(actual);
}

function render() {
  let q;
  try {
    q = calcularCotizacion(actual.partidas, actual.config);
    $("#error-config").hidden = true;
  } catch (e) {
    $("#error-config").hidden = false;
    $("#error-config").textContent = e.message;
    // Se recalcula con un margen seguro para no dejar la pantalla en blanco.
    q = calcularCotizacion(actual.partidas, { ...actual.config, utilidad: 0 });
  }

  pintarEmpresa();
  pintarEncabezado();
  pintarConfig();
  pintarPartidas(q);
  pintarTotales(q);
  pintarHistorial();
  pintarDocumento(conPreciosDeVenta(q));
  return q;
}

/* ── Eventos ─────────────────────────────────────────────────────────── */

function avisar(texto) {
  const el = $("#aviso-flotante");
  el.textContent = texto;
  el.classList.add("visible");
  clearTimeout(avisar._t);
  avisar._t = setTimeout(() => el.classList.remove("visible"), 2200);
}

function persistir() {
  const r = guardar(estado);
  if (!r.ok && r.motivo === "cuota") {
    avisar("Almacenamiento lleno: exporta y borra cotizaciones viejas.");
  }
}

function agregarPartida(base = {}) {
  actual.partidas.push({
    codigo: base.codigo || "",
    descripcion: base.descripcion || "",
    unidad: base.unidad || "ud",
    cantidad: base.cantidad ?? 1,
    costoMaterial: base.costoMaterial ?? 0,
    costoManoObra: base.costoManoObra ?? 0,
    desperdicio: base.desperdicio ?? 0,
  });
  render();
}

function pintarResultados(termino) {
  const caja = $("#resultados");
  const encontrados = termino.trim() ? buscar(termino, catalogo).slice(0, 40) : [];
  indiceResaltado = encontrados.length ? 0 : -1;

  if (!encontrados.length) {
    caja.hidden = true;
    caja.innerHTML = "";
    return [];
  }

  caja.hidden = false;
  caja.innerHTML = `<ul role="listbox">${encontrados
    .map(
      (p, i) => `<li role="option" data-idx="${i}" aria-selected="${i === 0}">
        <span class="codigo">${escapar(p.codigo)}</span>
        <span>${escapar(p.descripcion)}</span>
        <span class="precio">${formatearDinero(
          numeroPositivo(p.costoMaterial) * (1 + numeroPositivo(p.desperdicio)) + numeroPositivo(p.costoManoObra),
          actual.config
        )}/${escapar(p.unidad)}</span>
      </li>`
    )
    .join("")}</ul>`;
  return encontrados;
}

function conectar() {
  // — Buscador del catálogo —
  const entrada = $("#buscar");
  let encontrados = [];

  entrada.addEventListener("input", () => {
    encontrados = pintarResultados(entrada.value);
  });

  entrada.addEventListener("keydown", (ev) => {
    if (!encontrados.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const paso = ev.key === "ArrowDown" ? 1 : -1;
      indiceResaltado = (indiceResaltado + paso + encontrados.length) % encontrados.length;
      $$("#resultados li").forEach((li, i) =>
        li.setAttribute("aria-selected", String(i === indiceResaltado))
      );
      $$("#resultados li")[indiceResaltado]?.scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter" && indiceResaltado >= 0) {
      ev.preventDefault();
      agregarPartida(encontrados[indiceResaltado]);
      entrada.value = "";
      encontrados = pintarResultados("");
      entrada.focus();
    } else if (ev.key === "Escape") {
      entrada.value = "";
      encontrados = pintarResultados("");
    }
  });

  $("#resultados").addEventListener("mousedown", (ev) => {
    const li = ev.target.closest("li[data-idx]");
    if (!li) return;
    ev.preventDefault();
    agregarPartida(encontrados[Number(li.dataset.idx)]);
    entrada.value = "";
    encontrados = pintarResultados("");
    entrada.focus();
  });

  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".buscador")) $("#resultados").hidden = true;
  });

  // — Edición de la tabla (delegada: las filas se repintan constantemente) —
  $("#cuerpo-partidas").addEventListener("input", (ev) => {
    const campo = ev.target.dataset.p;
    if (!campo) return;
    const fila = Number(ev.target.closest("tr").dataset.fila);
    const p = actual.partidas[fila];
    if (!p) return;

    if (campo === "descripcion" || campo === "unidad") {
      p[campo] = ev.target.value;
      // No se repinta la tabla: perdería el cursor a media palabra.
      const q = calcularCotizacion(actual.partidas, actual.config);
      pintarTotales(q);
      pintarDocumento(conPreciosDeVenta(q));
      return;
    }

    if (campo === "desperdicioPct") {
      p.desperdicio = numeroPositivo(ev.target.value) / 100;
    } else {
      p[campo] = numeroPositivo(ev.target.value);
    }

    // Se actualiza el importe de la fila sin reconstruir el <input> activo.
    const q = calcularCotizacion(actual.partidas, actual.config);
    const celda = ev.target.closest("tr").querySelector("td.num");
    if (celda) celda.textContent = formatearDinero(q.lineas[fila].total, actual.config);
    pintarTotales(q);
    pintarDocumento(conPreciosDeVenta(q));
  });

  // Al salir del campo se reescribe lo interpretado. Sin esto, teclear "-10"
  // dejaba "-10" a la vista mientras el importe se calculaba con 0, y la fila
  // mostraba dos datos que se contradecían.
  $("#cuerpo-partidas").addEventListener("change", (ev) => {
    const campo = ev.target.dataset.p;
    if (!campo || campo === "descripcion" || campo === "unidad") return;
    const fila = Number(ev.target.closest("tr").dataset.fila);
    const p = actual.partidas[fila];
    if (!p) return;
    ev.target.value = campo === "desperdicioPct"
      ? redondear(p.desperdicio * 100, 2)
      : numeroPositivo(p[campo]);
  });

  $("#cuerpo-partidas").addEventListener("click", (ev) => {
    if (ev.target.dataset.accion !== "borrar") return;
    const fila = Number(ev.target.closest("tr").dataset.fila);
    actual.partidas.splice(fila, 1);
    render();
  });

  $("#agregar-linea").addEventListener("click", () => agregarPartida());

  // — Encabezado de la cotización —
  document.addEventListener("input", (ev) => {
    const campo = ev.target.dataset.cot;
    if (!campo) return;
    actual[campo] = campo === "validez" ? numeroPositivo(ev.target.value) : ev.target.value;
    pintarDocumento(conPreciosDeVenta(calcularCotizacion(actual.partidas, actual.config)));
  });

  // — Datos de la empresa —
  document.addEventListener("input", (ev) => {
    const campo = ev.target.dataset.empresa;
    if (!campo) return;
    estado.empresa[campo] = ev.target.value;
    persistir();
    pintarDocumento(conPreciosDeVenta(calcularCotizacion(actual.partidas, actual.config)));
  });

  $("#logo").addEventListener("change", (ev) => {
    const archivo = ev.target.files?.[0];
    if (!archivo) return;
    if (archivo.size > 400 * 1024) {
      avisar("El logo debe pesar menos de 400 KB.");
      ev.target.value = "";
      return;
    }
    const lector = new FileReader();
    lector.onload = () => {
      estado.empresa.logo = String(lector.result);
      persistir();
      render();
      avisar("Logo actualizado.");
    };
    lector.readAsDataURL(archivo);
  });

  $("#quitar-logo").addEventListener("click", () => {
    estado.empresa.logo = "";
    persistir();
    render();
  });

  // — Configuración de precios —
  document.addEventListener("input", (ev) => {
    const campo = ev.target.dataset.config;
    if (!campo) return;
    if (campo === "moneda") {
      actual.config.moneda = ev.target.value.toUpperCase().slice(0, 3) || "USD";
    } else if (campo === "modoUtilidad") {
      actual.config.modoUtilidad = ev.target.value;
    } else if (campo === "impuestoIncluido") {
      actual.config.impuestoIncluido = ev.target.checked;
    } else {
      actual.config[campo] = numeroPositivo(ev.target.value) / 100;
    }
    // Estos porcentajes son de la empresa, no de una cotización suelta.
    // Lo que se guarda se recorta a un margen usable aunque lo tecleado sea
    // imposible: el aviso de "margen del 100% o más" tiene que verse mientras
    // se escribe, pero persistirlo hacía que la app volviera a abrir en estado
    // de error en cada carga posterior, y de ahí solo se salía adivinando que
    // había que reeditar el campo. El markup no se recorta: por encima del
    // 100% es legítimo.
    estado.config = { ...actual.config };
    if (estado.config.modoUtilidad !== "markup") {
      estado.config.utilidad = Math.min(numeroPositivo(estado.config.utilidad), 0.99);
    }
    persistir();
    render();
  });

  document.addEventListener("change", (ev) => {
    if (ev.target.dataset.config) {
      ev.target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // — Acciones principales —
  $("#nueva").addEventListener("click", () => {
    if (actual.partidas.length && !confirm("¿Descartar la cotización actual y empezar una nueva?")) return;
    actual = nuevaCotizacion();
    render();
    avisar("Cotización nueva.");
  });

  $("#guardar").addEventListener("click", () => {
    if (!actual.partidas.length) return avisar("Agrega al menos una partida.");
    const q = calcularCotizacion(actual.partidas, actual.config);
    const registro = { ...structuredClone(actual), total: q.total, guardada: new Date().toISOString() };
    const i = estado.cotizaciones.findIndex((c) => c.numero === actual.numero);
    if (i >= 0) estado.cotizaciones[i] = registro;
    else estado.cotizaciones.push(registro);
    persistir();
    render();
    avisar(`${actual.numero} guardada.`);
  });

  $("#imprimir").addEventListener("click", () => {
    if (!actual.partidas.length) return avisar("Agrega al menos una partida.");
    render();
    window.print();
  });

  $("#historial").addEventListener("click", (ev) => {
    const abrir = ev.target.dataset.abrir;
    const eliminar = ev.target.dataset.eliminar;
    if (abrir !== undefined) {
      const c = estado.cotizaciones[Number(abrir)];
      if (!c) return;
      actual = { ...nuevaCotizacion(), ...structuredClone(c) };
      render();
      avisar(`${actual.numero} abierta.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (eliminar !== undefined) {
      const c = estado.cotizaciones[Number(eliminar)];
      if (c && confirm(`¿Eliminar ${c.numero}? No se puede deshacer.`)) {
        estado.cotizaciones.splice(Number(eliminar), 1);
        persistir();
        render();
      }
    }
  });

  $("#exportar").addEventListener("click", () => {
    const blob = new Blob([exportar(estado)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `respaldo-cotizador-${hoy()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    avisar("Respaldo descargado. Guárdalo en tu correo o Drive.");
  });

  $("#importar").addEventListener("change", (ev) => {
    const archivo = ev.target.files?.[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = () => {
      try {
        estado = importar(String(lector.result));
        catalogo = estado.catalogo?.length ? estado.catalogo : CATALOGO;
        actual = nuevaCotizacion();
        persistir();
        render();
        avisar("Respaldo restaurado.");
      } catch (e) {
        alert(`No se pudo leer el archivo: ${e.message}`);
      }
    };
    lector.readAsText(archivo);
    ev.target.value = "";
  });

  // Ctrl/Cmd+S guarda, como en cualquier programa de escritorio.
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      $("#guardar").click();
    }
  });

  window.addEventListener("beforeunload", (ev) => {
    if (!hayCambiosSinGuardar()) return;
    ev.preventDefault();
    ev.returnValue = "";
  });
}

export function iniciar() {
  conectar();
  render();

  // El nombre de la empresa es lo que encabeza la cotización impresa. Si aún
  // no está puesto, el panel se abre solo: si no, el contratista manda su
  // primera propuesta encabezada con "Mi Constructora" y no entiende por qué.
  const panelEmpresa = $("#tarjeta-empresa");
  if (panelEmpresa) panelEmpresa.open = !estado.empresa.nombre;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { CATALOGO, UNIDADES, buscar, categorias, normalizar } from "../src/catalog.js";
import { exportar, importar, siguienteNumero, ESTADO_INICIAL } from "../src/storage.js";
import { calcularPartida } from "../src/calc.js";

test("toda partida del catálogo está completa y es cotizable", () => {
  const codigos = new Set();
  for (const p of CATALOGO) {
    assert.ok(p.codigo, `partida sin código: ${p.descripcion}`);
    assert.ok(!codigos.has(p.codigo), `código duplicado: ${p.codigo}`);
    codigos.add(p.codigo);

    assert.ok(p.descripcion?.length > 3, `descripción pobre en ${p.codigo}`);
    assert.ok(p.categoria, `sin categoría: ${p.codigo}`);
    assert.ok(UNIDADES.includes(p.unidad), `unidad inválida en ${p.codigo}: ${p.unidad}`);

    for (const campo of ["costoMaterial", "costoManoObra", "desperdicio"]) {
      assert.ok(Number.isFinite(p[campo]), `${campo} no numérico en ${p.codigo}`);
      assert.ok(p[campo] >= 0, `${campo} negativo en ${p.codigo}`);
    }
    assert.ok(p.desperdicio <= 0.30, `desperdicio irreal (${p.desperdicio}) en ${p.codigo}`);

    // Una partida que cuesta 0 no es una partida, es un error de captura.
    const { costoUnitario } = calcularPartida({ ...p, cantidad: 1 });
    assert.ok(costoUnitario > 0, `costo unitario cero en ${p.codigo}`);
  }
});

test("el catálogo cubre las fases reales de una obra", () => {
  const cats = categorias();
  for (const esperada of ["Preliminares", "Hormigón y acero", "Mampostería", "Eléctrica", "Sanitaria", "Pintura"]) {
    assert.ok(cats.includes(esperada), `falta la categoría ${esperada}`);
  }
  assert.ok(CATALOGO.length >= 40, "catálogo demasiado corto para cotizar una obra completa");
});

test("la búsqueda ignora acentos y mayúsculas", () => {
  assert.equal(normalizar("Hormigón"), "hormigon");
  assert.ok(buscar("hormigon").length > 0);
  assert.ok(buscar("HORMIGÓN").length > 0);
  assert.ok(buscar("electrica").length > 0);
  assert.equal(buscar("MAM-02")[0].codigo, "MAM-02");
  assert.equal(buscar("").length, CATALOGO.length);
  assert.equal(buscar("   ").length, CATALOGO.length);
  assert.equal(buscar("xyzzy-no-existe").length, 0);
});

test("la búsqueda encuentra por palabras sueltas y en cualquier orden", () => {
  // Nadie teclea la descripción completa: teclean dos palabras clave.
  const seis = buscar("bloque 6");
  assert.equal(seis.length, 1, 'buscar "bloque 6" debe dar con el bloque de 6"');
  assert.equal(seis[0].codigo, "MAM-02");

  // El orden no debe importar.
  assert.equal(buscar("6 bloque")[0].codigo, "MAM-02");

  // Cada palabra restringe: agregar términos nunca amplía el resultado.
  assert.ok(buscar("pintura interior").length <= buscar("pintura").length);
  assert.ok(buscar("pintura interior").length > 0);

  // Se puede buscar por categoría + detalle a la vez.
  assert.ok(buscar("electrica 220").length > 0);

  // Una palabra que no existe descarta todo, aunque las otras sí estén.
  assert.equal(buscar("bloque unicornio").length, 0);
});

test("exportar/importar es un viaje de ida y vuelta sin pérdida", () => {
  const estado = {
    ...ESTADO_INICIAL,
    empresa: { ...ESTADO_INICIAL.empresa, nombre: "Constructora Ashanny", telefono: "809-555-0000" },
    cotizaciones: [{ numero: "COT-2026-001", cliente: "Doña María", total: 4500 }],
  };
  const ida = exportar(estado);
  const vuelta = importar(ida);
  assert.deepEqual(vuelta.cotizaciones, estado.cotizaciones);
  assert.equal(vuelta.empresa.telefono, "809-555-0000");
});

test("importar acepta el JSON crudo además del envoltorio exportado", () => {
  const crudo = JSON.stringify({ empresa: { nombre: "Otra" }, cotizaciones: [] });
  const r = importar(crudo);
  assert.equal(r.empresa.nombre, "Otra");
});

test("importar rechaza basura en vez de corromper el estado", () => {
  assert.throws(() => importar("no soy json"));
  assert.throws(() => importar("null"));
  assert.throws(() => importar('"solo un texto"'));
});

test("el correlativo no repite números ni se confunde entre años", () => {
  assert.equal(siguienteNumero([], 2026), "COT-2026-001");
  const existentes = [
    { numero: "COT-2026-001" },
    { numero: "COT-2026-007" },
    { numero: "COT-2025-099" }, // otro año: no debe influir
    { numero: "borrador-sin-numero" },
    {},
  ];
  assert.equal(siguienteNumero(existentes, 2026), "COT-2026-008");
  assert.equal(siguienteNumero(existentes, 2027), "COT-2027-001");
});

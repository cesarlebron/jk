# -*- coding: utf-8 -*-
"""Smoke test: simula pymxs lo justo para ejercitar scoring, reglas e informe."""
import sys, types, contextlib

# --- stub de pymxs ---------------------------------------------------------
pymxs = types.ModuleType("pymxs")

class _RT(object):
    def __getattr__(self, nombre):
        raise AttributeError(nombre)

pymxs.runtime = _RT()

@contextlib.contextmanager
def _redraw(estado):
    yield
@contextlib.contextmanager
def _undo(*a, **k):
    yield

pymxs.redraw = _redraw
pymxs.undo = _undo
sys.modules["pymxs"] = pymxs

import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import spt_scene_performance_toolkit as spt

def ficha(**kw):
    f = {"nombre": "obj", "handle": 1, "clase": "Editable_Poly", "es_xref": False,
         "oculto": False, "congelado": False, "como_caja": False, "polys": 0,
         "num_mods": 0, "coste_mods": 0.0, "mods": [], "handle_base": 1,
         "num_instancias": 1, "bytes_tex": 0, "num_mapas": 0, "material": "",
         "num_hijos": 0, "prof_grupo": 0, "stack_animado": False,
         "no_colapsable": False, "es_grupo": False, "borrable": False}
    f.update(kw)
    return f

fichas = [
    ficha(nombre="Muro_pesado", polys=450000, num_mods=4, coste_mods=20.0,
          mods=[{"clase": "TurboSmooth", "activo": True, "peso": 12.0},
                {"clase": "Shell", "activo": True, "peso": 6.0},
                {"clase": "uvwmap", "activo": True, "peso": 1.0},
                {"clase": "Bend", "activo": False, "peso": 0.375}],
          bytes_tex=60 * 1024 * 1024, num_mapas=4, material="M_Muro", prof_grupo=4),
    ficha(nombre="Personaje", polys=120000, num_mods=3, coste_mods=14.0,
          mods=[{"clase": "Skin", "activo": True, "peso": 6.0}],
          no_colapsable=True, material="M_Piel"),
    ficha(nombre="Arbol_XREF", polys=300000, es_xref=True, material="M_Arbol"),
    ficha(nombre="Silla_inst", polys=8000, num_instancias=40, handle_base=7, material="M_Silla"),
    ficha(nombre="Dummy_muerto", clase="Dummy", borrable=True),
    ficha(nombre="Caja_oculta", polys=200000, oculto=True),
    ficha(nombre="Stack_animado", polys=5000, num_mods=5, coste_mods=12.0, stack_animado=True),
]
# 12 tornillos identicos -> attach; 4 lamparas identicas grandes -> instanciar
fichas += [ficha(nombre="Tornillo_%02d" % i, polys=300, material="M_Metal") for i in range(12)]
fichas += [ficha(nombre="Lampara_%02d" % i, polys=9000, material="M_Lampara") for i in range(4)]

fichas = spt.calcular_scores(fichas)
fichas = spt.generar_sugerencias(fichas)
spt.imprimir_informe(fichas, top=12)

# --- comprobaciones --------------------------------------------------------
por_nombre = dict((f["nombre"], f) for f in fichas)
def acciones(n):
    return [s["accion"] for s in por_nombre[n]["sugerencias"]]

fallos = []
def check(cond, msg):
    if not cond:
        fallos.append(msg)

check(all(0.0 <= f["score"] <= 100.0 for f in fichas), "score fuera de rango 0-100")
check(fichas[0]["nombre"] == "Muro_pesado", "el peor objeto no encabeza el ranking")
check(any("iteraciones de viewport" in a for a in acciones("Muro_pesado")),
      "no detecta TurboSmooth en viewport")
check(any("Aplanar jerarquia" in a for a in acciones("Muro_pesado")), "no detecta grupos profundos")
check(any("NO colapsar (Skin" in a for a in acciones("Personaje")),
      "propone colapsar un objeto con Skin")
check(any("NO colapsar (stack animado" in a for a in acciones("Stack_animado")),
      "propone colapsar un stack animado")
check(acciones("Arbol_XREF") == ["Optimizar en el archivo XRef de origen"],
      "toca un XRef")
check(any("Attach" in a for a in acciones("Tornillo_00")), "no propone attach en los tornillos")
check(any("instancias" in a for a in acciones("Lampara_00")), "no propone instanciar las lamparas")
check(not any("Attach" in a for a in acciones("Lampara_00")), "attach e instanciar se solapan")
check(acciones("Silla_inst") == [], "sugiere algo sobre un objeto ya instanciado")
check(por_nombre["Silla_inst"]["factor_instancia"] < 0.3, "el descuento por instancia no se aplica")
check(por_nombre["Caja_oculta"]["factor_visibilidad"] == 0.05, "objeto oculto sin descuento")
check(any("Eliminar helper" in a for a in acciones("Dummy_muerto")), "no detecta el helper huerfano")
check(spt._COSTE_MODIFICADOR_LC["uvwmap"] == 1.0, "lookup de modificadores sensible a mayusculas")
# prioridad = impacto*100/riesgo, ordenada descendente
for f in fichas:
    ps = [s["prioridad"] for s in f["sugerencias"]]
    check(ps == sorted(ps, reverse=True), "sugerencias de %s mal ordenadas" % f["nombre"])

# borrado de userprop sobre un buffer real
class _NodoFalso(object):
    def __init__(self, buf): self.buf = buf
class _RT2(object):
    def getUserPropBuffer(self, n): return n.buf
    def setUserPropBuffer(self, n, v): n.buf = v
spt.rt = _RT2()
n = _NodoFalso("Autor=Cesar\nSPT_ORIG_WIRECOLOR=12,34,56\nLote=A7")
spt._borrar_userprop(n, "SPT_ORIG_WIRECOLOR")
check(n.buf == "Autor=Cesar\nLote=A7", "el borrado de userprop pierde o conserva lineas mal: %r" % n.buf)

print("")
if fallos:
    print("FALLOS:")
    for m in fallos:
        print("  - " + m)
    sys.exit(1)
print("TODAS LAS COMPROBACIONES OK (%d)" % 18)

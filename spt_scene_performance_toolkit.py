# -*- coding: utf-8 -*-
"""
===============================================================================
SPT - SCENE PERFORMANCE TOOLKIT (nucleo)
Ronda 1: analisis + scoring + resaltado no destructivo + motor de sugerencias
===============================================================================

USO (pegar el archivo entero en el Script Editor de 3ds Max, pestaña Python):

    run_audit()          -> analiza la escena. SOLO LECTURA. No altera nada.
    apply_highlight()    -> pinta en rojo los N peores. Pide confirmacion.
    clear_highlight()    -> restaura el estado original. Funciona incluso
                            despues de un crash o de reabrir el archivo.

FILOSOFIA DE SEGURIDAD
  - run_audit() no escribe absolutamente nada en la escena.
  - apply_highlight() guarda el estado original en los UserProps de cada nodo,
    asi que el estado de restauracion viaja DENTRO del archivo .max. Si Max se
    cae a mitad, abres el archivo y clear_highlight() sigue funcionando.
  - Nunca se toca un material. Nunca se toca un objeto XRef.
  - Todo lo que escribe va dentro de un bloque de undo.

REQUISITOS: 3ds Max 2021 o superior (Python 3 + pymxs).
===============================================================================
"""

import os
import json
import math
import re
import tempfile

import pymxs
from pymxs import runtime as rt


# =============================================================================
# 1. CONFIGURACION
# =============================================================================

# --- Pesos del modelo de coste (deben sumar 1.0) ---------------------------
W_MODIFICADORES = 0.35
W_GEOMETRIA     = 0.30
W_TEXTURAS      = 0.20
W_MATERIALES    = 0.10
W_GRUPOS        = 0.05

# --- Coste relativo por clase de modificador -------------------------------
# Un UVW Map no cuesta lo mismo que un TurboSmooth. Contar modificadores "a
# pelo" es la razon principal por la que los rankings de este tipo de
# herramientas salen mal. Escala orientativa: 1.0 = practicamente gratis.
COSTE_MODIFICADOR = {
    "TurboSmooth":      12.0,
    "OpenSubdiv":       12.0,
    "MeshSmooth":       10.0,
    "HSDS_Modifier":     9.0,
    "Cloth":             9.0,
    "Hair_and_Fur":     10.0,
    "Shell":             6.0,
    "Sweep":             5.0,
    "Lattice":           5.0,
    "Displace":          6.0,
    "Skin":              6.0,
    "Physique":          6.0,
    "Morpher":           6.0,
    "Symmetry":          4.0,
    "Bend":              2.5,
    "Twist":             2.5,
    "Taper":             2.5,
    "FFD_2x2x2":         2.0,
    "FFD_3x3x3":         2.5,
    "FFD_4x4x4":         3.0,
    "Noisemodifier":     3.0,
    "Edit_Poly":         5.0,   # Edit Poly encima del stack es caro de verdad
    "Edit_Mesh":         5.0,
    "Unwrap_UVW":        3.0,
    "UVWMap":            1.0,
    "Smooth":            1.0,
    "Normalmodifier":    1.0,
    "Materialmodifier":  1.0,
    "VertexPaint":       2.0,
    "ProOptimizer":      4.0,
}
COSTE_MODIFICADOR_DEFECTO = 2.5

# Indice en minusculas: classOf() devuelve la grafia exacta de la clase de
# MAXScript ("UVWMap", "Uvwmap"... segun version), asi que la busqueda no puede
# depender de mayusculas.
_COSTE_MODIFICADOR_LC = dict((k.lower(), v) for k, v in COSTE_MODIFICADOR.items())

# Modificadores cuyo colapso destruye datos que no se pueden reconstruir.
_MODS_NO_COLAPSABLES = ("skin", "physique", "morpher", "cloth", "hair_and_fur")

# Modificadores de subdivision: los que tienen iteraciones de viewport propias.
_MODS_SUBDIVISION = ("turbosmooth", "opensubdiv", "meshsmooth", "hsds_modifier")

# --- Umbrales para el motor de sugerencias ---------------------------------
UMBRAL_POLYS_ALTO        = 100000    # poligonos por objeto
UMBRAL_TEXTURA_MB        = 25.0      # MB en disco de los mapas de un objeto
UMBRAL_STACK_LARGO       = 3         # nº de modificadores
UMBRAL_GRUPO_PROFUNDO    = 3         # niveles de grupo anidado
UMBRAL_POLYS_ATTACH      = 2000      # objeto "pequeño" candidato a attach

# --- Resaltado --------------------------------------------------------------
COLOR_ROJO               = (255, 0, 0)
TOP_POR_DEFECTO          = 25
USERPROP_COLOR           = "SPT_ORIG_WIRECOLOR"

# --- Rendimiento del propio analisis ---------------------------------------
TAMANO_LOTE              = 250       # nodos entre refrescos de UI

# --- Cache de resultados del ultimo analisis -------------------------------
SPT_ULTIMO_ANALISIS = []
SPT_ULTIMO_CANCELADO = False


# =============================================================================
# 2. UTILIDADES DE BAJO NIVEL
# =============================================================================

def _clase(obj):
    """Nombre de clase como string, tolerante a fallos."""
    try:
        return str(rt.classOf(obj))
    except Exception:
        return ""


def _cuenta(coleccion):
    """
    len() de un array de MAXScript. pymxs expone estos arrays como wrappers:
    len() funciona siempre, la propiedad .count no esta garantizada.
    """
    if coleccion is None:
        return 0
    try:
        return int(len(coleccion))
    except Exception:
        pass
    try:
        return int(coleccion.count)
    except Exception:
        return 0


def _undo(etiqueta):
    """
    pymxs.undo solo admite un segundo argumento con el nombre de la entrada de
    undo a partir de ciertas versiones. Degradamos sin romper.
    """
    try:
        return pymxs.undo(True, etiqueta)
    except Exception:
        return pymxs.undo(True)


def _es_xref(nodo):
    """Un objeto XRef nunca se modifica: pertenece a otro archivo."""
    try:
        if "xref" in _clase(nodo).lower():
            return True
        base = getattr(nodo, "baseObject", None)
        if base is not None and "xref" in _clase(base).lower():
            return True
    except Exception:
        pass
    return False


def _es_geometria(nodo):
    try:
        return rt.superClassOf(nodo) == rt.GeometryClass
    except Exception:
        return False


def _poligonos(nodo):
    """
    Poligonos evaluados. OJO: fuerza la evaluacion del objeto, por eso el
    analisis de una escena grande tarda. Es el precio de medir de verdad en
    lugar de estimar.
    """
    try:
        res = rt.getPolygonCount(nodo)   # devuelve #(caras, vertices)
        if res is None:
            return 0
        return int(res[0])
    except Exception:
        return 0


def _handle_base(nodo):
    """
    Handle del baseObject. Los nodos que comparten baseObject son instancias o
    referencias entre si. Agrupar por este handle es mucho mas rapido y mucho
    mas fiable que llamar a InstanceMgr objeto por objeto.
    """
    try:
        base = getattr(nodo, "baseObject", None)
        if base is None:
            return -1
        return int(rt.getHandleByAnim(base))
    except Exception:
        return -1


def _profundidad_grupo(nodo):
    """Cuantos niveles de grupo hay por encima de este nodo."""
    prof = 0
    try:
        padre = nodo.parent
        guardia = 0
        while padre is not None and guardia < 32:
            if rt.isGroupHead(padre):
                prof += 1
            padre = padre.parent
            guardia += 1
    except Exception:
        pass
    return prof


def _tiene_dependientes(nodo):
    """
    ¿Hay algun otro nodo que referencie a este? Un Dummy sin hijos puede seguir
    siendo el target de un constraint o de un wire: borrarlo romperia la escena.
    """
    try:
        deps = rt.refs.dependentNodes(nodo)
        return _cuenta(deps) > 0
    except Exception:
        # Si no se puede comprobar, asumimos que si: no proponemos borrar.
        return True


def _clases_bitmap():
    """
    Devuelve las clases de bitmap disponibles en ESTA instalacion. Asi el
    toolkit funciona igual con Corona, V-Ray o Arnold sin configurar nada.
    """
    candidatas = [
        "Bitmaptexture", "CoronaBitmap", "VRayBitmap", "VRayHDRI",
        "MultiTile", "OSLMap",
    ]
    encontradas = []
    for nombre in candidatas:
        try:
            cls = getattr(rt, nombre, None)
            if cls is not None:
                encontradas.append(cls)
        except Exception:
            continue
    return encontradas


def _ruta_bitmap(bmp):
    """Cada clase de bitmap guarda la ruta en una propiedad distinta."""
    for prop in ("filename", "HDRIMapName", "fileName", "bitmapName"):
        try:
            valor = getattr(bmp, prop, None)
            if valor:
                return str(valor)
        except Exception:
            continue
    return ""


_CACHE_TAMANOS = {}     # ruta de textura  -> bytes en disco
_CACHE_MATERIAL = {}    # handle material  -> (bytes, nº de mapas)


def _bytes_en_disco(ruta):
    """Peso del archivo de textura. Cacheado: la misma textura se lee una vez."""
    if not ruta:
        return 0
    if ruta in _CACHE_TAMANOS:
        return _CACHE_TAMANOS[ruta]
    tam = 0
    try:
        resuelta = ruta
        if not os.path.isfile(resuelta):
            try:
                candidata = str(rt.mapPaths.getFullFilePath(ruta))
                if candidata and os.path.isfile(candidata):
                    resuelta = candidata
            except Exception:
                pass
        if os.path.isfile(resuelta):
            tam = int(os.path.getsize(resuelta))
    except Exception:
        tam = 0
    _CACHE_TAMANOS[ruta] = tam
    return tam


def _ruta_estado():
    """
    Sidecar del modo de viewport, uno por escena: con un unico archivo global,
    resaltar en la escena A y limpiar en la B dejaria a B con el modo de A.
    """
    try:
        nombre = str(rt.maxFileName) or "escena_sin_guardar"
    except Exception:
        nombre = "escena_sin_guardar"
    nombre = re.sub(r"[^A-Za-z0-9_.-]", "_", nombre)[:80]
    return os.path.join(tempfile.gettempdir(), "spt_estado_%s.json" % nombre)


# =============================================================================
# 3. MODULO DE ESCANEO (SOLO LECTURA)
# =============================================================================

def _texturas_del_nodo(nodo, clases_bmp, cacheable):
    """
    Bytes de textura y nº de mapas que cuelgan de este nodo (material +
    modificadores). Si el nodo no tiene modificadores, el resultado depende
    solo del material y se puede cachear por material: en escenas donde 500
    objetos comparten 10 materiales, esto se ahorra casi todo el trabajo.
    """
    clave = None
    if cacheable:
        try:
            clave = int(rt.getHandleByAnim(nodo.material))
        except Exception:
            clave = None
        if clave is not None and clave in _CACHE_MATERIAL:
            return _CACHE_MATERIAL[clave]

    total_bytes = 0
    total_mapas = 0
    for cls in clases_bmp:
        try:
            encontrados = rt.getClassInstances(cls, target=nodo)
        except Exception:
            continue
        try:
            for bmp in encontrados:
                ruta = _ruta_bitmap(bmp)
                if ruta:
                    total_bytes += _bytes_en_disco(ruta)
                    total_mapas += 1
        except Exception:
            continue

    if clave is not None:
        _CACHE_MATERIAL[clave] = (total_bytes, total_mapas)
    return total_bytes, total_mapas


def _escanear_nodo(nodo, clases_bmp):
    """Extrae la ficha cruda de un nodo. No escribe nada."""
    ficha = {
        "nombre":        str(nodo.name),
        "handle":        0,
        "clase":         _clase(nodo),
        "es_xref":       _es_xref(nodo),
        "oculto":        bool(nodo.isHidden),
        "congelado":     bool(nodo.isFrozen),
        "como_caja":     False,
        "polys":         0,
        "num_mods":      0,
        "coste_mods":    0.0,
        "mods":          [],
        "handle_base":   _handle_base(nodo),
        "num_instancias": 1,
        "bytes_tex":     0,
        "num_mapas":     0,
        "material":      "",
        "num_hijos":     0,
        "prof_grupo":    _profundidad_grupo(nodo),
        "stack_animado": False,
        "no_colapsable": False,
        "es_grupo":      False,
        "borrable":      False,
    }

    try:
        ficha["handle"] = int(rt.getHandleByAnim(nodo))
    except Exception:
        ficha["handle"] = 0

    try:
        ficha["como_caja"] = bool(nodo.boxMode)
    except Exception:
        pass

    ficha["num_hijos"] = _cuenta(getattr(nodo, "children", None))

    try:
        ficha["es_grupo"] = bool(rt.isGroupHead(nodo))
    except Exception:
        pass

    # --- Modificadores, ponderados por clase --------------------------------
    # De paso miramos si el STACK esta animado. Ojo: rt.isAnimated(nodo) da True
    # tambien cuando lo unico animado es la transformacion, y una transformacion
    # animada no impide colapsar el stack. Por eso se comprueba modificador a
    # modificador, y el baseObject aparte.
    try:
        n_mods = int(rt.getNumModifiers(nodo))
        ficha["num_mods"] = n_mods
        total = 0.0
        for i in range(1, n_mods + 1):          # getModifier es 1-based
            m = rt.getModifier(nodo, i)
            cls = _clase(m)
            activo = True
            try:
                activo = bool(m.enabled)
            except Exception:
                pass
            peso = _COSTE_MODIFICADOR_LC.get(cls.lower(), COSTE_MODIFICADOR_DEFECTO)
            if not activo:
                peso *= 0.15                    # apagado sigue ocupando memoria
            total += peso
            ficha["mods"].append({"clase": cls, "activo": activo, "peso": peso})

            if cls.lower() in _MODS_NO_COLAPSABLES:
                ficha["no_colapsable"] = True
            try:
                if bool(rt.isAnimated(m)):
                    ficha["stack_animado"] = True
            except Exception:
                pass
        ficha["coste_mods"] = total
    except Exception:
        pass

    if not ficha["stack_animado"]:
        try:
            base = getattr(nodo, "baseObject", None)
            if base is not None and bool(rt.isAnimated(base)):
                ficha["stack_animado"] = True
        except Exception:
            pass

    # --- Geometria -----------------------------------------------------------
    if _es_geometria(nodo):
        ficha["polys"] = _poligonos(nodo)

    # --- Material y texturas -------------------------------------------------
    mat = None
    try:
        mat = nodo.material
        if mat is not None:
            ficha["material"] = str(mat.name)
    except Exception:
        mat = None

    if mat is not None or ficha["num_mods"] > 0:
        cacheable = (mat is not None and ficha["num_mods"] == 0)
        bytes_tex, mapas = _texturas_del_nodo(nodo, clases_bmp, cacheable)
        ficha["bytes_tex"] = bytes_tex
        ficha["num_mapas"] = mapas

    # --- ¿Se puede proponer borrarlo? ---------------------------------------
    # Solo se calcula para helpers, que es donde aplica la regla: comprobar
    # dependencias no es gratis.
    if ficha["clase"] in ("Point", "Dummy", "ExposeTm") and not ficha["es_grupo"]:
        ficha["borrable"] = (ficha["num_hijos"] == 0 and
                             ficha["num_mods"] == 0 and
                             not _tiene_dependientes(nodo))

    return ficha


def escanear_escena():
    """
    Recorre la escena y devuelve una lista de fichas crudas.
    Cancelable. No modifica nada. Restaura el flag de "guardado pendiente"
    para que el propio analisis no marque el archivo como sucio.
    """
    global SPT_ULTIMO_CANCELADO

    SPT_ULTIMO_CANCELADO = False
    clases_bmp = _clases_bitmap()
    fichas = []

    try:
        guardado_pendiente = bool(rt.getSaveRequired())
    except Exception:
        guardado_pendiente = None

    nodos = list(rt.objects)
    total = len(nodos)
    if total == 0:
        return fichas

    rt.progressStart("SPT: analizando escena...")
    try:
        with pymxs.redraw(False):
            for i, nodo in enumerate(nodos):
                try:
                    if not rt.isValidNode(nodo):
                        continue
                    fichas.append(_escanear_nodo(nodo, clases_bmp))
                except Exception:
                    continue

                if i % TAMANO_LOTE == 0:
                    rt.progressUpdate(100.0 * i / total)
                    # Devuelve el control a Max para que la UI responda y para
                    # que el boton de cancelar funcione. No son hilos reales:
                    # la API de escena de Max NO es thread-safe.
                    rt.windows.processPostedMessages()
                    if rt.getProgressCancel():
                        SPT_ULTIMO_CANCELADO = True
                        break
    finally:
        rt.progressEnd()
        if guardado_pendiente is not None:
            try:
                rt.setSaveRequired(guardado_pendiente)
            except Exception:
                pass

    # --- Segunda pasada: contar instancias por baseObject compartido --------
    conteo = {}
    for f in fichas:
        h = f["handle_base"]
        if h != -1:
            conteo[h] = conteo.get(h, 0) + 1
    for f in fichas:
        f["num_instancias"] = conteo.get(f["handle_base"], 1)

    return fichas


# =============================================================================
# 4. MODULO DE SCORING
# =============================================================================

def _normalizar(valor, maximo):
    if maximo <= 0:
        return 0.0
    return min(1.0, float(valor) / float(maximo))


def calcular_scores(fichas):
    """
    Score 0-100 RELATIVO a esta escena, no absoluto. 50.000 poligonos son una
    barbaridad en una escena de mobiliario y son nada en una escena urbana:
    normalizar contra umbrales fijos produce rankings inutiles.
    """
    if not fichas:
        return fichas

    max_mods  = max([f["coste_mods"] for f in fichas] + [0.0])
    max_polys = max([f["polys"]      for f in fichas] + [0])
    max_tex   = max([f["bytes_tex"]  for f in fichas] + [0])
    max_mapas = max([f["num_mapas"]  for f in fichas] + [0])
    max_grupo = max([f["prof_grupo"] for f in fichas] + [0])

    for f in fichas:
        n_mods  = _normalizar(f["coste_mods"], max_mods)
        n_polys = _normalizar(f["polys"],      max_polys)
        n_tex   = _normalizar(f["bytes_tex"],  max_tex)
        n_mapas = _normalizar(f["num_mapas"],  max_mapas)
        n_grupo = _normalizar(f["prof_grupo"], max_grupo)

        bruto = (W_MODIFICADORES * n_mods +
                 W_GEOMETRIA     * n_polys +
                 W_TEXTURAS      * n_tex +
                 W_MATERIALES    * n_mapas +
                 W_GRUPOS        * n_grupo)

        # Descuento por instanciacion: 40 instancias de una silla cuestan
        # muchisimo menos que 40 sillas unicas, pero no cuestan cero (siguen
        # generando draw calls y evaluacion de transformaciones).
        n_inst = max(1, f["num_instancias"])
        factor_inst = 1.0 / (1.0 + 0.5 * math.log(n_inst, 2)) if n_inst > 1 else 1.0

        # Descuento por visibilidad: lo que no se dibuja, no cuesta viewport.
        factor_vis = 1.0
        if f["oculto"]:
            factor_vis = 0.05
        elif f["como_caja"]:
            factor_vis = 0.30
        elif f["congelado"]:
            factor_vis = 0.80

        f["factor_instancia"] = round(factor_inst, 3)
        f["factor_visibilidad"] = factor_vis
        f["score"] = round(100.0 * bruto * factor_inst * factor_vis, 2)

    fichas.sort(key=lambda x: x["score"], reverse=True)
    return fichas


# =============================================================================
# 5. MOTOR DE SUGERENCIAS
# =============================================================================
# Cada regla devuelve None o un dict. Prioridad = impacto * 100 / riesgo.
#   impacto: 0.0 - 1.0  (cuanto score se recupera)
#   riesgo:  1 = reversible y sin efectos colaterales
#            2 = reversible pero toca datos
#            3 = destructivo o con efectos en cadena

def _regla_subdivision_viewport(f):
    for m in f["mods"]:
        if m["clase"].lower() in _MODS_SUBDIVISION and m["activo"]:
            return {
                "accion": "Poner iteraciones de viewport a 0 en " + m["clase"],
                "motivo": "Subdivision activa en viewport: es el coste unitario mas alto del stack.",
                "impacto": 0.90, "riesgo": 1, "reversible": True,
            }
    return None


def _regla_colapsar_stack(f):
    if f["num_mods"] < UMBRAL_STACK_LARGO:
        return None
    if f["no_colapsable"]:
        return {
            "accion": "NO colapsar (Skin/Morpher/Cloth). Revisar stack a mano.",
            "motivo": "Stack de %d modificadores con deformacion no reconstruible." % f["num_mods"],
            "impacto": 0.30, "riesgo": 3, "reversible": False,
        }
    if f["stack_animado"]:
        return {
            "accion": "NO colapsar (stack animado). Revisar stack a mano.",
            "motivo": "Stack de %d modificadores, pero hay animacion dentro del stack." % f["num_mods"],
            "impacto": 0.30, "riesgo": 3, "reversible": False,
        }
    riesgo = 3 if f["num_instancias"] > 1 else 2
    nota = ""
    if f["num_instancias"] > 1:
        nota = " AVISO: afecta a las %d instancias que comparten este objeto." % f["num_instancias"]
    return {
        "accion": "Colapsar stack a Editable Poly",
        "motivo": "Stack de %d modificadores sin animacion.%s" % (f["num_mods"], nota),
        "impacto": 0.70, "riesgo": riesgo, "reversible": False,
    }


def _regla_display_caja(f):
    if f["polys"] >= UMBRAL_POLYS_ALTO and not f["como_caja"] and not f["oculto"]:
        return {
            "accion": "Display as Box mientras trabajas",
            "motivo": "%s poligonos dibujandose en cada refresco de viewport." % "{:,}".format(f["polys"]),
            "impacto": 0.80, "riesgo": 1, "reversible": True,
        }
    return None


def _regla_texturas(f):
    mb = f["bytes_tex"] / (1024.0 * 1024.0)
    if mb >= UMBRAL_TEXTURA_MB:
        return {
            "accion": "Bajar resolucion de mapas o usar proxy de viewport",
            "motivo": "%.1f MB en disco repartidos en %d mapas (descomprimidos en RAM, bastante mas)." % (mb, f["num_mapas"]),
            "impacto": 0.50, "riesgo": 2, "reversible": True,
        }
    return None


def _regla_instanciar(f, gemelos):
    if f["num_instancias"] > 1 or f["polys"] < UMBRAL_POLYS_ATTACH:
        return None
    n = gemelos.get((f["polys"], f["material"]), 0)
    if n >= 3:
        return {
            "accion": "Convertir en instancias (hay %d objetos identicos)" % n,
            "motivo": "Mismo polycount y mismo material: son copias, no instancias.",
            "impacto": 0.60, "riesgo": 2, "reversible": True,
        }
    return None


def _regla_attach(f, gemelos):
    if f["polys"] >= UMBRAL_POLYS_ATTACH or f["polys"] <= 0 or f["num_instancias"] > 1:
        return None
    if gemelos.get((f["polys"], f["material"]), 0) >= 10:
        return {
            "accion": "Attach con los objetos que comparten material",
            "motivo": "Objeto pequeño de una familia numerosa: el coste esta en el numero de objetos, no en los poligonos.",
            "impacto": 0.50, "riesgo": 3, "reversible": False,
        }
    return None


def _regla_grupos(f):
    if f["prof_grupo"] >= UMBRAL_GRUPO_PROFUNDO:
        return {
            "accion": "Aplanar jerarquia de grupos",
            "motivo": "%d niveles de grupo anidado: encarece la evaluacion de transformaciones." % f["prof_grupo"],
            "impacto": 0.20, "riesgo": 2, "reversible": True,
        }
    return None


def _regla_helper_huerfano(f):
    if f["borrable"]:
        return {
            "accion": "Eliminar helper huerfano",
            "motivo": "Helper sin hijos, sin modificadores y sin ningun nodo que lo referencie.",
            "impacto": 0.10, "riesgo": 2, "reversible": True,
        }
    return None


def generar_sugerencias(fichas):
    """Rellena f['sugerencias'], ordenadas por prioridad descendente."""
    # Indice de "gemelos": objetos con mismo polycount y mismo material. Solo
    # cuentan los que NO son ya instancias, que son los unicos que hay que
    # arreglar; si no, una familia ya instanciada se recomienda a si misma.
    gemelos = {}
    for f in fichas:
        if f["polys"] > 0 and f["num_instancias"] == 1 and not f["es_xref"]:
            clave = (f["polys"], f["material"])
            gemelos[clave] = gemelos.get(clave, 0) + 1

    for f in fichas:
        # Un XRef pertenece a otro archivo: se analiza pero jamas se toca.
        if f["es_xref"]:
            f["sugerencias"] = [{
                "accion": "Optimizar en el archivo XRef de origen",
                "motivo": "Objeto XRef: modificarlo aqui rompe el vinculo.",
                "impacto": 0.0, "riesgo": 1, "reversible": True, "prioridad": 0.0,
            }]
            continue

        sugerencias = []
        for regla in (_regla_subdivision_viewport, _regla_colapsar_stack,
                      _regla_display_caja, _regla_texturas,
                      _regla_grupos, _regla_helper_huerfano):
            res = regla(f)
            if res:
                sugerencias.append(res)

        for regla in (_regla_instanciar, _regla_attach):
            res = regla(f, gemelos)
            if res:
                sugerencias.append(res)

        for s in sugerencias:
            s["prioridad"] = round(s["impacto"] * 100.0 / max(1, s["riesgo"]), 1)

        sugerencias.sort(key=lambda s: s["prioridad"], reverse=True)
        f["sugerencias"] = sugerencias

    return fichas


# =============================================================================
# 6. RESALTADO NO DESTRUCTIVO
# =============================================================================
# Metodo: wirecolor + toggle global displayColor.shaded = #object.
# No se toca ningun material. El estado original se guarda en los UserProps
# del propio nodo, de modo que se guarda dentro del archivo .max y sobrevive
# a un crash o a un cierre sin guardar el script.

def _nodo_por_handle(ficha):
    """Handle primero; si el handle ya no vale, por nombre."""
    try:
        handle = int(ficha.get("handle", 0))
        if handle:
            nodo = rt.getAnimByHandle(handle)
            if nodo is not None and rt.isValidNode(nodo):
                return nodo
    except Exception:
        pass
    try:
        nodo = rt.getNodeByName(ficha.get("nombre", ""), exact=True)
        if nodo is not None and rt.isValidNode(nodo):
            return nodo
    except Exception:
        pass
    return None


def _borrar_userprop(nodo, clave):
    """
    setUserProp(..., undefined) no borra la clave de forma fiable en todas las
    versiones: puede dejar escrito el literal "undefined", y clear_highlight()
    volveria a encontrarla. Reescribimos el buffer sin esa linea, respetando
    el resto de propiedades del usuario.
    """
    try:
        buf = rt.getUserPropBuffer(nodo)
        buf = "" if buf is None else str(buf)
    except Exception:
        buf = ""

    prefijo = clave.lower() + "="
    lineas = [ln for ln in buf.replace("\r\n", "\n").split("\n")
              if not ln.strip().lower().startswith(prefijo)]
    nuevo = "\n".join(lineas).strip("\n")

    try:
        rt.setUserPropBuffer(nodo, nuevo)
        return True
    except Exception:
        try:
            rt.setUserProp(nodo, clave, rt.undefined)
            return True
        except Exception:
            return False


def apply_highlight(top=TOP_POR_DEFECTO, confirmar=True):
    """Pinta de rojo los `top` objetos con peor score del ultimo analisis."""
    if not SPT_ULTIMO_ANALISIS:
        print("SPT: no hay analisis previo. Ejecuta run_audit() primero.")
        return 0

    try:
        top = max(1, int(top))
    except Exception:
        top = TOP_POR_DEFECTO

    objetivos = [f for f in SPT_ULTIMO_ANALISIS if not f["es_xref"]][:top]
    if not objetivos:
        print("SPT: nada que resaltar.")
        return 0

    if confirmar:
        msg = ("SPT va a cambiar el color de objeto de %d nodos y a poner el "
               "viewport en modo 'Object Color'.\n\n"
               "No se toca ningun material. Reversible con clear_highlight().\n\n"
               "¿Continuar?" % len(objetivos))
        if not rt.queryBox(msg, title="Scene Performance Toolkit"):
            print("SPT: cancelado por el usuario.")
            return 0

    # Guardar el modo de display anterior en un sidecar en disco. Si ya hay un
    # resaltado activo NO se sobrescribe: en caso contrario, un segundo apply
    # guardaria "object" como modo "original" y clear_highlight() ya nunca
    # devolveria el viewport a "material".
    ruta_estado = _ruta_estado()
    if not os.path.isfile(ruta_estado):
        try:
            modo_previo = str(rt.displayColor.shaded)
        except Exception:
            modo_previo = "material"
        try:
            with open(ruta_estado, "w") as fh:
                json.dump({"displayColor_shaded": modo_previo}, fh)
        except Exception:
            pass

    rojo = rt.color(COLOR_ROJO[0], COLOR_ROJO[1], COLOR_ROJO[2])
    tocados = 0

    with _undo("SPT Highlight"):
        with pymxs.redraw(False):
            for f in objetivos:
                nodo = _nodo_por_handle(f)
                if nodo is None:
                    continue
                try:
                    # Si ya hay un original guardado, no lo pisamos: eso
                    # significa que el resaltado ya estaba aplicado.
                    if not rt.getUserProp(nodo, USERPROP_COLOR):
                        wc = nodo.wirecolor
                        rt.setUserProp(nodo, USERPROP_COLOR,
                                       "%d,%d,%d" % (int(wc.r), int(wc.g), int(wc.b)))
                    nodo.wirecolor = rojo
                    tocados += 1
                except Exception:
                    continue

        try:
            # Sin este toggle, el wirecolor no se ve en un viewport sombreado
            # con materiales asignados: solo se veria al seleccionar.
            rt.displayColor.shaded = rt.Name("object")
        except Exception:
            pass

    rt.redrawViews()
    print("SPT: %d objetos resaltados. clear_highlight() para revertir." % tocados)
    return tocados


def clear_highlight():
    """
    Restaura el estado original. Recorre TODA la escena buscando la marca en
    UserProps, asi que funciona aunque no haya analisis en memoria, aunque el
    script se haya recargado o aunque Max se haya cerrado por el camino.
    """
    restaurados = 0
    limpiados = 0

    with _undo("SPT Clear Highlight"):
        with pymxs.redraw(False):
            for nodo in list(rt.objects):
                try:
                    guardado = rt.getUserProp(nodo, USERPROP_COLOR)
                    if not guardado:
                        continue
                    partes = str(guardado).split(",")
                    if len(partes) == 3:
                        nodo.wirecolor = rt.color(int(partes[0]), int(partes[1]), int(partes[2]))
                        restaurados += 1
                    _borrar_userprop(nodo, USERPROP_COLOR)
                    limpiados += 1
                except Exception:
                    continue

    ruta_estado = _ruta_estado()
    modo = "material"
    try:
        if os.path.isfile(ruta_estado):
            with open(ruta_estado, "r") as fh:
                modo = json.load(fh).get("displayColor_shaded", "material")
    except Exception:
        pass
    try:
        rt.displayColor.shaded = rt.Name(modo)
    except Exception:
        pass
    # El sidecar se consume: si se queda, el proximo apply_highlight() creeria
    # que ya hay un resaltado activo y no guardaria el modo real.
    try:
        if os.path.isfile(ruta_estado):
            os.remove(ruta_estado)
    except Exception:
        pass

    rt.redrawViews()
    print("SPT: %d objetos restaurados (%d marcas limpiadas). "
          "Modo de viewport devuelto a '%s'." % (restaurados, limpiados, modo))
    return restaurados


# =============================================================================
# 7. INFORME
# =============================================================================

def _mb(bytes_):
    return bytes_ / (1024.0 * 1024.0)


def imprimir_informe(fichas, top=20):
    print("")
    print("=" * 100)
    print("SCENE PERFORMANCE TOOLKIT - TOP %d OBJETOS POR COSTE" % top)
    print("=" * 100)

    if not fichas:
        print("Escena vacia o analisis cancelado.")
        return

    if SPT_ULTIMO_CANCELADO:
        print("AVISO: analisis CANCELADO. El ranking solo cubre los %d objetos "
              "recorridos hasta la cancelacion." % len(fichas))
        print("-" * 100)

    total_polys = sum(f["polys"] for f in fichas)
    print("Objetos analizados: %d   |   Poligonos totales: %s   |   Texturas unicas: %d (%.1f MB en disco)"
          % (len(fichas), "{:,}".format(total_polys),
             len(_CACHE_TAMANOS), _mb(sum(_CACHE_TAMANOS.values()))))
    print("-" * 100)
    print("%-7s %-32s %10s %12s %6s %9s %6s" %
          ("SCORE", "OBJETO", "POLYS", "MODS(coste)", "INST", "TEX(MB)", "GRUPO"))
    print("-" * 100)

    for f in fichas[:top]:
        marca = " [XREF]" if f["es_xref"] else ""
        print("%-7.1f %-32s %10s %5d(%5.1f) %6d %9.1f %6d%s" % (
            f["score"], f["nombre"][:32], "{:,}".format(f["polys"]),
            f["num_mods"], f["coste_mods"], f["num_instancias"],
            _mb(f["bytes_tex"]), f["prof_grupo"], marca))

        for s in f.get("sugerencias", [])[:3]:
            print("        -> [P%5.1f | riesgo %d] %s" % (s["prioridad"], s["riesgo"], s["accion"]))
            print("           %s" % s["motivo"])
    print("=" * 100)
    print("apply_highlight()  -> resalta en rojo los %d peores" % TOP_POR_DEFECTO)
    print("clear_highlight()  -> restaura todo")
    print("")


# =============================================================================
# 8. PUNTO DE ENTRADA
# =============================================================================

def run_audit(top=20):
    """Analiza la escena. SOLO LECTURA: no modifica ni un byte de la escena."""
    global SPT_ULTIMO_ANALISIS

    _CACHE_TAMANOS.clear()
    _CACHE_MATERIAL.clear()

    fichas = escanear_escena()
    fichas = calcular_scores(fichas)
    fichas = generar_sugerencias(fichas)

    SPT_ULTIMO_ANALISIS = fichas
    imprimir_informe(fichas, top=top)
    return fichas


if __name__ == "__main__":
    run_audit()

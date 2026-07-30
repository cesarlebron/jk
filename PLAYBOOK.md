# Cómo esta herramienta produce $200

Empiezo por lo honesto: **no puedo transferirte dinero.** No tengo cuentas, ni
forma de cobrarle a nadie, y el contenedor donde corro se borra al terminar.
Cualquiera que te diga lo contrario te está vendiendo humo.

Lo que sí puedo hacer es construirte algo que produzca los $200 con trabajo
tuyo — y dejarte medido, con números verificables, cuánto rinde cada camino y
qué te cuesta en tiempo. Eso es lo que hay abajo, ordenado por lo que rinde
primero.

---

## Camino 1 — Cobrar bien la próxima cotización (el más rápido, y no requiere un cliente nuevo)

Este es el que te da los $200 **sin conseguir un solo cliente adicional**.

Si vienes calculando la ganancia multiplicando el costo (markup), estás
cobrando menos de lo que crees. La diferencia contra el margen real no es una
opinión, es una identidad aritmética:

```
diferencia = costo × margen² / (1 − margen)
```

| Tu margen objetivo | Ganas de más | Tamaño de obra donde ya son $200 |
|---|---:|---:|
| 15 % | 2.65 % del costo | $7,556 |
| 20 % | 5.00 % del costo | $4,000 |
| **25 %** | **8.33 % del costo** | **$2,400** |
| 30 % | 12.86 % del costo | $1,556 |
| 35 % | 18.85 % del costo | $1,061 |

*(Verificado contra el motor de cálculo del repo — `compararMargenMarkup()` en
`src/calc.js`, con pruebas en `tests/calc.test.js`.)*

**Qué hacer:** deja el selector en *Margen sobre la venta* (ya viene así) y
cotiza normal. En una remodelación con $2,400 de costo y 25% de objetivo, esa
sola cotización vale **$200 más** que como la venías haciendo.

- **Tiempo:** 0 minutos extra. Es la configuración por defecto.
- **Riesgo:** que el precio te saque de mercado. Por eso el panel te muestra
  siempre el punto de equilibrio: sabes exactamente hasta dónde puedes bajar.

---

## Camino 2 — Cotizar el mismo día

En obra residencial pequeña, quien cotiza primero gana desproporcionadamente.
No porque sea más barato, sino porque el cliente ya se cansó de esperar a los
otros tres.

**Qué hacer:** guarda `dist/cotizador.html` en el celular. Cuando alguien te
pida un precio, cotizas ahí mismo, parado en el sitio, y le mandas el PDF antes
de irte. Sin señal, sin abrir la laptop.

- **Rinde:** una obra pequeña adicional al mes. Con $2,000 de venta al 25% de
  margen son **$500**.
- **Tiempo:** 10–15 minutos por cotización, una vez calibrado el catálogo.
- **Requisito:** dedicar **30 minutos, una sola vez**, a corregir las partidas
  que más usas con tres facturas recientes de tu ferretería. Si te saltas esto,
  cotizas con precios que no son los tuyos y el resto no sirve.

---

## Camino 3 — Cobrar por cotizar

Muchos contratistas y maestros constructores no saben presupuestar y lo saben.
Una cotización presentable, con partidas desglosadas y condiciones escritas,
es un entregable que se paga.

**Qué hacer:** ofrece "te preparo el presupuesto formal de tu obra" a $50–$75.
Con la herramienta te toma 20 minutos. **3–4 clientes = $200.**

- **Rinde:** $200 con 3–4 encargos.
- **Tiempo:** ~20 min cada uno.
- **Dónde:** los maestros y contratistas que ya conoces del gremio y de la
  ferretería. No necesitas anunciarte en ningún lado.

---

## Camino 4 — Vender la herramienta

El repo es MIT: puedes venderlo. Otros contratistas tienen exactamente tu mismo
problema.

**Qué hacer:** véndelo a **$25** con el catálogo ya calibrado a los precios de
tu zona (eso es lo que de verdad vale, no el software). **8 ventas = $200.**

- **Rinde:** $200 con 8 ventas.
- **Tiempo:** es el camino más lento. Requiere distribución, y la distribución
  es el trabajo difícil, no el producto.
- **Sé realista:** es el de menor probabilidad a corto plazo. Lo listo de
  último a propósito.

---

## Lo que yo ya hice, y lo que te toca

**Hecho y verificado:**

- Motor de cálculo con margen real, desperdicio, gastos generales, imprevistos,
  impuesto y anticipo — 42 pruebas automatizadas en verde, incluidas pruebas
  end-to-end en un navegador real.
- Catálogo de 48 partidas de obra con búsqueda por palabras sueltas.
- Documento imprimible profesional que **nunca** filtra tus costos al cliente.
- Empaquetado en un archivo único de 65 KB que funciona sin internet.
- Página de presentación lista para publicar gratis en GitHub Pages.

**Te toca a ti** (nadie lo puede hacer por ti, y sin esto lo demás no rinde):

1. **30 minutos** calibrando el catálogo con tus facturas reales.
2. Llenar los datos de tu empresa una vez.
3. Cotizar todo lo que te pidan, el mismo día.

El Camino 1 no necesita nada de esto para empezar a rendir: ya está activo por
defecto en la próxima cotización que hagas.

---

## Publicar la página gratis

En GitHub: **Settings → Pages → Source: `main` (o la rama de trabajo) → `/root`**.
Queda en `https://<tu-usuario>.github.io/jk/` sin costo. La página funciona
igual abierta como archivo local, si prefieres no publicarla.

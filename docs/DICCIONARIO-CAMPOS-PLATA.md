# Diccionario de Campos de Plata — Shipro 2.0

> **Qué es esto:** el mapa completo de todos los campos de dinero del sistema — cómo se llaman, qué significan **de verdad** (según cómo el código los usa, no según su nombre), y dónde el nombre o el comentario **engañan**.
>
> **Por qué existe:** a lo largo del tiempo varios campos fueron reinterpretados, y sus nombres dejaron de coincidir con su significado real. Eso genera confusión recurrente al tocar plata. Este documento es la fuente única de verdad del vocabulario, para que todos los chats hablen el mismo idioma.
>
> **Cómo leerlo:** cada campo tiene su significado real y una marca de si **engaña** (⚠️) o es fiel (✅). Al final, los mismatches están agrupados por tipo de arreglo.
>
> **Estado:** foto inicial tomada en el commit `ebe88df` (2026-08-28). Se actualiza **incrementalmente** a medida que los renames se ejecutan (uno por sesión, principio Nacho). Primer rename ejecutado: `precioFactura → tarifaFullCotizada` (commit `a8cda53`, 2026-08-30) — ver [[DEUDA 158]] para el checklist de renames pendientes.

---

## Principio rector

> Cada campo de plata se nombra según su **ROL REAL** — lo que HACE, no lo que alguien creyó que hacía al nombrarlo. Los renames se hacen de a UN campo por sesión, con recon + verificación money-safe, nunca en lote. (Nacho, 2026-08-28.)

Este principio gobierna las decisiones de este documento: cuando un nombre y un rol divergen, gana el rol. Los mismatches se corrigen por prioridad de blast radius (el que engaña al usuario primero, después el que engaña al programador, después los fantasmas), pero SIEMPRE con la disciplina de un-campo-por-sesión.

---

## Cómo se agrupan los problemas

Los campos que engañan caen en **tres grupos**, y cada uno se arregla distinto:

- **Grupo 1 — Engañan al USUARIO** (lo ve en pantalla y decide mal). Los más urgentes. Requieren renombrar label + a veces mover el campo.
- **Grupo 2 — Engañan al PROGRAMADOR** (el comentario del campo miente sobre lo que hace). Se arreglan **barato**: corregir el comentario. Cero riesgo.
- **Grupo 3 — Campos FANTASMA** (existen en la base pero nadie los usa). Confunden por estar ahí sin función. Se limpian aparte.

---

## Las cinco variables de plata del negocio (modelo confirmado por Nacho)

Antes de la tabla, el modelo mental correcto — las cinco variables reales de un envío y dónde vive cada una:

| # | Variable de negocio | Campo real | ¿Existe? |
|---|---------------------|-----------|----------|
| 1 | **Cotización virtual full al cliente** (lo que Shipro cotiza al crear el envío, con peso/dims declarados) | `tarifaFullCotizada` (ex-`precioFactura`, `@map`; congelado al alta) | ✅ |
| 2 | **Facturado real full al cliente** (post-liquidación, con el costo real del courier) | **NO existe como campo** — es la suma `tarifaFullCotizada + costoAforo`, calculada al liquidar | ⚠️ derivado |
| 3 | **Costo del courier — cotizado** (tarifa cruda al crear la etiqueta, forma nativa) | `costoCourierNativo` (ex-`precioProveedor`, `@map`, commit `09f3ca4`) → copia en `costoCourierCotizado` (ex-`costoCourierEsperado`, `@map`) → `costoCourierFacturado`. **Familia lifecycle** de 3 miembros. | ✅ |
| 4 | **Costo del courier — realmente facturado** (lo que vino en el Excel del courier) | `costoCourierFacturado` | ✅ |
| 5 | **Ajuste del cliente a su comprador** (el descuento buyer-facing) | `descuentoClienteAplicado` | ✅ |
| — | **Precio publicado al comprador** (checkout, con el ajuste del cliente) | `precioMostrado` (post-DEUDA 156) | ✅ |

**Las dos fugas que estas variables permiten medir:**

- **Fuga cotizado vs. facturado (courier):** variable 3 vs. variable 4 → mide el desvío por peso/dimensiones. **Sin** el ajuste del cliente. Hoy medible con `costoCourierFacturado − costoCourierCotizado` (ex-`costoCourierEsperado`).
- **Fuga publicado vs. facturado:** (variable 1 ± ajuste del cliente) vs. variable 2 → mide contra lo que el comprador realmente vio publicado.

> **Nota crítica sobre `tarifaFullCotizada`** (ex-`precioFactura`, renombrado 2026-08-30 commit `a8cda53`): NO se actualiza al importar la liquidación del courier. Queda **congelada en la cotización del alta**. El desvío por aforo se guarda aparte en `costoAforo`, y el total real al cliente es la **suma de los dos** (`tarifaFullCotizada + costoAforo`), calculada en la liquidación mensual. Esta es una decisión de diseño deliberada (documentada en `conciliacion/route.ts` L145-152), no un bug.

---

## Tabla maestra — FinanzasEnvio

Los campos de plata del envío. La zona con más problemas.

| Campo | Comentario actual | Significado REAL | ¿Engaña? | Grupo |
|-------|-------------------|------------------|----------|-------|
| `precioMostrado` | "Lo que el comprador vio en el checkout" | Post-156: precio buyer-facing **con descuento**. El comentario siempre fue correcto; el problema es que 4 lectores lo usaban como si fuera el facturado. | ⚠️ (por los lectores) | 1 |
| `tarifaFullCotizada` (ex-`precioFactura`, `@map`) | "Tarifa full COTIZADA y debitada AL ALTA (congelada; no se actualiza en conciliación)." | Cotización virtual **congelada al alta**. NO es el facturado real. El real = `tarifaFullCotizada + costoAforo`. **Renombrado 2026-08-30 (commit `a8cda53`, `@map("precioFactura")` preserva columna física).** | ✅ (post-rename) | 1 ✓ |
| `porcentajePrecioFactura` | (sin comentario) | Ghost / ambiguo — sin usos detectados. | ⚠️ ambiguo | 3 |
| `valorDeclarado` | "Seguro de la mercadería (Terceros)" | El **valor** que declara el comprador (input), no el monto del seguro. El seguro real no se aplica hoy. | ⚠️ | 2 |
| `costoCourierNativo` (ex-`precioProveedor`, `@map`) | "Costo cotizado al crear la etiqueta" | ✅ **RENOMBRADO 2026-08-31 (`09f3ca4`, [[DEUDA 158]] avance 4/PAR)**. Tarifa cruda del courier en forma **nativa** (Andreani con IVA, Mocis sin) — no homogénea entre couriers. Miembro "nativo" de la familia lifecycle `costoCourierNativo → costoCourierCotizado → costoCourierFacturado`. El DTO del cotizador (`OpcionTarifa` + return de `aplicarMarkup`) también se renombró; el JSON key `"precioProveedor"` en `CotizacionSnapshot.opcionesSnapshotJson` (write-only forensic log) se conserva como bridge. | ✅ (post-rename) | 1 ✓ |
| `costoCourierCotizado` (ex-`costoCourierEsperado`, `@map`) | "Costo COTIZADO por el courier al crear la etiqueta (copia de precioProveedor, forma nativa; NO recalculado por aforo). Par con costoCourierFacturado (cotizado vs facturado)." | **Copia** de `precioProveedor`, sin recalcular por aforo. Par cotizado/facturado con `costoCourierFacturado`. **Renombrado 2026-08-31 (commit `0b1f6b0`, `@map("costoCourierEsperado")`).** El snapshot JSON de `ConciliacionRun` (undo path) conserva la key vieja `"costoCourierEsperado"` como bridge — backward-compat con snapshots existentes. | ✅ (post-rename) | 1 ✓ |
| `costoCourierFacturado` | "Lo que REALMENTE vino en el Excel del courier" | Fiel — el costo real del Excel del courier. | ✅ | — |
| `estadoAuditoria` | "OK, DOBLE_COBRO, SOBREPRECIO_RECLAMAR" | Fiel. Marca si el envío ya se concilió (≠ PENDIENTE). | ✅ | — |
| `facturaCourierRef` | "Escudo anti-UPS (FC-0001-9992)" | Fiel — referencia del Excel para evitar doble cobro. | ✅ | — |
| `pesoCobrado` | "Peso cotizado inicialmente" | Fiel. | ✅ | — |
| `pesoAforado` | "Peso real facturado a fin de mes" | Fiel. Null hasta conciliar. | ✅ | — |
| `costoAforo` | "Diferencia monetaria del desvío cobrada al cliente" | Fiel — el delta que se le cobra al cliente por el aforo (Rama A, subió peso). | ✅ | — |
| `fugaFinanciera` | "Diferencia $ vs la mejor opción" | Fiel — mide si se eligió un courier más caro habiendo uno más barato (routing). | ✅ | — |
| `courierSugerido` / `servicioSugerido` | "El más barato para esta modalidad" | Fiel. | ✅ | — |
| `tarifaCourierBaseNeta` (ex-`tarifaCourierBase`, `@map`) | "lo que devolvió la API cruda" | ✅ **RENOMBRADO 2026-08-31 (`f2ae054`, [[DEUDA 158]] avance 5)**. Es la tarifa del courier **NORMALIZADA A NETO** (= `desglose.secoNeto`; se le quita el IVA si el courier lo traía). **Distinta de `costoCourierNativo`** (forma nativa cruda): en Andreani (IVA-inclusive) divergen (1210 vs 1000), en Mocis coinciden por venir ya neto. Los dos son necesarios: `costoCourierNativo` para conciliación (contra Excel del courier); `tarifaCourierBaseNeta` como base HOMOGÉNEA cross-courier del pricing cascade. | ✅ (post-rename) | — |
| `markupIntermediarioPorcentajeAplicado` (ex-`markupIntermediarioAplicado`, `@map`) | "el +% + fijo del intermediario" | ✅ **RENOMBRADO 2026-08-31 (`14407dc`, [[DEUDA 158]] avance 6)**. Guarda **SOLO** el monto ($ neto) del componente **porcentual** aplicado (`= baseConIntermediario − secoNeto`), Rama A. El componente fijo del intermediario es **N/A permanente** (Nacho confirmó 2026-08-31 — nunca va a existir) → sufijo `Porcentaje` es **definitivo**. Rama B/fallback → null. Feed colateral a [[DEUDA 160]]: `seguroFijoIntermediarioConIva` pasa a ghost DEFINITIVO. | ✅ (post-rename) | — |
| `smoAplicado` (ex-`seguroAplicado`, `@map`) | "el seguro que terminó en el precio" | ✅ **RENOMBRADO 2026-08-31 (`26855dc`, [[DEUDA 158]] avance 3/N)**. Nombre honesto: es el **SMO** (Seguro Mínimo de Shipro), no seguro de mercadería ni del courier real (esa feature es la nueva [[DEUDA 163]] "seguro-courier-activable"). | ✅ | — |
| `descuentoClienteAplicado` | "el descuento/recargo del cliente (con signo)" | Post-156: siempre **≥ 0** (piso $0). El "con signo" está desactualizado. | ⚠️ | 2 |
| `baseConIntermediarioAplicado` (ex-`precioProveedorReal`, `@map`) | "base + markup intermediario. La conciliación lo prefiere." | ✅ **RENOMBRADO 2026-08-31 (`09f3ca4`, [[DEUDA 158]] avance 4/PAR)**. Contenido: `= secoNeto × (1 + intermediarioMarkupPorcentaje/100)` (courier neto + markup % intermediario). Audit-trail DEUDA 153; la conciliación **NO lo lee** (usa `costoCourierNativo`, ex-`precioProveedor`). Se renombró junto con su par para eliminar la ambigüedad de "proveedor" (courier físico vs "quien Shipro paga"). | ✅ (post-rename) | — |
| `ramaCongelada` | "true=Rama B, false=Rama A" | Fiel. | ✅ | — |
| `feeNetoFacturado` | "Fee Shipro NETO (sin IVA)" | Fiel. | ✅ | — |
| `logisticaNetaFacturada` | "Cascada + SMO, NETO" | Fiel. | ✅ | — |
| `ivaFacturado` | "IVA 21% sobre (feeNeto + logisticaNeta)" | Fiel. | ✅ | — |
| `estadoLiquidacionFee` / `...Logistica` | Enum EstadoLiquidacion | Fiel. | ✅ | — |
| `periodoLogistica` | "YYYY-MM de la factura del courier" | Fiel. | ✅ | — |

---

## Tabla — CredencialCourier (configuración que alimenta la cotización)

| Campo | Comentario / Label UI | Significado REAL | ¿Engaña? | Grupo |
|-------|----------------------|------------------|----------|-------|
| `ajusteTarifaPorcentaje` | Comentario: "Markup en %" / **UI: "Recargo/Descuento (Tu Tienda)"** | Override del **markup de Shipro** por cliente↔courier. NO es un descuento del cliente. Los negativos se ignoran en silencio. | ⚠️⚠️⚠️ triple | 1 |
| `markupFijo` | "Fee fijo por paquete" / UI: "Costo Fijo Adicional" | Markup **fijo de Shipro**, no el Fee de plataforma (`OperacionFee`). Colisión del término "Fee". | ⚠️ | 1 |
| `quiereSeguroCourier` | "el cliente elige seguro courier vs mínimo" | Ghost — el pipeline no lo lee. | ⚠️ | 3 |
| `descuentoClienteSobreTarifa` | "MONTO fijo $ buyer-facing, piso $0" | Fiel (post-156). | ✅ | — |
| `descuentoClientePorcentaje` | "% buyer-facing" | Fiel (post-156). | ✅ | — |
| `descuentoClienteModo` | "MONTO \| PORCENTAJE" | Fiel (post-156). | ✅ | — |
| `tarifaPlanaRespaldo` | "Ningún reader lo consume ya; drop en cleanup" | Muerto — reemplazado por el per-courier. | ✅ (ya marcado) | 3 |
| `tarifaPlanaRespaldoCourier` | "tarifa de rescate POR courier" | Fiel. Obligatoria para activar el courier. | ✅ | — |

> **El mislead más visible al usuario:** la sección **"3. Ajuste Comercial (Tu Tienda)"** en `/configuracion/transportes` dice "Tu Tienda" (sugiere que es del cliente), pero sus tres campos son config de **Shipro**. Es la raíz de la DEUDA 154 y el objetivo de la DEUDA 157 (mover a admin).

---

## Tabla — CourierIntermediario

| Campo | Comentario | Significado REAL | ¿Engaña? | Grupo |
|-------|-----------|------------------|----------|-------|
| `markupPorcentaje` | "% que el DUEÑO cobra por prestar credenciales" | Fiel. | ✅ | — |
| `seguroFijoIntermediarioConIva` | "Se guarda CON IVA" — pero el seed dice "SIN IVA, nombre a corregir" | Ghost + el nombre **contradice** al seed. | ⚠️ | 3 |
| `tarifaIncluyeIvaIntermediario` | "si la tarifa del intermediario incluye IVA" | Ghost — no consumido. | ⚠️ parcial | 3 |

---

## Tabla — Otros modelos (mayormente limpios)

| Campo | Modelo | Significado REAL | ¿Engaña? |
|-------|--------|------------------|----------|
| `saldoActivo` | Empresa | Saldo actual de la cuenta. | ✅ |
| `limiteDescubierto` | Empresa | Cuánto se le permite adeudar. | ✅ |
| `smoActivo` / `smoPrecioAlClienteConIva` | Courier | **Legacy** — el motor ahora lee de `SmoCourier`. Espejo hasta terminar la migración. | ✅ (documentado) |
| `valorNeto` | SmoCourier | SMO neto por courier (sin IVA). | ✅ |
| `valorPorcentaje` | MarkupShiproVigencia | Markup de Shipro **global** (%). | ✅ |
| `tipo` + `valor` | OperacionFee | El Fee de plataforma (FIJO en $ o PORCENTAJE). | ✅ |
| `porcentaje` | AjusteMasivoFee | Registro de ajustes masivos del Fee (event log). | ✅ |
| `monto` / `saldoPosterior` | MovimientoFinanciero | Movimiento (con signo) + foto del saldo. | ✅ |
| `montoTotal` | LiquidacionMensual | Total de la liquidación del mes. | ✅ |
| `precio` | HistoricoCotizaciones | Precio crudo del courier (sin markup ni IVA). | ✅ |

---

## Resumen de mismatches por grupo (para decidir qué arreglar)

### Grupo 1 — Engañan al USUARIO (urgentes, requieren renombrar/mover)
1. **`ajusteTarifaPorcentaje`** con label "Recargo/Descuento (Tu Tienda)" → es el markup de Shipro. *(DEUDA 154 / 157)*
2. **Sección "3. Ajuste Comercial (Tu Tienda)"** → contiene config de Shipro, no del cliente. *(DEUDA 157)*
3. **`markupFijo`** "Costo Fijo Adicional" → markup fijo de Shipro. *(DEUDA 157)*
4. **`precioMostrado`** leído como facturado en dashboard/export/rastreo → muestra el descontado post-156. *(el fix que disparó este diccionario)*

### Grupo 2 — Engañan al PROGRAMADOR (baratos: corregir el comentario)
5. ~~`precioFactura`~~ → **RENOMBRADO** a `tarifaFullCotizada` (commit `a8cda53`, 2026-08-30, [[DEUDA 158]] avance 1/N).
6. `descuentoClienteAplicado` → quitar "con signo" (es piso $0).
7. ~~`costoCourierEsperado`~~ → **RENOMBRADO** a `costoCourierCotizado` (commit `0b1f6b0`, 2026-08-31, [[DEUDA 158]] avance 2/N). Par cotizado/facturado con `costoCourierFacturado`.
8. ~~`markupIntermediarioAplicado`~~ → **RENOMBRADO** a `markupIntermediarioPorcentajeAplicado` (commit `14407dc`, 2026-08-31, [[DEUDA 158]] avance 6). Sufijo `Porcentaje` DEFINITIVO — el fijo intermediario es N/A permanente (Nacho confirmó).
9. ~~`seguroAplicado`~~ → **RENOMBRADO** a `smoAplicado` (commit `26855dc`, 2026-08-31, [[DEUDA 158]] avance 3/N). El "seguro del courier real" (cobertura sobre mercadería activable por el cliente) es feature nueva pendiente — ver [[DEUDA 163]].
10. ~~`precioProveedorReal`~~ → **RENOMBRADO** a `baseConIntermediarioAplicado` (commit `09f3ca4`, 2026-08-31, [[DEUDA 158]] avance 4/PAR). Renombrado junto con su par `precioProveedor → costoCourierNativo` (compartían la palabra ambigua "proveedor").
11. ~~`tarifaCourierBase`~~ → **RENOMBRADO** a `tarifaCourierBaseNeta` (commit `f2ae054`, 2026-08-31, [[DEUDA 158]] avance 5). Sufijo `Neta` distingue de `costoCourierNativo` (forma nativa cruda) — dos fields con propósitos distintos, no redundantes.
12. `valorDeclarado` → aclarar que es el valor declarado, no el monto del seguro.
13. ~~`precioProveedor`~~ → **RENOMBRADO** a `costoCourierNativo` (commit `09f3ca4`, 2026-08-31, [[DEUDA 158]] avance 4/PAR). Familia lifecycle: `costoCourierNativo → costoCourierCotizado → costoCourierFacturado`. Bridge JSON key en `CotizacionSnapshot`. *(cruza con DEUDA 152 en la parte de IVA no-homogénea cross-courier).*

### Grupo 3 — Campos FANTASMA (limpiar aparte)
14. `porcentajePrecioFactura` — sin usos.
15. `quiereSeguroCourier` — pipeline no lo lee.
16. `seguroFijoIntermediarioConIva` — ghost + nombre contradice al seed. **UPGRADE 2026-08-31:** Nacho confirmó que el markup fijo del intermediario NO va a existir nunca → **ghost DEFINITIVO** (candidato firme de drop en [[DEUDA 160]]).
17. `tarifaIncluyeIvaIntermediario` — ghost.
18. `tarifaPlanaRespaldo` — muerto (reemplazado por el per-courier).
19. `Courier.smoActivo` / `smoPrecioAlClienteConIva` — legacy (motor lee `SmoCourier`).

---

## Orden recomendado de acción

- **FASE 0 — Fix operator surfaces (dashboard + export + rastreo)** — ✅ **HECHA 2026-08-28 (commit `60d2792`)**. Los 3 displays operator (Excel export, tabla dashboard main, rastreo manual response) ahora leen `precioFactura` en vez de `precioMostrado`. El buyer en checkout Tiendanube sigue viendo el descuento (`precioFinalBuyer`).
- **FASE 1 — Grupo 2 (comentarios honestos)** — ✅ **HECHA 2026-08-28 (commit `3ba633a`)**. 12 fields + 1 block comment en `prisma/schema.prisma` con comentarios que dicen la verdad del rol real. Sin renames, sin cambio de tipos ni lógica.
- **FASE 2 — Métricas de fuga (`perdidaReal` + `fugaPesos`)** — ⏳ pendiente. Rediseñar la fórmula (contaminadas por el descuento del cliente post-DEUDA-156). Registrada como **[[DEUDA 159]]**. DECISIÓN DE NEGOCIO PENDIENTE de Nacho: qué mide cada métrica (fuga courier real vs fuga publicado-vs-facturado).
- **FASE 3 — Grupo 1 (renames por rol)** — 🚧 **RENAMES LIVIANOS COMPLETOS 2026-08-31; entangled restantes**. Registrada como **[[DEUDA 158]]** (uno por sesión, principio Nacho; el par proveedor/proveedorReal se hizo en un mismo commit por compartir la ambigüedad). Avance: **7/N campos** — ✅ `precioFactura → tarifaFullCotizada` (commit `a8cda53`, 2026-08-30) + ✅ `costoCourierEsperado → costoCourierCotizado` (commit `0b1f6b0`, 2026-08-31, con bridge snapshot JSON undo-safe) + ✅ `seguroAplicado → smoAplicado` (commit `26855dc`, 2026-08-31, @map, blast mínimo) + ✅ PAR `precioProveedor → costoCourierNativo` + `precioProveedorReal → baseConIntermediarioAplicado` (commit `09f3ca4`, 2026-08-31, @map, con bridge JSON en `CotizacionSnapshot`, DTO cotizador renombrado) + ✅ `tarifaCourierBase → tarifaCourierBaseNeta` (commit `f2ae054`, 2026-08-31, @map) + ✅ `markupIntermediarioAplicado → markupIntermediarioPorcentajeAplicado` (commit `14407dc`, 2026-08-31, @map, sufijo `Porcentaje` DEFINITIVO). **HITO 2026-08-31:** los renames livianos del audit-trail COMPLETOS. Restantes son TODOS entangled (0 standalone): `valorDeclarado → valorDeclaradoComprador` (coord. con [[DEUDA 163]] si se implementa seguro-courier), `markupFijo` + `ajusteTarifaPorcentaje` (ambos parte del rediseño markup Shipro en [[DEUDA 157]]). Se renombran cuando esas obras se ejecuten, no antes. **POLICY CORRECTION 2026-08-31:** el criterio "engaña poco → saltar" fue REVERTIDO. Feed colateral a [[DEUDA 160]]: `seguroFijoIntermediarioConIva` ahora ghost DEFINITIVO.
- **FASE 4 — Grupo 3 (limpiar fantasmas)** — ⏳ pendiente. Cleanup de campos ghost del schema. Registrada como **[[DEUDA 160]]**. Uno por uno con verificación previa.

> Renombrar campos que viven en la base de datos implica migración y toca lógica de plata: son obras con su propio cuidado, una por vez, nunca todas juntas.

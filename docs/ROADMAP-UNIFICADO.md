# Roadmap Unificado — Shipro 2.0

> **Documento operativo único.** Reconcilia el master de fases con el estado real de `DEUDAS.md` al **2026-07-24**.
> **Fuente de verdad detallada:** `DEUDAS.md` (números canónicos). Este board **cruza** — no reemplaza.
> **Complementa a:** `docs/COMERCIALIZACION-CHECKLIST.md` (foco pre-lanzamiento, algo desactualizado).

---

## Estado general (fecha 2026-07-24)

FASE 1 (precios y motor de plata) está **casi cerrada**: la fórmula rama-aware, la conciliación aforo↔virtual y la
liquidación en dos vías (Fee vs Logística) están vivas y verificadas al centavo. Lo que queda de FASE 1 es el
**cobro mensual real** en la billetera (hoy la liquidación es documento, no movimiento) — tres pasos concretos
detallados abajo. Con eso cerrado, se abre el portón para desplegar y recién entonces sumar plugins (FASE 3) y
más couriers (FASE 2). Deploy y sumar plugins son eventos separados: primero desplegar el motor firme, después
exponerlo.

---

## Las tres fases

### FASE 1 — Precios y motor de plata  [estado: casi cerrada]

**Hecho (esta sesión).**

- **DEUDA 73 — Fórmula de precio ✅ FASE 1** — cascada intermediario+Shipro sobre netos, SMO por courier,
  Fee neto, IVA una vez al final, débito rama-aware. Commits `8d40f58` (IVA policy), `996142f` (fórmula FASE 1),
  `d850272` (débito rama-aware), `d623b9d` (aforo/conciliación), `0d6fd7b` (dos-vías).
- **DEUDA 107 — Markup intermediario ✅ RESUELTA** — modelo `CourierIntermediario` + cascada + desglose
  persistido; conciliación distingue esperado vs anomalía. Commits `996142f`, `0d6fd7b`.
- **DEUDA 10 — Modelo B fallback ✅ NÚCLEO RESUELTO** — `OperacionFee` + `calcularFeeOperacion` + Fee dentro
  de la tarifa publicada de ambas ramas. Cierra el último pendiente de FASE 2 del CHECKLIST.
- **DEUDA 79 — Fee en desbloqueo ✅ RESUELTA POR REFACTOR** — el Fee ahora va dentro de `precioFactura` en un
  solo `DEBITO_ENVIO`; los `procesar-bloqueados*` heredan el `precioFactura` autoritativo → la premisa vieja
  (un `DEBITO_OPERACION_FEE` separado replicado en tres archivos) desapareció.
- **DEUDA 75 — Conciliación aforo↔virtual ⚠ PARCIAL** — el mecanismo está construido (costoAforo,
  estadoAuditoria, pesoAforado, facturaCourierRef, undo con snapshot, dos-vías); PENDIENTE el barrido de 6 meses
  para las etiquetas nunca recolectadas (ver PASO 3 abajo).

**Restante — el cobro de fin de mes en 3 pasos.** Los tres son movimientos reales en la billetera. Hoy la
liquidación es documento (`LiquidacionMensual` sin `MovimientoFinanciero` asociado). Ninguno existe todavía:

- **PASO 2 — Convertir las proformas en movimientos reales en la cuenta.** Escribir un
  `MovimientoFinanciero` por proforma cerrada (una entrada por vía Fee o Logística), tanto para POSTPAGO como
  para el ajuste PREPAGO de fin de mes cuando la liquidación difiere de lo debitado durante el mes. Requiere un
  `tipo` nuevo (candidatos: `DEBITO_LIQUIDACION_FEE` / `DEBITO_LIQUIDACION_LOGISTICA` / `AJUSTE_FIN_MES`).
- **PASO 3 — Barrido 6 meses: devolver logística reteniendo el Fee.** Cron que barre envíos Rama A con
  `estadoLiquidacionLogistica=PENDIENTE` + `fechaImpresion < now-6m` + sin `facturaCourierRef`. Marca
  `logisticaDevuelta=true`, escribe un `MovimientoFinanciero` de crédito por la logística (Fee retenido) y libera
  la vía a `REEMBOLSADO` (o equivalente). Cierra el resto de DEUDA 75.
- **PASO 4 — Re-débito de factura tardía sobre envío ya devuelto.** Si después del reembolso llega una factura
  del courier por ese mismo envío, re-debitar la logística y disputar contra el courier. Requiere reconocer el
  estado `REEMBOLSADO` en `/api/conciliacion` y ramificar (hoy la conciliación asume envíos vivos).

**Follow-ups menores de FASE 1 (no bloqueantes, no bloquean el cobro mensual):**

- **DEUDA 73** — descuento del cliente con signo (paso 6 del modelo, capa cliente→comprador); rename cosmético
  `seguroFijoIntermediarioConIva` → sin-IVA (schema); política de seguro por-courier (flag `quiereSeguroCourier`
  en schema pero adapters aún no lo consumen).
- **DEUDA 107** — UI admin para editar el intermediario por-courier (hoy manual en DB); el fallback
  `resolverPrecioFallback` no reconstruye la cascada (documentado como GAP en `crear.ts`).

---

### FASE 2 — Integrar más couriers  [después de FASE 1]

Sumar couriers ANTES de cerrar la fórmula multiplica el problema (cada adapter nuevo pisa el motor de plata a
mitad de refactor). Por eso este bloque va después de FASE 1.

- **DEUDA 91 — Cablear catálogo `ServicioCourier` al runtime de cotización.** Es la LLAVE DE ESCALABILIDAD:
  hoy los adapters devuelven strings crudos sin cruzar contra el catálogo, y Moci's cotiza "sucursal" que no
  ofrece (rompe envíos). Bloqueante parcial: sub-tarea M-1 (service IDs Same/Next Day de Moci's).
- **DEUDA 93 — Recolección tarifada del courier recolector.** Servicio con credenciales de Shipro (no del
  cliente), Shipro refactura al cliente. Bloqueada por respuesta de Moci's (preguntas listas para mandar).
- **DEUDA 71 — Guardar credenciales del courier al finalizar el wizard.** Hoy el paso 4 del wizard activa
  couriers sin persistir credenciales; el cliente llega al dashboard con couriers "activos" sin credenciales
  válidas. Medio scope, prerequisito de onboarding self-service masivo.

---

### FASE 3 — Plugins / API externa  [después de FASE 1; puede ir en paralelo a FASE 2]

Un plugin CREA envíos → entra por `crear.ts` (motor de plata). Por eso FASE 1 tiene que estar firme antes de
exponer la API externa.

- **DEUDA 105 — `/api/envios/cancelar` es solo-sesión.** Habilitarlo con API key (agregar a `DUAL_EXACT` en
  `proxy.ts`) + confirmar aislamiento per-empresa. Chico. Nota: fechas ISO al responder por API son parte del
  polish de contrato de plugins que se hace acá.
- **DEUDA 58 + DEUDA 104 (parte snapshot) — `CotizacionSnapshot` REDIMENSIONADA.** Decisión Nacho (chat V2): el
  snapshot NO es "precio congelado para facturar" — el courier factura lo que ve, no lo que se cotizó. El
  snapshot sirve como (a) tracking de conversión del embudo del checkout y (b) métrica publicado-vs-facturado.
  Sin consumer hoy; lo abre la Fase 3 al persistir con ID de carrito. Cruza con DEUDA 111.
- **DEUDA 103 — Multi-bulto + dimensiones en `POST /api/envios`.** Hoy solo `pesoReal` escalar; falta
  `paquetes[]` con dimensiones + `fragil` + `contenido`. Sin esto, el peso volumétrico factura distinto al
  cotizado (descalce de plata) y solo se soporta 1 caja por envío. Prerequisito de contrato de plugin serio.
- **Docs OpenAPI + primer plugin.** UNO solo primero (Tiendanube o Mercado Libre). No dispersar antes de
  aprender del primero.

**FASE 3b (futura, solo si va a marketplace oficial):**

- **DEUDA 104 — Webhooks salientes (Shipro → e-commerce).** Modelo `Webhook` + despachador con firma HMAC +
  cola de reintentos. Es el gap más grande para plugins de nivel marketplace, pero no bloquea un plugin
  self-installed que consulte por polling contenido al inicio.

---

## El portón: deploy antes de que entren plugins

Un plugin es una compuerta de tráfico externo hacia el motor de plata. Hay que blindar la caja antes de abrirla:

- **FASE 1 desplegada a producción 2026-07-30 (commit `b11f7f8`).** ✅ pm.shipro.pro corre ahora la fórmula
  rama-aware (IVA una sola vez, cascada intermediario+Shipro, SMO, Fee dentro de la tarifa) + el bloque completo
  de conciliación atómica + barrido 6 meses + guard de factura tardía + escudo anti-doble-cobro fixed. 8
  migraciones FASE 1 aplicadas (de `20260722213730_conciliacion_run` a `20260729190642_drop_movimiento_liquidacion_vestigial`),
  `prisma migrate status` = "Database schema is up to date!". 8 empresas de test + 11 usuarios de test preservados
  intactos (0 envíos, 0 finanzas); snapshot pre-deploy tomado. Cotización real verificada contra Andreani + Mocis.
- **Purgar el histórico de Andreani (con IVA) antes de confiar en el fallback.** El fallback recompone precio con
  la política nueva SIN IVA; los datos históricos guardaron el número CON IVA (Andreani lo devolvía así). Si el
  fallback lee un histórico viejo, aplica IVA sobre un número que ya lo trae → 21% de más silencioso.
- **La columna que Prisma no dropea sin ayuda en no-interactivo.** El `migrate dev` interactivo blockea los
  drops que borran datos; en CI/CD hay que planear cada drop (usar `db execute` + `migrate resolve --applied`
  como se hizo en `20260724234413_drop_estado_liquidacion_viejo`). Documentar el patrón para deploy.
- **DEUDA 108 — Servidor viejo de Fran (beta.shipro.pro).** 5 clientes reales operando + sin firewall + logs
  con ataques SSH constantes. Acción: avisar a Fran para aplicar Cloud Firewall al server viejo.
- **DEUDA 109 — Limpiar pm viejo del server de Fran.** Sin apuro (el DNS ya apunta al server nuevo), pero
  liberar recursos cuando la plataforma nueva esté validada.
- **DEUDA 66 — Postgres migration** ✅ RESUELTA 2026-07-17 (Linode Managed PG16 en São Paulo).

---

## Deudas transversales relevantes (no encajan en una fase pero pesan)

- **DEUDA 87 — Aislamiento entre clientes (seguridad grande, 2026-07-03).** Auditoría transversal. Progreso
  parcial vía sus subfamilias (FAMILIA 3 ya cerró varias). Sigue abierta como paraguas.
- **DEUDA 106 — `/api/envios/corregir` es PUBLIC.** El tracking es la única llave; ATAQUE de enumeración fácil.
  Media, seguridad, no urgente pero bloquea la exposición pública de trackings.
- **DEUDA 18 — Acceso shipro a facturación de clientes.** Tier 2 pre-launch en el CHECKLIST. Habilita soporte
  real cuando aparezca el primer caso de disputa de conciliación.
- **DEUDA 110 — Motor de optimización de la propuesta logística (PRODUCTO — diferencial competitivo).** Va
  DESPUÉS de FASE 1 + 2 + 3. Se alimenta de datos reales y de DEUDA 111. Construirlo antes es un motor sin
  combustible.
- **DEUDA 111 — Capa de Inteligencia del Checkout (PRODUCTO — cimiento de datos).** La CAPTURA arranca con
  FASE 3 (el snapshot con ID de carrito se persiste desde el día uno del primer plugin), el análisis viene
  después. Alimenta a DEUDA 110.

---

## Cómo se relacionan los dos chats anteriores + esta sesión

- **Chat "Shipro 2.0 roadmap y próximos pasos"** — es el MASTER de las 3 fases (precios → couriers → plugins),
  con la lógica del portón (deploy) intercalada.
- **Chat "Plataforma Multicourier V2"** — es el DISEÑO DE ARQUITECTURA multicourier: `CotizacionSnapshot`,
  cobertura, 8 couriers investigados, la redimensión del snapshot como tracking-de-conversión (no como
  precio-congelado-para-facturar). Es la base técnica que FASE 2 y FASE 3 leen. Vive en
  `docs/ARQUITECTURA-MULTICOURIER.md`.
- **Esta sesión** — es la EJECUCIÓN de FASE 1: cinco commits (`8d40f58`, `996142f`, `d850272`, `d623b9d`,
  `0d6fd7b`) que cierran el motor de plata rama-aware, la conciliación aforo y las dos-vías de liquidación.
  Deja tres PASOS restantes de FASE 1 (cobro mensual) para las próximas sesiones.

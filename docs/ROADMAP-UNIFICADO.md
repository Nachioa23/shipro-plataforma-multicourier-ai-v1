# Roadmap Unificado — Shipro 2.0

> **Documento operativo único — living map, no session log.** Reescrito 2026-10-13 verificado contra código (post drift sweep).
> **Fuente de verdad detallada:** `DEUDAS.md` (abiertas) + `DEUDAS-RESUELTAS.md` (histórico). Este board **cruza**, no reemplaza.
> **El código es la fuente de verdad.** Si el registry y el código disienten, gana el código.

---

## META

Objetivo: **primer cliente real operando lo antes posible, con la plataforma probada bajo carga.**

El objetivo original (31-oct-2026) quedó atrás; la nueva ventana la fija Nacho según cuándo caiga el único bloqueante grande vivo (138 Fases B/C/D, stress-test) + la QA de couriers con credenciales reales. Shipro arranca con el primer cliente **sin ML**, **sin homologación formal Tiendanube**, **sin motor de reglas encendido** — todo eso es carril paralelo o post-cliente por diseño.

Visión que ancla cada decisión: **Shipro es una plataforma de datos.** Toda cotización, débito, cambio de estado, liquidación, evento del comprador final — alimenta el motor que diferencia a Shipro de las agregadoras logísticas convencionales. Lo que no se captura día 1 es histórico irrecuperable.

---

## ESTADO REAL POR CHAT (verificado contra código, 2026-10-13)

### CHAT A — Núcleo

**Pre-cliente de núcleo prácticamente despejado.** Lo money-critical ya aguanta:

- ✅ **DEUDA 185** cross-tenant Direccion — en prod 2026-10-08, 4 etapas (modelo `ContactoEmpresa` + write en `crear.ts` + read scoped en `/api/directorio` + LGPD opción B). Verificado con prueba Astelarra.
- ✅ **DEUDA 96** recuperación de contraseña — en prod 2026-10-08, 2 piezas (reset flow con token single-use 2h + invalidación de sesión OWASP via `passwordChangedAt`). Cierra **DEUDA 69** (audit `password_reset`).
- ✅ **DEUDA 138 Fase A** — en prod 2026-10-08: **DEUDA 131** (idempotencia atómica con catch `P2002`, commit `2e7e80f`) + **DEUDA 136** (saldo con decremento atómico `{increment}`/`{decrement}` en los 3 writers: `crear.ts` + `/admin/finanzas` + `conciliacion`, commit `206646b`). Lost-update bajo concurrencia cerrado.
- ✅ **DEUDA 186** motor de reglas + scoring — **blueprint maestro completo** (`docs/BLUEPRINT-MOTOR-REGLAS.md`, 10 secciones incluyendo §10 arquitectura de datos del scoring). Fase 1 diseño cerrada; Fases 2+3 pre-cliente (construcción oculta/shadow mode), Fase 4 post-datos.
- ✅ **Backlog reconciliado** 2026-10-13 — drift sweep encontró ~9 drifts: 133+144 enteras a RESUELTAS; 36.E Fase 4c/d y 138 Fase A marcadas hechas; status corregido en 39/111/104/130/143/180.

### CHAT B — Couriers / Adapters

- ✅ **Andreani, Mocis, Intralog** validados e2e en prod. Fase 1 Intralog activa.
- 🟡 **DEUDA 171** Correo Argentino 2 bugs (Bearer JWT auth + sucursales por provincia con fallback) — **CÓDIGO COMPLETO**, QA pendiente. Nacho ya consiguió credenciales testing + prod.
- 🟡 **DEUDA 147** switch sandbox/prod Andreani (+ Mocis) — **CÓDIGO COMPLETO** 2026-10-08 (commit `54b1f35`). QA pendiente con credenciales testing que Nacho ya tiene.
- ⬜ **OCA, Hop Envíos**: adapters construidos, nunca validados e2e por falta de credenciales.
- ⬜ **DEUDA 165** Hop inconsistencia BD↔registry (sucursal/retiro/drop-off).
- 🟡 **Pendiente César (Intralog)**: política de `tracking_transporte` con otros couriers (multi-recolector Fase 2 — **DEUDA 167**).

### CHAT C — Plugins / Tiendanube / WooCommerce

- ✅ **DEUDA 133** webhooks privacidad LGPD (4 handlers + HMAC centralizado) — RESUELTA 2026-10-13 (código completo, QA homologación pendiente, no bloquea).
- ✅ **DEUDA 144** rates callback Tiendanube (endpoint 300+ líneas + labels generate/cancel/download/admin-link + modelo `TiendaTiendanube` + Modo B wired + `CotizacionSnapshot` persistido) — RESUELTA 2026-10-13.
- ✅ **Install OAuth Tiendanube** completo (`install/link` + `oauth/callback` + `/tiendanube/instalado`).
- ✅ **WooCommerce** end-to-end validado en prod.
- 🟡 **DEUDA 130** homologación Tiendanube (paraguas) — PARCIAL. Piezas pendientes conocidas:
  - Máquina de estados de labels.
  - Tracking cap + carrier override.
  - `/generate` validación e2e.
  - Reunión de validación formal con Tiendanube (+ Nimbus+Nexo UI si aplica + NubeSDK si aplica).
- ⬜ **DEUDA 104 OUT** webhooks salientes genéricos Shipro→e-commerce — AUSENTE (grep `model Webhook` + dispatcher = cero). Único OUT existente es `lib/tiendanube/tracking-map.ts` específico a Tiendanube FFO.

### CHAT D — MEF (Mercado Envíos Flex)

- ✅ **DEUDA 180 Fases 1+2** en prod (OAuth ML + ruteo por zonas, Fase 1 commit → RESUELTAS 2026-09-21, Fase 2 → 2026-09-24).
- ✅ **Extracción defensiva del payload ML** (`lib/mercadolibre/crear-envio-flex.ts:61-203` con `ReceiverAddressLike` + `payloadRaw`).
- 🟡 **Crons MEF** (`mef-sincronizar-zonas` + `mef-procesar-notificaciones`): rutas existen, NO wireadas en el crontab del server (bucket de 5 no-wireados).
- ⬜ **Fase 3** (etiqueta compuesta + entrega al courier downstream + tracking) — **BLOQUEADA**: requiere cuenta ML real con reputación verde. Shipro arranca el primer cliente **sin ML**, no bloquea.
- ⬜ **Handshake webhook real de ML** — sandbox impracticable, se valida con primer webhook real.

---

## LO QUE BLOQUEA EL PRIMER CLIENTE (lista corta y honesta)

1. **[[DEUDA 138]] Fases B/C/D — stress-test real.**
   - Fase B: generador de carga (k6 / Artillery / script custom; decisión al arrancar). Chat B lidera.
   - Fase C: métricas + instrumentación (Chat A acompaña — counters/timers sobre `crear.ts` + saldos; Chat B instrumenta adapters).
   - Fase D: ejecución contra staging + análisis + registro de hallazgos (probablemente generen nuevas deudas de optimización).
   - **Única obra GRANDE realmente bloqueante.**
   - Pre-requisito operativo: **Nacho arma la BD de operaciones** (dataset realista: compradores, CPs, pesos, dims, couriers, modalidades, orígenes) para disparar la carga.

2. **QA de couriers reales con credenciales nuevas.**
   - **DEUDA 171** Correo Argentino — código completo, validar e2e cotizar/despachar/rastrear con credenciales testing+prod que Nacho consiguió.
   - **DEUDA 147** switch sandbox Andreani (+Mocis) — código completo, validar con credenciales testing que Nacho ya tiene.
   - No es obra grande, es validación — bloquea el onboarding real porque sin couriers probados contra sus propios ambientes QA no hay confianza para producción.

3. **[[DEUDA 108]] server viejo** — acción externa Nacho↔Fran (Cloud Firewall al server viejo). Baja 1-nov coordinada. No es código.

**Todo lo demás** (motor de reglas 186, MEF Fase 3, homologación formal Tiendanube, estados centralizados 50+173, Torre completa, modelo de crédito etapa 2) es **POST-cliente** o **carril paralelo que no frena el primer onboarding**.

---

## CARRILES PARALELOS (no bloquean el primer cliente — avanzan por chat)

Estos corren en paralelo al camino crítico. Cada chat decide velocidad según su bandwidth.

- **Motor de reglas + scoring** (**DEUDA 186**, Chat A). Fase 1 diseño cerrada (blueprint). Fases 2+3 construibles ya (reglas ricas + scoring en sombra) sin esperar datos — zero data dependency, cae a cheapest/fastest con fallback escalonado. Fase 4 encendido cuando el histórico post-primer-cliente tenga umbral.
- **Captura de datos del motor** (dentro de 186 §10 — nothing-discarded principle). Day-1 raw capture: `EventoTracking.payloadRaw`, `WebhookTiendanubeRaw`, `ConciliacionRun.rawFile`, `MotorReglaShadowLog`, volumen rolling. **Alimenta la Torre y el motor** desde el día 1.
- **Torre de Control** (**DEUDA 39**, Chat A). PARCIAL: **11/16 métricas completas** 3-of-3 (endpoint + helper + UI card); 1 parcial (1.5 Velocidad Resolución Tickets); 4 MISSING: 1.3 Eficiencia Auditor, 4.2 Salud Couriers, 4.3 Cobertura Postal, 4.4 Salud Financiera. UI integral existe (`torre-de-control/page.tsx`, 3322 líneas). La captura de datos del motor amplía esta Torre.
- **Plugins / homologación Tiendanube** (**DEUDA 130** paraguas + **DEUDA 104 OUT**, Chat C).
- **MEF Fase 3+** (**DEUDA 180**, Chat D).
- **Multi-bulto** (**DEUDA 139 / 142 / 143**, Chat B). 143 Modo B casi completo (consumer en rates wired, falta UI config); Modo A greenfield.
- **Cluster zonas operativas** (**43 / 44 / 45 / 46 / 48 / 49**, Chat A). Cimiento del scoring por zona real — POST-cliente (motor arranca con fallback a provincia).

---

## PORTFOLIO REAL — ~11 OBRAS GRANDES ABIERTAS (post drift sweep 2026-10-13)

El inventario anterior listaba ~20; el drift sweep contra código bajó la cifra real a ~11. El resto son PARCIAL con progreso significativo o se desdoblaron en RESUELTAS por `make`.

### CHAT A — Núcleo (8 obras)

- **186** motor de reglas + scoring (diseñado, Fase 1 cerrada; construcción oculta Fases 2+3).
- **39** Torre de Control (11/16 completas; faltan 1.3, 4.2, 4.3, 4.4 + 1.5 partial).
- **181** vencimientos POSTPAGO (etapa 2 modelo crédito — obra de diseño+desarrollo).
- **173 + 50** estados centralizados String→enum + separación 2 planos (sibling; se ejecutan juntas).
- **42** modelo estacionalidad operativa (`EventoComercial` + alertas pre-evento).
- **56** fuga vs red completa (Métrica 3.2 Nivel 2 — cotización paralela contra todos los couriers).
- **111** captura checkout (PARCIAL — 1 writer en rates callback existe; falta `/api/cotizar` + wiring `usadaEnEnvioId`).
- **36.E** Fase 5 (couriers huérfanos tras cambio de recolector).

### CHAT B — Couriers (4 obras)

- **138** Fases B/C/D stress-test (**ÚNICA bloqueante del primer cliente**).
- **139** multi-bulto base arquitectónica (foundations hechas; adapters single-bulto todavía).
- **142** molde multi-bulto (4 escalones en main; Paso 2 adapters emitir N trackings pendiente).
- **143** motor empaquetado (Modo B casi completo — falta UI config; Modo A greenfield).
- **95** couriers mixtos por depósito (diseño pendiente — POST-cliente).

### CHAT C — Plugins (3 obras)

- **130** homologación Tiendanube (paraguas PARCIAL — máquina estados labels + tracking cap/override + /generate e2e + reunión validación).
- **104 OUT** webhooks salientes genéricos (modelo `Webhook` + dispatcher + firma HMAC + reintentos + UI).
- **103** multi-bulto completo 3 capas (motor reglas + N envíos + agrupación bajo pedido).

### CHAT D — MEF (1 obra)

- **180 Fase 3+** enriquecimiento + tracking downstream + excepciones + etiqueta ML + handshake webhook real + wiring crons.

### CROSS-CUTTING (cluster zonas, 1 obra consolidada)

- **43 + 44 + 45 + 46 + 48 + 49** zonas operativas reales. Encadenadas: 44 bloquea 43+45+46; 48 standalone; 49 PARCIAL (code normalizer done). Alimenta DEUDA 186 Fase 4. POST-primer-cliente.

### UNREGISTERED detectada en recon (2026-10-08)

**"Captura total de datos de entrada / day-1 raw capture"** — agrupa `EventoTracking.payloadRaw`, `WebhookTiendanubeRaw`, `ConciliacionRun.rawFile`, `MotorReglaShadowLog`, volumen rolling por `(courier, zona, ventana)`, extensión contrato `CourierInterface.rastrear`. Hoy sus piezas viven dispersas dentro de 186 §10 + 180 + 58 + 111. Decisión pendiente Nacho: ¿consolidar como DEUDA maestra o dejar dispersa?

---

## REPARTO SUGERIDO PRÓXIMO TRAMO

- **Chat B** (camino crítico): **138 Fase B** (generador de carga) + **QA Correo Argentino (171) + Andreani sandbox (147)** con credenciales que Nacho ya consiguió. Este es el carril que define cuándo arranca el primer cliente.
- **Chat A** (decisión Nacho): o **empujar el diferencial** (**186** Fase 2+3 — reglas ricas + scoring en sombra; **39** completar las 4 métricas faltantes como cimiento de datos del scoring), **o acompañar el camino crítico** (**138 Fase C** instrumentación sobre `crear.ts`+saldos). No ambas a la vez; una sesión = una obra.
- **Chat C**: **130 homologación** (3 piezas parciales: máquina estados labels + tracking cap/override + `/generate` validación e2e) + **104 OUT** (empezar diseño del modelo `Webhook` genérico — es el gap más grande para plugins futuros).
- **Chat D**: **MEF Fase 3** cuando llegue cuenta ML real con reputación verde. Mientras tanto, avance en roadmap técnico sin bloquear.
- **Nacho** (no-código):
  - BD de operaciones realista para el stress-test (138).
  - Confirmar credenciales restantes OCA + Hop para activar e2e Chat B.
  - Avisar a Fran para Cloud Firewall al server viejo (108).
  - Decidir foco Chat A próxima sesión (diferencial vs camino crítico).
  - Decisión pendiente: ¿consolidar "captura total raw" como DEUDA maestra?

---

## DISCIPLINA (aprendizaje de la sesión 2026-10-13 — anti-drift)

El backlog acumula **DRIFT** cuando un chat cierra trabajo sin mover la deuda a `RESUELTAS.md`. El recon code-vs-registry de 2026-10-13 encontró ~9 drifts:

- **Enteros**: DEUDA 133 (LGPD TN) + DEUDA 144 (rates callback TN) → ambas estaban "ABIERTAS" en el registry pero el código mostraba las piezas en main con commits dedicados.
- **Piezas**: DEUDA 36.E Fase 4c/d (commit `1f0e044`) + DEUDA 138 Fase A (commits `2e7e80f`/`206646b`/`ef6f4a4`) → estaban marcadas "⬜ PENDIENTE" aunque habían deployado.
- **Status stale**: DEUDA 39 (decía "avanzada", el código muestra 11/16+1 parcial+4 missing) + DEUDA 111 (ignoraba el writer ya existente en rates callback) + DEUDA 104 (ignoraba que mitad IN estaba completa) + DEUDA 130 (paraguas no reflejaba que las sub-piezas estaban hechas) + DEUDA 143 (ignoraba Modo B consumer wired) + DEUDA 180 (listaba pieza (1) extracción defensiva como pendiente, ya en código).

**Regla operativa** (incorporar al runbook de cada chat):

1. **Cada chat mueve su deuda a `RESUELTAS.md` al deployarla** — no solo commitea el código.
2. Cuando una pieza grande cierra sin cerrar la obra padre (ej. Fase A de 138), **marcar la pieza en el body de la obra padre** con ✅ + commit + fecha en vez de dejar "⬜ PENDIENTE".
3. **La fuente de verdad es el código**. Si el registry dice "abierta" y el código muestra la feature en main, gana el código. Hacer drift sweep code-vs-registry **al cierre de cada tramo grande** (post-deploy de un batch, post-prod de una obra, cuando se abre un tramo nuevo).
4. **Commits que cierran deuda incluyen una línea `cierra [[DEUDA ###]]`** en el mensaje. Facilita el sweep ex-post.

Esta sesión aplicó la regla retroactivamente — el próximo sweep debería encontrar cero drift si cada chat la cumple en adelante.

---

## PRINCIPIOS DE EJECUCIÓN

- **Money-critical**: recon → diseño → revisión Nacho → deploy gated con foto forense. El motor de precios (`cotizador.ts` / `crear.ts` cascada / `aplicarMarkup`) no se toca sin cuidado extremo — un rename mal cascadeado rompe facturación en silencio (ver DEUDA 158 para el patrón `@map` validado y DEUDA 156 fallout como aviso).
- **Multi-chat**: cada chat su territorio; los cruces (**173** estados centralizados, **103** multi-bulto, **104** webhooks salientes, **138** stress-test, **186** motor de reglas) se coordinan explícitamente; **ningún chat deploya trabajo de otro chat sin su OK**.
- **Money-safe en lote**: nunca en lote money-adjacent — uno por sesión con verificación empírica (patrón validado en DEUDA 158 renames + DEUDA 174 política de débito).
- **"El cliente vende siempre"** (Nacho): el failover técnico de DEUDA 129 ya cubre el caso; mantener la invariante en cualquier cambio de `cotizador.ts` / `crear.ts` / `dispatch.ts`.
- **Shipro = plataforma de datos**: toda feature nueva se pregunta "¿qué dato captura esto que el motor va a querer después?" Captura raw primero, parseá después (patrón ML Flex `payloadRaw`).

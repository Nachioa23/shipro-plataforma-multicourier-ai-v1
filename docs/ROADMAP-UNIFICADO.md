# Roadmap Unificado — Shipro 2.0

> **Documento operativo único.** Fecha: 2026-10-05. **META:** primer cliente real operando antes del **31-oct-2026** (~4 semanas).
> **Fuente de verdad detallada:** `DEUDAS.md` (abiertas) + `DEUDAS-RESUELTAS.md` (histórico, verbatim). Este board **CRUZA**, no reemplaza.

---

## Estado general (2026-10-05)

En prod hoy (origin/main `c1f88a1`): **motor de plata FASE 1 rama-aware** (cascada intermediario+Shipro, SMO, Fee, IVA una vez; débito rama-aware) · **modelo de crédito etapa 1** (colchón PREPAGO funcional + editor post-onboarding de `modalidadPago` + `limiteDescubierto` con audit, DEUDAS 174/175/176) · **MEF Fases 1+2** (OAuth ML + ruteo por zonas, DEUDA 180) · **hub de conexiones** 5 piezas (modelo Conexion + flujo API Key Opción A + vista/registro + registro auto Tiendanube + mandar plugin, DEUDA 150) · **consola de tarifa unificada** (DEUDA 170, 4 pantallas viejas jubiladas DEUDA 179) · **tripleta first-mile genérica** (recolector/dueño/entregador vía capacidad opcional, DEUDA 182) · **Intralog Fase 1** activo · **WooCommerce** end-to-end validado · **ownership gates** cerrados en rastreo-manual (DEUDA 126) y métricas cross-tenant (DEUDA 7).

**Lo que falta para el primer cliente real**: cerrar el leak cross-tenant de contactos (DEUDA 185, el único bloqueante money-adjacent descubierto 2026-10-05), habilitar recuperación de contraseña (DEUDA 96), cerrar el Fix B de "la venta nunca se pierde" (DEUDA 169), sacar del aire el server viejo de Fran (DEUDA 108), cablear credenciales reales de Correo Argentino y el entorno de pruebas de Andreani, y pasar el test de estrés mínimo.

**4 chats activos en paralelo**: Chat A (núcleo), Chat B (couriers), Chat C (plugins/API externa), Chat D (MEF/ML).

---

## Los 4 chats (territorios)

- **Chat A — Núcleo.** `lib/cotizador.ts`, `lib/envios/crear.ts|dispatch.ts|procesar-bloqueados-*.ts`, `prisma/schema.prisma` + migraciones, motor de precios/crédito, cascada de markup, hub de conexiones (`Conexion` + `TokenSetupApiKey`), `lib/auth-context.ts` + `proxy.ts`, APIs admin de tarifa (`admin/consola-tarifa` + `admin/markup-*` + `admin/smo-courier` + `admin/finanzas`), modelos de datos. **Corre las migraciones** en cada deploy.
- **Chat B — Couriers / Integraciones.** `lib/couriers/*Adapter.ts` + `CourierFactory` + `CourierInterface` + `serviciosSoportados` + `normalizar-courier`, app Tiendanube (`lib/tiendanube/*`, `app/api/tiendanube/*`), empaquetado (`lib/empaquetado/*`, `armarBultoApilado`), SMO per-courier operativo.
- **Chat C — Plugins / API externa / Docs.** Plugin WooCommerce (repo `shipro-woocommerce`), plugins futuros (Shopify / VTEX / Magento / PrestaShop), contrato OpenAPI (`docs/shipro-api-v1.openapi.yaml`), documentación externa (`docs/shipro-api-v1.html`), homologación Tiendanube.
- **Chat D — MEF / Mercado Libre.** DEUDA 180 Fases 3+ (enriquecimiento, tracking downstream, excepciones, etiqueta ML), wiring de los 2 crons MEF, handshake webhook real ML.

---

## CAMINO AL PRIMER CLIENTE (antes del 31-oct) — por capas

### CAPA 0 — Bloqueantes DUROS (sin esto NO se onboardea)

| DEUDA | Qué | Chat | Tipo | Estado |
|---|---|---|---|---|
| **185** | Leak cross-tenant contactos (Direccion global compartida por email; mutación + lectura cross-tenant confirmadas en prod con prueba Astelarra) | Chat A | obra + diseño (dos capas: física vs agenda) | ABIERTA — CONFIRMADA EMPÍRICAMENTE EN PROD 2026-10-05 |
| **96** | Login: link "¿La olvidaste?" no funciona + flujo de recuperación de contraseña | Chat A | obra (diseño cerrado 2026-10-08, 2 piezas, en construcción por Chat A — cierra también [[DEUDA 69]]; [[DEUDA 97]] Google OAuth queda FUERA del scope) | ABIERTA — sin esto, un cliente que olvida la clave queda afuera |
| **169 Fix B** | "La venta nunca se pierde" — hoy el 500 convertido a 400 no reintenta; un envío legítimo puede quedar como venta perdida si el courier no resuelve | Chat A + Chat C (cross) | obra con decisión producto | ABIERTA — Fix A ya en prod, Fix B pendiente |
| **108** | Server viejo (beta.shipro.pro) sin firewall + 5 clientes reales + logs con ataques SSH | EXTERNO (Nacho → Fran) | acción admin | ABIERTA — bloquea onboarding sobre superficie expuesta |

### CAPA 1 — Cobertura de couriers que el cliente va a usar

| DEUDA | Qué | Chat | Depende de |
|---|---|---|---|
| **171** | Correo Argentino: 2 bugs pendientes en adapter | Chat B | credenciales + agreement de QA que consigue Nacho (MiCorreo + Paq.ar son 2 cuentas distintas) |
| **147** | Switch sandbox / producción ausente en AndreaniAdapter (y Mocis) — credenciales de test fallan auth porque el adapter pega siempre a prod | Chat B | credenciales de test de Andreani que consigue Nacho |

### CAPA 2 — Test de estrés (el "auto a fondo", DESPUÉS de capa 0 + capa 1)

| DEUDA | Qué | Chat |
|---|---|---|
| **138** | Escalabilidad y stress-test de BD, APIs y código bajo alta concurrencia | Chat B lidera (toca despachos) + Chat A acompaña (schema + lecturas) |
| **131** | Race condition en idempotency check de `POST /api/envios` | Chat A (acompaña a 138) |
| **136** | Verificación de que el bloqueo por saldo negativo se dispara bajo concurrencia (no es pérdida de plata, es confirmar que el bloqueo activa correctamente post-colisión) | Chat A (acompaña a 138) |

### CAPA 3 — Importantes pre-cliente (deberían estar, no estrictamente bloqueantes)

| DEUDA | Qué | Chat |
|---|---|---|
| **125** | Hardening alta `CredencialCourier` — exigir `propietarioTipo` en Rama A (deploy FASE 2 mordió esto) | Chat A |
| **99** | Regla "Provincia de Destino" opción muerta en motor (bug silencioso) | Chat A |
| **100** | Operador "ENTRE" opción muerta en motor (bug silencioso) | Chat A |
| **132** | Fuga de dimensiones en dashboard — largo/ancho/alto se pierden y caen a 10×10×10 hardcoded (bug de facturación real) | Chat A |
| **71** | Guardar credenciales de courier al finalizar wizard — hoy paso 4 activa couriers sin persistir credenciales | Chat B |
| **173** | `estadoActual` String libre sin centralizar — prerequisito de plugins externos y UX consistente | cross-chat (A+B+C) |

---

## EN PARALELO (cada chat su carril — NO bloquean el primer cliente)

**Chat D** — MEF Fases 3+: enriquecimiento del shipment ML, tracking downstream, excepciones, etiqueta ML, wiring de 2 crons MEF (`mef-sincronizar-zonas` + `mef-procesar-notificaciones`), handshake webhook real. Esperando entorno Flex real para validar el shape del payload. Ver DEUDA 180 (Fases 1+2 en RESUELTAS).

**Chat C** — Plugins / Tiendanube / WooCommerce: DEUDA 130 (spec Tiendanube + homologación), DEUDA 133 (webhooks de privacidad obligatorios), DEUDA 144 (rates callback Tiendanube), DEUDA 104 (webhooks salientes Shipro → e-commerce), DEUDA 103 (modelo multi-bulto en API), DEUDA 129 (resiliencia checkout: circuit breaker + fallback rates).

**PUEDE ESPERAR (post primer cliente)**:
- Métricas / Torre: 39 (métricas restantes), 43-48 (zonas/SLA), 56, 57, 61, 62, 65, 161, 162.
- Modelo de crédito etapa 2: **181** (vencimientos POSTPAGO — obra de diseño+desarrollo).
- Guardarraíl de edición: **183** (tope suave fat-finger `limiteDescubierto`).
- Producto grande: 42 (estacionalidad operativa), 110 (optimización logística), 111 (inteligencia checkout).
- UI/UX menor: 54, 55, 59, 60, 80, 82, 83, 86 (typo "dias"), 90, 102, 115, 117, 120, 162.
- Limpieza: 160 batches restantes (smo* legacy + rewire de `requiereSeguro` + decisión 163 sobre `quiereSeguroCourier`).
- Couriers menores: 13 (QR Mocis en etiqueta Andreani), 95 (couriers mixtos por depósito), 163 (seguro courier activable), 165 (Hop sucursal/retiro/drop-off), 167 (multi-recolector Intralog Fase 2), 168 (política sub-etiqueta), 177 (Rama A↔B formato credenciales).

---

## El portón (recordatorio de disciplina)

- **Todo lo money-critical**: recon → diseño → revisión Nacho → deploy gated con foto forense. El motor de precios (`cotizador.ts` / `crear.ts` cascada / `aplicarMarkup`) **no se toca sin cuidado extremo** — un rename mal cascadeado rompe facturación en silencio (ver DEUDA 158 para el patrón `@map` validado y DEUDA 156 fallout como aviso).
- **Multi-chat**: cada chat su territorio; los cruces (**169** Fix B, **173** estados centralizados, **103** multi-bulto, **104** webhooks salientes, **150** absorción Tiendanube al modelo `Conexion`) se coordinan explícitamente; **ningún chat deploya trabajo de otro chat sin su OK**.
- **Convención money-safe**: para cambios money-adjacent, **nunca en lote** — uno por sesión con verificación empírica (patrón validado en la campaña de renames DEUDA 158 + la política de débito DEUDA 174).

---

## Reparto de las 4 semanas (quién hace qué)

- **Chat A** — Núcleo:
  - **185** (leak cross-tenant Direccion) — diseño de dos capas (física global + `ContactoEmpresa` por empresa) + recon de callers de `prisma.direccion.*` + migración aditiva + refactor `crear.ts` upsert + refactor `/api/directorio` + refactor wizard autocomplete + verificación empírica (replicar prueba Astelarra). **Prioridad #1.**
  - **96** (recuperación de contraseña) — flujo de reset con token single-use + email + UI + rate-limit. **Prioridad #2.**
  - Acompaña Fix B de **169** en lo que toca `crear.ts` (shape del estado bloqueado hacia plugins — coordinar con Chat C).
  - Acompaña **138** stress-test (lecturas de schema + `$transaction` en el update de saldo).
  - Como bonus si queda tiempo: **125** + **99** + **100** + **132** (bugs chicos de capa 3 que son self-contained).

- **Chat B** — Couriers:
  - **171** (Correo Argentino 2 bugs) + verificación e2e cuando lleguen credenciales de Nacho.
  - **147** (switch sandbox Andreani+Mocis) — fix de entorno para que las credenciales de test de Andreani funcionen contra sandbox real.
  - **169 Fix B** mitad del adapter: shape del response cuando el courier no resuelve en el momento.
  - **138** liderar stress-test: perfil de carga realista (crear + cotizar + dispatch concurrentes), detectar hot-spots.
  - Si queda aire: **71** (guardar credenciales al finalizar wizard).

- **Chat C** — Plugins:
  - Pulido final del plugin WooCommerce (DEUDAS 145 timeout vuelve a 5s cuando latencia núcleo < 5s; HMAC si se agrega a `/rastreo-publico`).
  - **169 Fix B** mitad plugins: cómo WooCommerce (y plugins futuros) manejan el nuevo estado bloqueado sin sorpresas.
  - Avance progresivo en Tiendanube Momento 3 (labels/tracking/webhooks) — DEUDA 144.

- **Chat D** — MEF:
  - Fases 3+ cuando Flex real responda. Wiring de los 2 crons MEF en crontab del server coordinado con Chat A (deploy).
  - Si Flex sigue sin shape → avance en roadmap técnico sin bloquear el primer cliente (que arrancará sin ML).

- **Nacho** (no-código):
  - Avisar a Fran para aplicar Cloud Firewall al server viejo (**108**). Confirmación con captura.
  - Conseguir credenciales de **Correo Argentino** (MiCorreo + Paq.ar) + agreement QA — habilita Chat B para 171.
  - Conseguir credenciales de **test de Andreani** — habilita Chat B para 147.
  - Validar UX en el browser (dev server) a medida que Chat A/B/C vayan bajando piezas de capa 0 y 1.
  - Diseño de producto en 185: confirmar la forma final de `ContactoEmpresa` + política de autocomplete cross-empresa (ver matiz de diseño en el body de la deuda).

---

## Drift reconciliado (2026-10-05)

Nota: **8 deudas movidas a RESUELTAS tras cruzar backlog vs código/prod** en dos batches de reconciliación (2026-10-05):
- Batch 1 (commit `09a1b32`): DEUDAS **126** · **175** · **176** · **179** — en prod via `c1f88a1`.
- Batch 2 (commit `b6accfa`): DEUDAS **153** · **156** · **158** · **159** — en prod via commits `ac441c6` · `065a403` · campaña `a8cda53`→`14407dc` · `93fc4bf`.

El backlog ahora refleja prod. **Pendientes de verificación empírica (no código)**: DEUDAS **121** (destrabe BLOQUEADO_CREDENCIAL vía API) y **136** (bloqueo saldo negativo bajo concurrencia). **Bugs reales abiertos confirmados en código**: **99** (PROVINCIA_DESTINO motor) · **100** (operador ENTRE motor) · **86** (typo "dias" Torre).

---

## Histórico (breve)

Qué resolvió el proyecto, en orden grueso (ver `DEUDAS-RESUELTAS.md` para el detalle verbatim):

1. **FASE 1 — Motor de plata rama-aware** (deploy prod 2026-07-30, commit `b11f7f8`): fórmula cascada intermediario+Shipro, SMO por courier, Fee neto, IVA una vez al final, débito rama-aware, conciliación aforo↔virtual con snapshot + undo, dos-vías de liquidación. DEUDAS 73/107/10/79/75.
2. **Config-variables + consola de tarifa** (2026-07-31 → 2026-09-11): tablas de vigencia (`MarkupShiproVigencia`, `SmoCourier`, `OperacionFee`, `MarkupIntermediarioCourier`) + patrón "cerrar+crear" para config editable sin deploy + consola unificada Shipro-only. DEUDAS 157/170 + jubilación de las 4 UIs viejas (179).
3. **Hub de conexiones** (2026-09-06 → 2026-09-11): 5 piezas en prod — modelo `Conexion` + flujo API Key Opción A + vista/registro manual + registro auto Tiendanube + mandar plugin desde el hub. DEUDA 150.
4. **Modelo de crédito ETAPA 1** (2026-09-29): colchón `limiteDescubierto` funcional en PREPAGO + editor post-onboarding de `modalidadPago` + `limiteDescubierto` con audit formal. DEUDAS 174/175/176.
5. **MEF (Mercado Envíos Flex) Fases 1+2** (2026-09-21 + 2026-09-24): data model ML + OAuth + librería de tokens + webhooks + ruteo por zonas + anti-starvation. DEUDA 180.
6. **Tripleta first-mile genérica** (2026-09-30): contrato `ICourierIntegrator.vincularRecoleccion?` + MocisAdapter encapsula rol recolector + mapa entregador→endpoint + cutover `dispatch.ts` al modelo ancla-primero + recolector best-effort. DEUDA 182.
7. **Hardening de seguridad** (2026-10-01): ownership gate en `/api/envios/rastreo-manual` + email del destinatario en la ficha. DEUDA 126.
8. **(Ahora)** **Camino al primer cliente real** — este roadmap.

# CHECKLIST DE COMERCIALIZACION — SHIPRO 2.0

> **Documento operativo unico** para la salida a comercializacion. Foto consolidada del audit del 2026-06-17.
> **Modo de uso:** Tachar items completados cambiando `[ ]` por `[x]`. Actualizar Estado al pie.
> **Fuente de verdad detallada:** `DEUDAS.md` (1286 lineas, 47 DEUDAs auditadas).

---

## ⚡ RESUMEN

**Estado:** 4 hard-blocks pendientes para comercializar. Estimado: **5-7 dias** de trabajo enfocado.

**Buena noticia:** El sistema core funciona. Cotizacion multicourier ✅, bloqueos de saldo/deposito ✅, Torre de Control ✅, Panel cliente ✅, passwords hasheados ✅, apiKey field listo ✅.

**Falta resolver para vender con seguridad operativa y financiera.**

---

## 🚨 DECISIONES DE PRODUCTO (respondidas 2026-06-17)

- [x] **D1 — Como onboardeo los primeros pilotos?** → **Self-service desde dia 1**
  - Implicancia: DEUDA 17 (UI onboarding) OBLIGATORIA.

- [x] **D2 — Modelo financiero para primeros pilotos?** → **Ambos modelos (A + B)**
  - Implicancia: DEUDA 10 (Modelo B fallback) OBLIGATORIA.

- [x] **D3 — Modalidad de pago para primeros pilotos?** → **PREPAGO estandar, POSTPAGO excepcional**
  - Implicancia: DEUDA 22 (suspension auto) OBLIGATORIA para los POSTPAGO.

- [x] **D4 — Cloud provider final?** → **Linode confirmado**
  - Implicancia: Postgres provisioning on Linode confirmado.

**Path elegido:** Completo (~5-7 dias). Todas las DEUDAs Tier 1 + TECH 1 + Tier 2 obligatorias.

---

## 🔴 TIER 1 — HARD-BLOCK COMERCIALIZACION

Sin estos no es seguro operar con clientes externos. **Resolver antes de salir a vender.**

### [ ] BLOCK 1.1 — Postgres migration

**Por que bloquea:** SQLite no soporta produccion concurrente. Cualquier cliente real con uso simultaneo lo rompe.

**Trabajo:**
- [ ] Provisioning Linode + base Postgres (o cloud elegido en D4).
- [ ] Cambio `provider = "postgresql"` en `prisma/schema.prisma`.
- [ ] Migracion data existente (si hay seed productivo).
- [ ] Update DATABASE_URL en `.env.local` + secrets.
- [ ] Smoke test E2E en Postgres (cotizar + crear envio + rastreo).
- [ ] Registrar como DEUDA 66 en DEUDAS.md (no tiene entry dedicada hoy).

**Estimado:** 1 dia.

**Riesgo de saltar:** ALTO. Operacion inestable bajo carga real.

---

### [ ] BLOCK 1.2 — DEUDA 17: UI onboarding cliente

**Por que bloquea:** Sin esto nadie puede registrarse autoservicio. Todos los onboardings son manuales 1-a-1.

**Si elegis D1=A (pilotos manuales):** este block es OPCIONAL. Onboardear los primeros 1-3 clientes en BD directa.
**Si elegis D1=B (self-service):** OBLIGATORIO.

**Trabajo:**
- [ ] Wizard `/admin/empresas/onboarding` con 6 pasos (datos fiscales, contacto, default config, requiereRevision flag, notificacion admin, audit log).
- [ ] Validacion CUIT contra AFIP (si es factible).
- [ ] Mail al admin_shipro de turno cuando empresa nueva lista para revision.

**Estimado:** 1-2 dias.

**Workaround temporal:** Onboarding manual en BD para los primeros 5-10 clientes.

---

### [ ] BLOCK 1.3 — DEUDA 19: Auditoria credenciales (CRÍTICA legal)

**Por que bloquea:** Sin audit log, cualquier disputa con cliente sobre cambios de credenciales o tipoCuenta no podes defender. Compliance basico SaaS.

**Trabajo:**
- [ ] Schema model `AuditoriaConfiguracion(id, usuarioId, fecha, empresaId, courierId, campo, valorAnterior, valorNuevo, motivo, ipOrigen)`.
- [ ] Middleware Prisma o trigger en update/upsert de `CredencialCourier`.
- [ ] Doble confirmacion UI para cambios sensibles (cambiar PREPAGO↔POSTPAGO, activar credenciales Shipro).
- [ ] Notificacion admin_shipro en cambios sobre empresas con envios recientes.
- [ ] Dashboard `/admin/auditoria-configuracion` con filtros por empresa/courier/usuario/fecha.

**Estimado:** 1 dia.

**Riesgo de saltar:** ALTO. Primer cliente que dispute "yo no autorice ese cambio" no tenes evidencia.

---

### [ ] BLOCK 1.4 — DEUDA 22: Suspension auto cuenta limiteDescubierto

**Por que bloquea:** Sin esto un cliente POSTPAGO puede generar deuda ILIMITADA. Riesgo financiero real.

**Si elegis D3=A (PREPAGO obligatorio):** este block es OPCIONAL (PREPAGO mitiga el riesgo).
**Si elegis D3=B (POSTPAGO permitido):** OBLIGATORIO.

**Trabajo:**
- [ ] Nuevo campo `Empresa.suspendida: boolean @default(false)`.
- [ ] Auto-mark `suspendida = true` al exceder `limiteDescubierto` (en `crear.ts` o cron finanzas).
- [ ] Mientras suspendida: rechazar TODA creacion de envio con codigo `CUENTA_SUSPENDIDA`.
- [ ] UI banner rojo dashboard cliente.
- [ ] Re-activacion automatica cuando saldo `>= -limiteDescubierto * 0.5`.
- [ ] Notificacion admin_shipro.

**Estimado:** medio dia.

---

## ⚠️ TIER 2 — IMPORTANTE PRE-PROD (paralelo a primeros pilotos)

Estos mejoran la operacion pero pueden hacerse en paralelo. **Tracker para no perderlos de vista.**

### [ ] DEUDA 10 — Manejo fallas courier Modelo B

**Cuando atacar:** Solo si D2=B. Si D2=A se posterga.

**Trabajo resumido:** Model `OperacionFee` + cotizacion por similitud historica + flujo de fallback en `crear.ts`.

**Estimado:** medio dia.

---

### [ ] DEUDA 18 — Acceso Shipro a facturacion clientes

**Cuando atacar:** Cuando aparezca el primer caso de soporte con disputa de conciliacion.

**Trabajo resumido:** Habilitar `/facturacion` para usuarios shipro con dropdown empresa (Opcion A, consistente con `/cotizar`).

**Estimado:** 3-4 horas.

**Workaround temporal:** Soporte por SQL directo en BD.

---

### [ ] DEUDA 21 — Matriz permisos granular /mis-transportes

**Cuando atacar:** Antes de habilitar self-service masivo (D1=B).

**Trabajo resumido:** Helper `lib/permisos.ts` con matriz de 7 campos × 4 roles. Hoy solo `tipoCuenta` cubierto.

**Estimado:** 3 horas.

---

## 🔒 TECH HARDENING

### [ ] TECH 1 — Hash de apiKey en DB

**Por que:** Campo `Empresa.apiKey` en plain text. Si BD se compromete, todas las API keys son legibles.

**Trabajo:**
- [ ] Migration: agregar `apiKeyHash` a Empresa.
- [ ] Generacion: store hash + return plain una sola vez al cliente.
- [ ] Validacion middleware: hash incoming + lookup por hash.
- [ ] Re-emitir apiKeys existentes.
- [ ] Registrar como DEUDA 67 en DEUDAS.md.

**Estimado:** 3-5 horas.

**Riesgo de saltar:** MEDIO. Mitigado por auth middleware actual, pero buena practica industry.

---

### [ ] TECH 2 — Plan de rotation credenciales master

**Por que:** Credenciales master Shipro (`ANDREANI_USER`, `MOCIS_USER`) hardcodeadas en `.env.local`. No auditable, rotation requiere developer + redeploy.

**Cuando atacar:** Post-launch, no bloqueante para deploy inicial.

**Trabajo resumido:** Mover a vault o secret manager + flow de rotation.

**Estimado:** post-launch.

---

## ✅ TIER 0 — VERIFICADO RESUELTO

Estos items ya estan resueltos. No requieren trabajo.

| Item | Status | Evidencia |
|---|---|---|
| Passwords hasheados | ✅ | `bcryptjs ^3.0.3`, `lib/auth.ts:24` |
| apiKey field Empresa | ✅ | `prisma/schema.prisma:19-21` |
| DEUDA 27 (Etiqueta diferida deposito) | ✅ RESUELTA | commit e7d92b9 + 382-line processor + 11+ refs |
| DEUDA 29 (cpOrigen multicourier) | ✅ RESUELTA FUNCIONALMENTE | Sub-fases 1+2+6.D.* completas |
| DEUDA 39 Torre de Control | ✅ 13 metricas implementadas | Multiple commits |
| DEUDA 62 Phases 1+2+4 | ✅ Panel cliente unificado scope-aware | 9 commits 2026-06-13 a 2026-06-17 |
| 10 helpers scope-aware | ✅ | `lib/utils/` (concentracion-courier, desvio-peso, efectividad-primera-visita, fuga-ruteo, kpis-hero, lista-couriers, modalidades, nps, sla, tickets-mesa-ayuda) |
| 10 endpoints Torre + 0 legacy | ✅ | `app/api/torre-de-control/` |

---

## 📋 ROADMAP POST-LAUNCH (no bloqueante)

DEUDAS que pueden esperar a post-launch sin riesgo operativo. **Detalle completo en `DEUDAS.md`.**

**Quick wins (scope chico, polish):**
- DEUDA 53 — Campo formal origen en TicketSoporte.
- DEUDA 54 — Recuperar Card "Auditar Checkouts".
- DEUDA 55 — Documentar MOTOR_PRECIO en schema.
- DEUDA 58 — paqueteSnapshotJson sin consumer (cleanup).
- DEUDA 65 — Filtros funcionales 3 modales (180-240 min).

**Activaciones de infraestructura ya construida:**
- DEUDA 59 — Activar email NPS post-entrega (infra lista).
- DEUDA 60 — Activar cron trimestral NPS Empresa (infra lista).
- DEUDA 8 — Vista UI Calidad Postal (backend listo).

**Robustness items DEUDA 29 (no bloqueantes):**
- Sub-fase 3 — Retry on 401 mid-request en adapters.
- Sub-fase 5 — 22 sucursales Andreani sin CPs publicos via `/v2/puntos-de-tercero` autenticado.

**Scope grande (sesiones dedicadas):**
- DEUDA 49 — Normalizacion provincias BD (refactor estructural).
- DEUDA 50 — Refactor canonico estadoActual (separacion 2 planos).
- DEUDA 56 — Nivel 2 Metrica 3.2 fuga vs red completa Shipro.
- DEUDA 62 Phase 3 — Expansion Categoria B/C Panel.

**Bloqueadas por decisiones o externos:**
- DEUDA 1 — Estado REQUIERE_SOPORTE (POSPUESTA SUB-PASO 9).
- DEUDA 13 — QR Mocis en etiqueta Andreani (coordinacion externa).
- DEUDA 48 — Decision arquitectonica origen CP.

**Cluster Torre de Control mejoras (Metrica 2.3 vinculadas):**
- DEUDA 43 — Sistema SLA nominal courier por zona.
- DEUDA 44 — Captura zona courier desde liquidacion.
- DEUDA 45 — Comparacion calibrada vs nominal en dashboard.
- DEUDA 46 — Granularidad sub-provincial zonas operativas.
- DEUDA 42 — Modelo estacionalidad operativa.

**Otros:**
- DEUDA 2 — Cache cotizaciones (post-prod, no bloqueante).
- DEUDA 10 — Modelo B fallback (Tier 2 si D2=B).
- DEUDA 40 — CPs rurales perdidos por parse CSV.
- DEUDA 41 — Verificacion jerarquica direcciones e-commerce.
- DEUDA 47 — Fix persistencia modalidad (RESUELTA, sigue en lista por completeness).
- DEUDA 52 — Geocoding Direccion lat/lng.
- DEUDA 57 — Persistir dimensiones paquete + Nivel 2 Metrica 3.4.
- DEUDA 61 — Bugs Mapa SLA (1/3 fix incidental, 2 pendientes).

---

## 📊 ESTIMADOS

### Path rapido (todas decisiones opcion A)

| Item | Estimado |
|---|---|
| BLOCK 1.1 Postgres migration | 1 dia |
| BLOCK 1.3 DEUDA 19 Auditoria | 1 dia |
| TECH 1 apiKey hash | 0.5 dia |
| **TOTAL** | **~2.5 dias** |

### Path completo (cualquier decision opcion B)

| Item | Estimado |
|---|---|
| BLOCK 1.1 Postgres | 1 dia |
| BLOCK 1.2 DEUDA 17 onboarding | 1-2 dias |
| BLOCK 1.3 DEUDA 19 auditoria | 1 dia |
| BLOCK 1.4 DEUDA 22 suspension | 0.5 dia |
| TIER 2 paralelo (3 items) | 1.5 dias |
| TECH 1 apiKey hash | 0.5 dia |
| **TOTAL** | **~5-7 dias** |

---

## 🎯 ORDEN DE EJECUCION CONFIRMADO (2026-06-17)

Ordenado por dependencias tecnicas + valor:

**FASE 1 — Seguridad y gobernanza (2 dias)**

1. [ ] **DEUDA 19 Auditoria credenciales** (1 dia) — Primera porque DEUDAs 17/21/22 se benefician del audit log creado aca.
2. [ ] **TECH 1 Hash apiKey en DB** (0.5 dia) — Security polish antes de exponer apiKeys a clientes.
3. [ ] **DEUDA 22 Suspension auto saldo** (0.5 dia) — Rapido + critico financiero para POSTPAGO excepcional.

**FASE 2 — Habilitacion cliente (2-3 dias)**

4. [ ] **DEUDA 21 Matriz permisos granular** (0.5 dia) — Prerequisito para self-service seguro.
5. [ ] **DEUDA 17 UI onboarding cliente** (1-2 dias) — Habilita self-service dia 1.
6. [ ] **DEUDA 10 Modelo B fallback** (0.5 dia) — Habilita Modelo B operativo.

**FASE 3 — Deploy (1.5 dias)**

7. [ ] **DEUDA 18 Acceso Shipro facturacion** (0.5 dia) — Soporte real pre-launch.
8. [ ] **BLOCK 1.1 Postgres migration** (1 dia) — ULTIMO con todo lo demas funcionando en SQLite.

**Total:** 5.5-7 dias para deploy comercializable.

**Empezamos con:** DEUDA 19 (Auditoria credenciales).

---

## 📌 ESTADO

| Fecha | Item | Status |
|---|---|---|
| 2026-06-17 | Audit inicial 47 DEUDAS | ✅ Completado |
| 2026-06-17 | DEUDAS.md sync (5 headers stale) | ✅ Completado |
| 2026-06-17 | Checklist comercializacion creado | ✅ Completado |
| 2026-06-17 | D1-D4 decisiones de producto respondidas | ✅ Completado |
| 2026-06-17 | Roadmap consolidado FASE 1-2-3 | ✅ Completado |
| — | FASE 1 Seguridad y gobernanza (DEUDAs 19, TECH 1, 22) | ⏳ En progreso |
| — | FASE 2 Habilitacion cliente (DEUDAs 21, 17, 10) | ⏳ Pendiente |
| — | FASE 3 Deploy (DEUDA 18, Postgres) | ⏳ Pendiente |

**Actualizar este apartado cuando se completen items.**

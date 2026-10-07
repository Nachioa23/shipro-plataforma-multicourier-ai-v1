# Deudas resueltas — archivo histórico de Shipro 2.0

Movidas desde DEUDAS.md el 2026-08-04. Solo entradas RESUELTAS/ABSORBIDAS. Fuente de trabajo: DEUDAS.md (solo pendientes).

---

## DEUDA 3 — `crear.ts:251` self-fetch a `/api/cotizar` rompe con dual auth (RESUELTA 2026-06-03 — zombi)

Con el proxy actual, el self-fetch HTTP a `/api/cotizar` desde dentro de `crearEnvio` no manda ni cookie de NextAuth ni Bearer shipro_live_, entonces el proxy lo rechaza con 401. La métrica `fugaFinanciera` queda en 0 pero el envío se crea bien (está en try/catch aislado).

**Why:** funcionalmente no rompe la creación, pero perdemos la auditoría de fuga financiera, que es uno de los productos de valor de Shipro.

**How to apply:** SUB-PASO 7 del plan general — refactorear el self-fetch a llamada directa a la función `cotizar` (extraída a `lib/cotizador.ts` siguiendo el mismo patrón de `lib/envios/crear.ts`).

## DEUDA 4 — Módulo de Depósitos (RESUELTA en commit e7d92b9)

Hoy el CP de origen del depósito está hardcodeado como `"1050"` (San Nicolás CABA) en múltiples archivos: `app/(dashboard)/cotizador-rapido/page.tsx`, `app/(dashboard)/nuevo-envio/page.tsx`, `app/api/checkouts/route.ts`, `app/api/envios/inversa/route.ts`. Adicionalmente, `lib/envios/crear.ts` usa el nombre `"Depósito Central - Empresa <id>"` para localizar la dirección de origen en `Direccion`. Nada de esto escala a clientes con depósitos en otras ubicaciones.

**Why:** Shipro es multi-tenant. Cada empresa puede tener uno o más depósitos en distintas direcciones. Sin este módulo, todos los envíos salen "desde San Nicolás", lo cual es falso para cualquier cliente que no esté ahí. Bloquea el onboarding real de clientes y rompe la lógica de cotización para clientes fuera de CABA.

**How to apply:** trabajo dedicado de 1-2 días, prioridad CRÍTICA antes del deploy a Postgres/Linode. Alcance:
- Modelo `Deposito` en schema Prisma (relación 1:N con `Empresa`; campos: nombre, calle, altura, cp, localidad, provincia, pais, predeterminado boolean, activo boolean).
- Migración Prisma + script de data migration: crear "Depósito Principal" para cada empresa existente con los datos hardcodeados actuales.
- ABM en sección "Mis Depósitos" del dashboard (CRUD básico, marcar uno como predeterminado).
- Onboarding extendido en alta de empresa (`POST /api/clientes`): pedir Razón Social + CUIT + Mail + datos del Primer Depósito como predeterminado.
- Refactor de `lib/envios/crear.ts`: leer el depósito predeterminado de la empresa (o el elegido en el body si el caller lo especifica) en lugar de buscar por nombre hardcodeado.
- Refactor de los 4 archivos con CP `"1050"` hardcodeado: pasar a leer del depósito.
- Permitir al operador del dashboard elegir qué depósito usar para cada envío manual (default = predeterminado de la empresa).

## DEUDA 5 — Modelar correctamente los usuarios de Shipro (RESUELTA en commit 33c7a26)

**Status:** RESUELTA en commit 33c7a26 (2026-04-29).

Hoy `admin_shipro` y `operador_shipro` están vinculados a la `Empresa "Shipro HQ"` (id=1) porque `Usuario.empresaId` es `NOT NULL` en el schema. Conceptualmente, los usuarios internos de Shipro **no pertenecen a ninguna empresa** — son "Modo Dios" y operan por cuenta y orden de cualquier cliente. `Shipro HQ` es una empresa fantasma creada solo para satisfacer la constraint del FK.

**Why:** la inconsistencia complica el modelo de permisos. Cualquier query que filtre por `empresaId` ve a Shipro HQ como una "empresa más" (con saldo, movimientos financieros, credenciales propias, etc.). En SUB-PASO 6 (refactor `empresaId` del query → header) hay que aplicar un workaround para preservar Modo Dios; con el modelo correcto el código quedaría más limpio.

**How to apply (estimado 2-3 horas, prioridad después de SUB-PASOs 6-8):**
- Hacer `Usuario.empresaId` nullable en el schema Prisma.
- Migración Prisma: convertir admin_shipro y operador_shipro a `empresaId = null`.
- Eliminar la fila `Empresa "Shipro HQ"` (id=1) y limpiar movimientos/credenciales/reglas asociados (deberían ser cero o ruido).
- Refactorear `proxy.ts`: si `token.empresaId` es `null` y `rol` es shipro, no inyectar `x-empresa-id` (o inyectar `"SHIPRO"` como valor especial reservado).
- Refactorear los handlers que leen `x-empresa-id`: si el header no está y `x-rol` empieza con `admin_shipro` / `operador_shipro` → comportamiento Modo Dios; si no está y rol es cliente → 401.
- Actualizar `lib/auth.ts` `authorize()`: dejar pasar usuarios shipro sin `empresa.activo` check (no tienen empresa).

**Workaround actual aplicado en SUB-PASO 6:** En cada handler, leer `x-rol` del header además de `x-empresa-id`. Si el rol empieza con `admin_shipro` o `operador_shipro` → Modo Dios: ignorar el `x-empresa-id` (que apunta a Shipro HQ id=1) y leer `filtroEmpresa` del query. Si el rol es cliente → usar SIEMPRE `x-empresa-id` y rechazar cualquier `filtroEmpresa` del query (defensivo: evita que un cliente intente ver datos de otra empresa).

## DEUDA 6 — `/api/metricas` aceptaba `empresaId=TODAS` de cualquier rol (CRÍTICA — RESUELTA en SUB-PASO 6)

**Status:** Detectada durante el análisis pre-SUB-PASO 6 (2026-04-28). RESUELTA en SUB-PASO 6 — el handler usa ahora `resolverContext()` que ignora cualquier intento de override del cliente. Commit hash pendiente al momento de redactar (actualizar cuando se commitee).

**Agujero:** [app/api/metricas/route.ts](app/api/metricas/route.ts) (versión previa, líneas 13-18) leía `empresaId` del query string sin verificar rol; si el valor era `"TODAS"` no aplicaba filtro y devolvía datos cross-tenant. La página `/torre-de-control` del dashboard fetchea exactamente este endpoint, así que un `gerente_cliente` podía abrir DevTools, manipular la URL del fetch y ver envíos/métricas/finanzas de todas las empresas.

**Nota histórica:** inicialmente identificamos este patrón en `app/api/torre-de-control/route.ts` (que tenía el mismo bug), hasta descubrir durante la implementación que ese endpoint es código huérfano (ver DEUDA 8) y la página realmente fetchea `/api/metricas`.

**Cómo se cierra:** SUB-PASO 6 refactoreó `/api/metricas` (el endpoint real explotable) reemplazando la lectura del query por `lib/auth-context.ts::resolverContext()`. Para clientes: `empresaId` siempre del header `x-empresa-id`. Para shipro: pueden usar `filtroEmpresa` (default "TODAS" = Modo Dios). El frontend `app/(dashboard)/torre-de-control/page.tsx` se actualizó para pasar `filtroEmpresa=TODAS` en vez de `empresaId=TODAS`. Adicionalmente `/api/torre-de-control` quedó refactoreado con el mismo helper por defense-in-depth.

## DEUDA 7 — `POST /api/empresa/reglas` acepta `empresaId` del body (CRÍTICA — RESUELTA POR SUB-PASO 6)

**Status:** Detectada durante el análisis pre-SUB-PASO 6 (2026-04-28). Se cierra dentro del refactor de SUB-PASO 6 (commit pendiente al momento de redactar — actualizar este Status con hash final cuando se commitee).

**Agujero:** [app/api/empresa/reglas/route.ts](app/api/empresa/reglas/route.ts) líneas 24-47 (handler POST): destructura `empresaId` del body de la request y lo usa para crear/buscar reglas. Un cliente con sesión válida podía hacer `POST /api/empresa/reglas` con `body.empresaId` = id de otra empresa y crear reglas de ruteo en la cuenta de un competidor (alterando el comportamiento del cotizador y la asignación de couriers de la víctima).

**Cómo se cierra:** SUB-PASO 6 elimina el uso de `body.empresaId` en el handler. El POST usa `lib/auth-context.ts::resolverContext()`: para clientes el `empresaId` viene del header inyectado por `proxy.ts`; el body sigue pudiendo contener el campo pero el handler lo ignora (compatibilidad con frontend existente). Para usuarios shipro: pueden crear reglas en cualquier empresa pasando `filtroEmpresa` del query/body (Modo Dios explícito).

## DEUDA 9 — admin_shipro debe elegir empresa explícitamente al cotizar/crear envío (Importante — RESUELTA en SUB-PASO 7 fix)

**Status:** Detectada como bug post-SUB-PASO 7 (2026-04-28). RESUELTA en el fix post-build de SUB-PASO 7 — backend lanza error específico, frontend muestra dropdown obligatorio. Commit hash pendiente al momento de redactar.

**Bug original:** Cuando admin_shipro u operador_shipro intentaba cotizar (`/cotizar` o `/cotizador-rapido`) o crear envío manualmente desde el dashboard, el sistema devolvía silenciosamente listas vacías con respuesta de 10ms. Causa: `resolverContext` para shipro sin `filtroEmpresa` devuelve `ctx.empresaId = null` (Modo Dios "TODAS"), y `cotizar()` con `empresaId=null` retornaba `{ domicilio: [], sucursal: [], ... }` por la rama `couriersConfigurados.length === 0`. El usuario no recibía feedback de qué hacer — solo "no hay opciones disponibles".

**Por qué Modo Dios "TODAS" no aplica a cotizar/crear:** la cotización requiere conocer las credenciales y reglas de UNA empresa específica. "Cotizar para todas las empresas a la vez" no es operación válida (cada empresa tiene credenciales distintas, contratos distintos, reglas distintas). En la plataforma anterior se resolvía con un dropdown explícito "trabajando como contador externo, ¿para qué cliente?".

**Cómo se cierra:**
- **Backend** (`lib/cotizador.ts` y `lib/envios/crear.ts`): cuando `empresaId === null`, lanza `Error('EmpresaRequerida: ...')`. Los route handlers de `/api/cotizar` y `/api/envios/manual` capturan ese error y devuelven `HTTP 400 { error, code: 'EMPRESA_REQUERIDA' }`. `/api/envios` POST (e-commerces vía API Key) no se cambia: la API Key garantiza un `empresaId` válido del header.
- **Frontend**: en `/cotizar`, `/cotizador-rapido`, `/nuevo-envio` y `CotizadorModal`, si el rol del usuario es shipro, se muestra un dropdown "Cotizar para empresa: [Seleccionar...]" como primer paso. Mientras no hay empresa elegida, los inputs de cotización quedan deshabilitados/ocultos. Al elegir, se envía como `body.filtroEmpresa = empresaId`. Para clientes (operador_cliente, gerente_cliente) no se muestra dropdown — su empresa está fija desde la sesión.
- **Datos del dropdown**: consume `/api/clientes` (que ya existe).

## DEUDA 11 — Normalización inconsistente del campo `nombreCourier` (RESUELTA 2026-06-03 — zombi, fix probable durante DEUDA 29)

**Status:** Detectada el 2026-04-29 durante el debug del bug que generaba etiquetas SHP-XXXXXX en `crearEnvio`. Fix mínimo aplicado en `lib/envios/crear.ts` (usa ahora `courierReal.nombre` en el findUnique, en vez de `courierNombreLimpio`). El problema estructural persiste en 5+ archivos más; PENDIENTE refactor consistente.

**Resolución (2026-06-03):** Verificada zombi durante auditoria del backlog. El patron viejo `courierNombreLimpio` (con `.toLowerCase()` aplicado antes del findUnique) ya NO existe en ningun archivo. Los 5 archivos originalmente clasificados como BUG ahora usan el helper centralizado `obtenerCredencialCourier()` (en `lib/couriers/normalizar.ts`) que internamente llama a `obtenerCourier()` para resolver variantes (case-insensitive, apostrofes, espacios), y luego usa el `nombre` canonico de BD para el findUnique. El bug de "Mocis" vs "Moci's" tambien esta absorbido por el helper `normalizarParaComparacion()`. El sexto caso (`configuracion/couriers` con `courier.id`) sigue como originalmente clasificado (⚠️ dependiente del frontend, no era BUG sino warning).

**Hora probable del fix:** durante el refactor de DEUDA 29 (arquitectura multicourier, 2026-05-06 a 2026-05-21), cuando se introdujo `obtenerCourier()`. La entrada quedo stale en DEUDAS.md hasta hoy.

**Detalle:** `Courier.nombre` y `CredencialCourier.nombreCourier` se almacenan en BD con capitalización exacta (`"Andreani"`, `"Moci's"`, `"Moova"`, `"Javit"`). Pero el código tiene **múltiples convenciones contradictorias** para hacer lookups vía `findUnique` con la unique `empresaId_nombreCourier`:

| Archivo | Forma de pasar `nombreCourier` al findUnique | Estado |
|---|---|---|
| `lib/envios/crear.ts:163` (post-fix) | `courierReal.nombre` | ✅ OK |
| `app/api/envios/rastreo-manual/route.ts:24` | `envio.courier.nombre` | ✅ OK |
| `app/api/envios/inversa/route.ts:27` | `envioOriginal.courier.nombre` | ✅ OK |
| `app/api/cron/rastreo/route.ts:40` | `envio.courier.nombre` | ✅ OK |
| `app/api/envios/cancelar/route.ts:22` | `envio.courier.nombre.toLowerCase()` | ❌ BUG (devuelve NULL) |
| `app/api/envios/corregir/route.ts:58` | `envio.courier.nombre.toLowerCase()` | ❌ BUG |
| `app/api/etiquetas/masiva/route.ts:112` | `envio.courier.nombre.toLowerCase()` | ❌ BUG |
| `app/api/envios/sucursales/route.ts:38` | `courier` del query (lowercase) | ❌ BUG |
| `app/api/envios/andreani/excepciones/route.ts:56` | `'andreani'` literal lowercase | ❌ BUG |
| `app/api/configuracion/couriers/route.ts:55,71` | `courier.id` del body | ⚠️ depende del frontend |

**Bug latente adicional (Mocis):** la función de normalización en `crear.ts` mapea Mocis a `"Mocis"` (sin apóstrofe) cuando la BD tiene `"Moci's"` (con apóstrofe). El usuario solo testeó Andreani; este caso se rompería en cuanto un cliente intente operar con Mocis por nombre (no por id). Ver función:
```ts
if (textoIngresado.includes('mocis') || textoIngresado.includes('moci')) nombreOficial = "Mocis";
```
Debería ser `"Moci's"` para coincidir con BD.

**Why:** Cualquier `findUnique` con `nombreCourier` lowercase contra BD capitalizada devuelve NULL silenciosamente. En `crearEnvio` esto generaba etiquetas SHP-XXXXXX sin warning, sin error en terminal, con `200 OK` y 5.4s de latencia (porque el HTTP a Andreani sí ocurre, pero el lookup falla antes y el código no entra al bloque de despacho). El mismo bug existe latente en cancelar / corregir / etiquetas masivas / sucursales / Andreani excepciones — operaciones que parecen funcionar pero internamente no resuelven credenciales.

**How to apply (refactor recomendado, ~1 hora):**
- Adoptar UNA convención: `nombreCourier` siempre como `Courier.nombre` capitalizado (sin migración de datos, BD ya está así).
- Crear helper `lib/couriers/normalizar.ts` con `normalizarNombreCourier(nombre: string): string` que convierta cualquier variante (lowercase, sin apóstrofe, con espacios) al nombre canónico de BD. La función puede consultar la tabla `Courier` para mapear o tener una tabla en memoria.
- Reemplazar los 5 callsites con `.toLowerCase()` o lowercase literal por `normalizarNombreCourier()`.
- Corregir la normalización Mocis: `nombreOficial = "Moci's"` (con apóstrofe).
- Test: crear envío con Andreani Y Moci's (ambos couriers integrados activos hoy) y confirmar que ambos llegan al adapter real con tracking real.
- Considerar índice case-insensitive en `CredencialCourier.empresaId_nombreCourier` cuando se migre a Postgres (`citext`).

**Por qué fix mínimo en `crear.ts` ahora y no refactor completo:** el bug está activo en el flow más crítico (crear envío con débito de saldo + facturación + mail al cliente). Los otros casos están latentes pero menos visitados (cancelar manual, corregir desde mail, etc.). Refactor consistente queda para una pasada dedicada.

## DEUDA 12 — Refactor completo de gestión de couriers integrados (ABSORBIDA por DEUDA 29)

**Status actualizado 2026-05-07:** Esta deuda fue ABSORBIDA por el diseño de DEUDA 29 (commit 3ee9026). Las modificaciones a tablas Courier y CredencialCourier que cubren el alcance de DEUDA 12 están especificadas en docs/ARQUITECTURA-MULTICOURIER.md. Cierre definitivo cuando se implemente DEUDA 29.

**Status original:** Detectada el 2026-04-29 durante el debug del bug de `courierRecolector="pickup"` en `lib/envios/crear.ts`. Fix temporal aplicado el mismo día (manejo de 3 casos en `crear.ts`); refactor completo PENDIENTE como SUB-PASO mayor post-MVP. Estimado 2-3 días dedicados. No bloquea operación con los 2 couriers integrados hoy (Andreani + Moci's) pero sí bloquea el escalamiento a más couriers e integradores externos.

**Nota complementaria (descubierta diseñando DEUDA 29):** 0 envíos en BD tienen `trackingFirstMile`. El flujo first-mile nunca corrió productivamente. Esto valida que cualquier refactor de `courierRecolector` tiene riesgo bajo de migración.

**Estado actual del modelo:**
- `CredencialCourier.courierRecolector` mezcla valores legacy y nombres reales: `"pickup"`, `"mismo_courier"`, `"shipro_cross"`, `"dropoff"`, nombres de courier (`"Moci's"`, `"andreani"`). Los 4 registros de la BD actual tienen `"pickup"` (placeholder importado de la plataforma anterior).
- Credenciales master de Shipro hardcodeadas en `.env.local` (`ANDREANI_USER`, `ANDREANI_PASS`, `MOCIS_USER`, etc.). No auditable (no se sabe quién las cambió ni cuándo). Rotar requiere developer + redeploy.
- Datos del courier dispersos: nombre en tabla `Courier`, credenciales en `.env.local`, configuración por cliente en `CredencialCourier`, datos fiscales/postales/contacto en **ningún lado**.
- URLs de courier hardcoded en ambos adapters (Mocis y Andreani) — ver "Otras deudas menores" para detalle y decision de postergar.

**Fix temporal aplicado hoy (SUB-PASO 7 fix):** En [lib/envios/crear.ts](lib/envios/crear.ts), el bloque de despacho del recolector ahora maneja 3 casos:
- **Caso A (mismo courier recolecta):** `courierRecolector` vacío, `"mismo_courier"`, `"pickup"` (legacy), o igual al `nombreCourier` del main → no se despacha First-Mile.
- **Caso B (microhub):** valor distinto a los anteriores y a `"dropoff"` → despacha con ese courier. Compatibilidad legacy: `"shipro_cross"` mapea a `"mocis"`.
- **Caso C (dropoff, cliente lleva al courier):** `"dropoff"` → no se despacha First-Mile.

**Visión completa (ABM administrativo de couriers integrados):**

Un módulo nuevo en el dashboard, accesible solo para `admin_shipro`, que gestione por cada courier integrado a la plataforma:

1. **Credenciales master de Shipro** — hoy en `.env.local`. Migrar a tabla `CourierIntegracion` con cifrado en BD. Permitir rotación sin tocar código. Auditoría: `lastUpdatedBy` + `lastUpdatedAt`.

2. **Configuración de First-Mile / Microhub** — flag `disponibleComoMicrohub`, tarifas que cobra por el First-Mile, capacidad operativa (zonas, horarios). Reemplaza el string libre actual de `courierRecolector` por una relación FK explícita.

3. **Datos postales y fiscales** — razón social, CUIT, domicilio fiscal, contacto (mail, teléfono), tipo de IVA, cuenta bancaria para liquidaciones.

4. **Datos de conciliación** — frecuencia de liquidación, formato de archivo aceptado, mail al que enviar.

5. **Estado del servicio** — activo/inactivo, provincias en las que opera, horarios de atención, tipos de servicio (domicilio, sucursal, same-day, etc.).

**Beneficios:**
- Admin de Shipro no necesita developer para cambios sensibles (rotar credenciales, activar/desactivar courier).
- Escalabilidad: integrar courier nuevo = cargar formulario + escribir adapter (no tocar `.env`, no tocar despacho).
- Auditoría completa de cambios.
- Datos relacionados juntos (no dispersos).
- Refactor concentrado en un módulo, no esparcido por el código.

**Migración del modelo:**
- Nueva tabla `CourierIntegracion` (1:1 con `Courier` actual o reemplazo).
- En `CredencialCourier`: reemplazar `courierRecolector: string` por `courierMicrohubId: Int? FK CourierIntegracion` + enum `modoRecoleccion: "MISMO" | "MICROHUB" | "DROPOFF"`.
- Data migration: convertir los 4 registros con `"pickup"` legacy a `modoRecoleccion = "MISMO"`, `courierMicrohubId = null`.
- Eliminar todo el mapeo legacy del código (incluyendo el fix temporal de hoy en `crear.ts`).

**Prioridad:** importante post-MVP. No bloquea la operación inmediata con Andreani + Moci's, pero hay que tenerlo antes de onboarding masivo de couriers o de empresas que requieran auditoría de credenciales.

## DEUDA 14 — Fallback hardcodeado a localhost en cron de rastreo (RESUELTA 2026-06-02 — helper bifurcado strict/soft)

**Status:** Identificada el 2026-04-29 durante la auditoría de SUB-PASO 8 (protección de crons). RESUELTA el 2026-06-02 con helper `lib/utils/app-url.ts` bifurcado (`getAppUrlOrThrow` para crons/endpoints + `getAppUrl` para mails en runtime).

**Resolución (2026-06-02):** Investigación detectó que el patrón hardcoded `process.env.APP_URL || "http://localhost:3000"` no estaba solo en el cron de rastreo — habia 9 ocurrencias en 7 archivos (DEUDA 14 alcance original mas amplio que lo documentado). Solución implementada en BLOQUE 1 de quick wins (sesion 2026-06-02):

1. Nuevo helper en `lib/utils/app-url.ts` con dos exports bifurcados segun contexto:
   - `getAppUrlOrThrow(): string` — fail-fast. Lanza Error si `APP_URL` no está. Usado en crons/endpoints donde es OK romper si la config falta.
   - `getAppUrl(): string | null` — best-effort. Retorna `null` + `console.warn` si `APP_URL` no está. Usado en mails de runtime para que la creación de envío NO se rompa por config faltante (principio "que la venta no se pierda").

2. Migración de 9 ocurrencias:
   - **Strict (2 callers)**: `app/api/cron/rastreo/route.ts`, `app/api/nps/route.ts` — fail-fast con `getAppUrlOrThrow()`.
   - **Soft (7 ocurrencias en 5 archivos)**: `app/api/clientes/route.ts` (x2), `lib/envios/crear.ts` (x2 en un solo guard global), `lib/envios/procesar-bloqueados.ts`, `lib/envios/procesar-bloqueados-operatividad.ts`, `lib/envios/procesar-bloqueados-deposito.ts` — guard `if (baseUrl)` antes del bloque mail.

3. Verificación: `tsc` 0 errores. Grep final confirma cero ocurrencias del fallback hardcoded en `lib/` y `app/` (solo queda 1 hit en el comentario del header del helper como documentación).

Efecto operativo en producción: si `APP_URL` se olvida en un deploy:
- Crons y endpoints administrativos rompen con error explícito (te enteras antes de afectar clientes).
- Mails en runtime de envíos: NO se envían + warn en consola. El envío se crea igual, el cliente no recibe mail con link roto.

**Detalle:** [app/api/cron/rastreo/route.ts:10](app/api/cron/rastreo/route.ts#L10):

```ts
const baseUrl = process.env.APP_URL || "http://localhost:3000";
```

`baseUrl` se usa para construir los links en los mails de colecta y NPS que el cron dispara cuando un envío cambia de estado (ver líneas 85-91). Si en producción se olvida configurar `APP_URL`, el cron responde 200 OK normalmente, pero los mails al cliente final van con links a `http://localhost:3000/s/<tracking>` y `http://localhost:3000/...` (NPS). Síntoma silencioso: la plataforma "funciona" pero los clientes reciben mails rotos.

**Mitigación actual:** `APP_URL` está en `.env.local` y documentada como variable requerida en `docs/CRONS.md` (sección 3). Confiar en el procedimiento de deploy.

**Fix futuro (recomendado, ~5 minutos):** reemplazar el fallback por un throw fail-fast al inicio del handler:

```ts
const baseUrl = process.env.APP_URL;
if (!baseUrl) {
  return NextResponse.json({ error: "APP_URL no configurada" }, { status: 500 });
}
```

Así el cron se rompe ruidosamente en lugar de mandar mails rotos. Aplicar también si aparece el mismo patrón en otros archivos.

## DEUDA 15 — Arquitectura de capacidades por courier (ABSORBIDA por DEUDA 29)

**Status actualizado 2026-05-07:** Esta deuda fue ABSORBIDA completamente por el diseño de DEUDA 29 (commit 3ee9026). Las 9 capacidades booleanas en la tabla Courier especificadas en docs/ARQUITECTURA-MULTICOURIER.md son exactamente lo que pedía DEUDA 15. Cierre definitivo cuando se implemente DEUDA 29.

**Status original:** Identificada el 2026-04-29 durante los tests manuales de SUB-PASO DEUDA 5. PENDIENTE — refactor estructural. Estimado 1-2 días dedicados.

**Estado actual:** El cotizador y la lógica de creación de envíos asumen que **todos los couriers ofrecen el mismo set de servicios**: domicilio + sucursal + cambio + devolución. La realidad es muy distinta: cada courier ofrece un set específico de servicios y soporta un set específico de acciones.

**Ejemplos reales:**
- **Andreani:** "Express Domicilio", "Estándar Domicilio", "Sucursal", "Cambio", "Devolución" — cada uno con un contrato comercial separado, su propia tarifa, y un endpoint/método de API distinto.
- **Moci's:** "Same Day", "Next Day", "Inversa" (devolución). Pendiente sumar "Pick-up"/"First-Mile" cuando se coordine con Moci's (ver DEUDA 13).
- **Acciones por courier:** algunos permiten cancelar post-impresión, otros no; algunos permiten editar dirección, otros no; algunos exponen rastreo en tiempo real vía webhook, otros solo polling.

**Why:** sin modelar las capacidades por courier:
- El cotizador muestra opciones que no existen (ej: "Express Domicilio" para un courier que no ofrece ese servicio).
- La UI de operador muestra acciones que el courier rechaza (ej: botón "Cancelar" cuando el courier no soporta cancel).
- No se puede hacer ABM de tarifas por servicio (cada servicio tiene su propia tabla de precios).
- Onboarding de un courier nuevo requiere code changes en lib/couriers/* en lugar de configuración.

**How to apply (estructural, 1-2 días):**
1. **Modelo de datos:**
   - Tabla `CourierServicio` con `(courierId, nombre, tarifaTipo, endpointApi, contratoId, activo, tipoServicio)`. `tipoServicio` enum: DOMICILIO_EXPRESS, DOMICILIO_ESTANDAR, SUCURSAL, CAMBIO, DEVOLUCION, SAME_DAY, NEXT_DAY, etc.
   - Tabla `CourierAccion` con `(courierId, accion, soportado, endpointApi)`. `accion` enum: CANCELAR, CORREGIR_DIRECCION, RASTREAR_REALTIME, GENERAR_INVERSA, etc.
2. **Cotizador:** filtrar opciones según `CourierServicio.activo` para el courier+empresa.
3. **UI de operador:** habilitar/deshabilitar botones según `CourierAccion.soportado`.
4. **ABM (DEUDA 12):** permite gestionar todo esto por courier sin tocar código.

**Bloquea:** onboarding de couriers nuevos (cualquier courier que no sea Andreani+Moci's actuales requiere code changes). También bloquea correcta facturación por servicio.

## DEUDA 16 — Sistema PREPAGO/POSTPAGO por credencial courier (RESUELTA en commit 288a791)

**Status:** RESUELTA en commit 288a791 (2026-04-30).

**Estado actual:**
- El código bloquea envíos si `Empresa.saldoActivo < costo`, **sin importar el tipo de cuenta**. La empresa tiene un campo `modalidadPago: "POSTPAGO"|"PREPAGO"` global pero la lógica de bloqueo de saldo no lo respeta consistentemente.
- Cliente Demo tiene `modalidadPago=POSTPAGO` en BD pero el código no diferencia el comportamiento.

**Contexto refinado por el usuario (clave):** El tipo de cuenta **NO es global por empresa**. Es una propiedad de **cada combinación cliente ↔ courier**. Razón:

> Un cliente puede operar **POSTPAGO con Andreani** (usa credenciales Shipro, cuenta corriente con Andreani vía Shipro, saldo virtual no aplica) y **PREPAGO con Moci's** (usa sus credenciales propias, billetera virtual de Shipro cobra por anticipado, courier le factura directo). Los acuerdos comerciales reales no son uniformes.

**How to apply (medio día):**
1. **Schema:** mover `tipoCuenta: PREPAGO | POSTPAGO` de `Empresa` a `CredencialCourier` (campo nuevo, default según política comercial).
2. **`lib/cotizador.ts` y `lib/envios/crear.ts`:**
   - Si `CredencialCourier.tipoCuenta === POSTPAGO` → no validar saldo, permitir el envío sin importar el saldo actual.
   - Si `CredencialCourier.tipoCuenta === PREPAGO` → validar saldo antes y debitar después.
3. **UI `/mis-transportes`:** dropdown PREPAGO/POSTPAGO por cada courier activado por el cliente.
4. **ABM general (DEUDA 12):** permite admin_shipro definir el default por integración nueva.

**Why bloquea producción:** sin esto, todos los clientes deben tener saldo virtual cargado para operar (incluso los que tienen contratos POSTPAGO con couriers vía Shipro). Es bloqueante para onboarding real.

## DEUDA 17 — UI de onboarding completo de cliente (RESUELTA 2026-06-24 en commits 54cd9a3 + 413927a)

**Status:** Identificada el 2026-04-29 durante los tests manuales de SUB-PASO DEUDA 5. PENDIENTE — estimado 1-2 días.

**Estado actual:** Los campos críticos de un cliente nuevo se cargan **manualmente en BD** o vía endpoints sueltos: razón social, CUIT, condición IVA, dirección fiscal, datos de contacto, configuración de billetera, primera credencial courier, etc. No hay un wizard de onboarding ni validación cruzada.

**How to apply (1-2 días):** wizard `/admin/empresas/onboarding` con flujo guiado:
1. **Datos fiscales:** CUIT (con validación contra AFIP si es factible), razón social, condición IVA, domicilio fiscal.
2. **Datos de contacto:** mail principal, teléfono, dirección de operación (si distinto a fiscal).
3. **Configuración default:** `tipoCuenta` default (POSTPAGO/PREPAGO) + couriers iniciales activados.
4. **Flag `requiereRevision: boolean`:** la empresa queda creada pero no operativa hasta que admin_shipro la valide. Mientras `requiereRevision=true`, login funciona pero no se puede crear envíos ni cotizar.
5. **Notificación:** mail al admin_shipro de turno cuando una empresa nueva queda lista para revisión.
6. **Audit log:** registrar quién hizo el onboarding, quién validó, fechas.

**Why no es bloqueante absoluto:** se puede hacer manualmente en BD para los primeros clientes mientras el módulo se construye, pero a partir de ~10 clientes se vuelve ingobernable.

## DEUDA 19 — Sistema de auditoría para cambios de credenciales y configuración (RESUELTA 2026-06-17 en commit 201de2e)

**Status:** Identificada el 2026-04-29 durante los tests manuales de SUB-PASO DEUDA 5 (refinada con escenarios concretos del usuario). PENDIENTE — estimado 1 día.

**Contexto del usuario (clave):**
> Con 500 clientes activos, los cambios manuales en credenciales o `tipoCuenta` son ingobernables sin trazabilidad. Tres escenarios problemáticos reales:
> 1. Un cliente tiene contrato propio con Andreani (POSTPAGO con Andreani). Por error operacional alguien activa "credenciales Shipro" en la configuración. El error pasa silencioso hasta facturación de fin de mes — Shipro factura los envíos al cliente como si fueran cuenta corriente Shipro, pero el courier ya facturó al cliente directamente. Doble cobro.
> 2. Un cliente cambia de PREPAGO a POSTPAGO sin proceso de aprobación. El cliente empieza a generar deuda con Shipro sin que se haya validado su capacidad de pago.
> 3. Un cliente queda con configuración inconsistente entre couriers (ej: Andreani POSTPAGO, Moci's PREPAGO, pero la empresa no tiene saldo cargado y los envíos Moci's empiezan a rebotar).

**How to apply (1 día):**
1. **Schema:** tabla `AuditoriaConfiguracion` con `(id, usuarioId, fecha, empresaId, courierId, campo, valorAnterior, valorNuevo, motivo, ipOrigen)`.
2. **Logging automático:** middleware en Prisma o trigger en cada `update`/`upsert` de `CredencialCourier`. Registrar `usuarioEmail` (lectura del JWT en el handler), no solo `usuarioId`.
3. **Doble confirmación UI:** para cambios sensibles (cambiar de POSTPAGO a PREPAGO, activar credenciales Shipro en cliente que tiene propias, etc.) mostrar modal de confirmación con texto explícito + obligación de escribir un motivo.
4. **Notificación a admin_shipro:** cuando se detecta cambio en cliente activo (ej: una empresa con envíos en los últimos 7 días), mandar mail al equipo Shipro de turno.
5. **Dashboard `/admin/auditoria-configuracion`:** filtros por empresa, courier, usuario que hizo el cambio, fecha. Permite reconstruir la historia de configuraciones.

**Relación con DEUDA 12 (ABM de couriers):** este audit log debería extenderse a TODA acción administrativa del ABM, no solo `CredencialCourier`. Diseñar el schema con esa generalización en mente.

**Why bloquea producción:** sin auditoría, cualquier error operacional o cambio malicioso queda sin trazabilidad. Cuando un cliente reporta "yo no autoricé este cambio", no hay forma de demostrar lo contrario.

## DEUDA 20 — Endpoint manual para procesar bloqueados restantes (ABSORBIDA 2026-06-03 por DEUDA 38)

**Status:** Identificada el 2026-04-30 durante implementación de DEUDA 16. ABSORBIDA el 2026-06-03 por DEUDA 38 (Reproceso desacoplado de envios bloqueados — background + cron + boton manual, registrada en `docs/ARQUITECTURA-MULTICOURIER.md` Sec 13 durante el cierre de DEUDA 32+37). El scope de DEUDA 38 es mas amplio y cubre completamente la funcionalidad pedida por DEUDA 20. Cierre definitivo cuando se implemente DEUDA 38. Mismo patron documental usado para DEUDA 12 y DEUDA 15 absorbidas por DEUDA 29.

**Detalle:** `procesarEnviosBloqueados()` ([lib/envios/procesar-bloqueados.ts](lib/envios/procesar-bloqueados.ts)) procesa máximo 10 envíos FIFO inline tras una recarga. Si un cliente tiene 50 envíos BLOQUEADO_SALDO y recarga saldo suficiente para los 50, solo se destraban 10 — los 40 restantes quedan bloqueados hasta otra recarga.

**How to apply (~2 horas):** endpoint `POST /api/envios/reintentar-bloqueados` (admin_shipro o gerente_cliente), con body `{ empresaId? }`. Llama a `procesarEnviosBloqueados()` y retorna el `recovery`. UI: botón "Reintentar bloqueados" en `/admin-finanzas` y `/dashboard`.

**Why no bloqueante:** mientras el volumen sea bajo (< 10 bloqueados por cliente por día), el procesamiento inline post-recarga alcanza. Pasar a manual cuando aparezcan casos con cola larga.

## DEUDA 21 — Matriz de permisos granular en /mis-transportes (RESUELTA 2026-06-18 en commit 05aaa17)

**Status:** Identificada el 2026-04-30 durante implementación de DEUDA 16. PENDIENTE — extensión de la política defense-in-depth.

**Estado actual:** En DEUDA 16 se aplicó defense-in-depth solo al campo `tipoCuenta` ([app/api/configuracion/couriers/route.ts](app/api/configuracion/couriers/route.ts)). Los demás campos del mismo handler (activar/desactivar courier, cargar credenciales propias, marcar credenciales Shipro, markups, recolector) NO tienen validación per-rol — cualquier usuario con sesión válida puede modificarlos.

**Riesgo:** un `operador_cliente` con bypass del frontend (DevTools) podría desactivar la integración de Andreani de su empresa, o cambiar a "credenciales Shipro" generándose un riesgo de doble facturación. La UI lo bloquea pero el backend no.

**How to apply (~3 horas):** definir matriz explícita de permisos por campo en `mis-transportes`. Por ejemplo:

| Campo | admin_shipro | gerente_cliente | operador_cliente | operador_shipro |
|---|---|---|---|---|
| `activo` | ✅ | ✅ | ❌ | ✅ (auditoría) |
| `usaCredencialesPropias` | ✅ | ✅ | ❌ | ❌ |
| `credencialesJson` (propias) | ✅ | ✅ | ❌ | ❌ |
| `credencialesJson` (Shipro) | ✅ | ❌ | ❌ | ❌ |
| `markup*` | ✅ | ✅ | ❌ | ❌ |
| `tipoCuenta` | ✅ | ❌ | ❌ | ❌ |
| `courierRecolector` | ✅ | ✅ | ❌ | ❌ |

Implementar como helper `lib/permisos.ts` con `puedeEditarCampo(rol, campo): boolean` y aplicar en el handler como spread de patches condicionales (mismo patrón que DEUDA 16 con `tipoCuentaPatch`).

**Relación con DEUDA 19:** cada cambio sensible debe loggearse (auditoría). DEUDA 21 + DEUDA 19 trabajan en conjunto.

## DEUDA 22 — Suspensión automática de cuenta al alcanzar limiteDescubierto (RESUELTA 2026-06-18 en commit 4e5041e)

**Status:** Identificada el 2026-04-30 durante implementación de DEUDA 16. PENDIENTE.

**Estado actual:** Una empresa POSTPAGO con `limiteDescubierto = $0` y saldo negativo sigue creando envíos (caen en BLOQUEADO_SALDO en DEUDA 16, OK). Pero una empresa POSTPAGO con `limiteDescubierto = $50.000` y saldo `-$60.000` también sigue creando envíos bloqueados — la cuenta debería suspenderse antes (cobrar antes de seguir prestando).

**How to apply (~medio día):**
- Nuevo campo `Empresa.suspendida: boolean @default(false)`.
- Al pasar el límite, marcar `suspendida = true` automáticamente (en `lib/envios/crear.ts` o en el cron de finanzas).
- Mientras suspendida: rechazar **toda** creación de envío con código `CUENTA_SUSPENDIDA` (no solo los que excedan saldo).
- UI: banner rojo prominente en dashboard cliente con instrucciones de regularización.
- Re-activación automática cuando el saldo vuelve a `>= -limiteDescubierto * 0.5` (margen para evitar flapping).
- Notificación a admin_shipro al detectar empresa suspendida (alerta de gestión).

**Why bloqueante pre-producción real:** sin suspensión automática, un cliente Modelo A (cuenta corriente) puede generar deuda ilimitada. Riesgo financiero alto.

**Relación con DEUDA 19:** suspensión + cambio de estado de cuenta es evento de auditoría obligatorio.

## DEUDA 26 — Limpieza de tabla Provincia y Localidad (RESUELTA 2026-06-03 — 3 fases)

**Status:** Identificada el 2026-05-03 durante DEUDA 4 (módulo Depósitos), tras verificar el endpoint `/api/geografia/buscar`. RESUELTA el 2026-06-03 en BLOQUE 2 quick wins.

**Resolución (2026-06-03 BLOQUE 2):** Cerrada completa en 3 fases. La premisa original era falsa — no era problema de mayúsculas/acentos sino CSV parsing roto + realidad postal argentina con CPs cross-provincia legítimos. Investigación de director y consultor durante la sesión derivó en 3 ejes complementarios:

**Fase C — Limpieza de basura del parse del CSV (BD).** Migration formal `20260602154255_deuda_26_limpieza_provincias_basura` eliminó 20 provincias basura (IDs 4-19, 23, 32, 37, 39) + 28 localidades dependientes via Cascade FK. Las provincias basura eran fragmentos de nombres rurales mal parseados ("RUTA 8 KILOMETRO 19,500 AL 22" caía como localidad "RUTA 8 KILOMETRO 19" + provincia "500 AL 22" por coma decimal sin escapar). Estado post-migration: Provincia 44→24, Localidad 19,201→19,173, CodigoPostal 2,183 (intacto).

**Fase D — Defensa en seed.ts.** Agregado guard con `normalizarProvincia()` antes del upsert en `prisma/seed.ts:148`. Si el seed se vuelve a correr (otro entorno, dev fresh install), las filas con provincia no canónica son rechazadas con `console.warn` y skipeadas (no se persisten). El seed completa el resto de las filas válidas sin interrumpirse.

**Fase F — Endpoint inteligente "provincia dominante".** Modificado `/api/geografia/buscar/route.ts` para que cuando un CP tenga localidades en múltiples provincias (92 casos legítimos en Argentina — zonas limítrofes tipo Delta del Paraná, Bariloche/Isla Victoria, NEA Litoral, NOA, Cuyo, Patagonia), devuelva la provincia con MÁS localidades y filtre la respuesta solo a las localidades de esa provincia. Esto evita que el dropdown del comprador muestre localidades inconsistentes con la provincia retornada.

**Test E2E verificado en runtime (2026-06-03):** CP 8400 (Bariloche) → "Río Negro" + 19 localidades correctas (sin "ISLA VICTORIA" ni "PUERTO ANCHORENA" que eran las 2 de Neuquén). CP 2000 (Rosario) → "Santa Fe" + 6 localidades correctas (sin "VILLA ANGELICA" de Entre Ríos). CP 1614 (Villa de Mayo) → "Buenos Aires" + ["VILLA DE MAYO"] (caso no cross-provincia, comportamiento inalterado). tsc=0 en cada fase.

**Trade-off aceptado:** las localidades de la provincia minoritaria de cada CP cross-provincia (ej: "ISLA VICTORIA" para CP 8400) ya NO aparecen en el dropdown del comprador. <0.01% de los casos. Si un comprador legítimo necesita enviar a una localidad minoritaria, corrige manualmente la provincia desde el form.

**Deuda residual identificada:** ~10-15 CPs rurales argentinos (rutas/kilómetros/apeaderos ferroviarios) fueron perdidos durante el parse del CSV. Registrados como DEUDA 40, no urgentes — son zonas sin localidad humana real y la gran mayoría de compradores no envían a esas direcciones.

**Decisión del director (2026-06-03):** Datos postales reales son críticos para que el courier entregue perfecto. Si el CP no existe, Shipro no da respuesta. La gran mayoría debe estar prolija para usabilidad correcta. Cierre completo sí, recuperar CPs rurales no es prioritario.

**Estado actual:**
- Tabla `Provincia` tiene **44 entradas**: 24 reales en MAYÚSCULAS sin acentos (`BUENOS AIRES`, `CIUDAD AUTONOMA DE BUENOS AIRES`, `CORDOBA`, `NEUQUEN`, etc.) + **20 basura** del parseo del CSV (`100 AL 21`, `300 (APEADERO FCGB)`, `400-LADO ESTE)`, `5`, `500`, etc.).
- Tabla `Localidad` tiene 19201 entradas, todas en MAYÚSCULAS sin acentos (ej: `RECOLETA`, `LOS POLVORINES`).
- Causa: el parser CSV (`csv-parser` en seed.ts) no maneja correctamente filas con comas dentro de campos (ej: localidades como "BARRIO X, ZONA Y"), generando filas malformadas con campos corridos.

**Mitigación temporal aplicada en DEUDA 4:**
- `lib/constants/normalizar-provincia.ts` mapea variantes mayúsculas/sin-acentos a la lista canónica `PROVINCIAS_AR`.
- `app/api/geografia/buscar/route.ts` aplica el normalizador antes de devolver, filtrando entradas basura (devuelve `provincia: null, localidades: []` cuando la provincia no matchea).
- BD intacta — el frontend ve datos limpios.

**How to apply (1-2 horas, sesión dedicada):**
1. Reemplazar `csv-parser` por uno que respete RFC 4180 (ej: `papaparse` o `csv-parse` con opciones strict).
2. En `prisma/seed.ts`:
   - Pre-procesar cada fila: `provincia` se mapea con `normalizarProvincia()` antes del upsert. Si retorna null, descartar fila.
   - `localidad` se transforma a Title Case (helper) antes del create/findFirst.
3. Migración de limpieza (script TypeScript):
   - DELETE de las 20 provincias basura + sus localidades asociadas + sus codigos postales asociados (cascade).
   - UPDATE de las 24 provincias reales a la versión canónica de `PROVINCIAS_AR`.
   - UPDATE de cada localidad a Title Case.
4. Eliminar `lib/constants/normalizar-provincia.ts` (ya no es necesaria una vez la BD está limpia).
5. Simplificar el endpoint `/api/geografia/buscar` (sacar la llamada al normalizador).

**Riesgo:** los envíos existentes guardan provincia/localidad en `Direccion` como **strings**, no como FKs. Verificado: la limpieza de las tablas Provincia/Localidad no rompe envíos históricos. Pero conviene re-verificar antes del deploy.

**Why no bloqueante hoy:** la mitigación temporal cubre el caso visible (dropdown frontend). Las 20 entradas basura en Provincia no aparecen en ningún lugar del UI porque el normalizador las filtra con null. Operativamente el sistema funciona. Pero la limpieza estructural es importante antes del deploy a Postgres en Linode (mejor migrar BD limpia que arrastrar la deuda).

## DEUDA 27 — Etiqueta diferida por depósito faltante (RESUELTA 2026-05-04 en commit e7d92b9 — header stale hasta 2026-06-17)

**Status:** Identificada el 2026-05-04 durante FASE E de DEUDA 4. RESUELTA EL MISMO DÍA en commit e7d92b9 (DEUDA 4 — Módulo de Depósitos cierre completo). Header quedó stale por más de 1 mes; sincronización realizada 2026-06-17 durante audit completo de DEUDAS.

**Evidencia de cierre (verificada 2026-06-17):**
- Estado nuevo `BLOQUEADO_DEPOSITO` implementado en lugar de bloqueo duro HTTP 400.
- Procesador FIFO `lib/envios/procesar-bloqueados-deposito.ts` (382 líneas) paralelo a DEUDA 16.
- Triggers automáticos on config en 3 endpoints (`/api/depositos` POST, `/api/depositos/[id]` PUT, `/api/depositos/[id]/predeterminado` POST).
- State usage extensivo en 11+ archivos de `app/`.
- UI condition `esBloqueadoDeposito` en `app/(dashboard)/page.tsx:737`.
- Excluido de cron de rastreo (consistente).

**Caveats menores (no bloqueantes):**
- UI banner amber + CTA "Configurá depósito" no verificado explícitamente — posible polish UX pendiente.
- Mail al gerente no verificado explícitamente.
- Background cron reproceso desacoplado: cubierto por DEUDA 38 (separado).

**Estado actual (post-FASE E DEUDA 4):**
- Si el cliente intenta crear un envío sin depósito predeterminado configurado → bloqueo duro 400.
- E-commerce que recibe ese error puede caerse o mostrar mensaje al comprador.
- La venta del e-commerce queda en limbo o se cancela.

**Visión completa (paralela a DEUDA 16 con BLOQUEADO_SALDO):**
- En lugar de rechazar, crear el envío con tracking `SHP-XXXXXX` y estado `BLOQUEADO_DEPOSITO`.
- NO llamar al courier (no hay origen para despachar).
- NO mandar mail al destinatario hasta que se destrabe.
- SÍ mandar mail al `gerente_cliente` con CTA: "Configurá tu depósito predeterminado en Shipro para destrabar N envíos pendientes."
- Banner amber en dashboard del cliente con contador.
- Cuando el cliente configure su depósito predeterminado: trigger `procesarEnviosBloqueadosPorDeposito(empresaId)` que recorre los `BLOQUEADO_DEPOSITO` y los re-despacha (igual patrón que `procesarEnviosBloqueados()` de DEUDA 16).
- En `/api/depositos/[id]/predeterminado` POST y en el endpoint de creación de primer depósito: invocar la función automáticamente después de marcar/crear.

**How to apply (4-6 horas):**
1. Estado nuevo: `Envio.estadoActual === "BLOQUEADO_DEPOSITO"`. No requiere migración (estadoActual es String libre).
2. Modificar `lib/envios/crear.ts`: en lugar de throw `DepositoRequerido`, setear `bloqueadoPorDeposito = true` y crear envío con SHP-* (igual patrón que DEUDA 16).
3. Modificar `lib/envios/dispatch.ts`: skip si `bloqueadoPorDeposito`.
4. Crear `lib/envios/procesar-bloqueados-deposito.ts` (o extender `procesar-bloqueados.ts` para que sea genérico por motivo).
5. Trigger en `/api/depositos/[id]/predeterminado` POST y en `/api/depositos` POST (cuando es el primer depósito).
6. UI: banner amber + tab "BLOQUEADOS POR CONFIG" en dashboard cliente.
7. Modificar handlers `/api/envios/manual`, `/api/envios` POST, `/api/cotizar`: aceptar el bloqueo y devolver 200 con flag `bloqueadoPorDeposito` (en vez de 400).
8. Mail al gerente con CTA.

**Why post-MVP:** la base operativa (DEUDA 4 + DEUDA 16) ya cubre el flujo crítico. Sin DEUDA 27, el cliente que no configuró depósito recibe 400 claro y configura → flujo funciona. La venta del e-commerce se cae solo si el e-commerce no maneja errores 400. Para MVP es aceptable. Para producción a escala (>50 clientes con onboarding masivo), implementar DEUDA 27 reduce fricción.

**Relación con DEUDA 16:** **arquitectura compartida.** El sistema de "etiqueta diferida con destrabado automático post-configuración" es transversal. Cuando se implemente DEUDA 27, considerar refactorear `procesar-bloqueados.ts` para que acepte un parámetro `motivo: "SALDO" | "DEPOSITO" | otros futuros` y centralice la lógica.

## DEUDA 29 — Adapters de couriers cotizan ignorando `cpOrigen` (RESUELTA FUNCIONALMENTE 2026-05-26 — Sub-fases 3, 5 pendientes como robustness/completeness, no bloqueantes)

**Estado:** CORE BUG RESUELTO. El bug crítico del cpOrigen ignorado fue cerrado en Sub-fase 2.D.despachar (commit a3d79c0, 2026-05-14). Sub-fase 2.C REDISEÑADA en commit 85a9f52 (2026-05-14) post-feedback director e implementada absorbida por la serie 6.D.* (2026-05-15 a 2026-05-26, 12+ commits hasta 6.D.7 d17bafd "Cierra DEUDA 33"). El header anterior declaraba "SUB-FASE 2 CERRADA FUNCIONALMENTE, 2.C UI pendiente" — eso quedó stale; el rediseño + absorción se cerró el 2026-05-26.

**Sub-fases 6.A + 6.D.1-6.D.7 ejecutadas (nuevo modelo conceptual):**
- 6.A (4f9702e): Alineación naming + flow onboarding.
- 6.D.1 (75af4c8): Schema DepositoCourierConfig + migración + seed.
- 6.D.2 (452d2e0): Endpoints CRUD DepositoCourierConfig.
- 6.D rectificación (3084ff4 + 3add6cc): Schema + cascada inteligente.
- 6.D.3 (7192491): Endpoint auto-asignación sucursal.
- 6.D.4 (56bcbbb): Endpoint validación operatividad par.
- 6.D.5 (ad68902): Refactor dispatch.ts + crear.ts.
- 6.D.6 (19af758): Eliminación legacy modoFirstMile + courierRecolectorId.
- 6.D.7 (d17bafd): UX consolidador dry-run + selector + modal cascada (Cierra DEUDA 33).

**Pendientes NO bloqueantes (robustness items, post-launch acceptable):**
- Sub-fase 3: retry on 401 mid-request en adapters (robustness).
- Sub-fase 5: 22 sucursales Andreani sin CPs públicos via `/v2/puntos-de-tercero` autenticado (completeness operativa).

**Identificada:** 2026-05-04 durante smoke test final de DEUDA 4 (Test 4).

**Origen:** bug en adapters Mocis + Andreani — sucursal de origen hardcodeada, ignoraba el depósito real del cliente. Expandida a refactor multi-sub-fase tras el diseño de `docs/ARQUITECTURA-MULTICOURIER.md` (commit `3ee9026` del 2026-05-07).

### Sub-fases

**✅ Sub-fase 1 — Schema, interface y código base** (viernes 8 de mayo, 4 commits, +1576 líneas)
- `1.A` (`252f7f5`): Schema y migración (6 tablas nuevas, 10 capacidades en Courier).
- `1.B` (`b71e648`): Resolver colisión TS `SucursalCourier` → `SucursalInfo`.
- `1.C` (`fc87063`): Adaptación TypeScript (14 archivos, refactor `dispatch.ts`, 3 callers, 3 lectores, `TransportesTab.tsx`).
- `1.D` (`26d5e51`): Capacidades iniciales Andreani(id=1) + Mocis(id=2).

**✅ Sub-fase 2.A — Sincronización sucursales Andreani** (martes 12 de mayo, commit `3e36967`, +342 líneas)
- Schema: `SucursalCourierCp` + FK formal `courierId` en `DepositoSucursalPreferida` + campo `seHaceAtencionAlCliente`.
- Script: `scripts/sincronizar-sucursales-andreani.ts` (filtro `canal=B2C AND seHaceAtencionAlCliente=true`).
- Resultado: 154 sucursales + 3359 CPs en BD.
- TODO Sub-fase 5: 22 sucursales sin CPs públicos (completar con `/v2/puntos-de-tercero` autenticado).

**✅ Sub-fase 2.B.0 — Geocodificación de depósitos** (miércoles 13 de mayo, commit `1f34e3c`, +294 líneas)
- Schema: `latitud`/`longitud`/`ultimaGeocodificacion` en `Deposito`.
- Helper: `lib/geo/geocodificar-direccion.ts` (Google Maps Geocoding API, contrato "nunca lanza").
- Script: `scripts/backfill-coordenadas-depositos.ts`.
- Integración: POST + PUT depósitos con geocoding automático.
- Política híbrida: stale + señal de desactualización ante fallo (`latitud IS NOT NULL AND ultimaGeocodificacion IS NULL`).
- Backfill: 2 depósitos Mowi geocodificados exitosamente.

**✅ Sub-fase 2.B — Endpoint API sucursales preferidas** (miércoles 13 de mayo, commit `5d03552`, +189 líneas)
- Helper: `lib/geo/haversine.ts` (función pura, fórmula clásica, radio Tierra 6371 km).
- Endpoint: `GET /api/depositos/[id]/sucursales-courier/[courierId]`.
- 3 queries Prisma paralelas: sucursales activas + matches por CP + preferencia configurada.
- Haversine en JS: top 20 sucursales ordenadas por cercanía si depósito tiene lat/lng.
- Defense-in-depth: proxy → ownership → courier check → response.
- 6/6 tests end-to-end validados con curl (login real + cookie de cliente@demo.com).
- TODO futuro: DRY del `calcularDistancia` inline en `/api/envios/sucursales/route.ts`.

**🟡 Sub-fase 2.C — UI configuración sucursales preferidas** (PENDIENTE — única pendiente activa)
Pantalla separada accesible desde listado de depósitos. Consume endpoint 2.B y persiste en `DepositoSucursalPreferida` que 2.D.despachar ya consume.

**Sub-fase 2.D — Lógica resolución `sucursalOrigen`** (dividida en cotizar + despachar tras hallazgo empírico)

  **⚪ Sub-fase 2.D.cotizar — Decisión: no implementar** (jueves 14 de mayo, commit `df25818`, empty commit)
  Tras 13 curls de verificación empírica a `GET /v1/tarifas`, se confirmó que Andreani NO acepta override de origen en cotización — la tarifa es función exclusiva de `(contrato, cliente, cpDestino, peso, volumen)`. Implementar este sub-commit sería código no-op. Implicancia comercial documentada en commit message: para clientes fuera de AMBA, la solución es Modelo B (credenciales propias del cliente con contrato firmado desde su zona), no código de adapter.

  **✅ Sub-fase 2.D.despachar — Sucursal de imposición resuelta desde BD** (jueves 14 de mayo, commit `a3d79c0`, +90 / -8 líneas en 7 archivos)
  - Jerarquía 4-niveles en `AndreaniAdapter.despachar()`:
    1. `params.sucursalOrigenId` (preferencia BD ← NUEVO)
    2. `creds.id_sucursal_origen` (.env o credenciales propias)
    3. `params.origen` (CP depósito, DEUDA 4)
    4. Fallback hardcoded (defense-in-depth)
  - `dispatch.ts` agrega lookup de `DepositoSucursalPreferida` (skip inteligente: !depositoId o Mocis sin sucursales).
  - Manejo de sucursal soft-deleteada: log warning + fallback (no rompe).
  - 4 callers de `despacharCourier` modificados con `depositoId: envio.depositoId`.
  - Logística inversa NO tocada (no usa `despacharCourier`).
  - Cero modificaciones a `cotizar()` (irresoluble por contrato, ver 2.D.cotizar).

**✅ Sub-fase 2.E — Remitente real desde BD** (miércoles 13 de mayo, commit `e9ce533`, +62 / -3 líneas en 3 archivos)
- Reemplaza remitente hardcoded ("Shipro / Cliente" + CUIT 30712371729) por datos reales.
- Lookup de Empresa (nombre + cuit) en `dispatch.ts` después del check `credencial.activo`.
- 3 logs `[andreani] WARN` condicionales: sin remitente, sin email, sin teléfono.
- Approach centralizado en `dispatch.ts` (3 archivos vs alternativa de tocar 7 callers).

**✅ Sub-fase 2.F — Tokens robustos con cache + lock + expiración real** (miércoles 13 de mayo, commit `9e21777`, +115 / -11 líneas en 2 archivos)
- Verificación empírica previa: curl a `/login` confirmó shape `{token, refreshToken}` (sin `expires_in` al top-level). Expiración embebida en JWT (claim `exp`).
- `AndreaniAdapter`: cache con margen 5 min + lock `tokenPromise` anti-race + `parseJwtExp` helper + fallback +24h.
- `MocisAdapter`: margen 60s → 300s + lock idéntico + `refreshToken` extraído.
- TODO Sub-fase 3: retry on 401 mid-request en ambos adapters.

**⚪ Sub-fase 2.G — Connection pooling: decisión de no implementar** (miércoles 13 de mayo, commit `178c259`, +18 líneas de comentarios doc)
- Análisis empírico: Node v24 con undici embebido ya hace pooling per-host con `keepAliveTimeout=4s`.
- Flows internos de Shipro (cotizar+despachar consecutivos en <1s) YA reúsan conexión automáticamente.
- Beneficio medible con volumen actual (~10 envíos/día): 1-3 segundos/día ahorrados. Marginal vs latencia variable de couriers.
- Riesgos descartados: `setGlobalDispatcher` afecta TODO el proyecto; per-fetch dispatcher requeriría boilerplate en 16 `fetch()` calls sin beneficio medible.
- Revisitar cuando: APM/observabilidad incorporada, métricas muestren handshake TLS como bottleneck, volumen >1000+ envíos/día.

**✅ Sub-fase 2.H — Fix mismatch keys credenciales Andreani** (miércoles 13 de mayo, commit `ee88368`, +1 / -1 línea)
- 4 keys del frontend renombradas para alinear con backend `parsearPropias`:
  - `usuario` → `username` (CRÍTICO: backend valida obligatoriamente, clientes Modelo B bloqueados de plano)
  - `contrato_dom` → `contrato_domicilio`
  - `contrato_suc` → `contrato_sucursal`
  - `sucursal_origen` → `id_sucursal_origen`
- 0 filas afectadas en BD (`usaCredencialesPropias=0` para todos los clientes actuales).
- 4 keys opcionales no cubiertas (contratos compuestos cruzados): fuera de scope MVP, para sub-fase futura de UX completa.

### Insight arquitectónico documentado

**Commit `346658e`** (jueves 14 de mayo, empty commit): documenta el cambio de modelo mental para clientes multi-zona tras hallazgo de 2.D.cotizar + investigación en docs oficial Andreani + plataformas competidoras (Tiendanube, Empretienda, PrestaShop).

**Hallazgo principal:** Andreani modela contratos por MODALIDAD (`CONTRATO_DOMICILIO`, `CONTRATO_SUCURSAL`), no por zona geográfica. La zona vive en el concepto operativo "Sucursal de Imposición" configurado caso por caso con ejecutivo comercial.

**Distinción crítica:** Sucursal de Imposición (donde el cliente entrega el paquete) ≠ Sucursal de Distribución (donde se entrega al destinatario final).

**Oportunidad competitiva identificada:** Tiendanube tiene feature "Multidepósito" pero NO calcula tarifa por depósito (solo desde dirección principal, documentado por ellos). Shipro puede resolver este caso real para clientes multi-zona.

**Modelo de datos propuesto para futuro refactor:** `Empresa → CredencialCourier → ContratoCourier (N) → DepositoSucursalImposicion (mapeo)`. Pendiente: 5 preguntas para validar con ejecutivo Andreani antes de implementar.

### Pendientes

**🟡 Sub-fase 3-6 — Refactor restante** (PENDIENTE)
Ver `docs/ARQUITECTURA-MULTICOURIER.md` para detalle.

## DEUDA 47 — Fix persistencia de modalidad en Envio.modalidad (descubierta 2026-06-08, RESUELTA 2026-06-09 en commit de Metrica 3.3)
Hoy `lib/envios/crear.ts:478` persiste modalidad: "Estandar" (default) para todos los envios. El cotizador devuelve modalidad rica ("Entrega a Domicilio (Estandar)", "Retiro en Sucursal", "Locker"), pero esa string no se persiste.

**Impacto actual:** la metrica 2.3 NO puede cortar por modalidad. Documentado en `app/api/torre-de-control/promesa-calibrada/route.ts` como granularidad v1.

**Solucion:**
- Modificar `lib/envios/crear.ts` para extraer modalidad de la opcion elegida (o recibirla como input explicito).
- Persistir el string canonico en `Envio.modalidad`.
- Cuando se resuelva: agregar dimension modalidad al endpoint y dashboard de metrica 2.3.

---

## DEUDA 66 — Postgres migration para produccion (BLOCK 1.1, registrada 2026-06-24, RESUELTA 2026-07-17 — deploy productivo con base administrada Linode/Akamai PostgreSQL 16 en São Paulo + servidor limpio, migraciones + seed + verificación E2E)

**Status:** PARCIAL. Piezas 1-3 + conversion Decimal RESUELTAS en commits 8bb80ee (Pieza 1: Postgres local docker-compose), 3fca0ac (Piezas 2-3: schema `provider = "postgresql"` + baseline nueva), 72836c4 (Decimal: 17 campos monetarios `@db.Decimal(12,2)` + 20 archivos convertidos). Pendiente: Pieza 5 (provisioning Linode + DATABASE_URL productivo). Pieza 4 (data migration) N/A: BD local greenfield, prod arrancara greenfield tambien.

**Por que bloquea deploy:** SQLite no soporta produccion concurrente. Cualquier cliente real con uso simultaneo lo rompe.

**Trabajo:**
- ✅ Postgres local via docker-compose (puerto host 5433). Commit 8bb80ee.
- ✅ Cambio `provider = "postgresql"` en `prisma/schema.prisma` + `migration_lock.toml`. Commit 3fca0ac.
- ✅ Baseline Postgres nueva `20260630190446_baseline_postgres_deuda66` (28 migraciones SQLite archivadas via el historial de git). Commit 3fca0ac.
- ✅ Conversion Float → Decimal(12,2) de 17 campos monetarios (`Empresa.saldoActivo/limiteDescubierto/tarifaPlanaRespaldo`, `CredencialCourier.markupFijo`, `FinanzasEnvio.precio*/costo*/valorDeclarado/fugaFinanciera`, `MovimientoFinanciero.monto/saldoPosterior`, `LiquidacionMensual.montoTotal`, `HistoricoCotizaciones.precio`, `OperacionFee.valor`) + refactor de ~20 archivos de codigo (helpers de dinero, envios, api routes, mailer, analytics) usando metodos Decimal (`.add`/`.sub`/`.mul`/`.div`/`.gt`/`.lt`/`.eq`). Campos NO monetarios (peso, lat/lng, porcentajes, dimensiones) siguen Float. Verificado end-to-end con smoke test contra Postgres local (script throwaway, borrado post-commit): `$100.000,00 − $12.500,00 envio − $1.936,00 fee c/IVA = $85.564,00` EXACTO al centavo, cero drift de float. Commit 72836c4.
- ⏳ Provisioning Linode + DATABASE_URL productivo + smoke test E2E en produccion.

**Estimado restante:** 4-6 horas (Linode provision + smoke E2E en produccion).

**Riesgo de saltar:** ALTO. Operacion inestable bajo carga real (aplica a la Pieza 5 pendiente).

**Vinculo checklist:** docs/COMERCIALIZACION-CHECKLIST.md — TIER 1 BLOCK 1.1.

---

## DEUDA 67 — Hash de apiKey en BD (TECH 1, RESUELTA 2026-06-18 en commit 5c4b04e)

**Status:** ✅ RESUELTA. Numerada en este sync (previo no tenia entry dedicada; el checklist la trackeaba como "TECH 1").

**Origen:** Audit 2026-06-17 detecto `Empresa.apiKey` en plain text en BD. Si la BD se comprometia, todas las API keys quedaban legibles.

**Resolucion:**
- Migration `apiKeyHash` (HMAC-SHA256 con `APIKEY_HMAC_SECRET`).
- POST /api/clientes y `/api/empresa/api-key` generan + retornan plain una vez, persisten solo el hash.
- Middleware de validacion hashea incoming key + lookup por hash.
- Cliente Demo apiKey rotada al schema nuevo: `shipro_live_36542082ea20b77554a68e8e2b3ab649`.

**Sub-paso pendiente menor:** rotacion masiva de apiKeys existentes (script tech1-rotate.mjs en /scripts, ad-hoc). No bloqueante.

**Vinculo checklist:** docs/COMERCIALIZACION-CHECKLIST.md — TECH HARDENING TECH 1.

---

## DEUDA 75 — Conciliacion tarifa virtual vs facturada + exclusion de no-recolectadas (Modelo A) (RESUELTA 2026-07-29 — cerrada por PASO 2/3 del cobro mensual)

**Status:** RESUELTA 2026-07-29 — verificado contra main. Los tres problemas originales (ajuste tarifa virtual→facturada por envío, exclusión de no-recolectadas, conciliación contra la liquidación del courier) quedan cubiertos por el bloque de PASOs del cobro mensual:
- **Mecanismo aforo↔virtual + dos-vías** — commits `d623b9d` (costoAforo/estadoAuditoria/pesoAforado/facturaCourierRef/undo) + `0d6fd7b` (dos-vías Fee/Logística sobre precioFactura congelado + costoAforo).
- **Ajuste por aforo mueve plata para AMBOS modelos** — commit `d0a691f` (unificación: la proforma logística queda documental, el DEBITO_AJUSTE_AFORO ocurre al conciliar).
- **Barrido 6 meses de envíos NO-RECOLECTADOS** — commit `9aafad4` (GET /api/cron/sweep-6m: filtra Rama A + PENDIENTE + logisticaDevuelta=false; devuelve el flete estimado como CREDITO_LOGISTICA_NO_FACTURADA; Fee se conserva).
- **Factura tardía sobre etiqueta barrida** — commit `616a569` (guard netoOriginal=feeNeto cuando logisticaDevuelta=true → re-cobra el flete real completo, no solo el delta).
- **Atomicidad de la corrida entera** — commit `3ce141a` (una sola $transaction externa; rollback total ante error mid-loop). El wiring del cron al crontab + docs/CRONS.md es paso de deploy, no de código.

**Contexto:** En Modelo A, la tarifa publicada al comprador es "virtual" (estimada al crear el envio). La tarifa REAL que Shipro factura al cliente se ajusta a fin de mes contra lo que el courier efectivamente facturo (via Excel/liquidacion del courier). Ademas, las etiquetas que el courier NUNCA recolecto NO se facturan (el courier tampoco se las facturo a Shipro).

**Problema:** Hoy no existe el motor que: (1) ajuste tarifa virtual -> facturada por envio, (2) excluya de la facturacion mensual las etiquetas no-recolectadas, (3) concilie contra la liquidacion del courier. Parte de la infra existe (FinanzasEnvio.costoCourierFacturado, costoCourierEsperado, estadoAuditoria; ruta /api/conciliacion; "Escudo Tarifario") pero el flujo completo no esta cerrado.

**Vinculo:** DEUDA 10 publica la tarifa virtual de fallback; DEUDA 75 la concilia a fin de mes. Probablemente se cruza con el sistema de conciliacion existente — revisar antes de construir.

**Por que no bloquea deploy:** la facturacion mensual ocurre semanas despues del primer envio. Hay tiempo de construirlo post-launch.

---

## DEUDA 84 — `/api/admin/reglas` sin gate de rol (SEGURIDAD) (registrada 2026-07-01, scope chico, seguridad)  (RESUELTA 2026-07-12 — cerrada incidentalmente por DEUDA 87 FAMILIA 3; follow-up del catálogo maestro en commit 2c4a3b9)

**Status:** ABIERTA. Detectada durante el diagnostico de DEUDA 83 (2026-07-01).

**Origen:** `app/api/admin/reglas/route.ts` GET hace `prisma.reglaRuteo.findMany()` **sin `where`, sin `resolverContext`, sin chequeo de `x-rol`**. Devuelve **todas las reglas de ruteo de todas las empresas** a cualquier request que pase el check de sesion del proxy — incluido un `gerente_cliente`. Viola la politica defense-in-depth (`docs/POLITICAS-TECNICAS.md`): un endpoint bajo `/api/admin/*` debe validar `x-rol` aunque el proxy autentique la sesion. `RuteoTab` (que ve el cliente) consume este endpoint (`components/configuracion/RuteoTab.tsx:31`), o sea la fuga es alcanzable desde la UI del cliente.

**Fix propuesto:** agregar gate `x-rol === "admin_shipro"` al inicio del handler (ignorar/403 segun patron), o migrar el consumo del cliente a `/api/empresa/reglas` (scope-aware) y reservar `/api/admin/reglas` para Shipro.

**Por que importa:** fuga de datos entre clientes (reglas de ruteo de una empresa visibles a otra). Prioridad **alta** dentro de lo no-bloqueante — es seguridad, revisar antes de onboarding real de clientes.


---

## DEUDA 87 — Auditoria transversal de aislamiento entre clientes (RESUELTA 2026-07-29 — remediación de las 4 familias mergeada en main)

**Status:** RESUELTA 2026-07-29 — verificado contra main. Las 4 fugas confirmadas en pass-2 tienen commit de cierre en main:
- **Familia 1** (fuga cross-client en `etiquetas/masiva` + `etiquetas/mocis`) — commit `ef98029` "FAMILIA 1: scoping por empresa en etiquetas (cierra FAMILIA 1)".
- **Familia 2** (mutación pública sin login en `envios/cancelar` + `envios/inversa`) — commit `92cf83f` "FAMILIA 2: cierra fuga cross-client en cancelar/inversa". El code-fix está mergeado; la **verificación funcional en browser sigue open como DEUDA 89** (encadenada, no bloquea el cierre del código).
- **Familia 3** (9 endpoints admin sin gate de rol) — cerrada progresivamente en 4 commits: `bd1a878` (7 endpoints, parcial) + `aa46d1e` (grupo A+B, `/api/clientes`) + `fc7bded` (scoping `/api/tickets`) + `84b2572` "GROUP C: ownership en andreani/excepciones (cierra FAMILIA 3)". DEUDA 84 (1 de los 9) ya estaba cerrada por este mismo camino.
- **Familia 4** (script legacy `importar/route.ts` con `EMPRESA_ID=1` hardcodeado) — commit `fe316cf` "FAMILIA 4: jubila el importador CSV legacy (cierra la auditoria DEUDA 87)".

**Origen:** durante el diagnostico de DEUDA 84 se detecto que el modelo de permisos se construyo endpoint por endpoint con criterios distintos (3 patrones conviviendo: A=`resolverContext` scope-aware, B=lectura manual de `x-rol`/`x-empresa-id`, C=sin check en el handler). Surgio la pregunta de si el aislamiento entre clientes (que ninguna empresa vea/opere data de otra) esta garantizado transversalmente o solo en los endpoints donde alguien se acordo.

**Pass 1 — inventario (2026-07-03, verificado):** 76 rutas API totales. Clasificacion automatica por patron de auth en el handler: 24 usan `resolverContext` (A), 12 lectura manual (B), 40 sin patron en handler (C). De los 40 C, ~21 son C por diseño y correctos (crons con `CRON_SECRET`, endpoints publicos/API-key, admin-only globales que necesitan gate de rol y no scoping por empresa). Quedan **~19 CANDIDATOS** a fuga entre clientes — NO confirmados, pendientes de verificacion query por query. IMPORTANTE: "candidato" = mencionar o no `empresaId` en el handler; NO prueba fuga. Solo la lectura de la query real confirma.

**Candidatos por racimo (pass 1):**
- Depositos (8): `/api/depositos/route.ts` + `/api/depositos/[id]/*` — el racimo mas grande, mismo patron (operan por id).
- Clientes / API-key (2): `/api/clientes`, `/api/empresa/api-key`.
- Envios session-side (3): `/api/envios/{buscar,cancelar,inversa}`.
- Etiquetas (2): `/api/etiquetas/{masiva,mocis}`.
- Tickets (1), Nomenclador (1), Envios/andreani/excepciones (1), admin/reglas (1 = DEUDA 84).

**Pass 2 — verificacion COMPLETA (2026-07-03, 24 candidatos verificados query por query).** Resultado: de ~19 candidatos del inventario, **4 fugas de aislamiento reales confirmadas**. El inventario pass-1 sobreestimaba ~4.75x — explicado por los meta-findings (patron D + clase DEUDA-84 + public-by-design + script hardcodeado). Mapa por familias:

**FAMILIA 1 — Fuga entre clientes (2 endpoints). GRAVE.**
- `app/api/etiquetas/masiva/route.ts` — POST recibe `ids` del body y hace `envio.findMany({ where: { id: { in: ids } } })` sin filtrar por empresa del que pide. Cliente A pide IDs de cliente B → recibe PDFs con direccion/telefono/contenido ajenos.
- `app/api/etiquetas/mocis/route.ts` — GET por `trackingNumber` del query, sin scope. Mismo problema.
- Proxy: `session` (inyecta `x-empresa-id`, el handler lo ignora). Fix: filtrar por empresa del caller (guard de ownership reutilizable, patron `verificarAccesoDeposito`).

**FAMILIA 2 — Mutacion publica sin login (2 endpoints). LA MAS GRAVE.**
- `app/api/envios/cancelar/route.ts` — en `PUBLIC_API_EXACT` (proxy.ts). Sin auth. Cualquiera con un trackingNumber cancela cualquier envio + dispara cancelacion en el courier.
- `app/api/envios/inversa/route.ts` — idem, genera logistica inversa sobre envio ajeno.
- El trackingNumber NO es secreto (impreso en etiqueta, en mails al comprador) → usarlo como autenticador para MUTAR estado es el agujero. Para LEER (rastreo) es correcto; para mutar, no. Fix: sacar de `PUBLIC_API_EXACT`, exigir sesion + ownership.

**FAMILIA 3 — Endpoint admin sin gate de rol (9 endpoints). Clase DEUDA-84.**
- `app/api/clientes`, `app/api/admin/empresas`, `app/api/tickets`, `app/api/nomenclador`, `app/api/envios/andreani/excepciones`, `app/api/admin/feriados`, `app/api/admin/finanzas`, `app/api/admin/liquidaciones`, `app/api/conciliacion`.
- Son herramientas shipro-ops (operar cualquier empresa es correcto PARA UN ADMIN), pero no validan `x-rol`. El proxy confirma que hay sesion, no que el rol sea admin_shipro. Un `gerente_cliente` con `curl` alcanza operaciones/datos globales.
- Fix: gate `x-rol === "admin_shipro"` (o `operador_shipro` con matriz segun caso) al inicio del handler, patron de `admin/auditoria-configuracion/route.ts`. DEUDA 84 (admin/reglas) es el item 1 de esta familia — mismo fix x9.

**FAMILIA 4 — Script legacy hardcodeado como ruta viva (1 endpoint). Clase propia.**
- `app/api/importar/route.ts` — `const EMPRESA_ID = 1;` hardcodeado (L12). Cualquier sesion que POSTee un CSV escribe envios a la empresa 1. Script de migracion que quedo enchufado como ruta.
- Fix: propio (parametrizar empresa + gate, o retirar la ruta). ACCION: grep del arbol por otros `EMPRESA_ID`/`empresaId = 1` hardcodeados — puede haber mas.

**SEGUROS verificados (9 endpoints, no requieren accion):**
- 8 rutas `depositos/*` — delegan a `lib/depositos/auth.ts` (`verificarAccesoDeposito` valida ownership por `deposito.empresaId`, 404 ante mismatch; `resolverEmpresaIdParaCrear` para la coleccion). Patron D bien aplicado — modelo a replicar.
- `app/api/empresa/api-key/route.ts` — usa `getToken` (JWT firmado) + `token.empresaId`, bloquea shipro. Imposible de falsear.

**PENDIENTE de verificar (fuera de los ~19 candidatos, para completar el 100%):** las 12 rutas patron B (lectura manual de headers) y confirmar que los 24 A/torre-de-control scopean bien. Prioridad menor: A y B ya tienen algun check; el riesgo mayor (clase C sin check) ya esta mapeado.

**PLAN DE REMEDIACION (4 patrones, no parches):**
1. Guard de ownership reutilizable para Familia 1 (basado en el patron depositos).
2. Quitar Familia 2 de `PUBLIC_API_EXACT` + exigir sesion/ownership.
3. Gate de rol x9 para Familia 3 (empezando por DEUDA 84).
4. Fix puntual + barrido de hardcodes para Familia 4.
Orden sugerido de ejecucion: Familia 2 (mas grave) → Familia 1 → Familia 3 → Familia 4. Cada una su propia sesion/commit. NO mezclar familias en un commit.

**Por que importa:** 4 fugas reales + 2 clusters (rol-gate x9, hardcode). Ninguna explotable HOY (no hay produccion), todas remediar ANTES de onboarding real. Este mapa es el resultado verificado de la auditoria — decisiones de remediacion se toman sobre esto, no sobre el inventario crudo.


---

## DEUDA 88 — Credenciales de servicios externos ausentes + verificar integraciones (registrada 2026-07-04, scope medio, entorno)  (RESUELTA 2026-07-17 — 28 variables cargadas en producción + cotización real verificada contra Andreani y Mocis)

**Status:** ABIERTA. Detectada en QA manual (2026-07-04): `.env.local` quedo VACIO tras la reconstruccion del entorno post-migracion Postgres. Las credenciales de servicios externos vivian ahi en el entorno viejo y se perdieron.

**Sintomas observados:** Andreani falla auth ("Fallo la autenticacion con Andreani", `AndreaniAdapter.refreshToken`); Google Maps banner "API fuera de servicio" en `/envio-nuevo`; cotizacion CP 1625→1050 sin resultados (domicilio ni sucursal) pese a tener Andreani y Mocis "activos".

**Causa raiz:** NO es codigo — es entorno. Mismo patron que el NEXTAUTH_SECRET faltante (DEUDA 81-adyacente): variables/credenciales que el entorno reconstruido no tiene. Confirmado: `.env.local` vacio.

**Alcance del trabajo (aprovechar para hacerlo bien):**
- Recuperar/regenerar credenciales y cargarlas en `.env.local` (NUNCA al repo — gitignored).
- Verificar de punta a punta las 2 integraciones existentes: **Andreani** (auth + cotizacion + sucursales + creacion) y **Mocis** (idem).
- Sumar las integraciones de couriers NUEVAS pendientes (revisar el registry unificado / DEUDA 29 multicourier para la lista).
- Definir si las credenciales de courier van por env o por `CredencialCourier` en DB por empresa (el diagnostico mostro que la demo empresa no tiene credenciales sembradas — decidir el modelo).
- Google Maps API key: pendiente aparte (baja prioridad, el usuario lo corrige luego).

**Por que importa:** sin esto no se puede cotizar, crear ni cancelar envios reales end-to-end. Bloquea el smoke test de produccion y la verificacion de DEUDA 87 FAMILIA 2. Prioridad ALTA para poder testear el flujo operativo.


---

## DEUDA 92 — Chequeo de cobertura del courier entregador (RESUELTA — era catálogo de sucursales sin sincronizar) — actualizada 2026-07-07

**Estado:** RESUELTA en su causa raíz. Queda 1 sub-tarea de verificación (camino recolector, M-92).

---

## Qué era en realidad (NO era un bug de la lógica de cobertura)

El síntoma ("Andreani no cubre el CP 1661") NO venía de que el chequeo mirara el CP
equivocado. La causa raíz era más simple y de entorno: **la tabla de cobertura
`SucursalCourierCp` estaba VACÍA** (0 filas para todos los couriers) tras la migración. El
proceso de sincronización de sucursales (DEUDA 32+37 Fase G — ya construido, con botón en
`/admin-couriers` y cron mensual) **nunca se había ejecutado** en el entorno post-migración.

Con la tabla vacía, CUALQUIER chequeo de cobertura devolvía `sin_cobertura` — daba igual qué
CP se mirara (el del depósito del cliente o el del recolector), porque no había ni una fila
contra la cual comparar.

## Cómo se resolvió

Se corrió la sincronización de Andreani desde `/admin-couriers` → botón "Sincronizar cobertura
ahora" (admin_shipro). Resultado: **164 sucursales sincronizadas OK**, tabla
`SucursalCourierCp` poblada con la cobertura real de Andreani. Mocis correctamente devuelve
"no aplica" (no tiene red de sucursales — es entregador a domicilio; no está en
`FUENTES_SUCURSALES`).

**Verificado:** tras el sync, se creó una etiqueta real de Andreani (tracking
360003029921770) para Comercio Demo S.A. (depósito CP 1661) — Andreani cubre el 1661
directamente, así que el envío salió por el camino directo (sin recolector).

## Nota operativa (importante para producción)

La sincronización debe correrse periódicamente. En producción lo hace el cron mensual
(`/api/cron/sincronizar-couriers`, gateado por CRON_SECRET). En entornos nuevos / recién
migrados hay que **correrla una vez a mano** desde el panel admin, o la cobertura queda vacía
y NADA se puede despachar. Considerar: (a) documentar este paso en el checklist de
provisioning de un entorno nuevo, y (b) evaluar un healthcheck que avise si
`SucursalCourierCp` está vacío para un courier con red de sucursales.

## Sub-tarea PENDIENTE de verificación — M-92 (camino recolector/consolidador)

Lo que se probó fue el **camino directo** (Andreani cubre el CP del depósito → despacha
directo). NO se probó todavía el **camino con courier recolector**, que es el modelo de Nacho
para cuando el entregador NO cubre el CP del depósito del cliente:

- Cliente designa un courier RECOLECTOR (ej. Mocis) → `Deposito.courierRecolectorId`.
- Cliente activa los couriers entregadores y tilda cuáles recolecta el recolector →
  `DepositoCourierConfig.recogeViaConsolidador = true` por par.
- El chequeo de cobertura del entregador pasa a mirar el CP del depósito del recolector
  (`Courier.cpDepositoConsolidador`), no el del cliente.
- La etiqueta del recolector se incluye junto con la del entregador (Mocis + Andreani).

**A probar (M-92):** configurar un cliente con Mocis como recolector y un entregador que NO
cubra el CP del depósito, y verificar que (a) el chequeo pase mirando el CP del recolector,
(b) la etiqueta se genere con ambos couriers. Nota: durante el diagnóstico se vio que Mocis
tiene `cpDepositoConsolidador=1702` cargado PERO `puedeConsolidar=false` — revisar esa
inconsistencia, probablemente bloquee elegir a Mocis como recolector desde la UI del admin.

## Aprendizaje de método

El síntoma apuntaba a la lógica de ruteo (zona sensible), pero la causa era datos sin
sincronizar (entorno). Bien haber diagnosticado antes de tocar: no se modificó una sola línea
de la lógica de cobertura — se corrió un proceso que ya existía. Mismo patrón que el resto de
los hallazgos post-migración (variables de entorno vacías, tablas sin poblar).

## DEUDA 98 — Formulario de reglas pide el ID numérico del courier (UX) (scope chico, frontend)  (RESUELTA 2026-07-13 en commit 3351bac)

**Status:** ABIERTA. Detectada 2026-07-13.

**Síntoma:** En el formulario de creación de reglas (`/admin-couriers`), cuando la acción es
`FORZAR_COURIER`, el campo "Acción: Valor" es un input de texto libre donde hay que escribir el **ID
numérico** del courier (`"1"` para Andreani, `"2"` para Mocis). El usuario no tiene forma de saber
ese mapeo — es conocimiento interno.

**Fix propuesto (frontend, chico):** reemplazar el input de texto por un `<select>` cargado desde la
tabla `Courier` (`findMany({ where: { activo: true } })`), con **label = nombre** del courier
(Andreani, Moci's) y **value = id** en string (`"1"`, `"2"`). El contrato de persistencia no cambia
(`accionValor` sigue siendo `"1"`/`"2"`, que es lo que el motor espera hoy — ver DEUDA 101). El
usuario elige por nombre; el sistema traduce a ID.

**Prioridad:** media (UX de cara al admin). Es el arreglo más jugoso de esta familia y el más simple.

---

## DEUDA 101 — Motor de cotización tiene los couriers hardcodeados en FORZAR_COURIER (scope medio, deuda de diseño)  (RESUELTA 2026-07-13 en commit 53a84d8)

**Status:** ABIERTA. Detectada 2026-07-13.

**Síntoma:** En `lib/cotizador.ts:380-381`, la acción `FORZAR_COURIER` mapea el `accionValor` a un
nombre de courier con `if` hardcodeados: `"1"` → `"ANDREANI"`, `"2"` → `"MOCI'S"`. Sumar un tercer
courier obliga a editar el motor (y en dos puntos: el switch ID→nombre y la comparación
`op.courier === nombreEsperado` en mayúsculas).

**Fix propuesto:** en vez del mapeo hardcodeado, buscar el courier por ID en tiempo de cotización
(`prisma.courier.findUnique({ where: { id: parseInt(accionValor) } })`) y comparar contra
`op.courier === courierBD.nombre.toUpperCase()`. Así un courier nuevo se integra sin tocar código.
Encaja con DEUDA 98 (el `<select>` ya manda el ID correcto).

**Prioridad:** media. No urge con 2 couriers, pero es deuda de escalabilidad — se paga sola al integrar
el tercero.

---

## DEUDA 106 — `/api/envios/corregir` es PUBLIC + read-leak en `/api/envios/buscar` (SEGURIDAD) (registrada 2026-07-14, scope medio, seguridad — RESUELTA 2026-08-04: pieza 1 desplegada a prod 2026-08-03; pieza 2 verificada e2e en local 2026-08-04, pendiente deploy a prod)

**Status: RESUELTA — pieza 1 + pieza 2 completas.** Pieza 1 desplegada a prod 2026-08-03. Pieza 2 verificada end-to-end en local 2026-08-04; el deploy a prod queda pendiente (código + migración aditiva del token, orden código-primero — la migración es aditiva no-destructiva).

- **PIEZA 1 (DONE — commit `71d2f6b`, deployado a prod 2026-08-03).** Cierra dos flancos descubiertos durante el recon:
  - **Ownership en `/api/envios/buscar`**: el handler ahora usa `verificarAccesoEnvio` (`lib/envios/ownership.ts`, PRINCIPIO 2 DEUDAS.md:19). Un cliente ve sólo envíos de su propia empresa; cross-empresa retorna 404 `"Envío no encontrado"` — misma respuesta que envío inexistente, no filtra existencia. Shipro (empresaId=null) mantiene scope global. `verificarAccesoEnvio` ya existía y estaba aplicado en `envios/cancelar` + `envios/inversa` (fix de FAMILIA 2, commit `92cf83f`) — buscar era el único endpoint del family que no había sido migrado.
  - **DTO whitelist en `/api/envios/buscar`**: la respuesta antes era el objeto Prisma completo — leaba `empresa.{saldoActivo,limiteDescubierto,apiKeyHash,apiKeyActiva,cuit,direccionFiscal*,modalidadPago,tarifaPlanaRespaldo,suspendida,onboardingCompletado}`, `destino.{documento,email,telefono}`, y todos los internals del `courier` (emailSoporte, smo\*, puede\*, etc.). Ahora emite sólo el mínimo que los consumidores reales necesitan: `trackingNumber, estadoActual, modalidad, fechaImpresion/Colecta/Entrega, courier.nombre, empresa.nombre, destino.{nombre,calle,altura,piso,dpto,cp,localidad,provincia}, eventos[].{estado,observacion,fecha}` — sin PII del comprador más allá del nombre y sin ningún dato financiero de la empresa.
  - **Verificación local**: dashboard encuentra sus propios envíos ✓; `cliente@demo.com` no ve un tracking de otra empresa (obtiene "no hay coincidencias") ✓. Deployado a prod.
  - **NO cambia el clasificador del proxy** — `/api/envios/buscar` sigue en `DUAL_EXACT` (session o api-key). Por eso el path anónimo del comprador quedó roto en el intermedio; PIEZA 2 mov 1 lo abrió por un endpoint separado (`/api/envios/rastreo-publico`).

- **PIEZA 2 (DONE — token del comprador para rastreo + corrección; verificada end-to-end en local 2026-08-04).** Seis commits en orden:
  - **mov 1** (`1a4d209`) — Nuevo endpoint público `/api/envios/rastreo-publico` (L1, sin destino, sin PII, oculta el nombre del comprador — Andreani-style; proyección Prisma `select`-enforced para que un contribuidor futuro no pueda leakear accidentalmente). `/s/[tracking]` reapunta al nuevo endpoint. ADEMÁS restaura `destino.email + destino.telefono` al DTO owner de `/api/envios/buscar` — regresión de PIEZA 1 que había roto la coordinación del operador en el dashboard (`app/(dashboard)/rastreo/page.tsx:185` la usa para componer mensaje WhatsApp/mail al comprador).
  - **mov 2** (`ba9f960`) — Schema: `Envio.correccionToken String? @unique` + `Envio.correccionTokenExpira DateTime?`. Migración aditiva `20260804190000_envio_correccion_token` (aplicada LOCAL only). Token generado en `lib/envios/crear.ts` SÓLO cuando el envío nace RETENIDO — `randomBytes(24).toString("base64url")` = 192 bits de entropía, 32 chars URL-safe, unguessable; expiry 48h. Inyectado en la URL del `enviarMailRetenido` como `?token=<token>`. Nada validaba el token todavía en este commit — puramente escritura.
  - **mov 3** (`a4bef23`) — Refactor: extrae la validación de dirección (calle vacía / altura sin keyword / Google ZERO_RESULTS / no-street-level / CP-first-2-digits mismatch) del bloque inline de `lib/envios/crear.ts` a `lib/geo/validar-direccion.ts` reutilizable. Server-key only (deja de usar `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` que se filtraba al bundle del browser; ahora sólo `GOOGLE_MAPS_API_KEY` server-side). `crear.ts` la consume; parity verificada en local (dirección buena → Pendiente; dirección mala → RETENIDO con mismo motivo string).
  - **mov 4** (`822b753`) — `/api/envios/corregir` gate de identidad dual. Si `body.token` presente → path del COMPRADOR: query one-shot con las 4 condiciones (envío + token + no-expirado + RETENIDO); Google-validation OBLIGATORIA antes del `Direccion.update` (fallo → 422 con `motivo` de `validarDireccionEnvio`). Si no hay token → path del CLIENTE/SHIPRO: self-auth via `getToken({req, secret: NEXTAUTH_SECRET})` — el proxy no inyecta headers en `PUBLIC_API_EXACT` así que el handler replica inline `authBySession` de `proxy.ts:72-90`; luego `verificarAccesoEnvio` + re-check RETENIDO; SKIP Google validation (última palabra del cliente). Despacho + ramas de estado byte-idénticas al pre-mov-4 (verificado por diff). Corregir queda en `PUBLIC_API_EXACT` — self-gated en el handler para no requerir cambio de proxy.
  - **mov 5** (`c7b0307`) — Página del comprador `app/corregir/[tracking]/page.tsx` lee `?token=` via `useSearchParams` y lo forwarda en el POST body. GET token-aware agregado a `/api/envios/corregir` (proyección Prisma `select`: sólo `estadoActual` + `destino.{calle..provincia}`, cero PII) para servir el prefill L2 (dirección actual). `/api/envios/buscar` no se toca. POST del corregir byte-idéntico al de mov 4 (verificado: `git diff` cero líneas eliminadas).
  - **fix** (`141c30f`) — Bug encontrado en el e2e: la pantalla de éxito del comprador linkeaba al tracking VIEJO (URL param genérica SHP-…) en vez del NUEVO que asigna el courier tras el re-despacho. El envío en BD queda con `Envio.trackingNumber = trackingOficial` nuevo, así que la SHP-… vieja deja de resolver → 404. Fix: la página parsea `res.json()` de la respuesta del POST, captura `data.trackingOficial`, y usa `${trackingOficial ?? tracking}` en el `<Link>` de éxito. Fallback a la URL tracking por defense-in-depth. `Dashboard cliente path` (`app/(dashboard)/page.tsx:333`) usa `fetchEnvios()` refresh, no un Link — no tenía el bug, no se tocó.

**Decisiones de producto (locked, 2026-07-14 → 2026-08-04):**
- **Token generado SÓLO cuando el envío nace RETENIDO**. No token en la creación exitosa; el rastreo público (L1) no necesita token — es casi-público, tipo Andreani.
- **Rastreo público es casi-público como Andreani**: mínimo (estado + courier + vendor + timeline), SIN nombre del comprador, sin dirección, sin PII. El comprador confirma su paquete por tracking + estado; un scraper que adivine trackings ve exactamente lo mismo que cualquier receptor del mail.
- **Comprador → Google OBLIGATORIO**; cliente → puede completar a mano (**última palabra**). Ambos pasan por el mismo endpoint con branches; el flag `esBuyer` determina si Google-validation se aplica.
- **El link muere cuando el envío sale de RETENIDO** (primero que corrige gana). Enforcement: el filtro `estadoActual: RETENIDO` en la query mata el token una vez que el envío pasa a `Pendiente`. NO se hace null-out explícito del token — el filtro de estado ES la autoridad; el valor queda para audit / debug.
- **Post-despacho FUERA DE ALCANCE de este DEUDA**. El cliente usa la acción propia del courier (ej. Andreani "cambiar datos postales" post-etiqueta) para corregir después de que la etiqueta ya existe. La corrección `/api/envios/corregir` cubre exclusivamente la ventana RETENIDO pre-despacho.

**Verificación end-to-end local (2026-08-04):**
- Envío `SHP-644317` creado RETENIDO por CP inválido → mail al comprador con `/corregir/SHP-644317?token=<…>` → GET token-aware pre-fill del form con dirección actual OK → buyer corrige a dirección válida → POST valida token + Google → RAMA 1 despacha en Andreani → tracking oficial nuevo `360003058098420` → response `{success:true, trackingOficial:"360003058098420"}` → pantalla de éxito linkea a `/s/360003058098420` → carga OK. Flujo verde end-to-end.
- Cliente path (dashboard) verificado independiente: `guardarCorreccionAuditoria` sin token → session self-auth → skip Google → mutación OK. No regresiones.

**Deudas relacionadas que quedan abiertas (NO en scope de DEUDA 106):**
- **DEUDA 126** — `/api/envios/rastreo-manual` sigue leakeando `destino.{documento, email, telefono}` en su DTO hand-picked. Endpoint distinto; misma clase de leak que PIEZA 1 pero no compartió fix. Pendiente.
- **DEUDA 127** — Dead magicLink `https://shipro.pro/fix/<orden>` emitido en `/api/checkouts:82` — apunta a una ruta que no existe en el repo. Limpieza / seguridad futura.
- **Deploy a prod pendiente para PIEZA 2**: el orden a prod es **CÓDIGO-PRIMERO** (deployar el código de mov 1-5 + fix) y luego correr la migración aditiva (`prisma migrate deploy` para `20260804190000_envio_correccion_token`). La aditividad no es destructiva (las columnas nacen NULL para los envíos existentes); el código pre-migración funciona sin tocarlas.

**Contexto original (preservado):**

Detectada 2026-07-14 durante el relevamiento de la API externa.

**Síntoma:** El endpoint `POST /api/envios/corregir` está clasificado `public` en `proxy.ts:12`
(`PUBLIC_API_EXACT`) — **no pide ninguna credencial**. Con solo conocer un `trackingNumber` de un
envío en estado RETENIDO, cualquiera desde internet puede **cambiar la dirección de destino** de ese
envío.

**Por qué está público (razón legítima):** existe una página pública de auto-corrección en
`app/corregir/[tracking]/page.tsx`, linkeada desde la página pública de seguimiento
(`app/s/[tracking]/page.tsx:336`). El flujo es bueno: al comprador le queda el paquete RETENIDO por
un problema de dirección, entra a ver su tracking, y **corrige él mismo sus datos** — sin tener
cuenta en Shipro (el comprador nunca es usuario de la plataforma).

**El valor de negocio de la función (por qué NO se saca):** es una **carrera** entre el comprador y
el cliente de Shipro para ver quién corrige primero. Cada corrección que hace el comprador es una
gestión operativa menos para el cliente. La función descarga trabajo del cliente — es valor de
producto, no solo UX.

**El riesgo concreto:** el `trackingNumber` **no es un secreto** — viaja por mail al comprador, está
impreso en la etiqueta, y es enumerable/adivinable. Usarlo como única llave es "seguridad por
oscuridad". Un atacante que scrapee o adivine trackings de envíos RETENIDO puede **redirigir paquetes
ajenos a su propia dirección**.

**Mitigación parcial hoy (no elimina el riesgo):** mientras el envío está RETENIDO, la etiqueta real
del courier **todavía no se creó** — es genérica de Shipro hasta que los datos se validen contra
Google Maps. Pero si el atacante mete una dirección válida, la etiqueta se crea **con la dirección
del atacante**. Hay una ventana, no una protección.

**Solución elegida — LINK MÁGICO con token (decisión de producto, 2026-07-14):**
- Cuando un envío pasa a RETENIDO, generar un **token único e impredecible** (firmado, no adivinable)
  asociado a ese envío, con **vencimiento a las 48 horas**.
- Mandar al comprador un mail con el link que ya lleva el token:
  `/corregir/<tracking>?token=<token>`. El comprador **clickea y entra** — cero fricción, no tiene
  que escribir ni recordar nada.
- El endpoint `/api/envios/corregir` **valida el token** (que exista, que corresponda a ese envío,
  que no esté vencido) antes de permitir la corrección.
- **Ventana de 48 horas:** el comprador tiene la primera oportunidad. Si no corrige en 48hs, el token
  vence y **el cliente de Shipro resuelve desde la plataforma**. Nadie queda trabado; es una carrera
  sana donde el que llega primero descarga al otro.
- El flujo del **dashboard del cliente** (`app/(dashboard)/page.tsx:336`, que hoy también pega a este
  endpoint) sigue funcionando con sesión — no requiere token.

**Por qué el link mágico y no "tracking + email":** se evaluó pedir el email como segunda llave
(más simple de construir), pero el link mágico es mejor en las dos dimensiones: **más seguro** (el
token no se adivina ni se scrapea; el email sí puede viajar en el mismo mail que el tracking) y
**mejor experiencia** (el comprador no escribe nada, solo clickea). Es además el patrón estándar de
la industria para este caso (mismo mecanismo que "recuperar contraseña" o "confirmá tu mail"). El
mailer ya existe (`lib/mailer.ts`), así que la pieza de envío está.

**Trabajo:**
1. Modelo/campo para el token de corrección (token, envioId, vencimiento, usado).
2. Generación + envío del mail al pasar a RETENIDO (reusar `lib/mailer.ts`).
3. Validación del token en `POST /api/envios/corregir` (mantener el flujo de sesión del dashboard).
4. Sacar `/api/envios/corregir` de `PUBLIC_API_EXACT` en `proxy.ts` (pasa a validar token O sesión).
5. La página `/corregir/<tracking>` lee el token del querystring y lo manda al endpoint.

**Relación con la API de plugins:** la decisión de producto "corregir es solo desde la plataforma"
aplica a la **API de plugins** (el e-commerce NO corrige por API). Esta función —el comprador
auto-corrigiendo— es distinta y **se mantiene**: es plataforma→comprador, no integración.

**Prioridad:** media-alta. Es seguridad real (redirección de paquetes), pero mitigada por la ventana
RETENIDO y por el volumen bajo actual. Resolver antes del onboarding de clientes reales con volumen.

---

## DEUDA 112 — Escudo anti-doble-cobro incluía `estadoLiquidacionFee === LIQUIDADO` (RESUELTA en commit a0f76bc)

**Status:** Detectada durante el recon del PASO 3 (sweep 6-meses) el 2026-07-29. RESUELTA en commit a0f76bc.

**Bug (pérdida silenciosa de plata):** El escudo anti-doble-cobro en `app/api/conciliacion/route.ts` disparaba si `estadoLiquidacionFee === LIQUIDADO`. La proforma FEE (`admin/liquidaciones` POST tipo=FEE) flippa ese flag para TODOS los envíos del mes, independiente de la conciliación. Si el operador emitía la proforma FEE ANTES de cargar el Excel del courier (ordering B, orden no garantizado), el escudo daba falso positivo DOBLE_COBRO → hacía `continue` → el aforo NUNCA se debitaba → el cliente no pagaba el delta cuando el courier facturaba más caro. Pérdida por etiqueta: `costoAforo × 1.21`. Peor aún: la etiqueta quedaba en `estadoLiquidacionLogistica=PENDIENTE` con `facturaCourierRef=null`, así que el sweep de 6 meses (PASO 3) después la vería como "no confirmada" y le devolvería el flete de un envío que el courier SÍ facturó — segunda pérdida encadenada. Introducido en 0d6fd7b (DEUDA 73): el comentario del escudo conflaba "vía Fee cerrada" con "corrida de conciliación duplicada".

**Fix:** removida la condición `estadoLiquidacionFee === LIQUIDADO`. El escudo queda con las dos señales autoritativas del lado logístico: `estadoLiquidacionLogistica === LIQUIDADO || facturaCourierRef !== null` (`facturaCourierRef` lo setea la propia conciliación, es el marker de "ya procesada"). Recon verificó 6 casos (ya conciliado, ya-conciliado-sin-Fee, ordering-B, ya-log-proforma, Rama B, sweep-6m futuro): ninguno abre double-charge; sólo el caso roto (ordering B) pasa de "pierde el aforo" a "lo cobra bien". El guard de `revertir/route.ts` que también lee `Fee=LIQUIDADO` NO se tocó — es otro propósito (protege una LiquidacionMensual ya emitida al cliente contra reversión) y su uso es legítimo.

---

## DEUDA 124 — Estado de producción no reproducible desde el seed: parches manuales del deploy de FASE 2 (2026-08-03) no reflejados en `prisma/seed.ts` (RESUELTA por auditoría 2026-08-03 — el seed sí reproduce (a-c); (d) re-scoped a DEUDA 125; (e) mooted por DEUDA 123)

**Status:** RESUELTA por auditoría de código 2026-08-03 sobre `prisma/seed.ts` en el commit `3fefa5d`. Los cinco ítems originales se resuelven así:

- (a) **`MarkupShiproVigencia`** global 10% — ✅ **ya está en el seed** (`prisma/seed.ts:111-127`), corre antes del gate `if (seedDemo)` (o sea, corre en modo PRODUCCION), guard idempotente `findFirst({activo:true})` antes de crear. Reseed sobre BD limpia reproduce el valor.
- (b) **`SmoCourier`** $121.50 para Andreani + Moci's — ✅ **ya está en el seed** (`prisma/seed.ts:84-109`), corre en modo PRODUCCION, guard idempotente por-courier. Reseed reproduce.
- (c) **`CourierIntermediario`** Mocis→Andreani (markup 10%, seguro 90, tarifaIncluyeIvaIntermediario=false) — ✅ **ya está en el seed** (`prisma/seed.ts:129-152`), corre en modo PRODUCCION, guard idempotente por (courierId, propietarioCourierId, activo). Reseed reproduce.
- (d) **`CredencialCourier.propietarioTipo` + `propietarioCourierId`** — es **data per-empresa**, no config de plataforma. No va en el seed. Que en prod se hayan creado credenciales con owner null es un problema del PATH DE ALTA de credencial (`app/api/configuracion/couriers/route.ts:301` no exige el campo), no del seed. Se re-scoped como **DEUDA 125** (endurecer el alta de credencial). Red de seguridad ya operativa: `BLOQUEADO_CREDENCIAL` (sub-piece 3, commit `c85269d`) bloquea la creación de envío en Rama A sin dueño, evitando envíos silenciosos mal cotizados.
- (e) **`CredencialCourier.tarifaIncluyeIva`** — mooted por DEUDA 123: la columna fue dropeada (mov 3, commit `3fefa5d`) y la bandera vive ahora en el adapter (`ICourierIntegrator.tarifaApiIncluyeIva`). El parche manual que hubo en prod ya no aplica.

**Por qué prod se veía "no reproducible" durante el deploy 2026-08-03**: no fue un defecto del seed sino un artifact operativo — la BD de prod ya tenía data de FASE 1, y durante el deploy sólo se corrieron migraciones (no se re-corrió el seed sobre la BD viva). Las tablas nuevas nacieron vacías y se llenaron a mano en la ventana del deploy. En una BD limpia (recreación de infra desde cero) el seed en modo PRODUCCION reproduce (a-c) sin intervención manual.

**Determinismo confirmado**: el seed no hardcodea IDs de courier. Todo se resuelve por nombre (`findUnique({where:{nombre:"Andreani"}})` etc.), así que un reseed sobre una BD limpia genera cualquier ID que el SERIAL asigne y las FKs internas de `CourierIntermediario`, `SmoCourier` etc. quedan consistentes.

**Recomendaciones operativas (fuera de esta deuda pero relevantes)**:
- Mantener un registro humano-legible de ajustes puntuales a prod (fecha, SQL, motivo) fuera del seed — un `docs/PROD-STATE-CHANGES.md` en el repo. Alternativamente, un archivo de migración de datos runtime específica de prod (idempotente) que corra post-seed.
- Cerrar DEUDA 125 elimina el modo de falla que originó este DEUDA (credenciales Rama A born con owner null).

---

## DEUDA 128 — Idempotencia en creación de etiquetas por API (prerequisito plugins, ticket to play) (registrada 2026-08-05, scope medio)

**Status:** RESUELTA. Commit 99af569 (2026-08-05). Deployada a producción 2026-08-05.
Header Idempotency-Key en POST /api/envios. @@unique([empresaId, idempotencyKey])
en Envio. Migración 20260805230917. Race condition menor registrada como DEUDA 131.

**Problema:** `POST /api/envios` hoy NO tiene mecanismo de idempotencia. Si un e-commerce reintenta la creación de una etiqueta por latencia de red, timeout, o reintento de su propio webhook interno ("orden pagada"), Shipro **crea DOS etiquetas y cobra dos veces**. Es el modo de falla clásico de una API de e-commerce sin idempotencia. Un plugin no puede confiar en un reintento seguro sin este contrato.

**Fix — token de idempotencia derivado de un identificador ESTABLE del pedido:**
- **Identificador estable** = `platform + store_id + order_id + fulfillment_id` (ej. `tiendanube:store42:order123:ful1`). Es la clave que identifica UN despacho específico dentro de un pedido específico dentro de una tienda específica de una plataforma específica.
- **Comportamiento en el handler:** si el token ya generó una etiqueta, devolver la EXISTENTE (misma response — mismo `trackingNumber`, misma `etiquetaUrl`). NO crear otra. Si el token es nuevo, crear + persistir la asociación token→envío.
- **Refuerzo en DB:** constraint `UNIQUE` sobre la clave de idempotencia en `Envio` (o tabla puente si preferimos separar). Race-condition-safe: dos requests paralelos con el mismo token → uno crea, el otro obtiene `UniqueConstraintViolation` y lee el existente. Devuelve la misma response.
- **Estándar de industria (EasyPost / Stripe):** header `Idempotency-Key` recibido en la request; respuesta cacheada por (key, endpoint) durante ~24h; lock para requests concurrentes con el mismo key. Shipro puede seguir el mismo pattern (header + fallback al body si el plugin no lo maneja).

**Por qué importa para plugins:** los webhooks de e-commerces reintentan (Tiendanube hasta 5 veces con backoff; Shopify hasta 19). Sin idempotencia, cada reintento nos hace **despachar de nuevo → cobrar de nuevo → duplicar tracking → romper la conciliación del cliente**. **Es prerequisito de TODOS los plugins.** No es opcional.

**Prioridad:** alta. Prerequisito duro. Scope medio (~2-3 días: schema + handler + tests de race conditions + documentación del header). Coordinar con DEUDA 103 (misma capa de creación); pueden atacarse juntas o secuenciadas.

---

## DEUDA 123 — `CredencialCourier.tarifaIncluyeIva` default `true` es un footgun de SUBCOBRO (mordió en prod 2026-08-03) (registrada 2026-08-03, scope chico, PRIORIDAD ALTA, pricing/schema)

**Status:** RESUELTA 2026-08-03 (verificado 2026-08-24). El footgun se eliminó de raíz: la columna CredencialCourier.tarifaIncluyeIva fue DROPEADA (mov 3); la bandera vive ahora en el adapter (ICourierIntegrator.tarifaApiIncluyeIva = false en los 5 adapters) y el único path de alta de credencial (app/api/configuracion/couriers/route.ts) ya no la toca — no puede volver a nacer mal. El schema declara `tarifaIncluyeIva Boolean @default(true)` en `prisma/schema.prisma:438`, pero los adapters de Andreani y Moci's devuelven tarifa NETA (Andreani lee `data.tarifaSinIva.total` con fail-loud si falta; Moci's confirmado empíricamente 2026-07-21 que `opcionAkeron.price` viene sin IVA — ver `prisma/seed.ts:154-159`). El seed corrige las credenciales existentes con `prisma.credencialCourier.updateMany({ where: { nombreCourier: { in: ["Andreani", "Moci's"] } }, data: { tarifaIncluyeIva: false } })` (`prisma/seed.ts:161-163`), pero **cualquier credencial creada FUERA del seed nace en `true`** — típicamente vía el wizard de onboarding (`app/api/clientes/route.ts`, path que no toca `tarifaIncluyeIva`). Efecto: `aplicarMarkup` en `lib/cotizador.ts:156` toma la rama `secoNeto = seco.div(IVA_AR_MULTIPLIER)` sobre una tarifa que YA es neta → todos los precios cotizados quedan un factor `1/1.21 ≈ 0.826` más bajos: **SUBCOBRO de ~17.36%** (`1 - 1/1.21`) en cotización y en creación de envío (montoDebito y precioFactura).

**Confirmado en producción durante el deploy de FASE 2 (2026-08-03):** las 2 credenciales de Argenshipro SAS estaban en `true` (creadas fuera del seed) y cotizaban ~17% por debajo del valor esperado. Se corrigió a mano en la BD de prod con un `UPDATE "CredencialCourier" SET "tarifaIncluyeIva" = false WHERE "nombreCourier" IN ('Andreani', 'Moci''s')`. Sin envíos reales todavía, así que no hubo pérdida — pero el próximo cliente onboardeado lo dispararía otra vez.

**Alcance del fix:**
1. **Cambiar el default del schema** a `tarifaIncluyeIva Boolean @default(false)` en `prisma/schema.prisma:438` + migración de rename del default. No requiere backfill (los rows existentes conservan su valor).
2. **Endurecer el onboarding** (`app/api/clientes/route.ts` — la ruta que crea la CredencialCourier inicial) para setear explícitamente `tarifaIncluyeIva: false` al crear una credencial de Andreani o Moci's; opcionalmente extenderlo a todo `nombreCourier` conocido cuyo adapter devuelve neto (registry en `lib/couriers/serviciosSoportados.ts` o similar).
3. **Documentar la política**: el flag describe el SHAPE del número que devuelve el adapter (¿la API del courier ya sumó IVA?), NO una decisión comercial. Su valor debe ser conocido en el momento de dar de alta el courier — no es negociable por empresa. Este comentario ya vive en `lib/cotizador.ts:151-155` y en `prisma/seed.ts:154-159`; conviene consolidarlo en el schema.

---

## DEUDA 91 — Cablear el catálogo ServicioCourier al runtime de cotización (adapter integration) (registrada 2026-07-06, RESUELTA EN PROD 2026-09-06)

**Status:** **RESUELTA EN CÓDIGO 2026-09-02 (COMPLETA en localhost), pendiente deploy prod.** Semáforo localhost↔prod: queda acá hasta subir. Post-deploy prod → mover a `DEUDAS-RESUELTAS.md`. **Prerequisito de Intralog** (Chat B): con la 91 aplicada, Intralog entra sin heredar el bug de ofrecer modalidades que no presta.

**RESUMEN COMPLETO (en local) — 2 capas + default estricto:**

- **CAPA 1 (HECHA local 2026-09-02, commit `1bdcc08`):** el motor filtra modalidades por **capacidad del adapter** (no ofrece lo que el courier no soporta técnicamente). MISMA fuente de verdad que la UI `/admin-couriers` (bloqueo de toggles por adapter). Aplicada en TODOS los caminos de armado de opciones (hot path + fallback inner + outer catch fatal + Tiendanube consume del cotizador). Arregla el bug histórico de Moci's cotizando sucursal. Verificado local: Moci's ya NO ofrece sucursal, Andreani mantiene domicilio + sucursal, precios intactos.
- **CAPA 2 (HECHA local 2026-09-02, commit `c5595a2` + `c83b738` docs estricto):** el motor respeta el **catálogo de servicios administrado por Shipro** (`ServicioCourier.activo`) como recorte sobre el techo del adapter. **Engine ofrece = adapter-soportado ∩ Shipro-habilitado.** Jerarquía: adapter = techo (Capa 1, físico), Shipro = recorte (Capa 2, business admin-managed). Simetría total con el hot path — outer catch fallback ahora usa el MISMO `mapaCapacidades` que el hot path.
- **Default ESTRICTO (Nacho, 2026-09-02):** courier sin catálogo configurado NO ofrece nada. Fuerza configurar servicios al integrar el courier — evita ambigüedad "no configurado ¿ofrece por default o no?". Comportamiento `?.has(...) ?? false` en L570 hot path + L672 outer catch: si `mapaCapacidades.get(courier)` es undefined o Set vacío → gate false → skip total.

**ORDEN DE DEPLOY OBLIGATORIO (crítico):**
- **Configurar el catálogo de TODOS los couriers activos ANTES del deploy** (local + prod). Con default estricto, un courier con 0 servicios `activo:true + capacidadTecnicaMapeada != null` desaparece del checkout.
- Nacho ya configuró: **local + prod** al 2026-09-03. Excepción única: **Hop Envíos sucursal** — bloqueado por adapter incompleto (ver [[DEUDA 165]] nueva).
- Post-configuración, deploy es price-neutral y desplaza-neutral para couriers configurados.

**Sub-tareas históricas (contexto — la mayoría cubiertas por la arquitectura CAPA 1+2):**

- ✅ **Punto 1 del plan original (2026-07):** cotizador pide solo códigos activos por courier. Cubierto por CAPA 1+2.
- ⏳ **Punto 2 (adapter recibe `codigosSolicitados` + devuelve `codigoServicio`):** sin implementar. Hoy el `codigoServicio` en `OpcionTarifa` se resuelve por separado en el cotizador vía `mapaCodigoServicio` (DEUDA 144), no por el adapter. Sigue como arquitectura pendiente si se quiere que el adapter etiquete por código canónico.
- ⏳ **Punto 3 (adapters leen `capacidadTecnicaMapeada`):** sin implementar. Adapters no consultan el catálogo — el cotizador gate por adaptador vía registry consulta.
- ⏳ **Punto 4 (descartar servicios devueltos no pedidos):** sin implementar. Bajo riesgo hoy: el adapter Mocis devuelve "Same Day"/"Next Day" y el cotizador acepta ambos si el gate pasa.
- ⏳ **Sub-tarea M-1 (Moci's Same Day / Next Day service_id):** sigue sin averiguar. Hoy adapter etiqueta por index (heurística). No bloqueante — funciona, pero sin garantía formal.
- ⏳ **Sub-tarea A-1 (contrato Andreani Express):** sigue sin resolver.

Los 4 puntos ⏳ + M-1/A-1 son evolución arquitectónica del contrato adapter↔cotizador. **El bug crítico (Mocis-sucursal, prerequisito Intralog) está cerrado.** Los pendientes pueden atacarse cuando se integre un adapter que los necesite explícitamente.

---

**CONTEXTO HISTÓRICO (pre-2026-09-02, mantenido para referencia):**

**Tipo:** Arquitectura — continuación de DEUDA 32+37 (NO arquitectura nueva).
**Origen:** Detectada durante testeo post-migración (2026-07). Síntoma disparador: Moci's
cotiza "entrega en sucursal" que NO ofrece (y que ROMPERÍA la creación del envío si se
elige), y no se distingue "Same Day" de "Next Day".
**Estado (histórico 2026-07-06):** PENDIENTE. Insumo de NotebookLM YA OBTENIDO (ver tablas de mapeo abajo).
Bloqueante parcial: falta confirmar los service id de Moci's (sub-tarea M-1). OCA: cableado al nacer junto con el adapter (2026-08-21) — alta en BD pendiente de credenciales.

---

## Contexto: la infraestructura YA EXISTE (DEUDA 32+37, cerrada 2026-06-01, commit 10eda29)

YA construido y funcionando (NO rehacer):
- **Modelo `ServicioCourier`** (schema:267) — `codigoServicio`, `grupo`, `activo` (switch
  admin), `capacidadTecnicaMapeada` (mapea el código al adapter; NULL = no soportado).
- **Registry `lib/couriers/serviciosSoportados.ts`** — 8 códigos canónicos.
- **Pantalla `/admin-couriers`** — sección Servicios con switch por código + wizard de alta.
- Sync de sucursales por cron + `RegistroCoberturaVacia`.

La **capa de configuración** está completa. Falta que el **runtime de cotización** la consulte.

---

## El hueco: adapters + cotizador NO consultan el catálogo al cotizar

- `MocisAdapter.cotizar` (L159) devuelve TODO lo que Akeron contesta, como strings crudos,
  sin filtrar por catálogo y sin etiquetar con `codigoServicio`.
- `AndreaniAdapter.cotizar` (L163) devuelve un único `{ servicio: "Estándar", precioNeto }`
  con la etiqueta hardcodeada.
- `lib/cotizador.ts` agrega sin cruzar contra `ServicioCourier.activo`.

## Lo que falta cablear (4 puntos)

1. `lib/cotizador.ts` — pedir SOLO los códigos con `ServicioCourier.activo = true` por courier.
2. `adapter.cotizar()` — recibir `codigosSolicitados: CodigoServicio[]` y devolver resultados
   **etiquetados con `codigoServicio`**.
3. Adapters leen `capacidadTecnicaMapeada` para traducir cada código a su API (ver tablas).
4. Descartar servicios devueltos que NO fueron pedidos (defensa).

---

## HALLAZGOS VERIFICADOS (NotebookLM, 2026-07)

### Andreani — todo por número de CONTRATO

La API de Andreani NO tiene parámetro "servicio" ni "velocidad". **El contrato ES el
servicio.** Cada modalidad es un contrato distinto asignado comercialmente. Al COTIZAR
(`/v1/tarifas`), la respuesta es ANÓNIMA (solo precio, sin decir qué servicio) → **el adapter
DEBE recordar qué contrato mandó para etiquetar el resultado con el código.** La modalidad
domicilio/sucursal se expresa al CREAR la orden (`destino.postal` vs `destino.sucursal.id`),
no al cotizar.

| Código catálogo | Servicio Andreani | Cómo se pide | ¿Se ofrece? |
|---|---|---|---|
| entrega_domicilio_estandar | Encomienda eCommerce | contrato estándar; crear: destino.postal | Sí |
| entrega_domicilio_express | Encomienda SLA express | contrato express (REQUIERE contrato comercial aparte) | Sí, SI se consigue el contrato express |
| entrega_sucursal | Encomienda retiro en sucursal | contrato sucursal; crear: destino.sucursal.id | Sí |
| entrega_punto_retiro | Punto de tercero (PD3) | contrato sucursal; crear: destino.sucursal.id del PD3 | Sí (igual que sucursal) |
| entrega_elocker | (no es categoría propia) | se trata igual que sucursal si está en la red | No como categoría propia |
| inversa_cambio | LI Cambio | contrato cambio; crear: productoAEntregar/productoARetirar | Sí (etiqueta documentoDeCambio) |
| inversa_devolucion_retiro_domicilio | LI Retiro | contrato retiro; origen.postal=comprador, destino.postal=vendedor | Sí |
| inversa_devolucion_dropoff_sucursal | LI Drop-off | contrato devolución; origen.sucursal.id, destino.postal | Sí |

**Matriz deseada por Nacho (Andreani) — las 5 mapean:** Dom→Dom, Dom→Suc, Suc→Dom (devolución
económica drop-off), Cambio→Dom, Devolución→Dom.
**Sub-tarea A-1:** confirmar si Andreani asignó un contrato EXPRESS específico. Si no, el
servicio `entrega_domicilio_express` queda pendiente hasta conseguirlo (no bloquea el resto).

### Moci's / Akeron — por parámetro `service` (ID numérico)

La API se pide con un parámetro `service` (ID numérico). Si se omite, usa el "servicio por
defecto del cliente". **CONFIRMADO: Akeron NO ofrece entrega en sucursal** — solo acepta
direcciones de domicilio. La opción de sucursal que se cuela HAY QUE FILTRARLA ACTIVAMENTE:
si un cliente la elige, la creación del envío FALLA (no hay campo para sucursal en la API).

| Código catálogo | Servicio Moci's | Cómo se pide | ¿Se ofrece? |
|---|---|---|---|
| entrega_domicilio_estandar | Next Day / default | service = (ID Next Day) u omitir | Sí |
| entrega_domicilio_express | Same Day | service = (ID Same Day) | Sí |
| entrega_sucursal | NO soportado | — | No — FILTRAR activamente |
| entrega_punto_retiro | NO soportado | — | No — FILTRAR |
| entrega_elocker | NO soportado | — | No — FILTRAR |
| inversa_cambio | Cambio | /shipping_inversa/new, type_inversa=2 | Sí |
| inversa_devolucion_retiro_domicilio | Devolución | /shipping_inversa/new, type_inversa=1 | Sí |
| inversa_devolucion_dropoff_sucursal | NO soportado | — | No — FILTRAR |

**Matriz deseada por Nacho (Moci's):** Dom→Dom Same Day, Dom→Dom Next Day, Devolución→Dom,
Cambio→Dom.

**⚠️ Sub-tarea M-1 (BLOQUEANTE para distinguir velocidades):** la documentación NO define qué
`service id` numérico es "Same Day" y cuál "Next Day" (solo aparece el genérico `service: 1`).
Hay que AVERIGUARLO — por prueba de cotización en vivo (cotizar y leer la respuesta real) o
preguntando al soporte de Moci's. Hasta confirmarlo, NO se puede mapear con certeza
`entrega_domicilio_express` vs `entrega_domicilio_estandar` para Moci's. Decisión de Nacho:
dejarlo como sub-tarea a confirmar (no adivinar el número — un ID equivocado rompe envíos).

---

## Orden de implementación sugerido (cuando se ataque)

1. **Primero el filtro (resuelve el bug urgente):** cablear que el cotizador descarte los
   servicios NO activos en catálogo. Esto solo ya frena que Moci's cotice sucursal (el
   síntoma que rompe envíos). No depende de M-1.
2. **Etiquetado por código:** adapters devuelven `codigoServicio` en vez de strings crudos.
   Andreani: el adapter recuerda qué contrato mandó. Moci's: mapea por `service id` (bloqueado
   por M-1 para distinguir velocidades) o por string como puente temporal.
3. **Confirmar M-1** (service id de Moci's) y A-1 (contrato express de Andreani).
4. Llenar `capacidadTecnicaMapeada` de cada `ServicioCourier` según las tablas de arriba.

---

## Notas relacionadas

- `serviciosSoportados.ts:13-17`: DEUDA futura de rediseño de taxonomía de `tipoEntrega`
  (mezcla conceptos; debería ser 3 grupos + subtipos). Evaluar si va antes o después.
- Nivel-courier (qué ofrece Shipro) ≠ disponibilidad por cliente (Modelo A/B, en
  `CredencialCourier`). No mezclar.
- Escalar a los 4 couriers faltantes: mismo método (cuaderno NotebookLM por courier →
  tabla de mapeo → cargar servicios en el alta → cablear).

## Absorbe

- "Moci's cotiza sucursal sin ofrecerla" (mismo root; ahora con urgencia: rompería el envío).
- "No se distingue same-day de next-day" (mismo root; para Moci's depende de M-1).

---

## DEUDA 157 — Rediseño del markup Shipro: markup UNIFICADO per-courier con modo HEREDA/PROPIO (Shipro-managed) (registrada 2026-08-28, RESUELTA EN PROD 2026-09-06)

**Status:** **RESUELTA EN CÓDIGO 2026-09-01 (COMPLETA en localhost), pendiente deploy prod.** Semáforo localhost↔prod: queda acá hasta subir. Las 4 piezas (3 del rediseño + cierre client-card) están en local, verificadas end-to-end. Post-deploy prod → mover a `DEUDAS-RESUELTAS.md`.

**RESUMEN DEUDA 157 COMPLETA (en local):** el markup Shipro se migró de la tarjeta del cliente al admin per-courier. Cliente ya NO ve ni edita ningún ajuste de markup — lo maneja Shipro en `/admin-markup-courier` con modo HEREDA (sigue global) o PROPIO (valor fijo, permite 0). Objetivo original cumplido.

**Commits (4 piezas):**
- **Pieza 1** `93ef1c4` (2026-09-01): campo `modo` (enum `MarkupCourierModo` HEREDA/PROPIO) en `MarkupCourier`, default HEREDA. Migración aditiva. Cero cambio de precio.
- **Pieza 2** `150eb4a` (2026-09-01): UI `/admin-markup-courier` con toggle HEREDA/PROPIO + valor recordado + hint global; API upgrade (GET devuelve `globalActivo`, POST persiste `modo`).
- **Pieza 3** `73e3aa7` (2026-09-01): motor conectado — nuevo `resolverMarkupCourierPorcentaje` (Rama A: MarkupCourier con lógica modo; Rama B: gate 0). 3 callers rewired. `aplicarMarkup` math intacta. Verificado end-to-end: Andreani PROPIO 15% subió $14.192,04→$14.742,45 (Δ+3.88% coherente 10%→15%); HEREDA idénticos; Rama B gate = 0.
- **CIERRE** `33822c6` (2026-09-01): tarjeta del cliente limpia. Removidos de `/configuracion/transportes` sección 3 los inputs de "Recargo/Descuento %" (`ajusteTarifaPorcentaje` — huérfano tras Pieza 3, motor lee `MarkupCourier`) y "Costo Fijo Adicional $" (`markupFijo` — oculto, regla proporcional-only, queda vivo en código con valor 0, re-exponible). Conservada la "Tarifa de rescate" (`tarifaPlanaRespaldoCourier` — engine consumer, obligatoria DEUDA 132). Sección renombrada a "3. Tarifa de rescate". Save endpoint dejó de persistir los 2 campos removidos (quedan en 0 DB, ya estaban en 0 fleet-wide — verificado). Motor INTACTO. `tsc=0`. Blast: 2 files (`TransportesTab.tsx` + `configuracion/couriers/route.ts`). Zero cambio de precio (Δ price = 0 en local).

**Base previa (aditiva) del build-home:** `MarkupCourier` model + admin API + UI + nav (`fc03a1f`, 2026-08-31) es el hogar sobre el que se apilaron las 3 piezas + cierre. Sigue vigente como base del rediseño unificado.

**Plan de deploy (Opción A — PRICE-NEUTRAL):** prod hoy tiene todos los couriers en HEREDA (default de Pieza 1, cero PROPIO cargado). Conectar el motor en prod es PRICE-NEUTRAL — todos siguen el global 10%, idéntico al comportamiento del path viejo (que para `ajusteTarifaPorcentaje=0` también caía al global). El cierre client-card + endpoint stop-writing también price-neutral (los DB values ya en 0 fleet-wide, verificado). **Deploy invisible para facturación.** Ajustes PROPIO se hacen DESPUÉS deliberadamente desde `/admin-markup-courier`.

**SUB-TAREAS RESIDUALES (registrar, no urgentes):**
- **`markupFijo` field vivo en el motor a 0:** `aplicarMarkup` L209/L231/L238 sigue leyendo el `fijoMarkup` del `config`; con `credencial.markupFijo=0` fleet-wide, es no-op (`secoNeto.add(0)=secoNeto`, `.add(0)=X`). Si algún día se decide eliminarlo del todo (regla proporcional-only definitiva confirmada), es una migración destructiva del motor — su propia mini-obra con recon + backup. **Por ahora oculto en UI + persistido en 0 + no-op en pricing.** Puede quedar así indefinidamente sin costo operativo.
- **[[DEUDA 154]]** (label engañoso "Recargo/Descuento"): **RESUELTA DE FACTO** al remover ese input de la tarjeta del cliente en el cierre. El label ya no se muestra al usuario; el campo Prisma `ajusteTarifaPorcentaje` queda dormant en DB (0 fleet-wide, no read por motor post-Pieza-3, no written por el endpoint post-cierre). Marcar DEUDA 154 como cerrada.
- **[[DEUDA 158]] entangled** (renames pendientes `ajusteTarifaPorcentaje` + `markupFijo`): ambos ya no están en la UI del cliente ni en el pricing engine. Si se quiere renombrar los fields Prisma por rol real (para consistencia semántica del schema post-Pieza-3), es un rename con `@map` como los otros 7 renames DEUDA 158 hechos — **opcional, no urgente** (los fields están dormant; renombrar es puramente cosmético para futuros lectores del schema).

**Origen:** sesión DEUDA 156 (2026-08-28), al preguntarse Nacho si el field `ajusteTarifaPorcentaje` debía vivir en la tarjeta del cliente o en admin. Evolución del diseño: 2026-08-28 registro inicial → 2026-08-31 build-home + design LOCKED simplificado (per-courier general) → 2026-09-01 diseño UNIFICADO con modo HEREDA/PROPIO + 3 piezas + cierre. **Cumplido el objetivo:** el cliente REAL puede entrar a producción sin poder alterar el markup Shipro.

**DISEÑO MARKUP UNIFICADO (Nacho, 2026-09-01 — REEMPLAZA la decisión previa "motor lee solo MarkupCourier sin fallback"):**

El markup por courier tiene un **modo explícito**:
- **HEREDA:** el courier sigue el markup **global** (`MarkupShiproVigencia`) **en vivo** — si cambia el global, se actualiza solo (no se copia el valor).
- **PROPIO:** el courier usa su `valorPorcentaje` fijo — **NO sigue al global**.
- **PROPIO permite 0%** (apagar el markup a propósito — promo/acuerdo especial) — estado **distinto de HEREDA** (que replicaría el global aunque el global sea 10).

**4 aristas decididas:**
1. **HEREDA = vínculo vivo (no copia):** sigue al global cuando cambia. Ventaja: al modificar el global, todos los HEREDA se actualizan automáticamente.
2. **UI = toggle explícito** Hereda/Propio por courier (no la convención ambigua "0=hereda").
3. **PROPIO 0% permitido** (distinto de HEREDA — se usa para apagar el markup a propósito).
4. **Modo y valor van SEPARADOS** — como `descuentoClienteModo`/`descuentoClientePorcentaje` de [[DEUDA 156]]. El 0 ya no significa heredar; el modo lo dice explícito.

**Motor (Pieza 3):** Rama A → lee `MarkupCourier` del courier:
- `modo=HEREDA` → usa el global vigente (`MarkupShiproVigencia`).
- `modo=PROPIO` → usa `valorPorcentaje` de la fila.
Rama B → sin markup Shipro (como ya definido; no consulta).

**`MarkupShiproVigencia` SIGUE EXISTIENDO** (cambio vs. decisión previa que planeaba eliminarlo del motor) — es el valor que los `HEREDA` siguen. La tabla + su UI `/admin-parametros-tarifa` se mantienen vivas.

**Observación colateral (importante):** la idea previa "no activar courier sin markup" (validación bloqueante en catalog activation) **queda como sub-tarea futura / obsoleta** con este diseño. Con `default HEREDA` en `MarkupCourier`, un courier nuevo puede tener 0 filas `MarkupCourier` **y aun así heredar el global automáticamente** vía HEREDA. En cuanto se cree la primera fila (o antes, aplicando el default en el resolver: sin fila = HEREDA = global), "courier sin markup" **deja de ser un estado posible**. Elegante — el default resuelve la preocupación sin necesidad de validación bloqueante.

**CONSTRUCCIÓN en 3 PIEZAS** (Opción A — deploy por separado, máximo aislamiento; motor aislado para verificar precios uno-por-uno):

- ✅ **PIEZA 1 (HECHA local 2026-09-01, commit `93ef1c4`):** campo `modo` (enum `MarkupCourierModo` {HEREDA, PROPIO}) en `MarkupCourier`, `default HEREDA`. Migración **aditiva** (`CREATE TYPE` + `ADD COLUMN NOT NULL DEFAULT 'HEREDA'`). Filas existentes (Andreani, Moci's, OCA, Correo Argentino, Hop Envíos — todos 10%) → `modo=HEREDA` automáticamente vía DEFAULT (**cero cambio de precio**: siguen todos matcheando el global 10% igual que antes). Motor NO tocado. `tsc=0`. Blast: 2 files (schema + migration). Pendiente deploy prod.

- ✅ **PIEZA 2 (HECHA local 2026-09-01, commit `150eb4a`):** UI `/admin-markup-courier` rediseñada con toggle HEREDA/PROPIO por courier + API upgrade:
  - **Toggle segmentado** (2-column grid, azul Shipro `#233b6b` seleccionado) HEREDA/PROPIO en cada card, bound a `nuevoModo[courierId]` (prefill con `activa.modo` o default `HEREDA`).
  - **HEREDA:** input % deshabilitado, placeholder muestra `heredando X%` (global); col "Vigente" en azul muestra "HEREDA" + "Aplica el global: X%". El valor se persiste igual (VALOR RECORDADO — al volver a PROPIO se recupera sin re-tipear).
  - **PROPIO:** input editable, permite 0; hint bajo el input aclara *"0% = markup apagado a propósito, distinto de HEREDA"*. Col "Vigente" muestra el valor + "PROPIO" (+ badge "apagado a propósito" si valor=0).
  - **Header** con hint global vigente ("Global vigente: X% — es el valor que siguen los couriers en modo HEREDA").
  - **Historial:** nueva columna "Modo"; en filas HEREDA el valor muestra `(hereda global)` en cursiva gris (más honesto — el valor guardado no era el aplicado).
  - **API `route.ts`**: GET devuelve `{ filas, globalActivo }` (agregado el global en single-round-trip). POST acepta `modo` en body con whitelist defensivo (default `HEREDA` si falta/inválido), no-op guard compara tupla `(modo, valorPorcentaje)` (switch HEREDA↔PROPIO con mismo valor sí es cambio), `create({ data: { ..., modo } })` persiste, audit log `[AUDIT markupCourier]` incluye `modoAnterior/modoNuevo`.
  - **Verificado localhost end-to-end:** toggle funciona; **VALOR RECORDADO OK** — ida-y-vuelta PROPIO→HEREDA→PROPIO recupera el valor sin pérdida; audit log confirma persistencia de `modo` en cada vigencia; el **PRECIO SIGUE AISLADO** — cotizar Andreani en PROPIO 15% dio el mismo precio ($14.192,04) porque el motor NO lee `modo` aún (`resolverMarkupShiproPorcentaje` sigue con el path viejo `ajusteTarifaPorcentaje` + global). Confirma la disciplina de aislamiento del motor hasta Pieza 3.
  - `tsc=0`. Blast: **2 files** (`app/(dashboard)/admin-markup-courier/page.tsx` + `app/api/admin/markup-courier/route.ts`). **Cero pricing tocado.** Pendiente deploy prod.

- ✅ **PIEZA 3 (HECHA local 2026-09-01, commit `73e3aa7`):** motor conectado a `MarkupCourier`. Cambios:
  - **Nuevo `resolverMarkupCourierPorcentaje(courierId, usaCredencialesPropias, client)`** en `lib/utils/resolvers-tarifa.ts`. Lógica LOCKED:
    - **Rama B** (`usaCredencialesPropias=true`): return 0 sin query (gate al tope).
    - **Rama A**: `findFirst({ courierId, activo, vigenciaDesde ≤ ahora, vigenciaHasta null/≥ahora })`. `modo=PROPIO` → devuelve `valorPorcentaje`. `modo=HEREDA` → helper `resolverGlobalMarkupPorcentaje` (vínculo vivo con `MarkupShiproVigencia`). Sin fila → warn + safety net al global (no throw — default HEREDA de Pieza 1 hace que "sin fila" no debería pasar; safety net cubre edge cases sin romper cotización).
  - **3 callers rewired:** `lib/cotizador.ts:518` (con null-safe `courierReal ?`), `lib/envios/crear.ts:684`, `app/api/conciliacion/route.ts:327` (con `tx` client). Todos pasan `(courierId, usaCredencialesPropias)`.
  - **`resolverMarkupShiproPorcentaje` viejo REMOVIDO** — 0 consumers post-rewire (grep confirmó).
  - **`aplicarMarkup` math INTACTA** — L200-260 sin cambios; sigue leyendo `config.ajusteTarifaPorcentaje` y aplicando el factor en L237. Solo cambió la FUENTE del value upstream.
  - **Intermediary path INTACTO** — `resolverIntermediarioMarkupPorcentaje` + `baseConIntermediario` L223-225 sin cambios.
  - `tsc=0`. Blast: **4 files** (resolver + 3 callers). Cero cambios en math ni intermediary path.

  **Verificación end-to-end local (money-safe):**
  - **Andreani PROPIO 15%:** baseline $14.192,04 (con 10% viejo global) → **$14.742,45** (post-Pieza-3 con 15% PROPIO). Delta $550.41 = **+3.88% sobre precioFinal**, coherente con markup 10%→15% aplicado sobre `baseConIntermediario` (delta cascade: 1.10→1.15, +4.5% aprox sobre cascada-Shipro, diluido por SMO/Fee/IVA constantes).
  - **Moci's, OCA, Correo Argentino, Hop Envíos (HEREDA):** precios **IDÉNTICOS** al baseline (siguen matcheando el global 10% via el nuevo resolver).
  - **Rama B (empresa 5 Andreani propias):** gate = 0, sin markup Shipro (mismo comportamiento que el path viejo — ambas versiones ignoran Rama B).
  - **Resolver-level simulación cross-checked:** viejo=10 vs nuevo=15 en Andreani (Δ +5pp); viejo=10 vs nuevo=10 en HEREDA (Δ 0). Predicción numérica match perfecto.

**PLAN DE DEPLOY (Opción A, decidido — deploy NEUTRO):**
- **Prod hoy: TODOS los couriers en HEREDA** (default de Pieza 1, no se cargó ningún PROPIO). Conectar el motor en prod es **PRICE-NEUTRAL** — todos siguen el global 10%, idéntico al comportamiento actual del resolver viejo (que para `ajusteTarifaPorcentaje=0` también cae al global 10%).
- **Deploy invisible para facturación** — cero cambio de precio, cero impacto operativo.
- **Ajuste de markups per-courier a PROPIO se hace DESPUÉS** desde `/admin-markup-courier`, deliberado y medible, aislado del deploy del motor. Un problema es del rewire O de un valor nuevo, nunca ambos mezclados.

**Con Pieza 3, la DEUDA 157 queda funcionalmente COMPLETA en su parte motor+admin.** Las 3 piezas del rediseño están cerradas:
- ✅ Pieza 1: campo `modo` (data model).
- ✅ Pieza 2: toggle admin UI + API.
- ✅ Pieza 3: motor consume desde `MarkupCourier`.

Post-deploy prod → marcar la deuda RESUELTA siguiendo la convención del repo (semáforo localhost↔prod).

**PIEZA 4 pendiente (cierre client-card):** con el motor ya migrado, el campo viejo `CredencialCourier.ajusteTarifaPorcentaje` **YA NO lo lee el motor** (Pieza 3 lo reemplazó), pero **sigue EXISTIENDO en la UI del cliente** (`components/configuracion/TransportesTab.tsx` sección "3. Ajuste Comercial"). Su remoción es el cierre final:
- Remover sección "3. Ajuste Comercial (Tu Tienda)" de `TransportesTab.tsx` (el cliente no debería verla ni tocarla).
- Drop de `CredencialCourier.ajusteTarifaPorcentaje` + `markupFijo` del schema (migración destructiva patrón DEUDA 160).
- Rewire de UI + endpoint edit (`app/api/configuracion/couriers/route.ts`) + `lib/permisos.ts` + `lib/auditoria-configuracion.ts` para no listar los fields dropeados.
- Cierra [[DEUDA 154]] (label engañoso "Recargo/Descuento" — se resuelve al remover) y los renames [[DEUDA 158]] entangled (`ajusteTarifaPorcentaje` + `markupFijo` se van al drop en vez de renombrarse). Scope: medio (múltiples files + migración destructiva); prioridad: baja post-Pieza-3 (motor ya migrado, el field vive dormido).

---

### Historia del diseño (contexto, no vinculante post-2026-09-01)

**Design LOCKED previo (Nacho 2026-08-31, superseded 2026-09-01):**
- Markup general por courier, un `%` por courier igual para todos los clientes, Shipro-managed.
- Motor leería **solo `MarkupCourier`, sin fallback global** (fail-loud si missing).
- Override per-cliente = feature futura; valores viejos no se migran.

**Cambio 2026-09-01:** el diseño evolucionó a UNIFICADO con modo explícito. Los 4 principios superficiales (per-courier, Shipro-managed, no per-cliente-override, start-fresh) se conservan; la mecánica interna cambió: el motor ahora consulta modo primero y **mantiene el global como el valor vivo que HEREDA sigue** (en vez de ignorarlo). Esto elimina el edge case "missing markup = fail-loud" (ahora HEREDA default cubre el caso).

**AVANCE Paso 1 previo (2026-08-31, commit `fc03a1f`):** hogar `MarkupCourier` construido:
- **Model `MarkupCourier`** (`prisma/schema.prisma`) — calco de `SmoCourier`.
- **Admin API `/api/admin/markup-courier/route.ts`** — mirror de `/api/admin/smo-courier/route.ts`.
- **Admin UI `/admin-markup-courier/page.tsx`** — mirror de `admin-smo/page.tsx`. Sin toggle de modo (será Pieza 2).
- **Nav wiring** en `app/(dashboard)/layout.tsx`.

Migración aditiva (`CREATE TABLE + INDEX + FK`), aplicada local, blast 5 files, cero pricing. Pendiente deploy prod. **Este build sigue vigente** — es el hogar sobre el que se agrega Pieza 1 (modo).

**Contexto técnico (invariante — sigue vigente):** `MarkupShiproVigencia` es GLOBAL (una fila plataforma, sin `empresaId` FK). El resolver `resolverMarkupShiproPorcentaje` (`lib/utils/resolvers-tarifa.ts:47-73`) hoy lee el override per-credencial `CredencialCourier.ajusteTarifaPorcentaje` cuando > 0, sino cae al global. Post-Pieza-3 el resolver cambia: lee `MarkupCourier` con lógica modo (HEREDA→global, PROPIO→valor), gate Rama B.

**Absorbe / reemplaza:** [[DEUDA 116]] (default global en onboarding) + [[DEUDA 117]] (UI del override) — ambas quedaron parcialmente pensadas contra el diseño per-credencial actual. El rediseño unificado las supera.

**Otros fields de la sección 3 (post-Pieza-3):**
- **`markupFijo`** ("Costo Fijo Adicional") — se va al DROP junto con `ajusteTarifaPorcentaje` (mismo dominio: markup Shipro per-cliente → pasa a Shipro-admin). El equivalente per-courier queda como feature futura (por ahora solo el `%` general vive en `MarkupCourier`; si se necesita fijo per-courier después, se agrega un `valorFijo` al mismo model o un `MarkupCourierFijo` hermano).
- **`tarifaPlanaRespaldoCourier`** ("Tarifa de rescate") — **se queda en la tarjeta del cliente.** Es un dato del cliente (DEUDA 132 Paso 5b), no una decisión Shipro.

**Relación:** [[DEUDA 154]] (label engañoso — se resuelve al remover el campo en el cierre client-card). [[DEUDA 116]] + [[DEUDA 117]] (absorbidas). [[DEUDA 156]] (el descuento del cliente — SÍ se queda en la tarjeta, es capa cliente→comprador; su patrón `descuentoClienteModo`/`valor` es el precedente del `modo`/`valorPorcentaje` acá). [[DEUDA 155]] (UI faltante del intermediario — semánticamente análoga; si ambas se hacen juntas en admin, comparten espacio). [[DEUDA 164]] (fix Hop — descubierto durante esta campaña).

**Scope:** alto (toca schema + motor de pricing + conciliación + UI + migración de datos). **Prioridad:** media-alta (bloquea que el cliente toque el markup Shipro; mitigado hoy porque no hay clientes reales en prod).

**Origen:** sesión DEUDA 156 (2026-08-28), al preguntarse Nacho si el field `ajusteTarifaPorcentaje` debía vivir en la tarjeta del cliente o en admin. Recon confirmó (a) que el diseño histórico lo puso deliberadamente per-credencial, (b) que mover a admin per-cliente requiere migración real (no rename), (c) que hoy sin clientes reales en prod es el momento ideal para reestructurar sin romper contratos vivos.

---

## DEUDA 164 — Bug: courier con nombre acentuado (Hop Envíos) duplicado en /admin-couriers + "Error al crear el courier" al activar (registrada 2026-09-01, RESUELTA EN PROD 2026-09-06)

**Status:** RESUELTA EN CÓDIGO (commit `ef00894`, 2026-09-01), pendiente deploy prod (fix presente en local + push pendiente). Semáforo localhost↔prod: queda acá hasta subir. Bug pre-existente (no introducido esta sesión), presente en local Y prod hasta este fix.

**Problema:** el normalizador de nombres de courier en `app/api/admin/couriers/route.ts` (GET filter L47 + POST pre-check L177) hacía `.toLowerCase().replace(/['\s]/g, "")` — strippeaba minúsculas + apóstrofes + whitespace pero **NO acentos**. La `í` sobrevivía la normalización.

Consecuencia para **Hop Envíos**:
- **DB** `"Hop Envíos"` → normaliza a `"hopenvíos"` (con `í`).
- **Registry canonical** (`lib/couriers/CourierFactory.ts:24`) → `"hopenvios"` (sin `í`, ASCII plain).
- **Mismatch en GET filter:** `nombresEnBd` set contenía `"hopenvíos"`; `couriersSoportados()` devolvía `"hopenvios"` → `.filter(!nombresEnBd.has(n))` dejaba pasar Hop → **la UI lo mostraba dos veces** (en la lista de couriers activos DB + en la lista "integrables"). Otros 4 couriers (Andreani, Mocis, OCA, Correo Argentino) sobrevivían por casualidad — todos display names all-ASCII, la normalización coincidía con el canonical. Hop era el **único** courier del registry con un carácter no-ASCII (`í`).
- **Mismatch en POST pre-check:** el falso negativo del mismo normalizador dejaba pasar el request de re-crear. El `create` hits `Courier.nombre @unique` (schema L211) → Prisma tira P2002 → catch L228-230 devolvía el genérico `"Error al crear el courier"` (500), ocultando la razón real (unique violation).

**Fix (commit `ef00894`, 2026-09-01):**
1. **Normalizador arreglado:** pipeline nuevo `lowercase → NFD → strip diacríticos (regex sobre U+0300–U+036F) → strip apóstrofes + whitespace`. Ahora `"Hop Envíos"` → `"hopenvios"` (matchea el canonical). Los otros 4 couriers normalizan idéntico al pre-fix (NFD sobre ASCII es no-op).
2. **Extraído a helper compartido** `lib/utils/normalizar-courier.ts` (`normalizarNombreCourier`) — usado por GET filter + POST pre-check en el mismo file. Evita drift futuro entre dos sitios copy-pasted.
3. **P2002 específico:** catch POST distingue `Prisma.PrismaClientKnownRequestError` con `err.code === "P2002"` → responde 409 con `"El courier \"${nombre}\" ya existe."`. Red-safety para race conditions (dos POST concurrentes entre pre-check y create) y para futuros drifts entre normalizer y DB. El catch genérico se mantiene para otros errores (500).

**Verificado localhost:** `tsc=0`; sanity de normalización confirma `"Hop Envíos" → "hopenvios"` (fix) + los otros 4 couriers idénticos (`andreani`, `mocis`, `oca`, `correoargentino`); solo 2 files tocados (`admin/couriers/route.ts` + `lib/utils/normalizar-courier.ts` nuevo). **Cero pricing, cero schema, cero migration.**

**Sub-tarea menor (report only, pendiente):** el recon detectó otros sitios con el patrón viejo `.toLowerCase().replace(/['\s]/g, "")` que hacen matching de nombre de courier — candidatos a migrar al helper compartido para prevenir el mismo bug si algún futuro courier trae acentos:
- `lib/couriers/normalizar.ts:14` (probablemente `normalizarParaComparacion`, usado en cotizador + dispatch).
- `lib/couriers/credenciales/index.ts:17, 37` (resolución de credenciales).

No tocados en `ef00894` por scope estricto — solo route de admin-couriers. Registrar como micro-follow-up cuando se decida migrar el resto del codebase al helper unificado.

**Scope:** bajo (1 file de código + 1 helper nuevo + doc). **Prioridad:** alta (bug operativo — bloqueaba activación de Hop en admin, opacaba errores de creación).

**Relación:** [[DEUDA 32+37]] (ABM de couriers original — introdujo el normalizador buggy). Descubierto durante la campaña de DEUDA 157 (Nacho cargando markups per courier post-Paso 1, notó el duplicate + error al intentar activar Hop).

**Origen:** Nacho reportó el bug al intentar activar Hop en el admin (2026-09-01) tras deploy de DEUDA 157 Paso 1. Diagnosis + fix same-session.

---

## DEUDA 145 — Timeout de courier: bajar de 8s a <5s parametrizable por-call para el plugin (registrada 2026-08-10, RESUELTA 2026-09-09 en 3 partes A + B + C)

**Status:** RESUELTA 2026-09-09. Cerrada en 3 partes cross-chat.

**Cierre:**

- **Parte A — Núcleo (cotizador paralelizado):** el loop serial `for (const config of couriersAptos)` en `lib/cotizador.ts:484` se reemplazó por `Promise.allSettled(couriersAptos.map(...))` preservando el orden vía merge post-loop. La cotización pasó de "suma de latencias de todos los couriers" a "el courier más lento" — con la parametrización de Parte B ese máximo queda con techo de 8s, y en condiciones normales la cotización responde en ~3-3.5s. Money-safe: precios/orden/manejo de errores byte-identicos, solo cambia la orquestación. Commit `59f3f4c`, en prod.

- **Parte B — Couriers (timeout parametrizable por-call):** en los 6 adapters (Andreani, Correo Argentino, Hop Envíos, Intralog, Moci's, OCA) se parametrizó `fetchConTimeout(input, init?, timeoutMs = COURIER_TIMEOUT_MS)` y se agregó `ETIQUETA_TIMEOUT_MS = 30000`. Cotización/despacho/rastreo/cancelación siguen a **8s** (bajo el circuit breaker de Tiendanube de 10s). La **descarga de etiqueta** pasa a **30s** — es back-office (el operador aprieta "Imprimir", espera; no hay cutoff de plataforma) y los couriers arman el PDF on-demand, con tiempos legítimos de varios segundos. OCA además parametriza `soapPost(..., timeoutMs)` para poder pasar el override sólo al método de etiqueta (`GetEtiquetasPorOrdenOrNumeroEnvio_PDF`); el resto de SOAPs mantiene 8s. Commits `1f05f24` (Intralog, ya en prod) + `97bf443` (los 5 restantes), en prod.

- **Parte C — Plugin WooCommerce:** timeout de cotización del plugin fijado a **10s** (valor de producción, no temporal). Cubre el techo de 8s de la cotización de Shipro + margen, y respeta el límite de las plataformas donde se publica tarifa (Tiendanube 10s). Comentario en el plugin actualizado para dejar asentada la decisión. Commit `6dad59c` en el repo `shipro-woocommerce`, con **release v0.1.0** publicado (tag `v0.1.0`, .zip attach, download URL fijo `https://github.com/Nachioa23/shipro-woocommerce/releases/download/v0.1.0/shipro-woocommerce-0.1.0.zip`).

**Decisión de negocio asentada:** el timeout del plugin **no se fija arbitrariamente** — lo fija el techo más bajo de las plataformas donde se publica tarifa. Hoy 8s cubre a todas (Tiendanube 10s). La cotización de Shipro está diseñada para responder por debajo de ese techo (cotizador paralelizado + timeout por courier). Si entra Shopify alto volumen (~3s de ventana) al roadmap, se reevalúa por plataforma. La etiqueta es back-office (sin cutoff), por eso queda uniforme en 30s.

**Desbloquea:** DEUDA 150 Pieza 3 (mandar plugin desde el hub — necesitaba el `.zip` en URL pública fija, resuelto por el release v0.1.0). DEUDA 144 (rates callback Tiendanube — queda con margen de sobra sobre los 5s del circuit breaker gracias a la Parte A + B).

---

### Texto original de la deuda (preservado)

**Status:** ABIERTA — prerequisito de calidad del rates callback (DEUDA 144).

**Problema:** `COURIER_TIMEOUT_MS = 8000` está hardcodeado y DUPLICADO en ambos adapters (MocisAdapter + AndreaniAdapter), no parametrizable por-llamada. Tiendanube corta el rates callback a los 5s (circuit breaker, DEUDA 130). Con 8s de techo por courier, una cotización lenta puede pasarse de los 5s de Tiendanube.

**Solución (diseño):** parametrizar el timeout como parámetro opcional del adapter (o del `fetchConTimeout`), para que el contexto "checkout" use < 5s sin bajar el global de 8s (que sirve al dashboard, donde 8s está bien). Opción (a) parametrizar per-call — preferida; opción (b) bajar la constante global — descartada (afecta dashboard).

**Nota:** el wrapper `fetchConTimeout` ya quedó SANO post-fix del bug de recursión (ver suplemento de DEUDA 129, commit 709d995). Este cambio es sobre el VALOR del timeout, no sobre el wrapper roto (ya arreglado).

**Relación:** DEUDA 129 (donde vive el timeout), DEUDA 144 (el rates callback que lo necesita <5s), DEUDA 130 (los 5s de Tiendanube).

---

## DEUDA 180 — Mercado Envíos Flex (MEF) Fase 1 núcleo (RESUELTA 2026-09-21 — en prod + validada) — pendiente conocido: RATIFICAR handshake con webhook real de ML

Registrada 2026-09-13. Lideró Chat D. Chat A (núcleo) construyó la Fase 1 completa entre 2026-09-14 y 2026-09-21. Fases 2-5 (routing por zonas, generación de etiqueta, ingesta de eventos de shipment, excepciones operativas) siguen bajo Chat D, fuera del alcance de esta resolución.

**Lo construido — MEF Fase 1 (núcleo), 10 commits en prod**:

- **Modelo de datos** (`b53426d` + fix `b77faa1`): 3 tablas aditivas — `CuentaMercadoLibre` (1—1 con Empresa, tokens encriptados AES-256-GCM), `TokenVinculacionMercadoLibre` (OAuth state single-use, mirror del twin Tiendanube), `NotificacionFlex` (staging idempotente de webhooks, dedup por `notificacionId @unique`). `mlUserId BigInt` post-fix — los `user_id` de ML son de 10 dígitos, no entran en INT4; el step-1 lockeó Int por error, la realidad venció al lock, migración `ALTER COLUMN TYPE BIGINT` aditiva-lossless sobre tablas vacías.
- **Librería de tokens ML** (`18d33c3`): `lib/mercadolibre/tokens.ts` — `exchangeCodeForToken` + `getMercadoLibreAccessToken(empresaId, {force?})` con **refresh lazy + single-flight lock + persist-before-return** (previene brick por concurrent refresh del `refresh_token` single-use). `lib/mercadolibre/client.ts` — `mlFetch(empresaId, path, init?)` con retry-1 on 401.
- **Rutas OAuth**:
  - `POST /api/mercadolibre/install/link` operator (`6ea745b`) — helper compartido `crearInstallLinkMercadoLibre` para el core.
  - `GET /api/mercadolibre/oauth/callback` público (`6ea745b`) — cross-install guard por `mlUserId`, `$transaction` atómico upsert `CuentaMercadoLibre` (tokens encriptados) + burn del token de vinculación, best-effort `Conexion` upsert. Callback en `PUBLIC_API_EXACT` del proxy (`e0634e7` cerró gap del step 3).
  - Página éxito `/mercadolibre/instalado` (`cbc96da`) mirror del twin Tiendanube.
  - **Botón autoservicio "Conectar Mercado Libre"** en `/configuracion/conexiones` (`e8021c8`, primer flujo self-service del sistema): endpoint session-scoped `POST /api/empresa/mercadolibre/connect` con **security invariant** — `empresaId` sale EXCLUSIVAMENTE de `token.empresaId` (JWT firmado NextAuth), NUNCA del body. Un cliente conecta SU PROPIA cuenta ML.
- **Receiver de webhooks** `POST /api/mercadolibre/webhooks` (`cf49e93` + fix seguridad `eccfa3f` + guard `f45209a`) — CORREGIDO tras el HALLAZGO CRÍTICO 2026-09-21:
  - **Descubierto**: el receiver original validaba por `x-signature` HMAC, pero esa firma es de **Mercado PAGO** — el marketplace ML (topics: shipments/questions/items) **NO firma sus webhooks**. Autentica por: IP de origen (14 IPs publicadas que cambian) + HTTPS + validación server-side vía GET autenticado del recurso. El receiver original rechazaría 401 los webhooks reales de ML — hallazgo destapado por la insistencia de Nacho en el e2e real, ANTES de que hubiera clientes ML productivos afectados.
  - **Nuevo diseño** (política Chat D): SIEMPRE persistir (dedup por `notificacionId`); NUNCA descartar un aviso; `estado` EVOLUCIONA (`recibida` → `valido`/`huerfana`/`get_fallido_reintentable`/`get_shipment_no_existe`), centralizados en `lib/utils/estados.ts` bajo `ESTADOS_NOTIFICACION_FLEX` (5 estados, cross-ref [[DEUDA 173]]).
  - **Locks reales**: (a) seller resolution vía `CuentaMercadoLibre.findUnique({where:{mlUserId: BigInt(x)}})` — huérfana si no matchea; (b) GET autenticado `/shipments/{id}` con `x-format-new: true` (requerido por ML per Chat D) — un webhook falso no puede fabricar un shipment que exista en la cuenta del seller. GET post-persist, no gatea el 200; 200 → `valido`, 404 → `get_shipment_no_existe` (race con ML, reintentable — NO spoof), error/5xx → `get_fallido_reintentable`.
  - **IP allowlist** en `lib/mercadolibre/webhook-ip.ts` — **fail-open-but-loud**: 14 IPs precargadas (default), env `ML_WEBHOOK_IPS` override, flag `ML_WEBHOOK_IP_ENFORCE=false` default (log si no matchea + procesa igual). **Guard de honestidad**: si `ENFORCE=true` sin verificar nginx `set_real_ip_from`, warn ruidoso porque `x-forwarded-for` sería cliente-spoofeable y daría falsa seguridad.
  - **Rich logging** `[ml-webhook-recv]` con headers completos + IP + notificacionMlId + topic + estadoInicial — alimenta el hardening de la allowlist cuando aparezca el primer webhook real.

**Validaciones e2e en prod**:
- **OAuth e2e VALIDADO 2026-09-17**: test user MLA real (mlUserId=3.686.169.320) conectado end-to-end desde el botón autoservicio → callback → `CuentaMercadoLibre` con `estado="activa"`, tokens ciphertext AES-256-GCM (formato `hex:hex:hex`, no plaintext ML), `nickname` best-effort OK, `Conexion` upserted. El fix BigInt validado con el ID grande real.
- **Receiver arreglado VALIDADO 2026-09-21**: POST sin `x-signature` → 200 (antes hubiera dado 401); IP fail-open confirmada en el log ruidoso; dedup por `notificacionId @unique` idempotente; capture endpoint throwaway borrado post-diagnóstico.

**PENDIENTE CONOCIDO (explícito — NO cerrar como 100%)**: la **RATIFICACIÓN del handshake con un webhook REAL de ML** no se pudo hacer en sandbox — se agotaron los caminos entre 2026-09-17 y 2026-09-22:

- Guardar la URL de notificaciones en el DevCenter NO dispara ping (la doc de 2015 que sugería un ping en el `save` no aplica al panel actual).
- La publicación de prueba del test user quedó en cuarentena PolicyAgent → no se pudo gatillar preguntas/compras que emitieran webhooks reales.
- `GET /missed_feeds` devuelve `{"messages":null}` → ML nunca intentó emitir ninguna notificación.
- El simulador oficial de webhooks es de **Mercado Pago**, no del marketplace — no cubre topics de shipments/questions/items.
- **Intento 2026-09-22 vía topic `items`** (camino más simple: PUT sobre item propio con token del seller, sin buyer): recreamos el throwaway `/api/dev/ml-token` para exponer el token del seller a Nacho vía DevTools; probamos con **4 ítems distintos**. Todos bloqueados por el sandbox de ML:
  1. **Imagen que nunca procesa** — `picture_download_pending` eterno con URLs `picsum.photos` y `upload.wikimedia.org` (ML no descarga imágenes de esos hosts en el sandbox, contra lo que sugería la doc).
  2. **PolicyAgent 403 persistente** (`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`) que no cede ni tras 10+ min — el soporte de ML afirma que se destraba en 1-3 min; en la práctica no destrabó nunca.
  3. **Web UI trampa por 2FA**: al intentar destrabar desde la UI de ML como test seller, la interfaz pide verificación por email — el email de un test user es `<algo>@testuser.com` (dominio inexistente), no hay bandeja de entrada real, no se puede completar el 2FA. GN confirmó que es un bug conocido del sandbox de ML.
  4. **Finalización automática al tocar por UI**: los intentos de "activar" un ítem paused desde la UI terminan finalizando el ítem (`status: "closed"`) sin previo aviso.
- **Conclusión honesta**: el **sandbox de ML es impracticable** para disparar un webhook de prueba con test users bajo las condiciones actuales. NO es un problema del código de Shipro — el receiver quedó **validado + aprobado explícitamente por el soporte de ML como "estándar de oro"** en la comunicación del caso. Limpieza: throwaway `/api/dev/ml-token` **re-creado + re-borrado** en el mismo arco (los 2 commits documentados; endpoint fuera de prod post-cleanup).

**El pendiente se ratifica con el primer webhook REAL** que llegará por alguna de estas 2 vías:
1. **El primer cliente productivo real** (una venta genuina en la cuenta ML de un seller vinculado a Shipro) — el logueo rico `[ml-webhook-recv]` captura IP real de ML + headers + body para confirmar que el diseño matchea. No hay riesgo de código: el receiver es fail-open + never-discard; en el peor caso el aviso queda con `estado="huerfana"` para investigar, nunca se pierde.
2. **Si el soporte de ML destraba el sandbox** (respuesta al caso `docs/CASO-SOPORTE-ML-WEBHOOK-TESTING.md` — pendiente enviar con el dato extra del PolicyAgent persistente sobre test items).

**⚠️ Aclaración de alcance — la prueba end-to-end de negocio (compra → envío → ETIQUETA del courier) NO es Fase 1**. Requiere la **Fase 2 (routing por zonas Flex + generación de etiqueta del courier + integración con adapters)**, que todavía no está construida y la dirige Chat D. **La Fase 1 está completa y validada** — solo cubre: recibir el aviso, verificarlo (IP + GET autenticado del recurso), persistirlo, y evolucionar el estado. El flujo completo (compra → shipment → etiqueta impresa → tracking al buyer) se prueba cuando exista la Fase 2.

**Cross-refs a DEUDAs pendientes**:
- **DEUDA nginx real-IP** (registrada 2026-09-21 en DEUDAS.md bajo DEUDA 180): configurar nginx en pm.shipro.pro con `set_real_ip_from <rangos-Akamai-CIDR>` + `real_ip_header X-Forwarded-For`. Prerequisito para poder subir `ML_WEBHOOK_IP_ENFORCE=true` con seguridad real — hoy la IP es spoofeable y por eso el receiver arranca en fail-open. La IP allowlist es defensa secundaria; los locks reales son seller resolution + GET autenticado.
- **DEUDA 173** (centralización de literales de estado): los 5 nuevos estados de `NotificacionFlex` se centralizaron en `lib/utils/estados.ts` como `ESTADOS_NOTIFICACION_FLEX` siguiendo la disciplina que esa deuda pide.
- **Follow-up menor no bloqueante**: `enviarMailAlertaCruceMercadoLibre` helper en `lib/mailer.ts` (mirror del twin Tiendanube). Hoy el cross-install guard hace `AuditoriaConfiguracion.create` + `console.error` — visibilidad OK, mail es solo cortesía adicional. Se agrega cuando se toque `lib/mailer.ts`.

**Fases 2-5** (routing por zonas Flex, generación de etiqueta, ingesta de eventos de shipment, excepciones operativas) — territorio Chat D. Chat A construye piezas de núcleo bajo pedido de Chat D con spec funcional concreto.

**Commits de Fase 1 en prod** (10 hashes): `b53426d` (modelo) + `18d33c3` (tokens lib) + `6ea745b` (OAuth routes) + `cbc96da` (página éxito) + `cf49e93` (webhook receiver) + `e0634e7` (proxy fix callback) + `e8021c8` (botón autoservicio) + `b77faa1` (fix BigInt) + `eccfa3f` (fix receiver security) + `f45209a` (guard honestidad enforce).

**Relación**: [[DEUDA 150]] (hub de conexiones — MEF suma `Conexion(plataforma=MERCADOLIBRE, mecanismo=OAUTH)` via callback), [[DEUDA 173]] (centralización de literales), DEUDA nginx real-IP (registrada bajo DEUDA 180 en DEUDAS.md).

---

## DEUDA 180 — Mercado Envíos Flex (MEF) Fase 2 (ruteo por zonas) (RESUELTA 2026-09-24 — en prod + verificada, 3 pendientes conocidos explícitos)

**Contexto**: Chat A núcleo bajo dirección Chat D. Fase 2 completa el ruteo del canal ML Flex: leer las zonas del vendedor, dejarle asignar un courier por zona, resolver el courier al recibir un shipment real y crear el Envío por el motor unico (`crearEnvio`) sin tratamiento especial de plata.

**Lo construido — MEF Fase 2 (ruteo, Chat A núcleo bajo dirección Chat D), 6 commits en prod, TODO aditivo, motor de precios NUNCA tocado (grep `lib/cotizador.ts` vacío en todos los deploys)**:

- **Fase 2.1 — Zonas Flex del vendedor** (commit `74ba154`, 2026-09-22):
  - Modelo: `CuentaMercadoLibreZona` + `CuentaMercadoLibreZonaCp` (espejo byte-a-byte del patrón `SucursalCourier ↔ SucursalCourierCp`: child + grand-child con FK `Cascade`, `@@unique([parentId, key])`, `@@index([codigoPostal])`). + 3 ADD COLUMN aditivas en `CuentaMercadoLibre` (`flexConfigurado Boolean @default(false)`, `flexCutOffTime String?`, `flexDailyCapacity Int?`). Migración `20260922180920_mef_zonas_flex`.
  - Sync: `lib/mercadolibre/sync-zonas.ts` — `sincronizarZonasFlex(empresaId)` + batch `sincronizarZonasFlexTodasLasCuentas()`. **PRECISION 1 atomicidad**: delete+recreate de una cuenta corre DENTRO de un solo `prisma.$transaction` — Fase 2.3 nunca ve estado intermedio "cero zonas". **PRECISION 1b empty-read guard**: si `services.self_service` está AUSENTE del payload ML (vendedor sin Flex), NO se borran las zonas existentes ni se toca `flexConfigurado` — retorna `{ ok: true, sinFlex: true }` sin efectos. Nunca zero-outear snapshot bueno por lectura vacía.
  - Cron: `app/api/cron/mef-sincronizar-zonas/route.ts` — mirror byte-a-byte de `sincronizar-couriers`, auth automático via proxy `CRON_SECRET`.

- **Fase 2.2 — Config Couriers Flex (pantalla + persistencia)** (commit `f4af5c7`, 2026-09-22):
  - Modelo: `AsignacionCourierZonaFlex` — **anclada por `zoneIdMl` (NO FK a la zona)** para que la asignación SOBREVIVA el delete+recreate del sync 2.1 (bug "el sync borra las asignaciones" cortado en diseño). `@@unique([empresaId, zoneIdMl])` = exclusividad (1 zona = 1 courier, reasignar reemplaza). `courierId Int` FK a `Courier` (convención dominante del schema). Migración `20260922191751_mef_asignacion_courier_zona`.
  - Pantalla: `app/(dashboard)/configuracion/couriers-flex/page.tsx` — mirror del twin `conexiones` (self-service, session-scoped). Estados color: verde (asignada), rojo (acción requerida), gris (inactiva en ML).
  - Endpoints: `GET/PUT /api/empresa/mercadolibre/couriers-flex` session-scoped (gate `gerente_cliente/operador_cliente`) + defense-in-depth (`zoneIdMl` debe pertenecer a la cuenta ML de esta empresa; `courierId` debe ser un `CredencialCourier` activo del cliente). `empresaId` SIEMPRE del JWT firmado, nunca del body.
  - Selector courier: reusa la fuente de verdad `CredencialCourier(empresaId, activo=true) ∩ Courier(activo=true)`, patrón idéntico al del endpoint `/api/configuracion/couriers`.
  - Entrada nueva en `tabs[]` de `configuracion/layout.tsx` (gate `!esOperadorCliente`).

- **Retoque receiver Fase 1 — persiste el shipment del GET** (commit `bf8699f`, 2026-09-22):
  - Modelo: `ShipmentFlex` — `shipmentId String @unique` (business key + idempotencia) + `empresaId FK SetNull` + `mlUserId BigInt` + `cpDestino String?` (extracción defensiva de `receiver_address.zip_code`) + `estadoShipment String?` + `payloadRaw Json` (body completo para Fase 3/4 sin re-GET). Migración `20260922200301_mef_shipment_flex`.
  - Receiver retrofit: en el path `valido` del `clasificarShipment`, ahora lee `res.json()` y persiste `ShipmentFlex` via `upsert` best-effort (`try/catch` total; NUNCA rompe el 200 al ML ni la clasificación). Validación intacta (IP allowlist + x-signature-optional + dedup P2002 + 200-always UNTOUCHED, grep-proveniente 0 líneas modificadas).

- **Fase 2.3.a — Resolver puro CP→zona→courier** (commit `e6c732b`, 2026-09-22, tweak Chat D 2026-09-23):
  - `lib/mercadolibre/resolverCourierPorCpFlex(empresaId, cp)` — helper puro (cero side-effects, cero persistencia, cero money). Filtro `enabled=true` DENTRO del where (nunca matchea zonas desactivadas). Normalización simétrica al sync (`String(cp).trim()`). Variantes tipadas: `ok` / `input_invalido` / `sin_cuenta_ml` / `sin_zonas_flex` / `cp_no_matchea` / `zona_sin_courier` / `anomalo`. **FAIL-FAST si >1 zona activa matchea el mismo CP** (GN garantiza disjuntos entre activas; si aparecen, NO ruteamos silenciosa — variante `anomalo`).

- **Fase 2.3.c — Worker que crea envíos Flex** (commits `85c83fa` + `93c2694` + `610fb21`, 2026-09-23/24):
  - Ubicación: `lib/mercadolibre/crear-envio-flex.ts` + cron `app/api/cron/mef-procesar-notificaciones/route.ts`. Molde Tiendanube (labels/generate), **worker SEPARADO del receiver** (mismo bucket que `mef-sincronizar-zonas`).
  - **🔒 SIN TRATAMIENTO ESPECIAL DE PLATA** (Chat D revisión money-critical): Flex pasa por `crearEnvio` como cualquier envío; el motor cobra según la rama del courier asignado en Fase 2.2 (`CredencialCourier.usaCredencialesPropias` → Rama A cascada completa / Rama B Fee-only). **CERO SMO exento, CERO guard Rama B, CERO flag canal-aware**. La premisa "SMO exento en Flex" del recon inicial fue **REVISADA/DESCARTADA** por Nacho+Chat D: cada variable (SMO, markup Shipro, markup fijo, intermediario, Fee) ya tiene su gate per-courier/per-empresa; el motor es rama-aware, no channel-aware.
  - **Envío SOLO vía `crearEnvio` con courier REAL** (invariante hard, grep-proven: cero `prisma.envio.create` en el creator; cero `findFirstOrThrow`/`SHP-BLOQ`/placeholder courier). El segundo camino de creación fue removido en `93c2694`.
  - **Vínculo directo Envio ↔ ML** (mirror byte-a-byte de Tiendanube): `Envio.mercadolibreShipmentId String?` + `Envio.mercadolibreOrderId String?` + `@@index([mercadolibreShipmentId])`. Migración `20260923183958_mef_envio_ml_link`. `OrdenExterna.mercadolibreShipmentId` queda como legacy scaffold sin uso (documentado en el schema — usar `OrdenExterna` rompería la simetría con el twin Tiendanube).
  - **`crear.ts` = SOLO plumbing aditivo** (grep-proven, 3 hunks +12 líneas net): interface CrearEnvioInput agrega 2 fields opcionales + destructure + persist en `tx.envio.create.data`. Cero líneas tocan rama/SMO/montoDebito/cotización.
  - **Idempotencia 2 capas**:
    1. Guard early-out por `Envio.mercadolibreShipmentId` (índice dedicado) — evita entrar al motor si ya existe.
    2. `crearEnvio` recibe `idempotencyKey="mef-${shipmentId}"` + red final `@@unique([empresaId, idempotencyKey])`.
  - **Venta no ruteable NO crea Envío** (restructure `93c2694`): queda en `NotificacionFlex` con `estado="accion_requerida"` (o `"accion_requerida_estancada"` — ver anti-starvation abajo) + `causaFlex String?` (nueva columna, migración `20260923195742_mef_notif_causa_flex`). Cuando el vendedor destraba (asigna courier, configura Flex, arreglamos el extractor de payload ML), la próxima corrida del worker la rutea + crea el Envío + marca procesada. Estados de causa: `flex_fuera_cobertura` / `flex_zona_sin_courier` / `flex_sin_config` / `flex_cp_no_extraido` / `flex_anomalo` / `flex_datos_incompletos` (catálogo `ESTADOS_BLOQUEO_FLEX` en `lib/utils/estados.ts` cross-ref [[DEUDA 173]]).
  - **Anti-starvation (fix `610fb21`, 2026-09-24)**: el worker escanea SOLO causas **RE-ESCANEABLES** (destrabables por acción esperable — vendedor configura o Chat A arregla el extractor de payload ML): `flex_zona_sin_courier` / `flex_sin_config` / `flex_cp_no_extraido` / `flex_datos_incompletos`. Las **ESTANCADAS** (`flex_anomalo` / `flex_fuera_cobertura`) van a `estado="accion_requerida_estancada"` que el worker NO levanta — requieren intervención manual, no ocupan slots del `take=100` cada corrida. Set canónico en 1 lugar: `CAUSAS_REESCANEABLES` + `CAUSAS_ESTANCADAS` en `lib/utils/estados.ts` + helper `esCausaReescaneable(causa)`.

**Verificado en prod 2026-09-24**:
- Migraciones aplicadas (5 en Fase 2): `mef_zonas_flex`, `mef_asignacion_courier_zona`, `mef_shipment_flex`, `mef_envio_ml_link`, `mef_notif_causa_flex`. Todas aditivas puras — cero DROP, cero destructive ALTER inspeccionados byte-a-byte antes de aplicar.
- Smoke tests OK: cron `mef-sincronizar-zonas` corrió con el test seller → guard `sinFlex` disparó (vendedor sin Flex en portal ML) → NO tocó zonas ni flags — PRECISION 1b validada con data real. Cron `mef-procesar-notificaciones` → `{ok:true, resumen:{procesadas:0,...}}` con buzón vacío. Pantalla `/configuracion/couriers-flex` carga con banners honestos.
- Motor de precios INTACTO: `git diff bc4ac02..HEAD -- lib/cotizador.ts` → vacío en todos los deploys de Fase 2. `crear.ts` diff = +12 líneas de plumbing puro, cero código toca pricing (grep buscando `rama|smoNeto|montoDebito|resolverSmoNeto|aplicarMarkup|cotizar\(|usaCredencialesPropias` → matches sólo en comments/docs).

**Flujo end-to-end funcionante**:
```
Venta ML → webhook a /api/mercadolibre/webhooks
  → receiver: HMAC-opcional + IP allowlist + dedup + persist NotificacionFlex
  → GET /shipments/{id} → estado="valido" + persist ShipmentFlex (cpDestino + payloadRaw)
Cron mef-procesar-notificaciones
  → findMany where estado IN ["valido","accion_requerida"] + take 100
  → resolverCourierPorCpFlex(empresaId, cpDestino)
    ├─ ok → crearEnvio(input) ← ÚNICO camino de creación (motor cobra por rama)
    │   → Envio con mercadolibreShipmentId + idempotencyKey="mef-${shipmentId}"
    │   → notif "procesada"
    └─ !ok → notif "accion_requerida" (re-escaneable) o "accion_requerida_estancada" (manual)
       + causaFlex=<causa específica>
```

**PENDIENTES CONOCIDOS (explícitos, NO bloquean el cierre — se resuelven con datos reales)**:

1. **Shape REAL del payload ML** — la extracción de `cpDestino` / dirección / peso (`receiver_address.zip_code`, `receiver_address.street_name`, `shipping_option.declared_weight`, `shipping_items[].dimensions.weight`, etc.) es DEFENSIVA con optional chaining porque el shape real ML no se confirmó con datos reales (el test seller nunca generó shipment real en Fase 1). Se ajustan los paths con el PRIMER ENVÍO REAL. Las notifs que caigan en `flex_cp_no_extraido` o `flex_datos_incompletos` quedan RE-ESCANEABLES (`estado="accion_requerida"`) esperando justo ese fix — cuando ajustemos el extractor, la próxima corrida del worker las rutea sola (el `ShipmentFlex.payloadRaw` sigue igual; la corrección vive en el reader).

2. **Handshake del webhook REAL de ML (heredado de Fase 1)** — la firma/IP real de ML no se ratificó en sandbox (impracticable — ver Fase 1 en esta misma DEUDA). Se valida con el primer webhook real. El logueo rico `[ml-webhook-recv]` del receiver captura headers + IP + body en el primer contacto para forense.

3. **Wiring de los crons en el crontab del server** — `mef-sincronizar-zonas` (Fase 2.1) + `mef-procesar-notificaciones` (Fase 2.3.c) siguen SIN wireados. Bucket de 5 crons no-wireados (`rastreo` + `metricas-sla` + `sincronizar-couriers` + los 2 MEF). Invocables manual con `curl -H "Authorization: Bearer $CRON_SECRET"` mientras tanto. NO tratar los crons como "corriendo" en cálculos de frescura hasta cerrar la deuda. Se atiende como batch de deploy — pieza operativa, no de código.

**Fases 3+ (fuera del alcance de Fase 2, las dirige Chat D)**: enriquecimiento (webhooks siguientes de un shipment ya creado), tracking downstream, manejo de excepciones (reintento de `get_fallido_reintentable`/`get_shipment_no_existe`), generación/descarga de etiqueta ML (canal Flex emite etiqueta del lado ML — Shipro consume, no genera). Quedan como pendientes de roadmap Chat D, no como TODOs de Chat A.

**Commits de Fase 2 en prod** (6 hashes): `74ba154` (2.1 zonas) + `f4af5c7` (2.2 config couriers-flex) + `bf8699f` (retoque receiver ShipmentFlex) + `e6c732b` (2.3.a resolver) + `85c83fa` (2.3.c creator + worker + Envio ML fields) + `93c2694` (2.3.c restructure a accion_requerida + causaFlex) + `610fb21` (2.3.c anti-starvation) — 6 features + 5 migraciones aditivas.

**Relación**: [[DEUDA 150]] (hub de conexiones — la pantalla `/configuracion/couriers-flex` conviviría con la de conexiones), [[DEUDA 173]] (centralización de literales — nuevo catálogo `ESTADOS_BLOQUEO_FLEX` + set `CAUSAS_REESCANEABLES/ESTANCADAS`), Fase 1 MEF (RESUELTA arriba en esta misma DEUDA 180).

---

## DEUDA 182 — Tripleta de first-mile genérica: recolector / dueño de credenciales / entregador como roles independientes; el Núcleo resuelve por capacidad, sin hardcode (RESUELTA EN CÓDIGO 2026-09-30 — 4 commits locales; validación e2e mocis→andreani PENDIENTE deploy)

**Status:** **RESUELTA EN CÓDIGO** (4 commits locales `04ccd26` → `2b03093`, sin push todavía). **Validación e2e mocis→andreani PENDIENTE de deploy** — sin sandbox real de Akeron para probar el link `set_tracking_code`; el primer envío productivo del combo mocis→andreani post-deploy es la validación real (facturable). Territorio: **Núcleo** (`lib/couriers/CourierInterface.ts` + `lib/couriers/MocisAdapter.ts` + `lib/envios/dispatch.ts`).

**Qué resuelve:** el CASO C (consolidador) del despacho tenía el link `set_tracking_code` inline en `dispatch.ts` con `fetch` directo a `mocis.akeron.net`, `getToken()` casteado a `any`, y un gate hardcodeado `if (recolectorNombreLimpio === "mocis" && courierMainNombreLimpio === "andreani")`. Sumar cualquier otro recolector con lógica de link propia (Intralog / futuro) requería tocar el Núcleo y meter un branch por par. Post-DEUDA 182: el Núcleo llama a la capacidad opcional `ICourierIntegrator.vincularRecoleccion(...)` genérica; cada adapter que actúa como recolector implementa su modalidad (Mocis emite etiqueta propia + linkea; Intralog adoptará tracking cuando su backend habilite `tracking_transporte`; etc). Sumar un recolector nuevo = implementar la capacidad en su adapter, sin tocar `dispatch.ts`.

**Política confirmada por Nacho:** el **entregador es el ANCLA** — siempre genera tracking + etiqueta reales; el recolector se suma de forma variable (adopta tracking / recibe etiqueta especial / emite etiqueta propia) y es **best-effort** — lo que falle en el rol recolector se resuelve en el camino, la venta nunca se pierde por eso.

**Qué se hizo (4 commits):**

- **`04ccd26` — contrato** (`lib/couriers/CourierInterface.ts`): método opcional `ICourierIntegrator.vincularRecoleccion(params: { datosEnvio, entregador }): Promise<ResultadoRecoleccion>` + tipo `ResultadoRecoleccion` como discriminated union con **3 modalidades**:
  - `tracking_adoptado` (el recolector opera con el tracking del entregador — ej. Intralog cuando habilite `tracking_transporte`).
  - `etiqueta_recoleccion` (el recolector emite una etiqueta especial de recolección — placeholder).
  - `etiqueta_propia` (el recolector emite su propia etiqueta full — el modo actual de Mocis).
  Aditivo (método opcional): ningún adapter existente rompe.

- **`23cba30` — MocisAdapter encapsula su rol de recolector** (`lib/couriers/MocisAdapter.ts`): implementa `vincularRecoleccion` reusando `this.despachar()` para emitir la etiqueta propia (mismo POST `/shipping/new` que hace hoy) + hace el POST `set_tracking_code` in-class (sin `as any`, con `this.getToken()`). Best-effort: si el link falla, `console.warn` y sigue con la etiqueta propia. Retorna `{ modalidad: "etiqueta_propia", trackingRecolector, etiquetaBase64, etiquetaUrl }`. Aditivo: `dispatch.ts` no se toca en este commit.

- **`9bf341e` — mapa entregador→endpoint** (`lib/couriers/MocisAdapter.ts`): reemplaza el `if (entregadorSlug === "andreani")` hardcodeado por un `VINCULACION_POR_ENTREGADOR: Record<string, { endpoint, campoTrackings }>` — sumar un entregador nuevo = agregar una entrada al mapa, sin tocar la lógica. **Comportamiento byte-idéntico** para `andreani` (misma URL, mismo body, mismo header).

- **`2b03093` — dispatch.ts CASO C al modelo genérico** (`lib/envios/dispatch.ts`): reestructura el bloque `if (esConsolidadorEfectivo)`:
  1. **ANCLA primero**: `motorMain.despachar(paramsDespacho)`. Si falla → `tracking: null, tramos: []` con error humano (mismo signal que antes; `crear.ts` lo mapea a `BLOQUEADO_PARCIAL` reintentable, igual que hoy).
  2. **RECOLECTOR después** vía capacidad genérica: `if (typeof motorRecolector.vincularRecoleccion === "function") { ... }`, best-effort. Un fallo se logea; el envío sale con el ancla + sin `tramoRecoleccion`.
  3. **Return byte-idéntico**: `{ tracking: trackingMain, etiquetaUrl: etiquetaUrlMain, tramos: [tramoRecoleccion, tramoEntrega] ?? [tramoEntrega], bultos: bultosMain }`.

**Cambios de comportamiento (intencionales):**

- **Orden temporal invertido**: ancla ANTES que recolector. Necesario porque el link (`set_tracking_code`) requiere el tracking del entregador para asociarlo.
- **Fallo del recolector: ya NO bloquea**. Antes: BLOQUEADO_PARCIAL cuando el recolector tiraba error → operador atendía. Después: envío sale con el ancla + tramo de entrega, sin tramo de recolección, con `console.warn`. La venta se despacha; el operador puede resolver el recolector en el camino si aplica.
- **Fallo del ancla: sigue bloqueando** (BLOQUEADO_PARCIAL reintentable via `procesar-bloqueados-*.ts` / `reintentar-envio.ts` — sin cambio).
- **Verificado que ningún consumidor downstream depende del orden temporal**: `lib/etiquetas/armar-etiqueta.ts:260` filtra `envio.tramos` por `tipo="recoleccion"` (semántico), no por `orden` temporal. Cero regresión en la impresión de etiquetas con zócalo Frankenstein.

**Eliminado del Núcleo (`dispatch.ts`):**

- `fetch` inline a `https://mocis.akeron.net/api/v1/shipping/andreani/set_tracking_code`.
- Gate hardcodeado `if (recolectorNombreLimpio === "mocis" && courierMainNombreLimpio === "andreani")`.
- Cast `(motorRecolector as any).getToken()`.
- Cierra el **TODO viejo** de `dispatch.ts:404-406` (*"TODO refactor calidad post-MVP: mover set_tracking_code a MocisAdapter"*).

**Universalidad del modelo:** contrato preparado para **N recolectores / N dueños de credenciales / N entregadores** — los tres son roles independientes que pueden combinarse. Operativamente hoy sigue siendo **1 recolector por depósito** (`Deposito.courierRecolectorId` scalar); la ampliación a schema multi-recolector queda como [[DEUDA 167]] (obra separada — DEUDA 182 abre camino, no la implementa).

**Nota sobre la etiqueta propia de Mocis:** antes del refactor, el `respuestaRecolector.etiquetaUrl` / `etiquetaBase64` se descartaban en `dispatch.ts`. Post-DEUDA 182, la modalidad `etiqueta_propia` de `vincularRecoleccion` los expone en el resultado (`ResultadoRecoleccion`) — todavía **no se persiste** (queda disponible por si se necesita imprimir la etiqueta Frankenstein Mocis a futuro; no hay caller hoy que lo consuma).

**Deudas relacionadas que quedan ABIERTAS (no las cierra este trabajo):**

- **[[DEUDA 167]]** — Multi-recolector Fase 2 (schema `Deposito.courierRecolectorId` scalar → tabla puente `(depositoId, courierEntregaId) → courierRecolectorId`). El sub-ítem *"mover set_tracking_code al adapter"* se resolvió con esta DEUDA 182; el resto de 167 (schema multi-recolector + UI + gate de activación) sigue abierto.
- **Intralog como recolector** (parte de Fase 2 de Intralog): implementar `vincularRecoleccion` en el adapter Intralog con modalidad `tracking_adoptado`. **Pendiente de que el backend de Intralog (César) habilite `tracking_transporte`** — sin ese endpoint del lado Intralog, la modalidad no puede completarse. Cuando esté disponible: 1 método nuevo en `IntralogAdapter.ts`, cero cambios en Núcleo (contrato ya listo).
- **Idempotencia CASO C** ([[DEUDA 29]] Sub-fase 3): pasar `Envio.id` como `external_reference` al recolector para que retries no acumulen trackings huérfanos. TODO sigue en `dispatch.ts` dentro del nuevo bloque `vincularRecoleccion` (línea del comentario preservada); resuelve la misma clase de problema que las Piezas 1-4 de DEUDA 29 ya cerradas para el débito.

**Commits (4 hashes, en orden):** `04ccd26` (contrato) → `23cba30` (Mocis rol recolector) → `9bf341e` (mapa entregador→endpoint) → `2b03093` (dispatch.ts cutover). **Sin push** al momento del cierre — deploy gated a decisión de Nacho.

**Relación:** [[DEUDA 167]] (multi-recolector — sub-ítem `set_tracking_code al adapter` cerrado acá), [[DEUDA 29]] Sub-fase 3 (idempotencia CASO C — sigue abierta), [[DEUDA 103]] (etiqueta madre/hija — la etiqueta propia de Mocis que ahora está disponible en el resultado alimentará el composer cuando aplique), Fase 2 de Intralog como recolector (sigue esperando `tracking_transporte` del lado de César).

**Origen:** decisión de Nacho 2026-09-30 para preparar la integración de Intralog como recolector alternativo a Mocis sin ensuciar el Núcleo con branches por par recolector×entregador. El trabajo se hizo en 4 commits atómicos con revisión gated en cada paso (money-adjacent — `dispatch.ts` es el orquestador de las 5-6 llamadas HTTP al despacho real).

---

## DEUDA 184 — Display del courier recolector en `CoberturaGrid` no se re-sincronizaba — selector vacío al reabrir la config del depósito (guardado nunca afectado) (RESUELTA EN CÓDIGO 2026-10-01 — commit `ecf919a`, en `origin/main`; PENDIENTE de deploy)

**Status:** **RESUELTA EN CÓDIGO** (commit `ecf919a` en `origin/main`). **PENDIENTE de deploy** — fix UI puro, bajo riesgo, sin schema change. Territorio: UI (`components/configuracion/CoberturaGrid.tsx`).

**Síntoma observado por Nacho (prod)**: en el depósito, al setear courier recolector (Moci's), guardar, salir, y reabrir la config, el selector del recolector aparecía **vacío**. PERO al crear un envío que requería consolidador el despacho **sí usaba Moci's** correctamente (corrió el CASO C real) → el valor **sí estaba en BD**. Bug de display puro.

**Diagnóstico (recon Chat A 2026-10-01)**: el **SAVE siempre andaba** (`Deposito.courierRecolectorId` persistía vía `PUT /api/depositos/[id]` con cascada en `data: { courierRecolectorId: ... }`). Ambos GET backend (`/api/depositos/[id]` y `/api/depositos/[id]/courier-configs`) devolvían el campo correctamente. El `DepositoForm` padre lo leía vía `fetch /courier-configs` dentro de un `useEffect` async y hacía `setCourierRecolectorId(recolectorActual)`. **El bug estaba en el hijo `CoberturaGrid`**:

```typescript
const [recolectorSeleccionado, setRecolectorSeleccionado] = useState<
  number | null
>(initialRecolectorId ?? null);
```

El `useState` captura el prop `initialRecolectorId` **UNA sola vez al mount**. React behavior estándar: cambios posteriores en el prop no re-inicializan el state. Secuencia del bug:

1. `DepositoForm` abre modal con `courierRecolectorId=null` (default inicial del `useState` del padre, antes del fetch).
2. `CoberturaGrid` monta en el mismo tick → recibe `initialRecolectorId=null` → `recolectorSeleccionado=null` para siempre.
3. Fetch async del padre resuelve con `recolectorActual=1234` → padre `setCourierRecolectorId(1234)` → re-renderiza.
4. `CoberturaGrid` re-renderiza con nuevo prop `initialRecolectorId=1234`, pero su `useState` interno sigue en `null` (React ignora el nuevo prop para re-inicializar).
5. UI del grid muestra `recolectorSeleccionado=null` → **selector vacío** aunque el padre tiene el valor correcto.
6. Al guardar: `body.courierRecolectorId = courierRecolectorId` del PADRE (que SÍ está correcto, 1234) → **el PUT persiste bien**. El despacho usa el recolector real. Síntoma observado exacto.

**Fix**: 1 `useEffect` que re-sincroniza el state interno con el prop cuando cambia:

```typescript
useEffect(() => {
  setRecolectorSeleccionado(initialRecolectorId ?? null);
}, [initialRecolectorId]);
```

**Idempotencia confirmada (sin loop)**: cuando el cambio viene del usuario (click en la grilla), el flujo es: `setRecolectorSeleccionado(nuevo)` + `onRecolectorChange?.(nuevo)` → padre `setCourierRecolectorId(nuevo)` → padre re-renderiza → prop `initialRecolectorId=nuevo` → el nuevo `useEffect` dispara `setRecolectorSeleccionado(nuevo)` pero `recolectorSeleccionado` **ya es `nuevo`** → React compara con `Object.is` → **no-op**, no re-render. Cero riesgo de loop.

**Verificación**: tsc 0. Diff solo en `components/configuracion/CoberturaGrid.tsx` (+11/-0 — 1 nuevo `useEffect` + comentario explicativo). Cero cambio al `useEffect` existente de `couriers-elegibles` (L105), cero cambio a `onRecolectorChange`.

**Relación:** detectado por Nacho **validando en prod la tripleta [[DEUDA 182]]** (first-mile genérica, pushed al main pero sin deploy todavía). Al setear/verificar el recolector del depósito como parte de la validación del CASO C refactoreado, apareció el bug de display preexistente — no introducido por 182, pero descubierto gracias a la validación de 182. Independiente de la lógica de dispatch; UI puro.

**Scope:** chico (1 archivo, +11 líneas, cero schema, cero migración, cero backend). **Deploy:** incluir junto al próximo push de UI; no hay urgencia por sí sola porque el guardado nunca estuvo afectado — solo frustración de UX al operador que creía que no se había guardado.

**Origen:** validación en prod post-DEUDA 182 (2026-10-01). Nacho identifica el síntoma + hipótesis correcta ("SAVE anda, READ/display al recargar no"). Recon Chat A confirma hipótesis byte-a-byte localizando el `useState` que captura prop solo en mount; fix de 1 línea en el hijo (no en el padre).

---

## DEUDA 175 — Colchón PREPAGO inerte: el gate de creación bloquea en $0 sin usar el limiteDescubierto, contra la intención de DEUDA 78 (money-crítico, registrada 2026-09-10) (RESUELTA 2026-09-29 — commit `abb045e`, en prod via `c1f88a1`)

**Status:** ABIERTA. Money-crítico. Prioridad media (hoy sin clientes reales no muerde; definir antes de onboardear PREPAGO reales, o antes de que un PREPAGO ya operativo dependa del colchón del finde). Sin backfill requerido (prod = data de prueba). Scope chico (el gate son 2 líneas) pero **decisión de negocio bloqueante** — apetito de riesgo de crédito de Shipro.

**Intención declarada (DEUDA 78, verbatim):**

> "Mitigacion actual (sin construir esto): limiteDescubierto calibrado para cubrir un fin de semana de operacion (Paso 5 onboarding) + aviso de saldo bajo (DEUDA 77). Con eso, **el cliente opera en descubierto durante el hueco y no pierde ventas**."

Y en el onboarding ([app/api/clientes/route.ts:100-107](app/api/clientes/route.ts#L100-L107)):
```
// DEUDA 10 Paso 5a (D-10-ONBOARDING-DESCUBIERTO): descubierto minimo estandar
// para PREPAGO ($50.000, colchon de fin de semana mientras se verifica la
// recarga manual — ver DEUDA 78). POSTPAGO usa el valor que ingresa el admin.
const MIN_DESCUBIERTO_PREPAGO = 50000;
```

A todo cliente PREPAGO se le asigna `limiteDescubierto = max(input, $50.000)` **con la promesa explícita de que puede seguir despachando durante el finde** mientras Shipro verifica manualmente su recarga (delay documentado: minutos a ~63 hs de viernes 20hs → lunes 9hs).

**Código real ([crear.ts:857-864](lib/envios/crear.ts#L857-L864)):**
```
if (tipoCuentaEfectivo === "PREPAGO") {
  if ((empresaConData.saldoActivo ?? new Prisma.Decimal(0)).lt(montoDebito)) {
    bloqueadoPorSaldo = true;
  }
} else { // POSTPAGO
  if ((empresaConData.saldoActivo ?? new Prisma.Decimal(0)).add(empresaConData.limiteDescubierto ?? new Prisma.Decimal(0)).lt(montoDebito)) {
    bloqueadoPorSaldo = true;
  }
}
```

**PREPAGO bloquea con `saldoActivo < montoDebito` — sin sumar `limiteDescubierto`.** POSTPAGO sí lo suma. Asimetría silenciosa: el gate PREPAGO nunca activa el colchón, aunque el onboarding lo asignó específicamente para eso.

**Consecuencia — el colchón PREPAGO es INERTE:**

- **Al crear envío**: gate bloquea en $0, envío nace `BLOQUEADO_SALDO`, sin dispatch al courier, sin etiqueta imprimible.
- **Al destrabar** ([procesar-bloqueados-credencial.ts:129-131](lib/envios/procesar-bloqueados-credencial.ts#L129-L131)): mismo patrón asimétrico, `saldoDisponible = saldoSimulado` para PREPAGO (sin colchón), `+ limite` para POSTPAGO.
- **Suspensión** (`evaluarSuspension`, `-limiteDescubierto × 1.5`): un PREPAGO **nunca puede llegar a saldo negativo** vía operación normal (el gate lo bloquea antes), así que el umbral de suspensión es inalcanzable. El colchón nunca se toca por vía de operación.

Efectivamente, el `MIN_DESCUBIERTO_PREPAGO = $50.000` es **valor huérfano en la BD**: asignado al onboarding, nunca consultado en ninguna decisión operativa. Es código muerto disfrazado de mitigación.

**Escenario operativo real (weekend gap):**
- Cliente PREPAGO transfiere viernes 20:00, admin_shipro verifica y acredita lunes 09:00.
- Durante esas ~63 hs el cliente vende en su e-commerce.
- **Comportamiento esperado (DEUDA 78)**: envíos despachan al courier con `saldoActivo` yendo negativo dentro del colchón ($0 → -$2k → -$5k). Comprador recibe tracking real. Lunes: recarga vuelve saldo a positivo.
- **Comportamiento actual**: cada envío nace `BLOQUEADO_SALDO`, con SHP-* provisorio sin etiqueta courier real. El comprador ve un tracking Shipro sin movimiento por 63 hs. Lunes: `procesar-bloqueados.ts` batch-processes los envíos apilados. Interpretación amable: "la venta se registra pero se paraliza"; interpretación estricta: "el cliente no puede despachar el finde", contradiciendo lo prometido en el onboarding.

**Veredicto — BUG (intención DEUDA 78 ≠ código):**

Dos opciones de fix (decisión de negocio Nacho, apetito de riesgo):

- **Opción (a) — ARREGLAR (implementar la intención):** el gate PREPAGO suma el colchón:
  ```
  if (tipoCuentaEfectivo === "PREPAGO") {
    if ((empresaConData.saldoActivo ?? new Decimal(0)).add(empresaConData.limiteDescubierto ?? new Decimal(0)).lt(montoDebito)) {
      bloqueadoPorSaldo = true;
    }
  }
  ```
  Igual que POSTPAGO. El PREPAGO despacha hasta $50.000 en descubierto durante el finde. Shipro presta ese margen — riesgo acotado por el propio colchón + la suspensión al 1.5×. El destrabe (`procesar-bloqueados-*.ts`) debe alinear el mismo cambio. **Money-critical**: cambia la política de dispatch PREPAGO; verificación empírica requerida en cada estado × rama.

- **Opción (b) — DEJAR + LIMPIAR (código muerto):** aceptar que PREPAGO bloquea en $0 por diseño ("pagás antes de usar, estricto"). Remover `MIN_DESCUBIERTO_PREPAGO = 50000` del onboarding (`app/api/clientes/route.ts`), remover el comment de DEUDA 78 sobre "colchon de fin de semana", actualizar DEUDA 78 para clarificar que la mitigación es distinta (o inexistente). El campo `limiteDescubierto` sigue existiendo pero para PREPAGO es 0 por default; para POSTPAGO sigue como línea de crédito normal.

**Sub-caso raro pero real**: un cliente que hoy sea POSTPAGO puede eventualmente pasar a PREPAGO (o al revés). La política debería definir qué ocurre con su `limiteDescubierto` en ese switch. No hay migración de modalidad implementada hoy — irrelevante por ahora.

**Impacto para DEUDA 174 (Política de Débito Unificada):** el bug es **ortogonal** — DEUDA 174 se puede construir sobre el modelo colchón que ya funciona en POSTPAGO. PREPAGO en las 5 piezas queda con la asimetría heredada: el Fee al crear (Pieza 2 Rama B) se cobra sólo si `saldoActivo ≥ Fee`. Cuando el bug 175 se resuelva (opción a o b), 174 se recomporta consistente sin cambios adicionales.

**Verificaciones sugeridas (para el fix si Nacho elige (a)):**
1. PREPAGO con `saldoActivo=$0`, `limiteDescubierto=$50k`, `montoDebito=$2k` → envío nace `Pendiente`, dispatch OK, `MovimientoFinanciero DEBITO_ENVIO -$2k`, saldo = -$2k.
2. Encadenar hasta cruzar `-$50k` cushion: envío nace `BLOQUEADO_SALDO`.
3. Cruzar $-75k (1.5×): `evaluarSuspension` marca `Empresa.suspendida = true`.
4. Recarga: `procesar-bloqueados.ts` destraba los pendientes, reactiva si aplica.

**Scope:** chico (2 líneas en crear.ts + análogas en 4 handlers `procesar-bloqueados-*.ts` para simetría). **Prioridad:** media — hoy latente (prod = prueba), pero es la primera política real que cae encima cuando entre el primer cliente PREPAGO productivo.

**Relación:** [[DEUDA 78]] (autoridad de intención — "colchón de finde"). [[DEUDA 22]] (suspensión — usa el colchón por umbral, inalcanzable en PREPAGO por este bug). [[DEUDA 16]] (BLOQUEADO_SALDO, el gate del que sale el bug). [[DEUDA 10]] Paso 5a (D-10-ONBOARDING-DESCUBIERTO, donde se asigna el $50k). [[DEUDA 174]] (política de débito unificada — ortogonal, no bloqueante).

**Origen:** recon money-critical Chat A 2026-09-10 durante el diseño de Pieza 2 de DEUDA 174 (colchón + BLOQUEADO_SALDO Rama B). Al verificar cómo el gate PREPAGO interactúa con el colchón declarado en el onboarding, apareció la asimetría silenciosa. DEUDA 78 dio la evidencia autoritativa de que era bug de política, no diseño intencional.

---

## DEUDA 176 — Sin UI para editar `limiteDescubierto` post-alta: solo se configura al crear el cliente (registrada 2026-09-10, scope chico, prioridad baja) (RESUELTA 2026-09-29 — commit `e05abdf`, en prod via `c1f88a1`)

**Status:** ABIERTA. Prioridad baja (no urgente sin clientes reales; útil para operaciones cuando los haya). Sin backfill (prod = prueba).

**Problema:** `Empresa.limiteDescubierto` se setea **solo al crear el cliente** (`POST /api/clientes` L153 pasa el valor al `prisma.empresa.create`). El `PUT /api/clientes` sólo tiene dos ramas: `accion: "toggle_activo"` y `accion: "crear_usuario"`. **No hay rama para editar el colchón** post-alta. Tampoco hay endpoint dedicado ni UI en el dashboard (`app/(dashboard)/admin-empresas/` NOT FOUND; `admin/finanzas` sólo acredita saldos con recarga manual, no edita el colchón).

**Consecuencia:** si un cliente crece y necesita más colchón (o menos, por gestión de riesgo), la única forma de modificarlo hoy es `UPDATE Empresa SET limiteDescubierto = X` directo en la BD. Igual que el gap histórico de la UI del markup del intermediario: el campo existe + funciona en el motor, pero sin superficie de admin editable = fricción de operaciones cuando el negocio quiera ajustar líneas de crédito por cliente.

**Fix sugerido:**
- **Opción A (mínima):** rama `accion: "actualizar_limite_descubierto"` en `PUT /api/clientes` con audit log via `registrarCambioConfiguracion` (patrón existente de `toggle_activo`, [app/api/clientes/route.ts:216-225](app/api/clientes/route.ts#L216-L225)). Body: `{ empresaId, limiteDescubiertoNuevo, motivoAuditoria }`. Gate rol: `admin_shipro` (defense-in-depth, mismo patrón).
- **Opción B (integral):** sección "Límite descubierto" en un editor de cliente en el dashboard, con endpoint dedicado y validación (POSTPAGO > 0, PREPAGO ≥ MIN si sigue vigente después de resolver [[DEUDA 175]]).

**Scope:** chico. Un branch en el PUT (10-20 líneas) + botón en la UI de admin (si se hace la opción B). Sin schema change (el campo existe). Sin migración de datos.

**Prioridad:** baja hoy (prod = prueba, cero clientes reales). Se activa cuando entren clientes POSTPAGO productivos que necesiten ajustes de línea de crédito, o cuando se resuelva [[DEUDA 175]] y el colchón PREPAGO empiece a tener uso real (mismo campo, misma necesidad).

**Relación:** [[DEUDA 175]] (bug colchón PREPAGO — misma zona del código; los dos amerintan el editor cuando el negocio operacionalice el colchón). [[DEUDA 22]] (suspensión usa el colchón — si el admin ajusta el colchón, los umbrales de suspensión/reactivación cambian automáticamente por multiplicador). [[DEUDA 10]] Paso 5a (D-10-ONBOARDING-DESCUBIERTO — donde el colchón nace).

**Origen:** recon del modelo colchón Chat A 2026-09-10 durante el diseño de Pieza 2 de DEUDA 174. Verificar dónde se configura el `limiteDescubierto` reveló que la única superficie de edición es el POST del onboarding; el PUT es un gate rígido de dos acciones que no cubre este campo. Registrado como deuda separada, no bloquea DEUDA 174 ni DEUDA 175 pero es infra que las hará usables.

---

## DEUDA 126 — `/api/envios/rastreo-manual` sigue leakeando PII del comprador en su DTO (SEGURIDAD/PRIVACIDAD) (registrada 2026-08-03, scope chico, seguridad) (RESUELTA 2026-10-01 — commit `982524b`, en prod via `c1f88a1`)

**Status:** ABIERTA. Descubierta durante el recon de DEUDA 106 pieza 1 (2026-08-03). `POST /api/envios/rastreo-manual` (`app/api/envios/rastreo-manual/route.ts`) es un endpoint `PUBLIC_API_EXACT` (`proxy.ts:11`) que hand-picka un DTO — a diferencia de la vieja versión de buscar, este ya NO devuelve `saldoActivo/limiteDescubierto/apiKeyHash/cuit/direccionFiscal*` (bien). PERO **sí devuelve el bloque completo de destinatario con PII**: `documento` (DNI), `email`, `telefono`, `direccionStr`, `localidad`, `cp` (`route.ts:68-76`). Cualquiera con un tracking (que no es secreto — viaja por mail, en la etiqueta) puede leer el DNI/email/teléfono del comprador de ese envío. Misma clase de leak que DEUDA 106 pieza 1 en un endpoint distinto.

**Alcance del fix (chico):**
- Trim del bloque `destinatario` del DTO: quitar `documento`, `email`, `telefono`. Mantener sólo lo que la UI de rastreo público realmente necesita (nombre para saludo + localidad para contexto — la dirección completa NO es necesaria en la vista de rastreo).
- Considerar aplicar el mismo `verificarAccesoEnvio` que ahora vive en buscar. Complicación: `rastreo-manual` está en `PUBLIC_API_EXACT` (no en `DUAL_EXACT`), y su único caller runtime es `components/AccionesEnvio.tsx:80` (dashboard, session-gated en la práctica). Opciones: (a) migrar a `DUAL_EXACT` + gate ownership (cierra el path anónimo); (b) mantener público pero sólo trimmear PII (deja el endpoint como una API de rastreo pública real, correcta si el producto lo quiere así). Decidir con producto.
- Consumidor único a verificar: `components/AccionesEnvio.tsx` — leer qué campos del `envio.destinatario` renderiza y validar que la trimmed version le alcanza.

**Relación con DEUDA 106**: misma clase (endpoint tracking-as-key devolviendo PII de más). Se separa como deuda propia porque el endpoint es distinto y su clasificación en el proxy es distinta — no comparte el fix con PIEZA 1 (que fue cirugía sobre buscar) ni con PIEZA 2 (que introduce el token).

**Prioridad:** media. Menos grave que DEUDA 106 pieza 1 (no leaka finanzas de empresa), pero sigue exponiendo PII del comprador. Cerrar antes del onboarding masivo.

---

## DEUDA 179 — Borrar las 4 pantallas viejas de tarifa (hoy ocultas del menú, rutas vivas) — cuando la consola esté probada en prod (registrada 2026-09-11, scope chico, prioridad baja) (RESUELTA 2026-10-01 — commit `c1f88a1`, en prod)

**Status:** ABIERTA. Prioridad **baja** — no molesta ocultas del menú, es prolijidad. Se aborda cuando la Consola de Tarifa (DEUDA 170 P2) demuestre en prod (semanas de uso con clientes reales) que cubre todo lo que hacían las 4 pantallas viejas.

**Contexto:** el 2026-09-11 (commit `281e4cd` local, pend. deploy) se removió del sidebar las 4 pantallas individuales que la Consola de Tarifa reemplaza:
- `/admin-markup-dueno` (markup del intermediario per courier).
- `/admin-markup-courier` (markup Shipro per courier con toggle HEREDA/PROPIO).
- `/admin-smo` (SMO per courier con vigencias).
- `/admin-parametros-tarifa` (markup Shipro global con vigencias).

**Estado actual:** las 4 rutas + sus `page.tsx` + APIs asociadas **SIGUEN VIVAS** (deep-link accesible por URL directa). Es una red de seguridad consciente (decisión Nacho 2026-09-11 en dos tiempos):
1. **Paso 1 (hecho):** ocultar del menú. La consola es el único acceso desde el sidebar; el que sabe la URL puede seguir usando la pantalla individual si detecta algo que falta en la consola. **Reversible trivial** (volver a agregar el `<Link>` en `layout.tsx`).
2. **Paso 2 (esta deuda):** borrar las 4 rutas cuando la consola esté probada en prod.

**Cuándo borrar:** después de semanas de uso real (clientes reales operando via la Consola), sin reportes de "falta X funcionalidad de la pantalla vieja". Ahí:
- `rm -rf` los 4 directorios `app/(dashboard)/admin-markup-{dueno,courier,smo}` + `admin-parametros-tarifa`.
- Grep exhaustivo de las 4 APIs asociadas (`app/api/admin/markup-dueno`, `app/api/admin/markup-courier`, `app/api/admin/smo-courier`, `app/api/admin/markup-shipro` — nombres exactos por-recon): si NADIE más las usa (la consola escribe via `app/api/admin/consola-tarifa/*`), borrarlas también. **Verificación previa obligatoria**: `grep -rn` desde `app/`, `components/`, `lib/`, tests — cualquier import o call queda en flag antes de la eliminación.
- Verificar que la consola escribe a los MISMOS modelos Prisma (`MarkupCourier`, `SmoCourier`, `MarkupIntermediarioCourier`, `MarkupShiproVigencia`, `OperacionFee`) — si sí (comentario `admin-consola-tarifa/page.tsx:2204` confirma *"escribe a los mismos modelos (fuente única)"*), la lógica de negocio sobrevive intacta.
- Los modelos + tabla NO se tocan (siguen siendo la fuente de verdad).

**Follow-up menor (sub-tarea):** [app/(dashboard)/clientes/page.tsx:671, 674](app/(dashboard)/clientes/page.tsx#L671) tiene texto informativo en el wizard de alta cliente:
```
<strong>Markup de Shipro:</strong> se configura en <code>/admin-markup-courier</code>
<strong>Markup del dueño de credenciales:</strong> se configura en <code>/admin-markup-dueno</code>
```
Son `<code>` (no `<Link>` — no rompen, es texto informativo). **Apuntan a pantallas ahora ocultas del menú**. Actualizar el copy a `<code>/admin-consola-tarifa</code>` cuando se toque esa pantalla, o cuando se ejecute la eliminación de las 4 pantallas viejas — lo que ocurra primero. Cero urgencia, cero riesgo, solo consistencia UX.

**Scope de borrado:** chico. 4 directorios `page.tsx` (típicamente 400-800 líneas cada uno) + 4 API routes (200-500 líneas cada uno) + eventuales imports huérfanos (los helpers de Prisma sobreviven). Cero migración de schema.

**Riesgo:** BAJO tras un período de estabilización. La red de seguridad (rutas vivas post-hide-from-menu) permite recuperación instantánea si algún operador reporta un gap durante ese período. Al borrar, la reversibilidad se pierde — por eso el "dos tiempos".

**Relación:** [[DEUDA 170]] (Consola de Tarifa — su cierre completo depende parcialmente del hide-del-menú de esta deuda; la eliminación es la limpieza final). [[DEUDA 157]] (markup Shipro por courier — pantalla original que la consola absorbe). [[DEUDA 115]] (SMO per courier). [[DEUDA 173]] (estados de envío String libre — sin relación pero mismo espíritu de "consolidar la fuente de verdad").

**Origen:** decisión Nacho 2026-09-11 al cerrar la Consola de Tarifa (DEUDA 170 P2) + verificar que las 5 variables + preview live funcionan en prod. La consola es reciente — merece semanas de exposición antes de tirar la red.

---

## DEUDA 153 — Campo fantasma `precioProveedorReal`: definido en schema, sin ningún uso en el código (registrada 2026-08-28, BUILT-local 2026-08-28) (RESUELTA EN PROD 2026-08-28 — commit `ac441c6`)

**Status:** BUILT (local, pending deploy) 2026-08-28 — decisión: CONECTAR (opción (a) del bloque de decisión). Los 5 slots ghost de la sección "5. Desglose de pricing" en FinanzasEnvio quedaron poblados vía cotizador (expone `secoNeto` + `baseConIntermediario` en `OpcionTarifa.desglose`) + `crear.ts` persist (commit `ac441c6`): `tarifaCourierBase` = `matched.desglose.secoNeto`, `markupIntermediarioAplicado` = `baseConIntermediario − secoNeto` (Rama A; null en Rama B), `precioProveedorReal` = `matched.desglose.baseConIntermediario`, `seguroAplicado` = `matched.desglose.smoNeto`. El 5º slot `descuentoClienteAplicado` (que quedaba null hasta cablear el descuento del cliente) lo completó [[DEUDA 156]] (commit `065a403`). Fallback/rescate → null (política, esFallback === true). Verificado en localhost. Pendiente prod deploy. Queda en DEUDAS.md como snapshot de la implementación hasta que se saque post-deploy verificado.

**Status previo (histórico):** ABIERTA — no bloquea nada. Es un ghost field que requiere decisión de rumbo antes de tocar.

**Problema:** `FinanzasEnvio.precioProveedorReal` (Decimal?) existe en `prisma/schema.prisma:596` con el comentario `"costo real esperado = base + markup intermediario"` y contexto en L591 `"La conciliación prefiere precioProveedorReal cuando existe; si no, cae a precioProveedor (legacy)."` — PERO `grep -rn "precioProveedorReal" --include="*.ts" .` en TODO el código TypeScript del repo retorna **CERO usos**: ni se lee ni se escribe en ningún lado. Ni `crear.ts` lo puebla, ni `conciliacion/route.ts` lo consulta, ni ninguna métrica lo referencia.

**Interpretación:** probablemente un diseño a medio hacer. No parece basura pura — el comentario en el schema sugiere una función pensada (guardar "el costo real esperado = base + markup intermediario", distinto del `precioProveedor` crudo del courier) que nunca se cableó en código. Consistente con la existencia hoy de `CourierIntermediario` (DEUDA 107 capa 1) — el markup del intermediario ya vive en el modelo, pero el "costo real esperado" derivado nunca se persiste.

**Decisión pendiente (de Nacho):**
- **(a) CONECTARLO** — poblarlo al crear el envío desde `matchedA.desglose.cascadaNeto` (que ya incluye base + markup intermediario) y hacer que la conciliación lo prefiera cuando exista, cayendo a `precioProveedor` (legacy) para envíos históricos. Cierra el diseño original.
- **(b) ELIMINARLO** — si la intención ya no aplica (ej. la conciliación evolucionó a otro criterio), dropear la columna vía migración destructiva. Limpia el schema.

Requiere que Nacho defina el rumbo antes de tocar. Probablemente un recon corto para ver qué asumía el diseño original y si el criterio actual de conciliación (que hoy usa `precioProveedor` como `costoEsperado`) haría uso real del campo si se poblara.

**Scope:** **bajo** si se elimina (una migración destructiva + drop de la columna del schema). **Medio** si se conecta (populate en `crear.ts` + branching en `conciliacion/route.ts` + política de fallback a `precioProveedor` para envíos históricos). **Prioridad:** baja — no bloquea; es cleanup arquitectónico + posible cierre de un diseño abierto.

**Relación:** DEUDA 107 (modelo `CourierIntermediario`, capa 1 — la base sobre la que el campo tendría sentido). DEUDA 152 (homogeneización de IVA de `precioProveedor`) — si se conecta este campo, la decisión de forma canónica (con/sin IVA) debería aplicarse al mismo tiempo.

**Origen:** hallazgo colateral del recon del fix de precios (2026-08-27) mientras se auditaba `prisma/schema.prisma` L568-596 para confirmar nullabilidad de `precioMostrado`/`precioProveedor`/`precioFactura`.

---

## DEUDA 156 — Aplicar el descuento/recargo del cliente al precio (motor de pricing) (registrada 2026-08-28, BUILT-local 2026-08-28) (RESUELTA EN PROD 2026-08-28 — campaña de 5 pasos: `e033c1d`, `9966624`, `37ee3bb`, `065a403`, `b934def`)

**Status:** BUILT (local, pending deploy) 2026-08-28 — construido en 5 pasos, verificado localhost con prueba 20% (precioFactura=14385.64 full → precioMostrado=11508.51 con descuento → descuentoClienteAplicado=2877.13 delta). Reglas de negocio LOCKED por Nacho: (i) descuento absorbido por el CLIENTE (Shipro factura el chain completo — `precioFactura` intacto); (ii) piso $0 (nunca negativo, máximo envío gratis); (iii) el cliente elige modo MONTO ($) o PORCENTAJE (%); (iv) buyer-facing SOLAMENTE (checkout de e-commerce; dashboard/facturación siguen viendo `precioFinal` full); (v) configurable por el CLIENTE en /configuracion/transportes (tier `["admin_shipro","gerente_cliente"]`).

**Pasos construidos:**
1. **`e033c1d`** — schema+migration `20260828161821`: enum `DescuentoClienteModo` + `CredencialCourier.descuentoClientePorcentaje` (Float) + comentario de `descuentoClienteSobreTarifa` actualizado a política nueva (piso $0).
2. **`9966624`** — cotizador: helper `aplicarDescuentoCliente` puro + nuevo field `precioFinalBuyer` en `OpcionTarifa` (piso $0). Sin descuento → `precioFinalBuyer === precioFinal` byte-idéntico.
3. **`37ee3bb`** — Tiendanube rates callback: buyer ve `precioFinalBuyer`; cotizacionSnapshot mantiene `precioFinal` puro para auditoría del embudo.
4. **`065a403`** — crear.ts: `precioMostrado = matched.precioFinalBuyer` + `descuentoClienteAplicado = matched.precioFinal.sub(matched.precioFinalBuyer)` (guarded por esFallback); `montoDebito` → `precioFactura` intacto (matched.precioFinal full).
5. **`b934def`** — UI "4. Descuento a tu comprador" (paleta emerald buyer-facing) + persistencia + permisos + auditoría en los 4 archivos: `lib/permisos.ts`, `lib/auditoria-configuracion.ts`, `components/configuracion/TransportesTab.tsx`, `app/api/configuracion/couriers/route.ts`.

**Prueba pendiente POST-DEPLOY:** verificar que el buyer del checkout de Tiendanube ve el precio descontado (rates callback en prod). Todo lo demás (persist, motor, UI) verificado en localhost.

**DEUDA 154 NO cerrada acá — deferred al rediseño del markup:** el relabel del campo "Recargo/Descuento (%)" (que hoy bindea a `ajusteTarifaPorcentaje`, override del markup Shipro) NO se hizo en este build. Nacho decidió (2026-08-28) que el markup Shipro debe salir de la tarjeta del cliente completamente y vivir en admin per-cliente (Shipro-managed) — se registra como [[DEUDA 157]] con secuencia obligatoria construir/migrar/remover. DEUDA 154 se resolverá cuando se ejecute el punto 3 de DEUDA 157 (sacar la sección "3. Ajuste Comercial" al remover el markup de la tarjeta).

**Status previo (histórico):** ABIERTA — no bloquea, pero es la deuda "de raíz" que arregla el campo engañoso de DEUDA 154 y cierra un cabo suelto del diseño DEUDA 73 (comentario L129 de cotizador.ts admite "seguro + descuento se sumarán cuando se implementen").

**Problema:** el "descuento del cliente" no se aplica hoy en el cálculo del precio. El pipeline no cablea un descuento independiente del override del markup Shipro% (ver [[DEUDA 154]]). `aplicarMarkup` (`lib/cotizador.ts:147-220`) NO recibe ningún parámetro de descuento en su `ConfigMarkup` (L131-145). La columna `CredencialCourier.descuentoClienteSobreTarifa` existe (agregada en la migración `20260720235835`) con default 0, pero grep confirmó 0 usos en TS. El comentario L129 del cotizador dice literal: *"NOTA DEUDA 73: aqui se sumaran seguro + descuento cuando se implementen."*

**Objetivo:** construir la aplicación del descuento/recargo del cliente en `aplicarMarkup`, de forma que modifique el precio publicado, y persistirlo en `FinanzasEnvio.descuentoClienteAplicado` (el slot que hoy queda null en el fix de DEUDA 153 hasta que esta deuda se cierre).

**DECISIONES DE NEGOCIO PENDIENTES (Nacho, a definir antes de construir):**
- **(a) ¿De dónde sale la plata del descuento?** ¿El descuento sale del margen del CLIENTE (Shipro cobra al cliente el mismo precio de siempre, el cliente absorbe el descuento hacia su comprador — capa cliente→comprador) o del margen de SHIPRO (Shipro le cobra menos al cliente y absorbe el descuento — cascada extra en `aplicarMarkup`)? Semánticamente distintos.
- **(b) ¿Hay tope o barrera de negocio?** ¿Se permite descontar por debajo del costo del courier (venta a pérdida)? ¿"Envío gratis" es un caso legítimo? ¿Se cliprea automáticamente para no invertir la lógica de cascada?
- **(c) ¿Cómo se separa del "override del markup Shipro"?** Hoy `ajusteTarifaPorcentaje` cumple los dos roles con label engañoso (N154). El descuento cliente debería vivir en otro campo (`descuentoClienteSobreTarifa` ya está en el schema) y tener su propio input en `TransportesTab`.

**CUIDADO:** toca el motor de precios (`aplicarMarkup`) — mismo cuidado que cualquier cambio de plata: recon + verificación localhost + deploy con prueba. NO aislable de la conciliación si el descuento afecta el `precioFactura` (que la conciliación consume como autoritativo). El impacto exacto en conciliación depende de la decisión (a): si el descuento sale del margen Shipro y modifica `precioFactura`, la conciliación tiene que saber que el delta esperable vs lo facturado por el courier ya no coincide con el patrón actual.

**Scope:** medio-alto (motor de precios + resolver + UI del campo separado en TransportesTab + auditoría de cambios ala D-19 + posible ajuste en conciliación según la decisión (a)). **Prioridad:** media-alta — Nacho quiere cerrarlo en cadena con DEUDA 153 (el slot `descuentoClienteAplicado` del audit trail queda null hasta que esta deuda se cierre).

**Relación:** [[DEUDA 154]] (el campo roto que esto arreglaría de raíz — al separar semánticas, el "Recargo/Descuento (Tu Tienda)" bindea a `descuentoClienteSobreTarifa` real, y `ajusteTarifaPorcentaje` queda solo como override del markup Shipro global). [[DEUDA 153]] (`descuentoClienteAplicado` es el destino del audit trail — se cablea de esta deuda). DEUDA 152 (homogeneización IVA de `precioProveedor` — si el descuento se aplica al neto o al bruto es otra pregunta de política que se cruza).

**Origen:** recon DEUDA 153 (2026-08-28), al confirmar en CONFLICT 1 que el "descuento del cliente" no se aplica en el pipeline actual y que el comentario L129 de cotizador ya reservaba el trabajo pendiente.

---

## DEUDA 159 — Rediseñar las métricas de "fuga por aforo" (perdidaReal + fugaPesos) — hoy contaminadas por el descuento del cliente (registrada 2026-08-28, BUILT-local 2026-08-30) (RESUELTA EN PROD 2026-08-30 — commit `93fc4bf`)

**Status:** BUILT (local, pending deploy) 2026-08-30 — commit `93fc4bf`. La fuga económica del "Desvío Financiero por Peso" (`lib/utils/desvio-peso.ts`) usa ahora `costoAforo` NETO × IVA para display, homogéneo con el resto de cards que muestran con IVA. Reemplaza la fórmula legacy `precioFactura − precioMostrado` contaminada post-[[DEUDA 156]] por el descuento buyer-facing del cliente. Envíos sin aforo cobrado (peso igual, SOBREPRECIO_RECLAMAR, sin conciliar) reportan 0 correctamente. Además: (i) eliminado el bloque muerto `aforoStats/perdidaReal` de `app/api/metricas/route.ts` (era dead output sin consumer frontend, ver comments `dashboard/page.tsx:320` + `torre-de-control/page.tsx:487`); (ii) agregado field `fugaPorcentaje` (per-envío) + `fugaPorcentajePromedio` (agregado en `ResumenDesvio`) — el "% económico" que Nacho pidió, disponible en el JSON para consumo UI posterior. Weight half intacto (`diffKg`, `clasificarSeveridad`, `desvioPromedioKg`, `desvioMaxKg`, `tasaSobre*`, `distribucionSeveridad*`). Billing intacto (`precioFactura`/`precioMostrado`/`montoDebito`, crear.ts, cotizador, rates callback sin cambios). Verificado localhost: dashboard cliente muestra 0 (correcto — no hay aforos en data local); ambas surfaces (client + Torre) leen la misma figura del cliente (`costoAforo × IVA`) por ahora. Pendiente deploy prod.

**Sub-scope diferido (a nuevas deudas):**
- La vista TORRE debería mostrar la figura del COURIER (`costoCourierFacturado − costoCourierCotizado`, ex-`costoCourierEsperado` renombrado en `0b1f6b0`), no la del cliente. Los 2 fields se persisten RAW-native y no hay link per-envío al `ivaDeclarado` del `ConciliacionRun`, así que requiere trabajo aparte de conciliación + migración. → [[DEUDA 161]].
- La Torre muestra un mensaje gris discreto ("Aún no hay liquidaciones...") cuando `enviosConAforo === 0` — asimetría UX con el dashboard cliente (que muestra ceros). Pre-existente (commit `0ddb379` junio 2026), no fallout de 159. → [[DEUDA 162]].

**Status previo (histórico):** ABIERTA — no bloquea operativa, pero las 2 métricas muestran números con drift silencioso post-DEUDA-156. Los displays operator ya se arreglaron en FASE 0 (commit `60d2792`); las métricas quedaron pendientes acá.

**Problema:** `metricas/route.ts:189` (`perdidaReal`) y `desvio-peso.ts:88` (`fugaPesos`) computan `precioFactura − precioMostrado`. Ese proxy **NUNCA fue robusto** — funcionaba solo porque pre-DEUDA-156 `precioMostrado ≈ precioFactura` (sin descuento). Post-156, `precioMostrado` lleva el descuento del cliente, así que la "fuga por aforo" ahora se **contamina con el descuento** (mide como "pérdida de Shipro" algo que es decisión comercial del cliente hacia su comprador).

**Impacto concreto:** un envío con `precioFactura=10000`, descuento cliente=$500 (→ `precioMostrado=9500`) y sin fuga real de peso reporta `perdidaReal=500` en Torre de Control — falso positivo. Peor: envíos con fuga real de peso Y descuento cliente reportan la suma como una sola "pérdida".

**Objetivo:** recomputar la fuga con los campos correctos. Alternativas disponibles hoy en `FinanzasEnvio`:
- `costoCourierFacturado − costoCourierEsperado` — **fuga real del courier** (lo que el courier facturó vs lo que Shipro esperaba). Ambos existen post-conciliación.
- `costoAforo` — **delta que Shipro pasó al cliente** por el aforo (Rama A `subioPeso` only). Ya está en $, con markups aplicados.
- Combinación según qué mide cada métrica (las dos "fugas" del diccionario: (A) cotizado-vs-facturado del courier vs (B) publicado-vs-facturado al cliente).

**DECISIÓN DE NEGOCIO PENDIENTE (Nacho):** qué mide cada una de las 2 métricas.
- ¿`perdidaReal` (Torre M4) = pérdida real de Shipro (courier facturó más de lo esperado y Shipro no lo pasó al cliente)? → usar `costoCourierFacturado − costoCourierEsperado − costoAforo` (guarded ≥ 0).
- ¿`fugaPesos` (Torre M3.4) = mismo criterio o distinto?

**Nota técnica:** `desvio-peso.ts` requiere **ampliar el interface `EnvioParaAuditar`** (hoy solo 4 fields: `pesoCobrado`, `pesoAforado`, `precioMostrado`, `precioFactura`) para acceder a `costoAforo`/`costoCourierFacturado`/`costoCourierEsperado`. Requiere actualizar sus callers (grep confirmó blast radius chico).

**Scope:** medio (toca métricas de Torre de Control + KPIs). **Prioridad:** media.

**Relación:** [[DEUDA 156]] (fallout que rompió estas métricas — FASE 0 arregló los 3 displays operator; las métricas son la última pieza pendiente). [[DEUDA 158]] (si `precioFactura` se renombra a `tarifaFullCotizada` en el mismo movimiento, aclara aún más lo que las métricas miden). Torre de Control M4 (aforo) y M3.4 (desvío de peso).

**Origen:** fallout de [[DEUDA 156]] (2026-08-28). FASE 0 arregló los displays operativos (dashboard + rastreo); esta deuda cierra las métricas.

---

## DEUDA 158 — Renombrar campos de plata mal nombrados según su rol real (empezando por precioFactura → tarifaFullCotizada) (registrada 2026-08-28, EN PROGRESO 2026-08-31) (RESUELTA EN PROD 2026-08-31 — campaña de 7 renames: `a8cda53`, `0b1f6b0`, `26855dc`, `09f3ca4`, `f2ae054`, `14407dc` — renames livianos del audit-trail COMPLETOS; 3 fields restantes del Grupo 1 son entangled con DEUDA 157/163 y se renombrarán cuando esas obras se ejecuten, no standalone)

**Status:** ABIERTA — **7 de N campos renombrados**: (i) `precioFactura → tarifaFullCotizada` (commit `a8cda53` 2026-08-30), (ii) `costoCourierEsperado → costoCourierCotizado` (commit `0b1f6b0` 2026-08-31), (iii) `seguroAplicado → smoAplicado` (commit `26855dc` 2026-08-31), (iv-v par) `precioProveedor → costoCourierNativo` + `precioProveedorReal → baseConIntermediarioAplicado` (commit `09f3ca4` 2026-08-31, con bridge JSON snapshot `CotizacionSnapshot`), (vi) `tarifaCourierBase → tarifaCourierBaseNeta` (commit `f2ae054` 2026-08-31), (vii) `markupIntermediarioAplicado → markupIntermediarioPorcentajeAplicado` (commit `14407dc` 2026-08-31). **RENAMES LIVIANOS DEL AUDIT-TRAIL (DEUDA 153) COMPLETOS.** Lo que resta son campos atados a otras obras (markup redesign [[DEUDA 157]], seguro-courier feature [[DEUDA 163]]) — se renombran cuando esas obras se ejecuten, no standalone. Los comments honestos de FASE 1 mitigan el riesgo de lectura para los restantes, pero el nombre engañoso sigue induciendo bugs (ver [[DEUDA 156]] fallout: 4 readers usaron precioMostrado como billed proxy hasta que la semántica se alineó). Se hace de a UN campo por sesión (o de a UN PAR cuando los nombres viejos comparten ambigüedad, como el par proveedor/proveedorReal) — principio Nacho: money-safe, nunca en lote.

**AVANCE 1 (2026-08-30, commit `a8cda53`):** PRIMER campo renombrado — `precioFactura → tarifaFullCotizada`, vía `@map("precioFactura")` (columna física intacta, cero migración de datos, cero cambio de valores; diff 74/74 simétrico = rename puro). Blast radius: 20 archivos tocados (schema + writes + reads + DTOs + frontend + comments). Verificado `tsc=0` + `prisma migrate status` = "up to date". Cascade tsc-guided (Prisma Client regeneró) confirmó que TODAS las refs se actualizaron. Frontend keys sincronizados con endpoint output (dashboard cards + torre anatomía) — cero silent-$0. Pendiente deploy prod.

**AVANCE 2 (2026-08-31, commit `0b1f6b0`, DEPLOYED a prod `540b1af` live):** SEGUNDO campo — `costoCourierEsperado → costoCourierCotizado`, vía `@map("costoCourierEsperado")` (columna física intacta, cero migración). **CRÍTICO manejado**: el snapshot JSON de `ConciliacionRun` (undo path) conserva la key vieja `"costoCourierEsperado"` como **bridge** → deshacer conciliaciones viejas sigue funcionando (round-trip: `WRITE snapshot { costoCourierEsperado: finanzas.costoCourierCotizado } ↔ READ snapshot restore Prisma.costoCourierCotizado ← entry.prior.costoCourierEsperado`). Par cotizado/facturado coherente ahora (`costoCourierCotizado` + `costoCourierFacturado`). Verificado `tsc=0` + `prisma migrate status` up-to-date + bridge round-trip en código. Blast radius: **3 files** (schema + `conciliacion/route.ts` + `conciliacion/revertir/route.ts`) — mucho más chico que el rename #1 porque el field es interno-admin (zero frontend, zero raw SQL, zero métricas). Deploy prod 2026-08-31: app respira + `/conciliacion` carga OK.

**VERIFICACIÓN PENDIENTE (no bloqueante):** el bridge undo del snapshot JSON (revertir una conciliación pre-rename) está verificado en código + round-trip, pero NO ejercitado en prod aún (no había conciliación para revertir el 2026-08-31). Validar en vivo la próxima vez que se revierta una conciliación — esperado: el rollback lee la JSON key vieja `"costoCourierEsperado"` y restaura al field `costoCourierCotizado` sin romper. Análogo a la compra-de-prueba pendiente del Chat B: validación de flujo real, no trabajo de dev.

**AVANCE 3 (2026-08-31, commit `26855dc`):** TERCER campo — `seguroAplicado → smoAplicado`, vía `@map("seguroAplicado")` (columna física intacta, cero migración de datos). Es el **SMO** (Seguro Mínimo de Shipro — tarifa mínima que Shipro cobra por courier), **NO** el seguro de mercadería del comprador ni el seguro del courier real (ambos GHOST hoy — ver nueva [[DEUDA 163]] feature seguro-courier-activable). Blast radius **mínimo** (el más chico del rename campaign hasta ahora): **2 files** (`prisma/schema.prisma` L610 + `lib/envios/crear.ts` — 4 hits: L533 persist var decl, L597 Rama B write, L641 Rama A write, L998 create key). **Zero frontend, zero raw SQL, zero snapshot JSON, zero DTOs, zero readers** (audit-trail DEUDA 153 sin consumer). Persist var renombrada por consistencia (`seguroAplicadoPersist → smoAplicadoPersist`); valor persistido inalterado (`= matchedX.desglose.smoNeto`, mismo SMO). Diff `-5 / +6` (rename puro + 1 comment nuevo en create). Verificado `tsc=0` + `prisma migrate status` = "up to date". Pendiente deploy prod.

**AVANCE 4 (2026-08-31, commit `09f3ca4`):** CUARTO + QUINTO campo — **PAR** `precioProveedor → costoCourierNativo` + `precioProveedorReal → baseConIntermediarioAplicado`, ambos vía `@map` (columnas físicas intactas, cero migración). Se renombran juntos porque compartían la palabra ambigua "proveedor" con significados distintos (courier físico vs "quien Shipro paga") — renombrar solo uno dejaba la ambigüedad. **Familia nueva `costoCourier*`**: `costoCourierNativo` (creación etiqueta, forma nativa cross-heterogénea) → `costoCourierCotizado` (copia snapshot conciliación, forma nativa) → `costoCourierFacturado` (Excel real del courier). `baseConIntermediarioAplicado` = `secoNeto × (1 + intermediarioMarkupPorcentaje/100)` (courier neto + markup % intermediario), audit-trail DEUDA 153 sin readers. **CRÍTICO manejado**: (a) conciliación (L246 `conciliacion/route.ts`) lee `costoCourierNativo` con el **MISMO valor nativo/semántica** — byte-idéntico vía `@map`; (b) el JSON key `"precioProveedor"` en `CotizacionSnapshot.opcionesSnapshotJson` (write-only forensic log, 0 readers) se **conserva como bridge** — solo el DTO field access renombra (`o.costoCourierNativo`). Blast radius: **7 files** — el segundo más grande de la campaña (después de `precioFactura`): schema + `lib/envios/crear.ts` + `app/api/conciliacion/route.ts` + `app/api/tiendanube/rates/route.ts` + `lib/cotizador.ts` (DTO OpcionTarifa + return de `aplicarMarkup`) + `app/(dashboard)/cotizar/page.tsx` + `app/(dashboard)/liquidaciones/page.tsx` (comment histórico). DTO cotizador renombrado también (2 interfaces + 4 sites de compute/propagate). Persist vars: `precioProveedorPersist → costoCourierNativoPersist`, `precioProveedorRealPersist → baseConIntermediarioAplicadoPersist`. Diff `-34 / +44` (asimetría +10 = comments nuevos bridge/familia/tags DEUDA 158). Verificado `tsc=0` + `prisma migrate status` = "up to date". Pendiente deploy prod.

**AVANCE 5 (2026-08-31, commit `f2ae054`):** SEXTO campo — `tarifaCourierBase → tarifaCourierBaseNeta`, vía `@map("tarifaCourierBase")` (columna física intacta, cero migración). Es la tarifa del courier **NORMALIZADA A NETO** (= `desglose.secoNeto`; se le quita el IVA si el courier lo traía), **distinta** de `costoCourierNativo` que es la **forma NATIVA cruda**. Divergen por IVA en couriers IVA-inclusive: **Andreani** (`tarifaIncluyeIva=true`, seco=1210) → `costoCourierNativo=1210` vs `tarifaCourierBaseNeta=1000` (÷1.21). **Mocis** (`tarifaIncluyeIva=false`, seco=1000) → coinciden numéricamente (1000 == 1000) por venir ya neto (accidente de input, no semántica compartida). El sufijo "Neta" distingue explícitamente del primo nativo. Los dos fields son necesarios: `costoCourierNativo` es fuente de verdad para conciliar contra el Excel del courier (per-courier); `tarifaCourierBaseNeta` es la base HOMOGÉNEA del pricing cascade (comparable cross-courier). Blast **mínimo**: **3 files** (`prisma/schema.prisma` L608 + `lib/envios/crear.ts` — 4 hits: L530/L595/L639/L998 + `lib/cotizador.ts` — 2 meta-comments agrupadores DEUDA 153 L62/L594). **Zero frontend, zero raw SQL, zero snapshot JSON, zero DTOs, zero readers** (audit-trail DEUDA 153 sin consumer). Persist var renombrada por consistencia (`tarifaCourierBasePersist → tarifaCourierBaseNetaPersist`); valor persistido inalterado (`= matchedX.desglose.secoNeto`, mismo neto). Diff `-7 / +8` (rename puro + 1 comment nuevo en create). Verificado `tsc=0` + `prisma migrate status` = "up to date". Pendiente deploy prod.

**AVANCE 6 (2026-08-31, commit `14407dc`):** SÉPTIMO campo — `markupIntermediarioAplicado → markupIntermediarioPorcentajeAplicado`, vía `@map("markupIntermediarioAplicado")` (columna física intacta, cero migración). Guarda **SOLO** el monto ($ neto) del componente porcentual del markup del intermediario aplicado (`= baseConIntermediario − secoNeto = secoNeto × interm%/100`), Rama A. El componente fijo del intermediario es **N/A permanente** (Nacho confirmó 2026-08-31: el intermediario solo cobra %; ningún caso futuro requiere fijo) → sufijo "Porcentaje" **definitivo** (cero riesgo de que aparezca un `Fijo` que compita en el mismo slot). Rama B/fallback → null (guard skipea; sin intermediario). Blast **mínimo**: **3 files** (`prisma/schema.prisma` L609 + `lib/envios/crear.ts` — 5 hits: L531 persist decl, L591 Rama B comment, L635 Rama A math comment, L642 Rama A write, L1000 create key + `lib/cotizador.ts` — 2 meta-comments agrupadores DEUDA 153 L62/L594). **Zero frontend, zero raw SQL, zero snapshot JSON, zero DTOs, zero readers** (audit-trail DEUDA 153 sin consumer). Persist var renombrada por consistencia (`markupIntermediarioAplicadoPersist → markupIntermediarioPorcentajeAplicadoPersist`); valor persistido inalterado (`= matchedA.desglose.baseConIntermediario.sub(matchedA.desglose.secoNeto)`, mismo delta). Diff `-8 / +9` (rename puro + 1 comment nuevo en create). Verificado `tsc=0` + `prisma migrate status` = "up to date". Pendiente deploy prod.

**HITO DE FASE (2026-08-31):** **RENAMES LIVIANOS DEL AUDIT-TRAIL COMPLETOS.** Los 7 renames ejecutados en esta campaña cubren TODOS los campos del Grupo 1 del diccionario que eran renombrables como obras standalone (schema + crear.ts + a lo sumo conciliación + DTO cotizador). Lo que queda de DEUDA 158 (3 campos: `valorDeclarado`, `markupFijo`, `ajusteTarifaPorcentaje`) NO son standalone — cada uno está **atado a otra obra** ([[DEUDA 163]] seguro-courier activable en el caso de `valorDeclarado`; [[DEUDA 157]] rediseño markup Shipro en el caso de `markupFijo` + `ajusteTarifaPorcentaje`). Se renombran cuando esas obras se ejecuten (rename AS PART OF cada redesign, no antes). Esto significa: **DEUDA 158 pasa de "campaña activa" a "OPEN pero en espera de las obras entangled"** — no requiere sesiones dedicadas más hasta que DEUDA 157 o 163 se activen.

**POLICY CORRECTION (2026-08-31, importante — registrada honestamente):** en esta sesión inicialmente se propuso SALTAR `tarifaCourierBase` y `precioProveedorReal` con el criterio "engañan poco" (el primer nombre defensible; el segundo audit-trail sin readers activos). **Nacho corrigió el criterio**: el objetivo de DEUDA 158 es que **CADA** campo diga su rol real, sin excepciones por "engaña poco" — un nombre ambiguo o incompleto igual induce confusión (humana o AI) y desarma el principio "nombrar por rol". Por lo tanto: (a) `precioProveedorReal` se renombró YA (AVANCE 4, junto con su par `precioProveedor`); (b) `tarifaCourierBase` y `markupIntermediarioAplicado` VUELVEN al checklist como PENDIENTES-de-renombrar (no descartados). Candidatos previamente identificados: `tarifaCourierBase → tarifaCourierBaseNeta` (explicita "post-IVA-strip"); `markupIntermediarioAplicado → markupIntermediarioPorcentajeAplicado` (guarda solo el %; el `+fijo` es ghost). **Bonus (2026-08-31):** Nacho confirmó que el **markup fijo del intermediario NO va a existir nunca** (el intermediario solo cobra %) — por lo tanto el nombre `markupIntermediarioPorcentajeAplicado` es **definitivo** (no hay riesgo de que aparezca un fijo que compita). Consecuencia colateral: `seguroFijoIntermediarioConIva` pasa de ghost ambiguo a **ghost definitivo** — feed a [[DEUDA 160]] como candidato firme de drop.

**CHECKLIST de campos candidatos restantes (uno por sesión, Nacho decide orden):**
- ✅ **DONE (2026-08-30, `a8cda53`)** — `FinanzasEnvio.precioFactura → tarifaFullCotizada`.
- ✅ **DONE (2026-08-31, `0b1f6b0`)** — `FinanzasEnvio.costoCourierEsperado → costoCourierCotizado`.
- ✅ **DONE (2026-08-31, `26855dc`)** — `FinanzasEnvio.seguroAplicado → smoAplicado` (@map; nombre honesto — es el SMO, no seguro de mercadería/courier).
- ✅ **DONE (2026-08-31, `09f3ca4`, PAR)** — `FinanzasEnvio.precioProveedor → costoCourierNativo` (@map; miembro "nativo" de la familia `costoCourier*` — creación etiqueta → cotizado → facturado). Blast: 7 files (incluye DTO cotizador + conciliación reader + JSON bridge en `CotizacionSnapshot`).
- ✅ **DONE (2026-08-31, `09f3ca4`, PAR)** — `FinanzasEnvio.precioProveedorReal → baseConIntermediarioAplicado` (@map; `= secoNeto × (1 + interm%/100)`, audit-trail DEUDA 153).
- ✅ **DONE (2026-08-31, `f2ae054`)** — `FinanzasEnvio.tarifaCourierBase → tarifaCourierBaseNeta` (@map; sufijo `Neta` distingue explícitamente de `costoCourierNativo` — divergen por IVA en couriers IVA-inclusive como Andreani).
- ✅ **DONE (2026-08-31, `14407dc`)** — `FinanzasEnvio.markupIntermediarioAplicado → markupIntermediarioPorcentajeAplicado` (@map; sufijo `Porcentaje` DEFINITIVO — el fijo intermediario es N/A permanente confirmado). Feed colateral a [[DEUDA 160]] (`seguroFijoIntermediarioConIva` ahora ghost firme).
- ⏳ **`FinanzasEnvio.valorDeclarado → valorDeclaradoComprador`** — dice "Seguro de mercadería" pero es VALOR declarado del comprador. **Nota:** al renombrar `seguroAplicado → smoAplicado` quedó registrada la [[DEUDA 163]] "seguro del courier activable" — si esa feature se implementa, coordinar este rename con el nuevo field de seguro-courier (que consumiría `valorDeclarado` como base de cálculo).
- ⏳ **`CredencialCourier.markupFijo → markupFijoShipro`** — es markup Shipro FIJO, no "Fee" (colisiona con `OperacionFee`). **Entangled con [[DEUDA 157]]** (rediseño markup — puede renombrarse AS PART de ese redesign en vez de standalone).
- ⏳ **`CredencialCourier.ajusteTarifaPorcentaje → overrideMarkupShiproPorcentaje`** — es override % del markup Shipro, no "Recargo/Descuento del cliente" pese al label UI. **Entangled con [[DEUDA 154]] + [[DEUDA 157]]** — recomendado renombrar cuando se ejecute el redesign markup.

**Progress: 7/N. Restantes: 3 fields — TODOS entangled (0 standalone).** `valorDeclarado` (coord [[DEUDA 163]] seguro-courier), `markupFijo` + `ajusteTarifaPorcentaje` (ambos parte de [[DEUDA 157]] markup redesign). Los renames livianos del audit-trail están COMPLETOS.

**Aprendizaje del rename #2 (bridge para JSON keys en snapshots):** cuando el field renombrado se serializa como key literal en un JSON persistido (ej. `ConciliacionRun.snapshot`), el JSON key **se mantiene con el nombre viejo** por backward-compat con data persistida. Solo el Prisma field + los property accesses cascadan al nuevo nombre. El TS interface que describe el JSON shape también mantiene la key vieja (con comment explicativo). Es el equivalente conceptual a `@map` pero manual (no hay decorador para JSON keys arbitrarios).

**Cada rename sigue el mismo patrón validado en `precioFactura`:**
1. Schema: renombrar field + `@map("nombreViejo")` para preservar columna física (cero migración datos).
2. `npx prisma generate` → Prisma Client fuerza tsc a fallar en cada ref stale.
3. Cascade tsc-guided hasta 0 errores.
4. Renombrar DTOs correlacionados (por principio "nombrar por rol").
5. Coordinar frontend keys con endpoint output shape.
6. Comments hygiene por consistencia.
7. `git diff --stat` con N/N simétrico = rename puro; cualquier asimetría = STOP + revisar.

**Problema:** varios campos de plata tienen nombres que no reflejan su rol real (documentado en `docs/DICCIONARIO-CAMPOS-PLATA.md`, "Grupo 1"). El más claro: `precioFactura` **NO es "lo facturado"** — es la tarifa full COTIZADA y debitada al alta (congelada; el real post-liquidación = `precioFactura + costoAforo`). Nombre honesto sería `tarifaFullCotizada`. Comment ya actualizado en FASE 1 (commit `3ba633a`) para reflejar el rol real, pero el nombre sigue engañando a lectores nuevos (humanos y AI).

**Alcance:** rename real en `prisma/schema.prisma` + **TODOS los readers/writers** (~15 sitios para `precioFactura`: `crear.ts`, `conciliacion/route.ts`, `metricas/route.ts`, `admin/liquidaciones/route.ts`, `kpis-hero.ts`, `desvio-peso.ts`, `efectividad-primera-visita.ts`, `procesar-bloqueados*.ts`, `rastreo-manual/route.ts`, `dashboard/page.tsx`, `inversa/route.ts`). Requiere:
- Migración de columna (`ALTER TABLE RENAME COLUMN`).
- `npx prisma generate` para regenerar el Client con el nuevo nombre.
- Cascada de tsc-guided rename en TypeScript.
- Verificación money-safe (renombrar un campo de plata mal rompe facturación en silencio — ej. si un reader queda con el nombre viejo por error, cae al `?? 0`).

**Otros candidatos del Grupo 1:**
- `markupFijo` (`CredencialCourier`): es markup Shipro fijo, no "Fee" — colisiona terminológicamente con `OperacionFee`. Candidato: `markupFijoShipro`.
- `ajusteTarifaPorcentaje` (`CredencialCourier`): es override del markup Shipro%, no "Recargo/Descuento del cliente" pese al label UI — se cruza con [[DEUDA 154]] (label engañoso) y [[DEUDA 157]] (redesign markup). Candidato: `overrideMarkupShiproPorcentaje`.
- ~~`costoCourierEsperado`~~ (`FinanzasEnvio`): ✅ RENOMBRADO a `costoCourierCotizado` (commit `0b1f6b0`, 2026-08-31) — el nombre nuevo es más preciso que el candidato original propuesto arriba (`costoCourierCotizadoSnapshot`); pair perfecto con `costoCourierFacturado`.

**Principio rector (Nacho, 2026-08-28):** *"nombrar cada campo según su ROL REAL — lo que HACE, no lo que alguien creyó que hacía al nombrarlo. Los renames se hacen de a UN campo por sesión, con recon + verificación money-safe, nunca en lote."* Ver `docs/DICCIONARIO-CAMPOS-PLATA.md`.

**Scope:** alto (schema + migración + money-safety). **Prioridad:** media. Se hace de a UN campo por sesión, nunca en lote. `precioFactura → tarifaFullCotizada` es el primero y el de mayor blast radius (~15 sitios).

**Relación:** [[DEUDA 154]] (label engañoso ajusteTarifaPorcentaje — el rename lo cierra si se hace en el mismo movimiento). [[DEUDA 157]] (rediseño markup — al mover el field a admin, el rename es natural). [[DEUDA 156]] (fallout que expuso el problema; FASE 1 mitigó vía comments honestos).

**Origen:** sesión del diccionario de campos de plata (2026-08-28), post-DEUDA-156 fallout.

---

## DEUDA 185 — Leak cross-tenant de contactos del Directorio: `Direccion` es tabla global compartida por email, mutada y leída entre empresas (registrada 2026-10-01, **CONFIRMADO EMPÍRICAMENTE EN PROD 2026-10-05**, prioridad ALTA, bloqueante pre-onboarding de clientes reales) (RESUELTA EN PROD 2026-10-08 — 4 etapas: modelo ContactoEmpresa + crear.ts write + directorio read scoped + LGPD opción B; verificado: "Astelarra" no aparece en un cliente sin acceso. Commits: `923ac55` (e1 modelo) + `d384edc` (e2 write) + `11bac0e` (e3 directorio) + `fac0f4b` (e4 lgpd))

**Status:** ABIERTA. Investigada el 2026-10-01 (chat A) a raíz de que Nacho vio empíricamente, probando con usuarios de empresas distintas, que el buscador de `/api/directorio` devolvía los mismos contactos "Albinati" para cuentas que no debían compartirlos. Confirmada hoy (2026-10-05) con una prueba aislante que no deja lugar a duda. Hoy está **contenida** porque es data de prueba — bloquea el onboarding de clientes reales.

**Diagnóstico (recon Chat A, 2026-10-01):**

El endpoint [app/api/directorio/route.ts](app/api/directorio/route.ts) scope-ea bien: construye `where.enviosDestino = { some: { empresaId: ctx.empresaId } }` AND-eado con el `OR` del search; `resolverContext` para un rol `gerente_cliente`/`operador_cliente` devuelve `empresaId` numérico desde el `x-empresa-id` inyectado por proxy desde el JWT, sin manipulación posible desde el cliente. **El filtro NO es la grieta** — se verificó línea por línea.

La grieta está en el **modelo de `Direccion`** + el **upsert por email** en [lib/envios/crear.ts:235](lib/envios/crear.ts#L235):

```ts
const direccionExistente = await prisma.direccion.findFirst({ where: { email: email } });
if (direccionExistente) {
  const dirActualizada = await prisma.direccion.update({
    where: { id: direccionExistente.id },
    data: { nombre, documento, telefono, calle, altura, piso, dpto, cp, localidad, provincia }
  });
```

- La tabla `Direccion` NO tiene `empresaId` — es **global por diseño**.
- El `findFirst({ where: { email } })` **no filtra por empresa** — mach-ea por email literal, cross-tenant.
- El `update` posterior **sobreescribe** nombre/documento/teléfono/dirección con los datos de quien esté creando el envío ahora, pisando lo que haya puesto cualquier otra empresa antes (last-write-wins).

Resultado conceptual: si dos empresas tienen al mismo comprador real (mismo email), ambas apuntan sus `Envio.destinoId` a la **misma fila `Direccion`**. El filtro `enviosDestino.some(empresaId=X)` matchea esa fila para **ambas** empresas (correctamente — ambas tienen envíos a esa dirección), pero (a) la fila es físicamente **una sola** y mutable por cualquiera de las dos, y (b) lo que una guarda lo ve la otra.

**CONFIRMADO EMPÍRICAMENTE EN PROD 2026-10-05 (prod en `c1f88a1`):**

Dos pruebas complementarias:

1. **Query prod sobre `Direccion`**:
   - `ignacio.albinati@gmail.com` (`Direccion.id=8`) tiene envíos de **3 empresas** (ids 1, 4, 8) → aparece en el directorio de las 3, lo cual es **legítimo** per el filtro (`enviosDestino.some(empresaId=X)` matchea). Esto por sí solo no distingue leak de comportamiento correcto — las 3 empresas sí le enviaron.
   - `ia@shipro.pro` (`Direccion.id=3`) tiene envíos de **1 sola empresa** → aparece correctamente solo ahí. El filtro funciona en el caso trivial.

2. **Prueba aislante — la que confirma el bug sin ruido**:
   - Nacho editó el contacto de `ignacio.albinati@gmail.com` desde el perfil de **Francisco Casal** (una de las 3 empresas). Cambió **el nombre** a `"Julia Astelarra"` (dejó el email intacto).
   - Luego buscó `"Astelarra"` desde el perfil de **Jeremías Amaro** (otra de las 3 empresas, no la que editó).
   - Resultado: el contacto `"Julia Astelarra"` aparece en **ambas empresas** (Amaro **y** Casal).

Esto evidencia **las dos caras del bug**:

- **(1) Mutación cross-tenant**: la edición que hizo Casal en su "contacto" se escribió sobre la fila `Direccion` compartida y así quedó para todas las empresas que apuntan a ese `destinoId`.
- **(2) Lectura cross-tenant**: Amaro, que nunca editó nada ni "agendó" al comprador con ese alias, lee desde su directorio el nombre que puso Casal.

**Matiz de diseño (producto, Nacho 2026-10-05) — afina qué hay que separar y qué NO:**

Nacho **sí quiere** mantener un dato físico canónico por comprador, compartido entre empresas y actualizado por todas (economía de datos — la dirección física/calle/altura/CP de una persona real es la misma para todos los que le envíen). Lo que **NO debe compartirse** son:

- **(a) La relación comercial** "este comprador es contacto de MI empresa": un cliente no debería ver en su directorio compradores a los que **él nunca envió** (hoy el filtro `enviosDestino.some` ya cubre esto correctamente — no es parte del bug).
- **(b) Cómo cada empresa lo tiene agendado**: el nombre `"Julia Astelarra"` que le puso Casal **no debe verlo** Amaro. Cada empresa tiene su propia agenda — alias/nombre interno, tal vez un teléfono de contacto operativo distinto, observaciones. El dato físico (calle/CP/geocódigo) sigue siendo uno solo; el "cómo lo llama cada empresa" es por-empresa.

El fix **NO es** simplemente "agregar `empresaId` a `Direccion`" — eso rompería la economía del dato físico (el barrio/CP/geocódigo del comprador se duplicaría una vez por empresa que le envíe). El fix tiene que **separar las dos capas**:

- **Capa física (compartida)**: `Direccion` sigue global y única por email (o por una identidad canónica a definir), guarda el dato físico. Esta fila la escribe el `crear.ts` cuando se trabaja un envío, mezclando lo que informó el shipper — con la cautela de que un cambio físico (mudanza del comprador) legítimamente debería propagarse para la próxima vez que cualquier empresa le envíe.
- **Capa agenda/relación (privada por empresa)**: tabla nueva **`ContactoEmpresa`** probablemente — campos tentativos `(id, empresaId, direccionId o email, nombreAgendado, aliasInterno?, telefonoInterno?, observaciones?, timestamps)` + `@@unique([empresaId, direccionId])` o `([empresaId, email])`. Esta tabla es lo que el buscador de `/api/directorio` leería y escribiría, estrictamente scopeada por `empresaId`. La edición "Casal cambia el nombre a Julia Astelarra" se guardaría en `ContactoEmpresa` de Casal — Amaro al buscar leería **su propia** fila `ContactoEmpresa` con el nombre canónico/original.
- **Forma final del diseño**: a confirmar en el recon del fix. Habrá que decidir: (i) qué campos quedan en `Direccion` (físicos puros) vs cuáles pasan a `ContactoEmpresa` (nombre, documento, teléfono?); (ii) backfill para separar la base actual (dedupe + reparto); (iii) cómo se actualiza la capa física sin propagar la agenda; (iv) qué hace el autocomplete del wizard de nuevo envío cuando una empresa busca a un comprador que NO está en SU `ContactoEmpresa` pero sí existe la `Direccion` global (¿opción explícita "agregar a mi directorio" + crear fila `ContactoEmpresa`? probablemente sí, con confirmación del usuario para que no se cuelen compradores de otras empresas).

**Scope**: medio-alto. Involucra (i) migración Prisma (crear `ContactoEmpresa` + backfill desde `Direccion` + mapeo de los envíos existentes), (ii) refactor del `crear.ts` para separar la escritura de capa física vs capa agenda, (iii) refactor de `/api/directorio` para leer de `ContactoEmpresa`, (iv) refactor del wizard de alta en `/nuevo-envio` para el autocomplete + flujo "agregar a mi agenda", (v) auditoría de otros callers de `prisma.direccion.*` para evitar leer datos de agenda desde la capa física.

**Prioridad**: ALTA, bloqueante pre-onboarding real. Hoy contenido porque solo hay data de prueba — en el momento que entren clientes reales con compradores que se solapen entre empresas (totalmente esperable: hay muchos marketplaces chicos que venden en Argentina al mismo público), el leak se vuelve activo y visible. **NO improvisar**: obra con diseño + recon + migración + verificación empírica controlada.

**Scope del fix (estimación grueso tras el matiz de diseño)**: diseño ~2-3 horas, recon de callers ~1 hora, migración + backfill ~2-3 horas, refactor código ~4-6 horas, verificación empírica (replicar la prueba Astelarra + edge cases) ~1-2 horas. **Riesgo**: medio — toca modelo de datos usado por `crear.ts` (crítico) y la UI del directorio; el backfill de la base actual requiere decisión de producto sobre qué nombres/teléfonos "pertenecen a quién" históricamente (probablemente se congela el estado actual en `ContactoEmpresa` de cada empresa que tenga envíos a esa `Direccion`, duplicando el campo nombre tal como está hoy — la pérdida de precisión es tolerable porque la gran mayoría coincide, y lo que no coincide pasa a ser una divergencia aceptable per-empresa).

**Relación**:
- Mismo espíritu de aislamiento que **[[DEUDA 126]]** (PII leak en `/api/envios/rastreo-manual` — RESUELTA el 2026-10-01 con ownership gate), pero esta es más profunda: no es una autz check faltante, es que el modelo de datos no soporta aislamiento.
- Toca el mismo área que el bug cross-tenant de `/api/metricas` que resolvió **DEUDA 7** (ver DEUDAS-RESUELTAS.md:52) — ambos tienen la misma raíz conceptual (un recurso que debería estar scopeado por empresa no lo está, aunque por razones distintas).
- Dependencia: NINGUNA — se puede abordar standalone. No bloquea ni es bloqueada por obra activa.

**Origen**: recon profundo Chat A 2026-10-01 (crear.ts:235 ubicado, filtro y resolverContext descartados como grieta). Confirmación empírica + prueba aislante Nacho 2026-10-05 (prueba Astelarra: ignacio.albinati@gmail.com editado desde Casal, leído desde Amaro). Matiz de diseño de producto Nacho 2026-10-05 (NO romper economía del dato físico; separar en dos capas).

---

## DEUDA 96 — Login: link "¿La olvidaste?" no funciona + falta el flujo de recuperación de contraseña (registrada 2026-07-12, scope grande) (RESUELTA EN PROD 2026-10-08 — 2 piezas: flujo reset token-single-use + invalidación de sesión OWASP; verificado e2e: reset de ignacio.albinati@gmail.com OK. Commits: `98aa5c8` (p1 reset flow) + `f6c7722` (p2 session invalidation). Cierra [[DEUDA 69]] (audit `password_reset`). Follow-up conocido no bloqueante: Pieza 2.1 (passwordChangedAt en proxy.ts authBySession para cerrar el gap de cookie raw sin pasar por `useSession`).)

**Tipo:** Funcionalidad faltante + UX. Puerta de entrada (login).
**Status:** ABIERTA. Detectada durante prueba del wizard (2026-07-12).

**Síntoma:** En la pantalla de login, el link "¿La olvidaste?" apunta a `/login#` (ancla muerta) — no
hace nada al clickearlo.

**Alcance real (confirmado por diagnóstico):** No es solo el link roto. **No existe NINGÚN flujo de
recuperación de contraseña** en el sistema: no hay ruta, ni endpoint, ni mecanismo de "te mando un mail
para resetear". El link no lleva a ningún lado porque no hay a dónde llevar.

**Impacto:** Un cliente real que olvide su contraseña **no tiene forma de recuperarla solo** — dependería
de que un admin de Shipro se la resetee a mano (como se hizo con `ventas@shipro.pro` en dev vía script).
Para producción con clientes reales, esto es un hueco operativo importante.

**Trabajo (flujo completo a construir):**
- Endpoint "solicitar reseteo": recibe email, genera un token temporal, manda un mail con un link.
- Endpoint "confirmar reseteo": valida el token, permite setear nueva contraseña.
- Páginas frontend para ambos pasos.
- El link del login apunta a la página de solicitud.
- Reusar el mailer existente (`lib/mailer.ts`, ya usado en el alta de clientes).

**Prioridad:** media-alta para producción (es autoservicio esencial), pero mitigable al inicio con reseteo
manual por admin mientras haya pocos clientes.

---

### DISEÑO CERRADO (2026-10-08) — DEUDA 96

**Patrón reusado (zero invención)**:
- **Modelo single-use**: clon byte-exact de `TokenSetupApiKey` ([schema.prisma:2393](prisma/schema.prisma#L2393)) → nuevo modelo `TokenResetPassword`. Campos: `usuarioId Int` FK (NO empresaId — usuarios Shipro con `empresaId=null` también deben poder resetear), `token String @unique` (192-bit base64url via `randomBytes(24).toString("base64url")`), `expira DateTime`, `usadoEn DateTime?`, `ipOrigen String?`, `createdAt DateTime @default(now())`. FK Cascade al Usuario. Index por usuarioId.
- **Mailer**: `enviarMailReseteoPassword(email, nombre, urlReset)` clona el shape de `enviarMailSetupApiKey` ([mailer.ts:322](lib/mailer.ts#L322)).
- **Password write**: byte-exact de [`cambiar-password/route.ts:79-87`](app/api/onboarding/cambiar-password/route.ts#L79) — `bcrypt.hash(..., 10)` + `prisma.usuario.update({ password, passwordTemporal: false })`.
- **Atomic consumer**: patrón [via-token/route.ts:92-103](app/api/empresa/api-key/via-token/route.ts#L92) — `$transaction` + `updateMany({ where: { id, usadoEn: null }, data: { usadoEn: now } })` + rollback si count=0.
- **404 genérico** para cualquier falla de token (no revela existencia).

**Arquitectura**:
- 2 endpoints bajo `/api/auth/` (ya public por [proxy.ts:7](proxy.ts#L7) → PUBLIC_API_PREFIXES incluye `/api/auth/`, zero cambio a proxy):
  - `POST /api/auth/forgot-password` — body `{email}`, siempre 200 genérico, rate-limited.
  - `POST /api/auth/reset-password` — body `{token, passwordNueva}`, atomic consume + update + audit.
- 2 páginas: `app/forgot-password/page.tsx` + `app/reset-password/[token]/page.tsx`.
- 1 mod: [login/page.tsx:160](app/login/page.tsx#L160) `href="#"` → `href="/forgot-password"`.

**DECISIONES LOCKED (Nacho, 2026-10-08)**:

1. **Token TTL = 2 horas** (corto, sensible — distinto del 7d del api-key setup; un link de reset en un inbox comprometido es riesgo real; 2h cubre el tiempo humano de "pedí reset + voy al mail").
2. **Rate-limit en BASE DE DATOS** (NO in-memory): Nacho explícito — *"lo que funcione con 2 o 1.000 usuarios, no un problema por ahorrar 12 min"*. Tabla persistente de intentos (por email + por IP), con TTL de limpieza vía cron. Soporta rolling restart + multi-process sin perder estado.
3. **Mensaje genérico SIEMPRE** (anti-enumeration): forgot endpoint responde `{ok:true, mensaje:"Si el email está registrado, te mandamos un link."}` para TODO caso. Branch "no user" hace fake delay (~200ms) para mitigar timing attack. Igual para reset endpoint: 404 genérico ante token inválido / expirado / usado / usuario inactivo.
4. **Invalidación de sesión al resetear**: SÍ (estándar OWASP — cambiar password cierra todas las sesiones vivas del usuario). Implementada como **PIEZA 2 separada** (toca `lib/auth.ts`, auth-critical) con `Usuario.passwordChangedAt DateTime` + check en el callback `jwt` de NextAuth (invalida si `token.iat < user.passwordChangedAt`).

**PLAN DE 2 PIEZAS**:

- **Pieza 1 — Flujo de reset**: modelo `TokenResetPassword` + tabla rate-limit + 2 endpoints + 2 páginas + mailer function + link del login. Auto-contenida, zero touch a `lib/auth.ts`.
- **Pieza 2 — Invalidación de sesión post-reset**: `Usuario.passwordChangedAt` + modificación del callback `jwt` en [lib/auth.ts](lib/auth.ts). Auth-critical, se separa para merge/deploy gated independiente (si Pieza 2 rompe algo, Pieza 1 ya está funcionando con la ventana de 8h máximo de sesión vieja — mitigación residual aceptable).

**Normalización email**: en ambos endpoints + al escribir — `email.toLowerCase().trim()`. Tapa un bug latente de case-sensitivity de Postgres (hoy los writers de Usuario no normalizan — ver `clientes/route.ts`, `mi-equipo/route.ts`). Flag separado para auditar los otros writers.

**CIERRA DEUDA 69**: el endpoint `reset-password` escribe `AuditoriaConfiguracion(campo="password_reset", empresaId: usuario.empresaId, valorAnterior:"***", valorNuevo:"***", motivo:"Reseteo via link token", ipOrigen)`. Cumple el requisito de audit de cambio de password en el mismo movimiento sin trabajo extra. [[DEUDA 69]] se marca RESUELTA junto con la Pieza 1 de 96.

**Scope archivos**:
- NEW: `prisma/schema.prisma` (model `TokenResetPassword` + tabla rate-limit + `Usuario.passwordChangedAt` en Pieza 2) + 1-2 migraciones aditivas.
- NEW: `app/api/auth/forgot-password/route.ts`.
- NEW: `app/api/auth/reset-password/route.ts`.
- NEW: `app/forgot-password/page.tsx`.
- NEW: `app/reset-password/[token]/page.tsx`.
- MOD: `lib/mailer.ts` (+1 función).
- MOD: `app/login/page.tsx` (1 línea).
- MOD Pieza 2 ONLY: `lib/auth.ts` (passwordChangedAt check en callback jwt).

**Total**: 7 archivos (5 nuevos + 2 mod) + 1-2 migraciones. **Zero money, zero touch a crear/cotizador/dispatch/finanzas.**

**Pre-cliente bloqueante** (Capa 0 del roadmap).

**Estimado**: 6-7h Pieza 1 + 1-2h Pieza 2 = **7-9h total con verificación empírica**.

**Pitfalls de seguridad flaggeados** (todos cubiertos por decisiones locked):
- Enum de emails → mensaje genérico siempre + fake delay en forgot.
- Token entropy → 192-bit base64url (patrón ya probado).
- Token TTL → 2h decision.
- Rate-limit → DB-backed decision.
- Soft-deleted users → 404 genérico (igual que token inválido).
- Case-sensitivity del email → `.toLowerCase().trim()` en todo lookup.
- Session invalidation → Pieza 2.
- Burn single-use → atomic consumer pattern.
- Password strength → ≥8 chars (mismo gate que wizard).

**Origen del diseño**: recon Chat A 2026-10-07, decisiones Nacho 2026-10-08.

---


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


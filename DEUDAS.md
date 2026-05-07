# Deudas técnicas pre-producción Shipro

> **Fuente de verdad**: este archivo (DEUDAS.md). El agente Claude mantiene una memoria
> espejo en `~/.claude/projects/.../memory/deudas_pre_produccion.md` que se carga
> automáticamente al iniciar sesiones de trabajo. Si las dos versiones difieren, gana
> este. Al actualizar/resolver/agregar deudas, hacerlo acá; la memoria del agente se
> reconcilia desde acá en la próxima sesión.

Identificadas durante SUB-PASO 5 (proxy + dual auth) el 2026-04-28. A retomar antes o durante el deploy a producción en Linode.

## DEUDA 1 — Implementar estado REQUIERE_SOPORTE (REDEFINIDA — POSPUESTA a SUB-PASO 9)

**Status:** Originalmente identificada el 2026-04-28 como "fix de catch en `crear.ts` para usar RETENIDO". REDEFINIDA el 2026-04-28 tras consideración de producto que reveló que son dos estados conceptualmente distintos. POSPUESTA a SUB-PASO 9 (o sesión dedicada).

**Distinción de estados (clave):**
- **RETENIDO** (ya implementado): problema con los **datos postales** del envío (calle vacía, falta altura, CP inconsistente, Google Maps no ubica la dirección). Lo resuelve el **destinatario** desde el link del mail (`/corregir/[tracking]`).
- **REQUIERE_SOPORTE** (nuevo): problema **externo al envío** (courier caído, saldo insuficiente, facturas vencidas del cliente, error técnico al despachar). Lo resuelve el **operador** de Shipro o el operador del cliente reintentando.

**Why:** confundir ambos estados rompe el flow operativo. RETENIDO y REQUIERE_SOPORTE tienen audiences distintas (destinatario vs operador) y mecánicas de resolución distintas (corregir dirección vs reintentar despacho). Hoy el catch del bloque despacho en `lib/envios/crear.ts` deja el envío en `"Pendiente"`, que tampoco es correcto: queda mezclado con envíos sanos esperando colecta.

**Alcance del mini-feature (estimado 2-3 horas):**
- Nuevo valor `'REQUIERE_SOPORTE'` en el campo `Envio.estadoActual` (string, sin enum por ahora dado el modelo actual).
- En `lib/envios/crear.ts`, catch del bloque despacho: setear `estadoInicialEnvio = 'REQUIERE_SOPORTE'` y registrar `EventoTracking` con la causa específica del error del courier.
- Nuevo endpoint `POST /api/envios/reintentar` que acepta `{ ids: number[] }` y reintenta el despacho courier para los envíos en estado REQUIERE_SOPORTE. Escenarios: 1 envío, varios seleccionados, todos del filtro actual (batch).
- UI: tab/filtro nuevo en bandeja de pedidos ("Requieren Soporte") separado del existente "Retenidos". Botones para reintentar individualmente o en batch.
- Comportamiento al reintentar: si exitoso → estado pasa a `"Pendiente"`. Si falla otra vez → queda en `REQUIERE_SOPORTE` con `EventoTracking` actualizado con el nuevo error.

**Posponer a:** SUB-PASO 9 o sesión dedicada. No entra en el alcance de SUB-PASO 7A (refactor self-fetch) ni 7B (deduplicar `obtenerCredencialesShipro`), que son refactor puramente técnico sin nuevos features.

## DEUDA 2 — Caché de cotizaciones (post-prod)

`/api/cotizar` tarda ~5-6 segundos por llamada por la latencia agregada de las APIs de couriers (Andreani, Mocis, etc.). En el flujo del dashboard cada cotización es síncrona y bloqueante.

**Why:** UX pobre en `/cotizar` y `/cotizador-rapido`; a escala también costo de API hits.

**How to apply:** caché en memoria (Redis o LRU server-side) con clave `(empresaId, cpOrigen, cpDestino, peso, modalidad)` y TTL 5-10 min. Después de pasar a producción — no es bloqueante para deploy.

## DEUDA 3 — `crear.ts:251` self-fetch a `/api/cotizar` rompe con dual auth

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

## DEUDA 8 — `/api/torre-de-control` es código huérfano (Menor — Limpieza)

**Status:** Descubierta durante SUB-PASO 6 (2026-04-28). PENDIENTE — decidir si borrar o reactivar. Por ahora quedó refactoreada con el helper estándar (defense in depth) en SUB-PASO 6.

**Detalle:** [app/api/torre-de-control/route.ts](app/api/torre-de-control/route.ts) existe pero nadie del dashboard lo llama. La página `app/(dashboard)/torre-de-control/page.tsx` fetchea `/api/clientes` y `/api/metricas`, no `/api/torre-de-control`. Posibles explicaciones: (a) endpoint planeado para una vista que se reemplazó por el flujo actual contra `/api/metricas`; (b) endpoint legado de un refactor anterior; (c) endpoint para un futuro consumidor externo.

**Cómo se cierra:** decidir entre dos caminos:
- **Borrar** `app/api/torre-de-control/route.ts` si no hay consumidor previsto (limpieza simple).
- **Mantener** y documentar el caso de uso si va a ser endpoint público (ej: API para un panel externo o app móvil).

Mientras se decide, la lógica está protegida por el mismo `resolverContext()` que el resto de las rutas, así que no representa un agujero de seguridad.

## DEUDA 9 — admin_shipro debe elegir empresa explícitamente al cotizar/crear envío (Importante — RESUELTA en SUB-PASO 7 fix)

**Status:** Detectada como bug post-SUB-PASO 7 (2026-04-28). RESUELTA en el fix post-build de SUB-PASO 7 — backend lanza error específico, frontend muestra dropdown obligatorio. Commit hash pendiente al momento de redactar.

**Bug original:** Cuando admin_shipro u operador_shipro intentaba cotizar (`/cotizar` o `/cotizador-rapido`) o crear envío manualmente desde el dashboard, el sistema devolvía silenciosamente listas vacías con respuesta de 10ms. Causa: `resolverContext` para shipro sin `filtroEmpresa` devuelve `ctx.empresaId = null` (Modo Dios "TODAS"), y `cotizar()` con `empresaId=null` retornaba `{ domicilio: [], sucursal: [], ... }` por la rama `couriersConfigurados.length === 0`. El usuario no recibía feedback de qué hacer — solo "no hay opciones disponibles".

**Por qué Modo Dios "TODAS" no aplica a cotizar/crear:** la cotización requiere conocer las credenciales y reglas de UNA empresa específica. "Cotizar para todas las empresas a la vez" no es operación válida (cada empresa tiene credenciales distintas, contratos distintos, reglas distintas). En la plataforma anterior se resolvía con un dropdown explícito "trabajando como contador externo, ¿para qué cliente?".

**Cómo se cierra:**
- **Backend** (`lib/cotizador.ts` y `lib/envios/crear.ts`): cuando `empresaId === null`, lanza `Error('EmpresaRequerida: ...')`. Los route handlers de `/api/cotizar` y `/api/envios/manual` capturan ese error y devuelven `HTTP 400 { error, code: 'EMPRESA_REQUERIDA' }`. `/api/envios` POST (e-commerces vía API Key) no se cambia: la API Key garantiza un `empresaId` válido del header.
- **Frontend**: en `/cotizar`, `/cotizador-rapido`, `/nuevo-envio` y `CotizadorModal`, si el rol del usuario es shipro, se muestra un dropdown "Cotizar para empresa: [Seleccionar...]" como primer paso. Mientras no hay empresa elegida, los inputs de cotización quedan deshabilitados/ocultos. Al elegir, se envía como `body.filtroEmpresa = empresaId`. Para clientes (operador_cliente, gerente_cliente) no se muestra dropdown — su empresa está fija desde la sesión.
- **Datos del dropdown**: consume `/api/clientes` (que ya existe).

## DEUDA 10 — Manejo de fallas de courier para clientes Modelo B (Producto — importante pre-producción)

**Status:** Detectada el 2026-04-28 durante el diseño del fix de DEUDA 9. PENDIENTE — requiere modelado adicional. Estimado: medio día de trabajo dedicado. Prioridad: importante antes de onboarding de clientes Modelo B en producción.

**Contexto:** Shipro tiene dos modelos comerciales:
- **Modelo A** (cuenta corriente, postpago): Shipro factura al cliente al final del mes con un detalle de envíos. Bajo riesgo financiero.
- **Modelo B** (credenciales propias, prepago): el cliente carga sus propias credenciales de courier en `/mis-transportes`, el courier le factura directamente, y Shipro cobra un fee por operación de la billetera virtual del cliente. Alto riesgo financiero porque Shipro no controla el cobro del envío real.

**Problema:** Cuando un cliente de Modelo B intenta crear un envío y la API real del courier falla (caída, credenciales rechazadas, etc.), hoy queda en limbo:
- Si Shipro intentara con sus credenciales master como fallback, el envío se cobraría a la cuenta corriente de Shipro (lo cual evita la política de protección financiera ya implementada en SUB-PASO 7).
- Si Shipro deja la etiqueta genérica `SHP-xxxx` (comportamiento actual), el e-commerce y el comprador ven un costo y un tracking que el courier real no reconoce.
- En ningún caso Shipro debe cobrar el costo del envío al cliente Modelo B (eso lo cobra el courier directamente).

**Cómo se cierra (alcance estimado medio día):**
- Modelo `OperacionFee` en schema Prisma (relación con `Empresa`): define el fee por operación que Shipro cobra cuando ejecuta una operación para Modelo B (por ej: $X por intento de etiqueta, sea exitoso o no).
- Lógica de "cotización por similitud histórica" en `lib/cotizador.ts`: cuando no se puede consultar al courier real, derivar el costo a mostrar al e-commerce/comprador buscando envíos similares en BD (mismo origen-destino-peso-modalidad de los últimos N días) y promediar.
- En `lib/envios/crear.ts`: si el cliente es Modelo B y el despacho falla:
  - NO debitar el costo del envío de la billetera (eso lo cobra el courier directo al cliente).
  - SÍ debitar el `operacionFee` configurado para la empresa.
  - Generar etiqueta genérica con el costo histórico estimado en la metadata.
- ABM en onboarding del cliente Modelo B: configurar el `operacionFee` (default razonable, ajustable por empresa).
- UI para que el operador de Shipro o el operador del cliente vea cuántos fees por operación se cobraron en el período.

**Deuda relacionada:** DEUDA 1 (REQUIERE_SOPORTE) — el flujo de reintento debería integrarse: si el cliente Modelo B reintenta con credenciales nuevas y funciona, no se le cobra otro `operacionFee` (o se le cobra solo si excede N reintentos en el período).

## DEUDA 11 — Normalización inconsistente del campo `nombreCourier` (Importante — pre-producción)

**Status:** Detectada el 2026-04-29 durante el debug del bug que generaba etiquetas SHP-XXXXXX en `crearEnvio`. Fix mínimo aplicado en `lib/envios/crear.ts` (usa ahora `courierReal.nombre` en el findUnique, en vez de `courierNombreLimpio`). El problema estructural persiste en 5+ archivos más; PENDIENTE refactor consistente.

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
- URL de Mocis hardcodeada en el adapter (ver "Otras deudas menores"); Andreani usa env. Inconsistencia.

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

## DEUDA 13 — QR de Mocis en etiqueta de Andreani (Importante operativa)

**Status:** Identificada el 2026-04-29 al verificar la generación de etiquetas reales con Andreani (tracking 360002958632720). PENDIENTE — depende de coordinación con Mocis. No bloqueante.

**Estado actual:**
- En la plataforma anterior, las etiquetas Andreani incluían un QR de Mocis para que Mocis pudiera identificar y recolectar el paquete en el flujo First-Mile (Mocis recolecta → entrega en hub Andreani).
- En la plataforma nueva, esa funcionalidad **no está implementada**. La etiqueta Andreani sale sin QR de Mocis.

**Why:** Sin el QR, Mocis no tiene mecanismo de identificación cuando hace First-Mile para Andreani. Operativamente, Mocis no puede trabajar como microhub para Andreani hasta que se reincorpore el QR a la etiqueta o se acuerde otro mecanismo de identificación.

**How to apply (estimado medio día — depende de coordinación con Mocis):**
- Coordinar con Mocis la creación de un servicio diferenciado de First-Mile (distinto del "same day" actual) que permita identificación por QR.
- Modificar la generación de etiquetas en `lib/couriers/AndreaniAdapter.ts` (o capa equivalente de generación de etiqueta) para inyectar el QR cuando `courierRecolector` indique Mocis como microhub.
- UI para configurar el QR en `/admin` cuando se haga el ABM de couriers (DEUDA 12).

**Prioridad:** Importante operativa, NO bloqueante para deploy. Bloquea el caso de uso "First-Mile Mocis → Andreani" pero no la operación directa Andreani-Andreani ni Mocis-Mocis.

## DEUDA 14 — Fallback hardcodeado a localhost en cron de rastreo (Menor — fail-fast deseable)

**Status:** Identificada el 2026-04-29 durante la auditoría de SUB-PASO 8 (protección de crons). PENDIENTE — no bloquea deploy mientras `APP_URL` esté correctamente seteada en el servidor de producción.

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

## DEUDA 17 — UI de onboarding completo de cliente (Importante pre-producción)

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

## DEUDA 18 — Acceso simétrico de shipro a facturación de clientes (Importante pre-producción)

**Status:** Identificada el 2026-04-29 durante los tests manuales de SUB-PASO DEUDA 5 (refinada con contexto del usuario). PENDIENTE — estimado 3-4 horas.

**Estado actual:** En SUB-PASO DEUDA 5 bloqueamos `/facturacion`, `/directorio` y `/historial-manifiestos` para usuarios shipro con un mensaje "Sección para usuarios cliente. Ir a torre-de-control". Esto es correcto **conceptualmente** (shipro no tiene empresa propia) pero **operativamente insuficiente** para facturación.

**Contexto refinado por el usuario (clave):**
> Para dar soporte real a un cliente con problema de conciliación o duda sobre su cuenta corriente, shipro DEBE ver exactamente la misma información que ve el cliente. Si la información que ve shipro es asimétrica respecto a la del cliente, no se puede dar soporte lógico: "vos decís que falta tal cargo pero yo no lo veo así, ¿qué pasó?". Misma data, misma vista.

**How to apply (3-4 horas):**
- Habilitar `/facturacion` para shipro con dropdown de empresa al inicio (Opción A — consistente con `/cotizar`, `/nuevo-envio`, `/mis-transportes` post-SUB-PASO 7). Mientras shipro no elige empresa, mostrar el mensaje actual + dropdown.
- El módulo es **el mismo** que ve el cliente (mismas tablas, mismos cálculos, mismos formatos), solo con un dropdown extra arriba.
- Reemplazar el bloqueo actual del archivo `app/(dashboard)/facturacion/page.tsx` por la lógica de dropdown.
- **No aplicar la misma lógica a `/directorio` y `/historial-manifiestos`** por ahora — esos sí son legítimamente "para usuarios cliente". Si en el futuro shipro necesita auditarlos, se evalúa caso por caso.

## DEUDA 19 — Sistema de auditoría para cambios de credenciales y configuración (CRÍTICA operacional pre-producción)

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

## DEUDA 20 — Endpoint manual para procesar bloqueados restantes (Menor — extensión de DEUDA 16)

**Status:** Identificada el 2026-04-30 durante implementación de DEUDA 16. PENDIENTE — extensión.

**Detalle:** `procesarEnviosBloqueados()` ([lib/envios/procesar-bloqueados.ts](lib/envios/procesar-bloqueados.ts)) procesa máximo 10 envíos FIFO inline tras una recarga. Si un cliente tiene 50 envíos BLOQUEADO_SALDO y recarga saldo suficiente para los 50, solo se destraban 10 — los 40 restantes quedan bloqueados hasta otra recarga.

**How to apply (~2 horas):** endpoint `POST /api/envios/reintentar-bloqueados` (admin_shipro o gerente_cliente), con body `{ empresaId? }`. Llama a `procesarEnviosBloqueados()` y retorna el `recovery`. UI: botón "Reintentar bloqueados" en `/admin-finanzas` y `/dashboard`.

**Why no bloqueante:** mientras el volumen sea bajo (< 10 bloqueados por cliente por día), el procesamiento inline post-recarga alcanza. Pasar a manual cuando aparezcan casos con cola larga.

## DEUDA 21 — Matriz de permisos granular en /mis-transportes (Importante pre-producción)

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

## DEUDA 22 — Suspensión automática de cuenta al alcanzar limiteDescubierto (Importante pre-producción)

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

## DEUDA 26 — Limpieza de tabla Provincia y Localidad (Importante — pre-producción)

**Status:** Identificada el 2026-05-03 durante DEUDA 4 (módulo Depósitos), tras verificar el endpoint `/api/geografia/buscar`. PENDIENTE — sesión dedicada estimada 1-2 horas.

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

## DEUDA 27 — Etiqueta diferida por depósito faltante (Importante post-MVP)

**Status:** Identificada el 2026-05-04 durante FASE E de DEUDA 4. PENDIENTE — sesión dedicada estimada 4-6 horas (alcance similar a DEUDA 16). Por ahora aplicamos bloqueo duro: si el cliente no tiene depósito predeterminado, `crearEnvio()` lanza `DepositoRequerido` y los handlers retornan 400.

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

## DEUDA 29 — Adapters de couriers cotizan ignorando `cpOrigen` (CRÍTICA pre-deploy MVP)

**Status:** Identificada el 2026-05-04 durante smoke test final de DEUDA 4 (Test 4). PENDIENTE — sesión dedicada estimada 3-4 horas. Bloquea la integración de couriers nuevos (mismo bug potencial en cada adapter).

**Contexto operacional descubierto durante diseño:** El flujo microhub/dropoff (cadena Mocis-Andreani como First-Mile + Last-Mile) NUNCA corrió end-to-end en producción. La consulta SQL al momento del diseño mostró 0 envíos con `trackingFirstMile` no nulo. El código de despacho first-mile (`lib/envios/dispatch.ts`), cancelación en cascada (`envios/cancelar/route.ts`), re-despacho (`envios/corregir/route.ts`) y etiquetado masivo (`etiquetas/masiva/route.ts`) está implementado pero nunca fue ejercitado por data productiva. El refactor de DEUDA 29 será el primer test real de la cadena Mocis-Andreani. Esto reduce el riesgo de migración (no hay data crítica que romper) pero aumenta el alcance de testing al implementar (hay que probar end-to-end por primera vez).

**Bug:**
- `lib/couriers/MocisAdapter.ts` (cotizar() ~línea 121-170): solo envía `cpDestino` al endpoint de Akeron. El parámetro `params.cpOrigen` se recibe pero nunca se lee.
- `lib/couriers/AndreaniAdapter.ts` (cotizar() ~línea 79-108): solo envía `cpDestino` al endpoint `/v1/tarifas` de Andreani. `params.cpOrigen` se recibe pero nunca se manda al API.

**Impacto operacional:**
- Cotizaciones incorrectas cuando el origen real del cliente no es AMBA.
- Mocis aparece como opción aunque el origen esté fuera de su zona de cobertura.
- Andreani devuelve tarifa AMBA→destino en lugar de origen→destino, subestimando el costo real (especialmente origenes de interior).

**Detección concreta:**
- Smoke test final de DEUDA 4: cotización origen 5000 (Córdoba, Alto Alberdi) → destino 1900 (La Plata) devolvió $8.000-$8.857 de Andreani y un Same Day de Mocis. La tarifa real de Córdoba→La Plata vía Andreani debería rondar los $15.000-$25.000; Mocis no debería aparecer (solo opera AMBA).

**Por qué no se vio antes:**
Hasta DEUDA 4, `/nuevo-envio/page.tsx` tenía `const cpOrigen = "1050"` hardcoded. Origen siempre era CABA, así que la tarifa AMBA→destino que devolvía cada API coincidía con el origen real. Cero discrepancia visible. Al hacer real el origen (DEUDA 4), el bug latente quedó expuesto.

**Filosofía para el fix (NO mantener listas hardcoded):**
- El courier es la fuente de verdad de su cobertura. NO mantener listas hardcoded de "Mocis solo opera en estos CPs".
- Nosotros mandamos `cpOrigen` + `cpDestino`. El courier responde:
  - Tarifa si hay cobertura.
  - Error si no hay cobertura → el cotizador ya hace `try/catch` per courier ([lib/cotizador.ts:182-197](lib/cotizador.ts#L182-L197)) y lo skipea silenciosamente.
- Eso evita drift de listas y respeta el contrato del courier.

**Documentación oficial de los APIs:**
- Mocis (Akeron): https://documenter.getpostman.com/view/18644794/UVJhCaAn
- Andreani Developers: https://developers.andreani.com/document

**How to apply (3-4 horas):**
1. Mocis adapter: revisar doc Akeron, identificar el campo correcto para `cpOrigen` en `/shipping/price` y enviarlo. Si Akeron rechaza con error de cobertura cuando el origen no aplica, el cotizador ya lo skipea.
2. Andreani adapter: revisar doc developers, identificar el campo de origen en `/v1/tarifas` (probablemente `cpOrigen` o `codigoPostalOrigen`), enviarlo en la query.
3. Agregar logging de request/response de cotización (con redacción de credenciales) para debugging futuro de tarifas raras.
4. Smoke test 5 combinaciones: AMBA-AMBA, AMBA-Interior, Interior-AMBA, Interior-Interior, origen sin cobertura del courier.

**Bloquea:**
Integración de couriers nuevos. Cualquier adapter nuevo replicaría el mismo bug si no se aclara la convención. Una vez resuelto este, documentar la convención en `lib/couriers/CourierInterface.ts` (JSDoc en `cotizar()` exigiendo respeto a `cpOrigen`).

## Otras deudas menores (no críticas, registradas para no perderlas)

- **`obtenerCredencialesShipro` duplicado** en 4-5 archivos: `app/api/cotizar/route.ts`, `app/api/etiquetas/masiva/route.ts`, `app/api/cron/rastreo/route.ts`, `lib/envios/crear.ts`, posiblemente más. Centralizar en `lib/couriers/credenciales.ts`.
- **8 vulnerabilities** (`npm audit`) preexistentes desde el scaffold inicial de create-next-app. Revisar con `npm audit fix` después de SUB-PASOs.
- **Provincias duplicadas** en seed: tras correr `prisma db seed` quedan 44 provincias en lugar de las 24 reales de Argentina. Causa probable: diferencias de mayúsculas/acentos al cargar `prisma/data/codigos.csv`. Limpiar al re-seedear.
- **Dropdowns hardcoded** en `app/(dashboard)/etiquetas/page.tsx`, `app/(dashboard)/historial-manifiestos/page.tsx`, `app/(dashboard)/colectas/page.tsx`: listas de couriers `["Moova", "Andreani", "Correo Argentino", "Moci's", "Javit"]`. Tres de esos no están soportados por `CourierFactory` hoy. Reemplazar por fetch a la lista activa de couriers.
- **Comentario obsoleto** en `prisma/schema.prisma` línea 17: `<--- ¡ESTE ES EL CAMPO VITAL QUE FALTABA!`. Limpiar en una pasada de polish.
- **Página `/seguimiento/[tracking]` deprecada** vs `/s/[tracking]` (la nueva). Solo la referencia el mail de creación en `lib/envios/crear.ts`. Migrar el link del mail a `/s/...` y borrar la deprecada.
- **NextAuth `pages.signIn` flow**: si `authorize()` lanza Error con mensaje custom (ej: "Empresa deshabilitada"), NextAuth v4 devuelve genérico "CredentialsSignin" al frontend. Para mostrar el mensaje custom hay que mapearlo en `app/login/page.tsx`.
- **Moova y Javit en BD (data sucia)**: la tabla `Courier` tiene 4 filas — Andreani, Moci's, Moova, Javit. Las dos últimas son data sucia importada de la plataforma anterior, sin adaptadores implementados en `lib/couriers/`. Borrar las filas cuando se haga la próxima limpieza de seed o agregar las integraciones reales correspondientes (cuando se haga el adapter, se vuelve a sumar la fila).
- **URL de Mocis hardcodeada en adapter**: `lib/couriers/MocisAdapter.ts` tiene la URL de la API de Mocis hardcodeada. Andreani sí usa `process.env.ANDREANI_URL`. Mover la URL de Mocis a `process.env.MOCIS_URL` para consistencia y para permitir entornos sandbox/live distintos en el futuro.

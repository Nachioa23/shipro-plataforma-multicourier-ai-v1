# Deudas técnicas pre-producción Shipro

> **Fuente de verdad**: este archivo (DEUDAS.md). El agente Claude mantiene una memoria
> espejo en `~/.claude/projects/.../memory/deudas_pre_produccion.md` que se carga
> automáticamente al iniciar sesiones de trabajo. Si las dos versiones difieren, gana
> este. Al actualizar/resolver/agregar deudas, hacerlo acá; la memoria del agente se
> reconcilia desde acá en la próxima sesión.

Identificadas durante SUB-PASO 5 (proxy + dual auth) el 2026-04-28. A retomar antes o durante el deploy a producción en Linode.

---

## Principios del producto (declarados durante el desarrollo)

Este bloque captura decisiones de principio que guian futuras decisiones de scope, prioridad y mantenimiento de codigo. Cuando dudemos entre borrar vs mantener algo, leemos los principios y decidimos consistente.

**PRINCIPIO 1 — Shipro es plataforma de datos (declarado 2026-06-02).** La generacion de informacion estrategica del cliente y la operacion logistica es parte del core del producto. Endpoints, queries y logica de analitica NO se borran aunque no tengan UI activa hoy — son backend listo para vistas futuras. Aplicado por primera vez en DEUDA 8 (vista de Calidad Postal) durante el BLOQUE 1 de quick wins del 2026-06-02.

---

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

## DEUDA 8 — Vista de Calidad Postal (REFORMULADA 2026-06-02 — backend listo, UI pendiente)

**Status original (2026-04-28):** Descubierta durante SUB-PASO 6 como endpoint huérfano `/api/torre-de-control/route.ts`. PENDIENTE — decidir si borrar o reactivar.

**Status reformulado (2026-06-02):** El endpoint NO se borra. Computa 4 metricas estrategicas de Calidad Postal (tasa precision postal, tiempo resolucion retenciones, atribucion comprador vs operador, top 5 provincias con errores) que son valor pendiente de exponer en UI. Decision del director: Shipro es plataforma de datos — endpoints/logica de analitica NO se borran aunque no tengan UI activa hoy. Backend listo, construir vista UI cuando se priorice. La metrica de Calidad Postal forma parte del sistema integral Torre de Control (ver DEUDA 39).

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

## DEUDA 20 — Endpoint manual para procesar bloqueados restantes (ABSORBIDA 2026-06-03 por DEUDA 38)

**Status:** Identificada el 2026-04-30 durante implementación de DEUDA 16. ABSORBIDA el 2026-06-03 por DEUDA 38 (Reproceso desacoplado de envios bloqueados — background + cron + boton manual, registrada en `docs/ARQUITECTURA-MULTICOURIER.md` Sec 13 durante el cierre de DEUDA 32+37). El scope de DEUDA 38 es mas amplio y cubre completamente la funcionalidad pedida por DEUDA 20. Cierre definitivo cuando se implemente DEUDA 38. Mismo patron documental usado para DEUDA 12 y DEUDA 15 absorbidas por DEUDA 29.

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

**Estado:** SUB-FASE 2 CERRADA FUNCIONALMENTE (8 sub-fases resueltas + 2 decisiones documentadas; única pendiente activa: 2.C UI).

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

## Otras deudas menores (no críticas, registradas para no perderlas)

- **`obtenerCredencialesShipro` duplicado** — RESUELTA 2026-04-28 aprox. La centralizacion ya esta hecha: existe el modulo `lib/couriers/credenciales/` (sub-directorio con `index.ts` barrel + `andreani.ts` + `mocis.ts` + `tipos.ts`). Los 8 consumidores (api/etiquetas/masiva, api/envios/{andreani-excepciones,sucursales,rastreo-manual,cancelar,inversa}, api/cron/rastreo, lib/cotizador, lib/envios/dispatch) importan del modulo central via `@/lib/couriers/credenciales`. Cero duplicacion. Verificado 2026-06-03 durante auditoria del backlog. La entrada quedo stale en DEUDAS.md hasta hoy.
- **8 vulnerabilities** (`npm audit`) preexistentes desde el scaffold inicial de create-next-app. Revisar con `npm audit fix` después de SUB-PASOs.
- **Provincias duplicadas** en seed: tras correr `prisma db seed` quedan 44 provincias en lugar de las 24 reales de Argentina. Causa probable: diferencias de mayúsculas/acentos al cargar `prisma/data/codigos.csv`. Limpiar al re-seedear.
- **Dropdowns hardcoded** — RESUELTA 2026-06-04. Los 3 archivos (`app/(dashboard)/etiquetas/page.tsx`, `app/(dashboard)/historial-manifiestos/page.tsx`, `app/(dashboard)/colectas/page.tsx`) ahora importan `NOMBRES_DISPLAY` desde `lib/couriers/serviciosSoportados.ts` (single source of truth introducida en DEUDA 32+37) y derivan el dropdown via `Object.values(NOMBRES_DISPLAY)`. Cuando se integre un courier nuevo, los 3 dropdowns se actualizan automaticamente sin tocar estos archivos. Decision del director: la plataforma escalara a 15+ couriers (incluyendo couriers "inventados" sin API real, con adapters que usan BD interna + reglas configuradas). Patron consistente con la disciplina del registry (NOMBRES_DISPLAY + CourierFactory + SERVICIOS_SOPORTADOS sincronizados). Test E2E verificado: los 3 dropdowns muestran solo Andreani + Moci's (no mas Moova/Correo Argentino/Javit fake).
- **Comentario obsoleto** en `prisma/schema.prisma` línea 17: `<--- ¡ESTE ES EL CAMPO VITAL QUE FALTABA!`. Limpiar en una pasada de polish.
- **Página `/seguimiento/[tracking]` deprecada** vs `/s/[tracking]` (la nueva). Solo la referencia el mail de creación en `lib/envios/crear.ts`. Migrar el link del mail a `/s/...` y borrar la deprecada.
- **NextAuth `pages.signIn` flow** — RESUELTA 2026-06-04. Backend (`lib/auth.ts:29`) ahora tira `throw new Error("EMPRESA_INACTIVA")` (codigo enumerable SCREAMING_SNAKE_CASE) en lugar del mensaje literal. Frontend (`app/login/page.tsx:31-41`) mapea los codigos a mensajes user-facing via `ERROR_MESSAGES: Record<string, string>` con fallback al mensaje generico ("Email o contraseña incorrectos. Revisá tus datos.") para passwords mismatch + usuario no encontrado (mismo mensaje preserva seguridad anti-enumeracion de cuentas). Estructura extensible: futuros casos `throw new Error("OTRO_CODIGO")` solo requieren agregar la key + mensaje en el ERROR_MESSAGES del login. Test E2E verificado: caso normal (credentials wrong) muestra el mensaje generico esperado.
- **Moova y Javit en BD (data sucia)** — RESUELTA 2026-05-07 por la migracion `20260507152517_deuda_29_arquitectura_multicourier` (ETAPA 1 de limpieza). Se eliminaron las filas de Courier (Moova=id3, Javit=id4) + sus referencias en CredencialCourier (via DELETE WHERE nombreCourier IN ('Moova', 'Javit')). Estado actual verificado 2026-06-02: tabla Courier solo contiene Andreani (id=1) y Moci's (id=2). La entrada quedo sin marcar como RESUELTA hasta hoy.
- **URLs de couriers hardcoded en adapters** (corregido 2026-06-02): ambos adapters tienen URL hardcoded — `MocisAdapter.ts` linea 4 (`https://mocis.akeron.net/api/v1`) y `AndreaniAdapter.ts` linea 24 (`https://apis.andreani.com`). La premisa original "Andreani usa env var" era falsa: la variable `ANDREANI_URL` existe en `.env.local` pero el codigo NO la consume (env var huerfana). DECISION DEL DIRECTOR (2026-06-02): postergar el refactor hasta tener 5-7 couriers integrados. Disenar el patron de URLs courier con solo 2 casos es prematuro — couriers reales pueden requerir multiples URLs (sandbox vs live), URLs por endpoint (cotizar vs tracking), o variaciones segun ambiente. Hacer la abstraccion ahora con muestra de 2 produce un patron que probablemente habria que rehacer al integrar OCA, Correo Argentino, DPD, etc. Mientras tanto: hardcoded es aceptable, las URLs de couriers no cambian frecuentemente. Cuando llegue el momento de integrar el 5to courier, revisitar y definir patron real.

## DEUDA 39 — Torre de Control: sistema integral de metricas estrategicas (DISEÑO COMPLETO 2026-06-04 — implementacion en progreso: Metricas 1.1, 2.1, 2.3, 3.3 cerradas. 12 metricas restantes.)

**Status:** Abierta 2026-06-02. Diseno profesional completo el 2026-06-04 documentado en `docs/TORRE-DE-CONTROL.md`. Implementacion pendiente, sesion dedicada por metrica.

**Documento maestro:** `docs/TORRE-DE-CONTROL.md` (1971 lineas). Contiene:
- 16 metricas en 5 bloques tematicos con 9 campos de documentacion cada una (Categoria, Definicion operativa, Por que importa, Diferencial competitivo, Fuente de datos, Formula de calculo, Cortes de analisis, Experiencia UI/UX, Verificacion tecnica pendiente).
- Bloque 1 (5 metricas): Resolver Nomenclador, Auditar Checkouts, Eficiencia del Auditor de Checkout, Carga de Soporte, Velocidad de Resolucion de Tickets.
- Bloque 2 (3 metricas): Tiempos Colecta, Efectividad en Primera Visita, Promesa de Entrega Calibrada (fusion del Mapa SLA con Discrepancia Promesa).
- Bloque 3 (3 metricas): Fuga por Ruteo, Desvio de Peso, Modalidades de Eleccion.
- Bloque 4 (4 metricas): Riesgo Courier, Salud de Couriers, Cobertura Postal Activa, Salud Financiera.
- Bloque 5 (1 metrica): NPS Transaccional enriquecido.
- Apendices: glosario tecnico, roadmap de implementacion en 5 fases, principios de implementacion.

**Decisiones de producto declaradas por el director durante el diseno:**
1. Las metricas que tu propuesta original sugeria son la base, pero la plataforma puede sostener mas metricas con la data que ya capta. Por eso se sumaron 5 nuevas: Eficiencia del Auditor de Checkout, Velocidad de Resolucion de Tickets, Salud de Couriers, Cobertura Postal Activa, Salud Financiera.
2. La promesa al comprador en el checkout debe estar validada por la realidad observada de la cadena del cliente, no por el SLA nominal publicado por el courier. Esto convirtio el Mapa SLA en un motor de promesa calibrada (metrica 2.3).
3. La auditoria de checkouts debe tener sensibilidad configurable y logica de tres niveles (validacion dura, correccion silenciosa, solicitud al comprador) para no fastidiar compradores con correcciones innecesarias. Registrado como DEUDA 41.
4. La estacionalidad operativa (Hot Sale, Cyber Monday, Navidad) agrega 1-2 dias al despacho y al transito. Registrado como DEUDA 42.

**Proximos pasos para implementacion:**
- Primera metrica a atacar: 1.1 Resolver Nomenclador (simplicidad + valor inmediato).
- Cada metrica requiere su propia sesion. Estimado 2-4h por metrica segun complejidad.
- Antes de cada implementacion, atender la seccion "Verificacion tecnica pendiente" del documento maestro: cada metrica tiene 5-8 preguntas dirigidas a Claude Code para confirmar estado del backend antes de codear.

**Status:** ABIERTA 2026-06-02. Backend parcial (metrica de Calidad Postal en `/api/torre-de-control/route.ts` — ver DEUDA 8). Pendiente: 10 metricas restantes + UI integral.

**Contexto:** Torre de Control es uno de los pilares estrategicos del producto Shipro (ver Principio 1 — plataforma de datos). Es el espacio interno donde el equipo de Shipro ve todas las metricas y dashboards de la operacion logistica. Operativamente sirve para tener el control del negocio. Un desprendimiento (con scope reducido) es el Panel de Control del usuario/cliente — la vista externa que ven los e-commerce.

**Decision del director (2026-06-02):** Torre de Control requiere una sesion dedicada de diseno profesional (1-2 horas), no un quick win. El director ya tiene trabajo previo con Gemini sobre las 11 metricas que componen Torre de Control. Esa descripcion es la base conceptual para el documento profesional, pendiente de refinamiento. Claude tiene la descripcion base guardada en memoria persistente para arrancar la sesion futura.

**Las 11 metricas (resumen conceptual, sin refinamiento profesional):**

1. **Resolver Nomenclador** — cuantos estados de couriers no fueron normalizados a idioma comun de Shipro.
2. **Auditar Checkouts** — calidad postal de etiquetas creadas (datos correctos vs corregidos via Google Maps).
3. **Fuga por Ruteo** — diferencia economica entre el courier/servicio elegido y las alternativas disponibles en la red Shipro.
4. **Desvio de Peso (Fuga)** — diferencia entre peso declarado por el cliente al cotizar y peso facturado por el courier.
5. **Efectividad en 1ra Visita** — % entregas en primera visita vs requieren recoordinacion vs no entregadas.
6. **Carga de Soporte** — cantidad de tickets/intervenciones del equipo cada 100 etiquetas creadas.
7. **Tiempos Colecta** — tiempo entre creacion de etiqueta y recepcion por el courier (despacho desde deposito del cliente).
8. **Modalidades (Real)** — ranking de habitos de eleccion entre tipos de servicio (domicilio standard, same day, sucursal, pickup, e-locker).
9. **Riesgo Courier (Real)** — concentracion de dependencia de Shipro en 1-3 couriers y analisis de riesgo operativo.
10. **Mapa SLA** — performance logistica real vs promesa del courier por tramo (origen, destino, courier, servicio).
11. **Experiencia del Consumidor (NPS Transaccional)** — encuesta post-entrega para medir experiencia del destinatario final.

**Principio transversal a las 11 metricas:** todas deben permitir desglozar, personalizar, segmentar, individualizar, agrupar y analizar desde distintos puntos de vista.

**Proximos pasos:**
- Sesion dedicada al diseno profesional de las 11 metricas (para cada una: definicion precisa, fuente de datos, formula de calculo, decision que habilita, dependencias).
- Decision arquitectonica: endpoint unico vs uno por metrica.
- Diseno UI integral de Torre de Control.
- Diseno UI del Panel de Control del cliente (vista desprendida con scope reducido).
- Priorizacion metrica por metrica segun dependencias de datos (ej: Desvio de Peso requiere carga de liquidaciones, que aun no se hace).


## DEUDA 40 — CPs rurales perdidos por parse del CSV (ABIERTA 2026-06-03, NO URGENTE)

**Status:** ABIERTA 2026-06-03 como deuda residual identificada durante el cierre de DEUDA 26. No urgente.

**Contexto:** Durante la limpieza de DEUDA 26 (Fase C), las 20 provincias basura eliminadas correspondían a filas del CSV `prisma/data/codigos.csv` con comas decimales sin escapar en nombres de localidades rurales argentinas. Patrón típico: `RUTA 8 KILOMETRO 19,500 AL 22` (notación argentina donde la coma es separador decimal/de miles, no de campo CSV). El parser `csv-parser` interpretó la coma decimal como separador de campo y partió mal esas ~20 filas. Resultado: ~10-15 CPs rurales argentinos (rutas, kilómetros, apeaderos ferroviarios tipo "005 (APEADERO FCGSM)") no están en la BD.

**Decisión del director (2026-06-03):** NO prioritario. Razones:
- Los CPs afectados son zonas rurales sin localidad humana real (kilómetros de rutas, apeaderos ferroviarios abandonados, etc.).
- La gran mayoría de compradores no envían a esas zonas (foco operativo: ciudades y suburbios).
- Si un cliente reporta un CP rural específico faltante en el futuro, se retoma puntualmente.

**Próximos pasos (si se retoma):**
- Identificar las ~20 filas problemáticas del CSV (grep por patrones tipo `,\d+,\d+ AL` o `,\d+ \(`).
- Editar manualmente: cambiar coma decimal por punto, o agregar quotes para preservar la coma como literal del nombre de localidad.
- Re-correr `prisma db seed`. El guard de Fase D rechaza solo provincias no canónicas — las filas reparadas pasarán bien.
- Verificar con grep que las localidades rurales aparecen en BD con su provincia correcta.

**Alternativa más robusta (si se quiere fix permanente):** cambiar `csv-parser` a un parser RFC 4180 compliant que maneje quoting con `csv-stringify` complementario, y re-exportar el CSV original con quoting consistente.


## DEUDA 41 — Verificacion jerarquica de direcciones en e-commerce con sensibilidad configurable (ABIERTA 2026-06-04, prioridad media-alta)

**Status:** ABIERTA 2026-06-04. Identificada durante el diseno de la Torre de Control (DEUDA 39). Relacionada a la metrica 1.2 Auditar Checkouts. Prioridad media-alta.

**Contexto:** La auditoria de Google Maps debe operar con logica jerarquica de tres niveles para evitar mandar mails de correccion al comprador cuando la Plataforma puede resolver la inconsistencia internamente:

- **Nivel 1 — Validacion dura (siempre):** verifica que la triada (calle + localidad + provincia) existe en la realidad segun Google Maps geocoding.
- **Nivel 2 — Correccion automatica silenciosa:** si Google Maps devuelve la direccion normalizada con una correccion menor (acentos, abreviaturas, typos detectables), Shipro toma la version corregida y emite la etiqueta directo. El comprador no se entera.
- **Nivel 3 — Solicitud de correccion al comprador:** solo si los niveles 1 y 2 no resuelven, se dispara el mail al comprador con formulario web validado por Google Maps.

Adicionalmente, la sensibilidad de la auditoria debe ser configurable por cliente con tres perfiles: laxo, estandar, estricto.

**Decision del director (2026-06-04):** sin la logica jerarquica + sensibilidad configurable, e-commerces que no validan direcciones en su propio checkout terminarian forzando friccion al comprador en porcentajes muy altos.

**Trabajo pendiente:**
- Auditar `lib/geo/geocodificar-direccion.ts` y `lib/envios/crear.ts` para entender que niveles existen hoy.
- Implementar nivel 2 (correccion silenciosa) si no existe.
- Disenar y agregar configuracion de sensibilidad por cliente (probablemente nuevo campo en `Empresa` o tabla aparte).
- Aplicar la sensibilidad en el motor de decision del auditor.
- Loguear claramente en `AuditoriaCheckout` que nivel fue aplicado para cada etiqueta (para metrica 1.2 en Torre de Control).

**Prioridad:** Media-alta. Es prerequisito de la metrica 1.2 funcionando con UX correcta. Hasta que esto este implementado, la metrica 1.2 se puede activar pero medira solo el comportamiento actual (probablemente solo nivel 1 + nivel 3).

## DEUDA 42 — Modelo de estacionalidad operativa para eventos comerciales (ABIERTA 2026-06-04, prioridad alta)

**Status:** ABIERTA 2026-06-04. Identificada durante el diseno de la Torre de Control (DEUDA 39). Relacionada a metricas 2.1 Tiempos Colecta y 2.3 Promesa de Entrega Calibrada. Prioridad alta para clientes con fuerte estacionalidad comercial.

**Contexto:** Eventos comerciales de alta demanda en Argentina (Hot Sale, Cyber Monday, Black Friday, Navidad, Dia del Padre/Madre, Dia del Nino, eventos propios de cada e-commerce) agregan entre 1 y 2 dias al despacho del cliente y entre 1 y 2 dias al transito del courier.

Si la Torre de Control no contempla estacionalidad, ocurren dos problemas:
1. La metrica 2.1 muestra degradacion operativa cuando en realidad es saturacion estacional esperable.
2. La metrica 2.3 calibra mal la promesa al comprador: durante Hot Sale, la promesa basada en mediana de 90 dias sera optimista; despues del evento, sera pesimista por arrastre.

**Decision del director (2026-06-04):** la promesa al comprador durante eventos es donde se gana o se pierde conversion y NPS. Sin modelado de estacionalidad, la metrica 2.3 pierde precision en los momentos comercialmente mas criticos del ano.

**Trabajo pendiente:**
- Modelar un calendario de eventos comerciales argentinos relevantes. Probable nuevo modelo `EventoComercial` con: nombre, fechaInicio, fechaFin, descripcion, magnitudImpactoEstimada.
- Permitir al cliente editar el calendario (agregar eventos propios).
- Aplicar correcciones de estacionalidad en el motor de promesa calibrada (metrica 2.3):
  - Durante ventanas de evento, usar percentiles especificos del evento previo en lugar del rolling 90d general.
  - Mostrar visualmente al cliente: "Promesa ajustada por Hot Sale en curso".
- En la metrica 2.1 (Tiempos Colecta), distinguir visualmente periodos de evento para evitar lecturas falsas de degradacion.
- Generar alertas pre-evento: "Hot Sale arranca en 14 dias. Tu promesa actual sera optimista en este periodo. Considera ajustar el nivel de seguridad a 'conservador' temporalmente."

**Prioridad:** Alta. Mayoria de e-commerces argentinos tienen fuerte estacionalidad y la promesa al comprador durante eventos es decisiva en conversion.

## DEUDA 43 — Sistema de SLA nominal del courier por zona (descubierta en Metrica 2.3, 2026-06-08)
UI admin_Shipro durante onboarding para cargar SLAs nominales por (courierId, zonaNombre). El modelo SlaCourier existe pero esta vacio. Necesario para la comparacion calibrada vs nominal del documento maestro (futura version de Metrica 2.3).

**Contexto:** Cada courier publica su SLA por zona ("Interior 1": 4 dias, "Patagonia 2": 7 dias, etc.). Shipro hoy no captura ni compara contra estos valores.

**Componentes:**
- UI nueva en /admin-couriers para CRUD de SlaCourier (textarea o tabla editable).
- Validaciones (UNIQUE por par courier x zona, dias > 0).
- Posiblemente: precarga manual con valores de Andreani y Mocis basicos.

**Bloquea:** comparacion calibrada vs nominal en la metrica 2.3 (vision futura).
**Requiere:** DEUDA 44 resuelta (captura de zona desde liquidacion).

---

## DEUDA 44 — Captura de zona del courier desde liquidacion (descubierta en Metrica 2.3, 2026-06-08)
Hoy Envio.depositoId + Direccion.provincia son la mejor granularidad de destino. El courier conoce la zona oficial donde clasifico el envio (ej: "Interior 1", "Patagonia 2"), pero ese dato no llega a Shipro.

**Solucion propuesta:**
- Nuevo campo Envio.zonaCourier (String?, nullable).
- Modificacion del ingestor de LiquidacionMensual para capturar la columna "zona" del Excel del courier.
- Mapeo por trackingNumber: cada fila de liquidacion → su envio correspondiente.

**Bloquea:** comparacion calibrada vs nominal (DEUDA 45). Granularidad sub-provincial de zonas operativas reales (DEUDA 46).
**Requiere:** revisar formato de liquidacion de Andreani y Mocis para confirmar disponibilidad del dato.

---

## DEUDA 45 — Comparacion calibrada vs nominal en dashboard (descubierta en Metrica 2.3, 2026-06-08)
Seccion en el modal de Metrica 2.3 que muestre side-by-side: "Andreani dice 4 dias al Interior 1, en realidad tarda 6.2 dias (P75)". Util para conversaciones de gestion con couriers (renegociar SLAs, identificar incumplimientos sistematicos).

**Bloquea:** nada (es agregado).
**Requiere:** DEUDA 43 + DEUDA 44 resueltas (necesitamos SLA nominal poblado + zona capturada).

---

## DEUDA 46 — Granularidad sub-provincial: zonas operativas reales (descubierta en Metrica 2.3, 2026-06-08)
La granularidad por provincia es insuficiente. Capital de Cordoba tiene SLA distinto al Interior de Cordoba. CABA y Conurbano Bonaerense son AMBA (mismo SLA), pero el Interior de Buenos Aires es otra cosa.

**Zonas operativas conocidas (informacion del director, 2026-06-08):**
- CABA: CPs 1000-1499
- AMBA Conurbano: CPs 1600-1900 (forma AMBA junto con CABA)
- Interior de Buenos Aires: resto de CPs de la provincia
- Resto de provincias: granularidad TBD por courier

**Solucion propuesta:**
- Modelo nuevo ZonaLogistica (nombre, descripcion, criterio_match).
- Match por rangos de CP para Buenos Aires.
- Mapeo provincia → zona unica para el resto.
- Refactorizar metrica 2.3 para agrupar por zona en lugar de provincia.

**Bloquea:** comparacion certera contra SLA nominal del courier.
**Requiere:** decision de producto sobre que zonas se modelan.

---

## DEUDA 47 — Fix persistencia de modalidad en Envio.modalidad (descubierta 2026-06-08, RESUELTA 2026-06-09 en commit de Metrica 3.3)
Hoy `lib/envios/crear.ts:478` persiste modalidad: "Estandar" (default) para todos los envios. El cotizador devuelve modalidad rica ("Entrega a Domicilio (Estandar)", "Retiro en Sucursal", "Locker"), pero esa string no se persiste.

**Impacto actual:** la metrica 2.3 NO puede cortar por modalidad. Documentado en `app/api/torre-de-control/promesa-calibrada/route.ts` como granularidad v1.

**Solucion:**
- Modificar `lib/envios/crear.ts` para extraer modalidad de la opcion elegida (o recibirla como input explicito).
- Persistir el string canonico en `Envio.modalidad`.
- Cuando se resuelva: agregar dimension modalidad al endpoint y dashboard de metrica 2.3.

---

## DEUDA 48 — Decision arquitectonica: origen del CP en cotizacion (descubierta en Metrica 2.3, 2026-06-08)
Hoy `/api/cotizar` recibe `cpOrigen?` opcional. Si el e-commerce lo manda, se usa. Si no, fallback al CP del deposito predeterminado (lib/cotizador.ts:117-125).

**Pregunta arquitectonica:** ¿el e-commerce deberia enviar el CP de origen o la Plataforma deberia siempre usar el deposito predeterminado del cliente?

**Implicancias:**
- Multi-deposito por empresa: ¿quien decide cual usar?
- Coherencia: cliente con 3 depositos puede tener confusion sobre cual cotizar.
- Integraciones existentes: probablemente algunos clientes ya mandan cpOrigen explicito.

**Sesion dedicada de producto.** No es bloqueante para metrica 2.3 v1.

---

## DEUDA 49 — Normalizacion de provincias en BD (descubierta en Metrica 2.3, 2026-06-08)
`Direccion.provincia` es string libre. Conviven en BD: "Buenos Aires" y "Provincia de Buenos Aires" como entidades distintas, cuando geograficamente son la misma provincia.

**Impacto actual:** metricas que agrupan por provincia fragmentan muestras. Metrica 2.3 normaliza en codigo (lowercase + trim) pero NO unifica variantes nominales.

**Solucion propuesta:**
- Refactor a 24 jurisdicciones argentinas (23 provincias + CABA) como enum o tabla referencia.
- Migration de Direccion.provincia con mapeo de variantes existentes.
- Validacion en formularios de carga.

**Conecta con DEUDA 46** (granularidad sub-provincial).

---

## DEUDA 50 — Refactor canonico del campo Envio.estadoActual: separacion en 2 planos (interno + courier) (registrada 2026-06-09, scope grande)

**Contexto:** Hoy `Envio.estadoActual` es un single String field sin enum/type, sin canonical list, sin normalizer. ~25 strings distintos circulan en BD y codigo (Pendiente, PENDIENTE, BLOQUEADO_SALDO, IMPRESO, "Impreso / Listo", EN_TRANSITO, TRANSITO, INCIDENCIA, etc.). ~30 sitios escriben + ~20 sitios leen con comparaciones ad-hoc tipo `["ENTREGADO", "Entregado"].includes(...)`. El cluster `S_FALLIDA` / `S_SINIESTRO` (legacy del Nomenclador) sobrevive sin proposito claro.

**Diagnostico arquitectonico:** El modelo real de negocio requiere 2 planos simultaneos:
- **Plano interno (Plataforma):** 5 estados que controla Shipro y ve el cliente — PENDIENTE, RETENIDO, BLOQUEADO, IMPRESO, CANCELADO. Visible en Bandeja de Pedidos y Centro de Etiquetas.
- **Plano courier:** 11 estados que ve el destinatario y refleja el ciclo real del paquete — ETIQUETA_CREADA, PAQUETE_RECOLECTADO, EN_TRANSITO_A_DESTINO, EN_SUCURSAL_DE_DESTINO, EN_SUCURSAL_DE_ENTREGA, EN_DISTRIBUCION, ENTREGADO, VISITA_FALLIDA, CANCELADO, DEVUELTO_AL_REMITENTE, INCIDENCIA.

Los 2 planos avanzan acoplados pero NO son identicos (ejemplo: interno=CANCELADO puede coexistir con courier=EN_DISTRIBUCION si el courier no actualizo su lado).

**Solucion provisoria (F1, commit actual):** helper `lib/utils/estados.ts` con catalogos canonicos + normalizadores `normalizarEstadoInterno()` / `normalizarEstadoCourier()` + heuristica `derivarPlanos()` que mapea Envio.estadoActual single field a tupla {interno, courier}. Cero migration. Cero refactor de los 50 sitios. Las metricas futuras (2.2 incluida) consumen el helper.

**Trabajo necesario para resolver DEUDA 50 (sesion dedicada futura, estimado ~7-8 horas):**
1. Migration de Prisma: agregar `Envio.estadoCourier String? @default(null)`, mantener `estadoActual` renombrado a `estadoInterno` (o mantener `estadoActual` y agregar nuevo).
2. Backfill de los envios actuales: poblar `estadoCourier` desde `estadoActual` legacy usando `derivarPlanos()`.
3. Refactor de ~30 sitios que escriben `estadoActual` para que escriban en el plano correcto.
4. Refactor de ~20 sitios que leen `estadoActual` para que usen el campo correcto segun contexto (Centro de Etiquetas usa `estadoInterno`, Bandeja de Pedidos muestra `estadoInterno` + `estadoCourier`).
5. Eliminar/migrar cluster `S_*` (S_FALLIDA, S_SINIESTRO) al catalogo canonico (probablemente colapsar a INCIDENCIA con observacion).
6. Crear union types TypeScript `EstadoInternoKey | EstadoCourierKey` y aplicar en signatures de funciones criticas.
7. Limpiar `importar/route.ts`: validar strings del Excel del cliente contra catalogo canonico (rechazar o normalizar).
8. Testing manual sitio por sitio.

**Prioridad:** Media-alta. Bloqueante para metricas con alta precision pero no bloqueante para produccion (helper normaliza on-the-fly). Plan: atacar despues que la Plataforma este en produccion y se hayan estabilizado las primeras integraciones con clientes.

**Origen:** Investigacion F1.A del 2026-06-09 (sesion de Fundaciones de Tracking previa a Metrica 2.2). Diseño consensuado con el director: 5 estados internos + 11 estados courier, plano interno determina cuando courier es null (RETENIDO o BLOQUEADO).

---

## DEUDA 52 — Geocoding de Direccion (lat/lng) (registrada 2026-06-09, scope chico-medio)

**Origen:** Metrica 2.5 (Anatomia de la Devolucion), 2026-06-09. El modelo `Direccion` no tiene campos `latitud` ni `longitud`, solo CP + provincia + localidad. Esto impide calcular distancia geodesica real para visualizar la magnitud del trayecto ida + vuelta de los paquetes devueltos.

**Estado actual:** la Metrica 2.5 funciona con agrupacion por provincia y localidad. La spec del director (2026-06-09) confirma esta limitacion como aceptable en v1.

**Plan de resolucion (dos opciones):**

1. **Geocoding por API externa.** Agregar campos `latitud Float?` y `longitud Float?` a `Direccion`. Resolver coords on-the-fly cuando se crea una Direccion nueva via Google Maps Geocoding API, Mapbox Geocoder, o similar. Pros: precision alta. Contras: dependencia externa + costo por request + latencia + API key management. Estimado ~6-8h.

2. **Tabla local de codigos postales argentinos.** Bajar de Correo Argentino o fuente publica un dataset CP -> lat/lng centroide. Crear tabla `CodigoPostalCentroide` y resolver Direccion.latitud/longitud por lookup al crear. Pros: cero dependencia externa + zero latencia post-seed + sin API costs. Contras: precision menor (centroide de CP, no calle exacta) + datos publicos pueden estar incompletos. Estimado ~4-6h + verificacion de calidad.

**Casos de uso desbloqueados:**
- Calculo de distancia geodesica ida + vuelta de cada devolucion (input para "costo de oportunidad" del stock inmovilizado ponderado por km).
- Heatmap geografico de devoluciones en dashboard.
- Comparacion de distancia promedio por courier (insight de eficiencia logistica).

**Prioridad:** Media-baja. No bloquea metricas operativas. Esperar a tener feedback de produccion sobre si la agrupacion por provincia/localidad alcanza, antes de invertir en geocoding.

---

## DEUDA 53 — Campo formal `origen` en TicketSoporte (registrada 2026-06-09, scope chico)

**Origen:** Metrica 2.4 (Tasa de Tickets de Mesa de Ayuda), 2026-06-09. El modelo `TicketSoporte` no tiene un campo formal que distinga el origen del ticket entre "Radar Shipro" (auto-creado por el cron de rastreo cuando un envio lleva +36hs sin movimiento) y "Cliente" (creado manualmente por un usuario_Shipro a partir de un reclamo de la empresa cliente).

**Estado actual:** la Metrica 2.4 infiere el origen mediante heuristica de substring en el campo `motivo` (`SUBSTRINGS_RADAR_SHIPRO = ["demora sin actualizacion", "auto-creado", "sin movimiento"]`). Si el motivo no matchea ninguna de estas substrings, el ticket se clasifica como Cliente.

**Plan de resolucion:**
1. Migration de Prisma: agregar `TicketSoporte.origen String @default("CLIENTE")` con valores posibles "RADAR_SHIPRO" | "CLIENTE" | "API" | "INTEGRACION".
2. Backfill de tickets existentes: ejecutar la heuristica actual una sola vez al aplicar la migration, persistir el resultado en el campo nuevo.
3. Actualizar `app/api/cron/rastreo/route.ts` linea ~150 (auto-creacion por inactividad >=36hs) para que persista `origen: "RADAR_SHIPRO"` explicitamente.
4. Actualizar `app/api/tickets/route.ts` POST handler para que persista `origen: "CLIENTE"` por defecto.
5. Reemplazar la heuristica `esRadarShipro()` en `app/api/torre-de-control/tickets-mesa-ayuda/route.ts` por un check directo `t.origen === "RADAR_SHIPRO"`.

**Estimado de trabajo:** 2-3 horas (migration + backfill + 3 edits + verificacion).

**Casos de uso desbloqueados:**
- Reportes precisos de origen incluso cuando los motivos no contienen las substrings esperadas (por ejemplo: ticket Radar con motivo customizado).
- Posibilidad futura de agregar canales: "API" (integracion con sistema del cliente), "INTEGRACION" (recibido via webhook de courier).
- Auditoria correcta del flujo Auto-Gestion vs Asistido.

**Prioridad:** Media-baja. La heuristica actual cubre el caso 100% para los tickets generados por el cron (motivo hardcodeado), y razonablemente bien para tickets creados manualmente. No bloquea metricas operativas.

---

## DEUDA 54 — Recuperar Card "Auditar Checkouts" (registrada 2026-06-10, scope chico)

**Origen:** Metrica 3.1 (Auditoria de Direcciones), 2026-06-10. Durante el refactor del Card 2 de BLOQUE 3 (Analisis Vivos) para bindear con el endpoint nuevo de Metrica 3.1, se descubrio que el Card legacy mostraba un concepto distinto: "envios retenidos por checkout" (validacion pre-envio relacionada con DEUDA 4 de depositos fisicos).

**Estado actual:** El Card 2 fue re-propositado para Metrica 3.1 (auditoria de calidad de direcciones). El concepto antiguo "auditoria de checkouts" queda sin representacion visual en el dashboard. Los datos legacy (`auditoriaStats.totalRetenidos`) siguen siendo computados por el endpoint /api/metricas pero no se muestran en ningun lugar visible.

**Plan de resolucion (cuando se decida priorizarlo):**
1. Crear un endpoint dedicado `/api/torre-de-control/auditoria-checkouts/route.ts` que reemplace la logica de `auditoriaStats.totalRetenidos`.
2. Agregar un Card nuevo (probablemente Card 12 o donde quepa en el layout) con icono propio y enlace a un modal dedicado.
3. Decidir si el modal sigue el patron p-8 space-y-6 establecido.

**Casos de uso desbloqueados:**
- Visibilidad operativa de envios bloqueados antes de la impresion (validacion checkout).
- Cruce con DEUDA 4 (gestion de depositos fisicos del cliente).
- Reduccion de "envios fantasma" que no pueden imprimirse por datos incompletos.

**Prioridad:** Baja. La funcionalidad del endpoint legacy sigue activa (envios retenidos siguen bloqueandose correctamente), solo se perdio la visibilidad visual en el dashboard. No bloquea operacion.

---

## DEUDA 55 — Documentar valor "MOTOR_PRECIO" en Empresa.ordenamientoDefault (registrada 2026-06-10, scope chico)

**Origen:** Metrica 3.2 (Fuga por Ruteo Ineficiente), 2026-06-10. Durante la investigacion del PRE-STEP se descubrio que la BD demo tiene a "Cliente Demo" con `ordenamientoDefault = "MOTOR_PRECIO"`, pero el comentario del schema `prisma/schema.prisma` solo documenta los valores `PRECIO_ASC`, `SLA`, `HISTORICO`. El valor "MOTOR_PRECIO" no esta declarado en el contrato del campo.

**Estado actual:** la BD acepta cualquier string en este campo (no hay enum constraint). La aplicacion presumiblemente maneja "MOTOR_PRECIO" en algun lado pero el campo no esta documentado consistentemente. Tambien existe duplicacion del concepto en `ServicioCourier.ordenamientoDefault` con el mismo default `PRECIO_ASC`.

**Plan de resolucion:**
1. Auditar todos los valores reales que existen en la BD de produccion (cuando este disponible) para `Empresa.ordenamientoDefault` y `ServicioCourier.ordenamientoDefault`.
2. Decidir si "MOTOR_PRECIO" es un valor legacy a migrar a uno canonico (`PRECIO_ASC`?) o si es un valor valido a documentar.
3. Actualizar el comentario en `prisma/schema.prisma` con la lista completa de valores aceptados.
4. Opcional: convertir el campo a Prisma enum para forzar el contrato.
5. Considerar si los dos campos `ordenamientoDefault` (en Empresa y en ServicioCourier) deben unificarse o si tienen semanticas distintas.

**Casos de uso desbloqueados:**
- Consistencia entre BD y documentacion.
- Validacion de input al setear el campo desde la UI / API.
- Predictibilidad de la logica de cotizacion (que ordena por que segun el valor).

**Prioridad:** Baja. No bloquea operacion. Pero introduce ambiguedad operativa: si alguien lee el schema espera 3 valores, en la realidad puede encontrarse con otros.

---

## DEUDA 56 — Nivel 2 de Metrica 3.2: fuga vs red completa Shipro (registrada 2026-06-10, scope grande)

**Origen:** Metrica 3.2 (Fuga por Ruteo Ineficiente), 2026-06-10. La version V1 implementa solo el NIVEL 1 de auditoria de ruteo: fuga DENTRO del mix de couriers activos para esa empresa cliente.

**Estado actual:** el endpoint /api/torre-de-control/fuga-ruteo consume `FinanzasEnvio.fugaFinanciera` (precomputada al crear envio) que solo compara contra los couriers que el cliente tiene activados. Si Andreani es el mas barato dentro de los activos, pero existe OCA (no activado) que cotiza aun mas barato, la fuga no se detecta.

**Por que es deuda:** el director Nacho (2026-06-10) explicito que la metrica debe responder dos preguntas:

1. Cuanto plata pierde el cliente eligiendo mal dentro de sus opciones activas? (NIVEL 1 implementado)
2. Cuanto plata pierde el cliente por NO tener todos los couriers integrados? (NIVEL 2 pendiente)

Sin el NIVEL 2 el cliente Shipro no puede evaluar si su mix actual de couriers es optimo o si convendria activar otros couriers integrados.

**Plan de resolucion:**

1. Modificar la logica de creacion de envios (`lib/envios/crear.ts`) para que cuando se calcule `fugaFinanciera`, tambien se compute y persista un campo nuevo `fugaFinancieraVsRedCompleta` (cotizando contra TODOS los couriers integrados a Shipro, no solo los activados para esa empresa).
2. Decidir como obtener cotizaciones de couriers no activados:
   - Opcion A: usar credenciales Shipro genericas (Modelo A, ver DEUDA 29) para esos couriers.
   - Opcion B: usar `HistoricoCotizaciones` para estimar (basado en cotizaciones previas de otros clientes para el mismo CP/peso).
   - Opcion C: combinacion: API real si Shipro tiene credencial, fallback a historico.
3. Extender el endpoint /api/torre-de-control/fuga-ruteo con un nuevo bloque `nivel2`.
4. Extender el modal con un panel adicional "Ahorro Potencial Activando Mas Couriers".
5. Agregar recomendacion concreta: "Activando OCA podrias ahorrar X% mas".

**Casos de uso desbloqueados:**
- El cliente puede evaluar costo-beneficio de activar nuevos couriers integrados.
- Shipro puede recomendar onboarding de couriers especificos a cada empresa.
- Hace visible el valor de la red integrada de Shipro (no solo "te integramos couriers", sino "te ahorras X plata si activas Y").

**Prioridad:** Media-alta. Es feature comercialmente fuerte (justifica el valor de la red integrada Shipro). Estimado: 6-10 horas (logica de cotizacion paralela + persistencia + UI).

---

## DEUDA 57 — Persistir dimensiones del paquete + Nivel 2 de Metrica 3.4 (registrada 2026-06-11, scope medio)

**Origen:** Metrica 3.4 (Desvio Financiero por Peso Volumetrico), 2026-06-11. Durante el PRE-STEP se descubrio que:

1. El modelo `Envio` solo persiste `pesoReal` (numerico). NO guarda dimensiones del paquete (largo, ancho, alto).
2. Las dimensiones viajan por el sistema (al cotizar / imprimir / despachar al courier) pero se pierden despues del flow — no quedan persistidas en ningun lado consumible.
3. `CotizacionSnapshot.paqueteSnapshotJson` podria contener esas dimensiones pero esta sin uso (ver DEUDA 58).

**Estado actual:** Metrica 3.4 V1 funciona solo en NIVEL 1 — compara `pesoCobrado` (lo cotizado al imprimir) vs `pesoAforado` (lo facturado por el courier en su liquidacion). Esto detecta fuga monetaria pero no diagnostica donde esta el error:
- Puede ser que el cliente declaro mal las medidas → cotizacion baja → liquidacion alta = bug del cliente.
- Puede ser que el courier aplique abusivamente su formula de aforo → bug del courier.

Sin las dimensiones persistidas, no podemos discriminar estos dos casos.

**Plan de resolucion (NIVEL 2):**

1. Persistir dimensiones del paquete en `Envio` (campos `largoCm Float?`, `anchoCm Float?`, `altoCm Float?`) o conectar `CotizacionSnapshot.paqueteSnapshotJson` (resuelve DEUDA 58 tambien).
2. Documentar la formula estandar de aforo: factor 3.5 cm3/kg para Andreani, otros couriers segun catalogo.
3. Cuando llegue la liquidacion, recomputar pesoVolumetricoEsperado = (largo × ancho × alto × factor) / 10000 y compararlo contra pesoAforado del courier.
4. Si pesoVolumetricoEsperado != pesoAforado → el courier esta aplicando una formula distinta a la documentada (posible abuso o cambio de tarifa no detectado).
5. Extender modal de Metrica 3.4 con un panel "Discrepancia con Aforo Esperado" que diferencie entre fuga por "datos mal declarados por cliente" vs "courier aplicando formula no canonica".

**Casos de uso desbloqueados:**
- Identificar empresas cliente que declaran sistematicamente mal las medidas (problema de capacitacion / API).
- Detectar abusos del courier en su computo de aforo.
- Negociar con el courier en base a evidencia cuantitativa.
- Recomendaciones especificas: "tu producto X declarado como 1kg en realidad mide 40x40x30 = 16.8kg aforados — actualiza tu ficha".

**Prioridad:** Media. No bloquea Metrica 3.4 V1 que ya es valiosa (detecta la fuga monetaria). Pero NIVEL 2 multiplica el valor diagnostico.

**Estimado:** 8-12 horas (Prisma schema migration + flow de creacion de envio + helper de aforo configurable por courier + extender endpoint + extender modal).

---

## DEUDA 58 — CotizacionSnapshot.paqueteSnapshotJson sin consumer (registrada 2026-06-11, scope chico)

**Origen:** Metrica 3.4 PRE-STEP, 2026-06-11. La tabla `CotizacionSnapshot` existe en el schema con el campo `paqueteSnapshotJson String` (presumiblemente contendria snapshot del paquete cotizado incluyendo dimensiones), pero:

1. Cero referencias en codigo (`grep -rln "paqueteSnapshotJson" app/ lib/` retorna vacio).
2. Cero filas en la BD demo.
3. Infraestructura latente — declarada pero sin productor ni consumer.

**Estado actual:** El modelo `CotizacionSnapshot` esta abandonado. Si se quisiera auditar lo cotizado contra lo entregado (caso de uso de Metrica 3.4 NIVEL 2 — ver DEUDA 57), seria la fuente natural pero no existe ningun proceso que la popule.

**Plan de resolucion (3 opciones):**

A. **Activar:** modificar `lib/cotizador.ts` para escribir un snapshot en cada cotizacion exitosa. Conectarlo en el flow de impresion (`lib/envios/crear.ts`) para asociarlo al envio creado via `usadaEnEnvioId`. Vincula con DEUDA 57.

B. **Deprecar:** si el caso de uso original esta abandonado, eliminar la tabla del schema en una migracion Prisma para reducir ruido.

C. **Documentar como "future use":** dejar el modelo intacto pero agregar un comentario en el schema explicando que esta latente para un futuro uso.

**Recomendacion:** opcion A es la mejor si DEUDA 57 se va a atacar — la tabla provee infraestructura ya pensada para snapshots de cotizacion. Opcion B si DEUDA 57 nunca se va a hacer. Opcion C como compromiso.

**Casos de uso desbloqueados (si opcion A):**
- Auditar lo cotizado vs lo facturado por el courier.
- Reconstruir el historial de cotizaciones para debugging.
- Soporte a Metrica 3.4 NIVEL 2 + cualquier auditoria financiera futura.

**Prioridad:** Baja. Tecnicamente es solo cleanup / activacion de infraestructura latente. Pero merece resolverse junto con DEUDA 57 para evitar abrir dos veces el codigo.

---

## DEUDA 59 — Activar disparo automatico del email NPS post-entrega (registrada 2026-06-11, scope chico-medio)

**Origen:** Metrica 1.2 (NPS Comprador) PRE-STEP, 2026-06-11. Durante la investigacion se descubrio que:

1. La funcion `enviarMailEntregadoNPS` en `lib/mailer.ts` esta completa con template HTML rico (grilla 0-10 color-coded, subject "Paquete entregado! Como fue tu experiencia?", redirige al /api/nps endpoint con tracking + score).
2. El endpoint `/api/nps/route.ts` que recibe el voto funciona correctamente (categoriza, persiste, calcula slaCumplido inline).
3. El endpoint `/api/nps/comentario/route.ts` para follow-up tambien funciona.
4. **Pero ninguna parte del codigo invoca `enviarMailEntregadoNPS`**. Resultado: ningun comprador recibe el email, EncuestaNPS queda en 0 filas en produccion.

**Estado actual:** Metrica 1.2 V1 funciona via seed sintetico. Sin activar el disparo automatico, la metrica nunca recibira data real continua. Es una infraestructura ~80% construida que necesita un ultimo paso de activacion.

**Plan de resolucion:**

1. Modificar `/api/cron/rastreo/route.ts` (cron de tracking que detecta cambios de estado) para que cuando un envio transicione a `ENTREGADO`:
   - Validar que aun no exista una `EncuestaNPS` asociada al envio (evitar doble envio).
   - Validar que el envio tenga email del destinatario disponible (no todos lo tienen).
   - Invocar `enviarMailEntregadoNPS(destino.email, trackingNumber, destino.nombre, courier.nombre, getAppUrlOrThrow())`.

2. Agregar campo opcional `encuestaEnviada Boolean @default(false)` en `Envio` para marcar disparos exitosos (alternativa: consultar `EncuestaNPS.findUnique({ where: { envioId } })` antes de cada envio, mas simple pero menos eficiente).

3. **Decision sobre backfill historico (director, 2026-06-11):** SOLO entregas nuevas (post-activacion). NO enviar email retroactivo a entregas historicas para no confundir compradores que ya olvidaron el envio.

4. Logging: cada disparo exitoso/fallido se registra para auditoria post-mortem.

**Casos de uso desbloqueados:**

- Metrica 1.2 recibe data real continua sin seed sintetico.
- Cliente Shipro obtiene voz cuantitativa del comprador final.
- Detectar correlacion SLA cumplido vs satisfaccion en tiempo real.
- Identificar campeones de marca (promotores con comentario) vs riesgos (detractores con sugerencia).

**Prioridad:** Media. La infraestructura ya esta lista 80% (template + endpoints + modelo). Solo falta el "primer mover".

**Estimado:** 2-4 horas (modificar cron + agregar campo opcional + validar logica anti-doble-envio + testing).

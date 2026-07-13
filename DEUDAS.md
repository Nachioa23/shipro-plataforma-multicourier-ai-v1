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

**PRINCIPIO 2 — Ownership canonico de Envio (declarado 2026-07-04).** La empresa duena de un Envio es la asignada en su creacion — la relacion `Envio.empresa` via el FK escalar `Envio.empresaId`, escrita en `lib/envios/crear.ts:597` (`empresa: { connect: { id: empresaId } }`). Todo endpoint que lea o mute envios con scope de cliente DEBE filtrar por este camino via `verificarAccesoEnvio` (`lib/envios/ownership.ts`). Shipro (`ctx.empresaId === null`) tiene scope global. NO inventar caminos alternativos de ownership (via Deposito/Manifiesto/Liquidacion son joins de agregacion, no ejes de propiedad). Diagnosticado en DEUDA 87 FAMILIA 2 (verificacion 3x confirma un unico camino).

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

## DEUDA 36.E — Flujo de onboarding logístico end-to-end: activación courier↔depósito con auto-verificación de cobertura y origen dinámico (especificación detallada de DEUDA 36) — registrada 2026-07-08, actualizada 2026-07-08

**Tipo:** Diseño de producto + UI — ZONA SENSIBLE (ruteo/consolidación, familia DEUDA 29/83).
**Relación:** Especificación detallada de la DEUDA 36. La 36 describía la cascada en germen; esta la define end-to-end.
**Estado:** EN CURSO. Fases 1, 4a y 4b CERRADAS y verificadas end-to-end (browser + DB). Quedan la grilla en el wizard de onboarding + el reordenamiento de pasos + pulido.
**Prioridad de negocio (Nacho):** ALTA — diferencial de producto para lucir. El momento en que un cliente configura su logística es donde se demuestra la promesa "claridad, no complejidad".

---

## PLAN DE FASES (acordado 2026-07-08)

- **Fase 1 — Endpoint de la grilla (backend). ✅ CERRADA — commit a35a3d7.**
  `GET /api/depositos/[id]/couriers-elegibles`: enumera todos los couriers activos + su
  estado de cobertura contra el CP efectivo. Query param opcional `recolectorProyectadoId`
  recalcula el `cpOrigenEfectivo` de cada courier no-recolector contra el hub del recolector
  (origen dinámico). Read-only, aditivo. Reusa `verificarAccesoDeposito` +
  `asignarSucursalParaDeposito` sin modificarlas. Verificado en browser: sin recolector
  Andreani cubre CP 1661 (San Miguel); con Mocis proyectado, Andreani pasa a origen 1702
  (Caseros), Mocis queda en 1661 (no se recolecta a sí mismo).

- **Fase 2 — Origen dinámico en la UI. ✅ ABSORBIDA en Fase 1 + 4a.**
  El endpoint ya soporta el recálculo dinámico; la grilla lo consume al cambiar el recolector.
  No requirió fase propia (el diagnóstico mostró que separarla era trabajo tirado contra una
  UI inexistente — se fusionó con la grilla).

- **Fase 3 — Bootstrap de fichas DepositoCourierConfig. ✅ ABSORBIDA en Fase 4b.**
  La creación automática de fichas quedó integrada en el guardado atómico de la 4b (ver abajo),
  no como fase separada.

- **Fase 4a — Grilla visual (display-only). ✅ CERRADA — commits db5605c (componente) + 6d31ac9 (montaje).**
  `components/configuracion/CoberturaGrid.tsx`: fila por courier con estado/color/icono/sucursal,
  picker de recolector que re-evalúa en vivo. Estados: verde (cubre), rojo (sin cobertura), ámbar
  (revisar). Píldoras Recolector/Consolidador/Sin credencial. Montada en DepositoForm reemplazando
  el selector simple viejo. Verificada en browser.

- **Fase 4b — Guardado atómico: activa recolector + crea fichas. ✅ CERRADA — commit e8a6602.**
  Al elegir recolector y confirmar, el guardado persiste el recolector Y crea las
  `DepositoCourierConfig(recogeViaConsolidador=true)` de los couriers que (a) cubren el CP del
  hub del recolector Y (b) tienen credencial activa — todo en una transacción atómica. Regla de
  Nacho ("cubre Y credencial") implementada: el modal muestra dos listas (se activarán ahora /
  pendientes de credencial). Escritura gateada por flag opt-in `autoActivarEligibles`. Verificado
  end-to-end (browser + DB): elegir Mocis para el Depósito Central crea recolectorId=2 +
  ficha Andreani recoge=true en una sola transacción.

- **Fase 4c/d — Grilla en el wizard de onboarding + reordenamiento. ⬜ PENDIENTE.**
  Usar el mismo `CoberturaGrid` en el wizard (`app/onboarding/page.tsx`), insertando un paso nuevo
  entre "depósito" (paso 3 actual) y "transporte" (paso 4 actual), para lograr la secuencia
  Depósito → Recolector → Transporte que pidió Nacho. El componente ya es reutilizable; falta el
  montaje + el re-slicing del wizard (PasoWizard 1|2|3|4 → 1|2|3|4|5).

- **Fase 5 — Manejo de couriers huérfanos + pulido. ⬜ PENDIENTE.**
  Cuando el cliente cambia/activa un recolector cuyo hub no cubren couriers ya activos: marcarlos
  en conflicto para que el cliente decida (decisión Nacho: no apagar solos, no bloquear, marcar).
  Apoyarse en la cascada existente de `PUT /api/depositos/[id]`.

---

## Estado de M-92 (sub-tarea de DEUDA 92 — camino recolector)

**CERRADO a nivel configuración + verificado end-to-end (2026-07-08).** El camino del recolector,
que estaba trabado por el hueco de UI (no había forma de crear la ficha depósito×courier), ahora
funciona: la grilla configura el recolector y crea las fichas. Verificado con envío real de Comercio
Demo — se generó la etiqueta combinada con los dos tramos (Mocis recolección tracking 0000125551 +
Andreani entrega tracking 360003031154600), la etiqueta física lleva ambas (zócalo de Mocis al pie de
la de Andreani, vía etiquetas/masiva). El camino de dos tramos quedó ejercitado en vivo por primera vez.

---

## Visión del flujo (Nacho, 2026-07-08) — referencia de diseño

Secuencia de onboarding de un depósito:
1. Cliente crea el depósito (define CP origen).
2. Sistema consulta cobertura de cada courier contra el CP del depósito.
3. Couriers que cubren = activables; que no cubren = apagados y BLOQUEADOS con motivo visible (no forzar).
4. Cliente puede elegir UN recolector (couriers con puedeConsolidar).
5. ORIGEN DINÁMICO: al elegir recolector, el CP de origen de los entregadores se DESPLAZA al hub del
   recolector (cpDepositoConsolidador); el recolector queda en el CP del depósito. Solo quedan activables
   los que cubren el nuevo CP. Regla de activación: cubre el nuevo CP Y tiene credencial activa.
6. Al activar cada courier, se crea la ficha DepositoCourierConfig automáticamente.
7. Couriers activos previos que no cubren el nuevo origen → quedan en CONFLICTO, cliente decide
   (recomendación: apagarlos). [Fase 5]

## Relación con otras DEUDAS

- **DEUDA 36** (padre): esta es su especificación detallada.
- **DEUDA 92** (M-92): cerrado a nivel config por esta DEUDA (ver arriba).
- **DEUDA 91** (catálogo de servicios): relacionada pero distinta — la 91 es QUÉ servicios ofrece cada
  courier; esta es DÓNDE (cobertura por CP) y el flujo de activación por depósito.
- **Servicio de recolección tarifado** (extensión de DEUDA 91, a registrar aparte): que el recolector
  cobre su servicio de recolección para terceros (código de servicio + costo diferenciado, cotizado y
  facturado aparte). Eje FACTURACIÓN; esta DEUDA es el eje ACTIVACIÓN/COBERTURA. No confundir.

## Nota de método

Detectado durante el walkthrough de M-92, al toparse con el selector de recolector vacío. Se decidió NO
destrabar a mano (no crear la ficha por API por la puerta de atrás) sino diseñar la solución end-to-end.
La Fase 4b (que escribe en el corazón del sistema) se partió en 3 pasos con dry-run primero para verificar
el cálculo antes de tocar la escritura. Zona sensible: diagnóstico read-only antes de cada cambio.

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

## DEUDA 49 — Normalizacion de provincias en BD (descubierta en Metrica 2.3, 2026-06-08 — PARCIAL al 2026-06-17: code-level normalizer implementado, refactor estructural BD pendiente)
`Direccion.provincia` es string libre. Conviven en BD: "Buenos Aires" y "Provincia de Buenos Aires" como entidades distintas, cuando geograficamente son la misma provincia.

**Impacto actual:** metricas que agrupan por provincia fragmentan muestras. Metrica 2.3 normaliza en codigo (lowercase + trim) pero NO unifica variantes nominales.

**Solucion propuesta:**
- Refactor a 24 jurisdicciones argentinas (23 provincias + CABA) como enum o tabla referencia.
- Migration de Direccion.provincia con mapeo de variantes existentes.
- Validacion en formularios de carga.

**Conecta con DEUDA 46** (granularidad sub-provincial).

---

## DEUDA 50 — Refactor canonico del campo Envio.estadoActual: separacion en 2 planos (interno + courier) (registrada 2026-06-09, scope grande — PARCIAL al 2026-06-17: foundations laid en `lib/utils/estados.ts` + adapters canónicos F1, refactor estructural BD pendiente)

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

---

## DEUDA 60 — Activar disparo trimestral del cron NPS Cliente Empresa (registrada 2026-06-11, scope chico)

**Origen:** Metrica 1.3 (NPS Cliente Empresa) cierre, 2026-06-11. Toda la infraestructura de captura esta construida y operativa:

1. Modelo `EncuestaNPSEmpresa` (13 columnas, 4 indexes).
2. Cron disparador `/api/cron/nps-empresa/route.ts` (167 lineas) listo para ejecutar.
3. Template email `enviarMailEncuestaEmpresa` en `lib/mailer.ts` con grilla 0-10 color-coded.
4. Endpoint voto `/api/nps-empresa/route.ts` (GET + POST) operativo, whitelistado en proxy.
5. Pagina publica `/encuesta-nps-empresa` con form de 5 preguntas + 6 estados client-side.
6. Endpoint Torre `/api/torre-de-control/nps-cliente-empresa` + Card 13 + modal en dashboard.

**Estado actual:** Metrica 1.3 V1 funciona via seed sintetico. Falta activar el cron en programador (Vercel cron, Railway, CronJob, etc.) para disparo automatico trimestral.

**Plan de resolucion:**

1. Configurar `CRON_SECRET` en variables de entorno de produccion (no esta en `.env` local).
2. Configurar scheduler para invocar `GET /api/cron/nps-empresa` con header `Authorization: Bearer ${CRON_SECRET}` el primer dia de cada trimestre (1 enero, 1 abril, 1 julio, 1 octubre).
3. Decision sobre backfill historico: NO (consistente con DEUDA 59 para NPS Comprador). Solo entregas a partir de la activacion.
4. Validar que `APP_URL` este configurada en produccion (el cron usa `getAppUrlOrThrow()` para generar links del email).
5. Monitorear primer disparo: verificar logs + contar encuestas creadas + verificar emails entregados.
6. Documentar para el equipo de operaciones.

**Casos de uso desbloqueados:**

- Metrica 1.3 recibe data real continua cada trimestre sin seed sintetico.
- Cliente Shipro obtiene voz cuantitativa de cada empresa cliente cada 3 meses.
- Detectar empresas en riesgo de churn (NPS bajo + sin mejorias trimestre a trimestre).
- Detectar fortalezas para usar en marketing (testimonios de promotores con consentimiento).

**Prioridad:** Media. La infraestructura ya esta lista 100%. Solo falta activacion en programador.

**Estimado:** 1-2 horas (configuracion en infra + primer test + monitoreo + documentacion).

**Adicional opcional (registrar como DEUDA 61 si se quiere):** endpoint admin `/api/admin/nps-empresa/disparar` para reenvio manual override (en caso de querer pedir feedback fuera de ciclo a una empresa especifica, o reenviar a un usuario que reporta no haber recibido el email).

---

## DEUDA 61 — Bugs preservados en Mapa SLA durante migracion legacy → endpoint dedicado (registrada 2026-06-12, scope medio — PARCIAL al 2026-06-17: BUG 1 resuelto incidentalmente en Phase 2.1 commit 14e5516, BUGs 2 y 3 siguen preservados)

**Origen:** Metrica 12 (Mapa SLA) migracion del legacy `/api/metricas` a endpoint dedicado `/api/torre-de-control/mapa-sla`, 2026-06-12. Decision del director: "Opcion A — migracion pura sin corregir bugs preservados". Los 3 bugs siguientes se mantienen identicos al legacy para no alterar numeros visibles durante la migracion arquitectonica.

**Adicional importante:** durante la migracion el director identifico que la logica legacy de medicion del SLA usaba el primer hito (entrega exitosa O visita fallida) como `fechaHitoSla`. En el mercado argentino los couriers actualizan estados virtualmente para mantener SLA artificial sin sacar el paquete a distribuir. Por eso el nuevo helper mide hasta entrega real (`fechaEntrega`), que es la verdad operativa. Esta decision NO es bug, es mejora consciente que cambia el significado del campo `slaHealthIndex` post-migracion.

**Bugs preservados (NO corregidos en V1):**

### BUG 1 — Key mismatch en diccionarioSlas

El cron `metricas-sla` pre-computa SLA por `provinciaDestino` raw ("Buenos Aires", "Cordoba"). La logica de calculo en `calcularMapaSLA()` usa `zona normalizada` ("Buenos Aires", "CABA" despues del mapeo `normalizarZona()`). El diccionario `SlaCourier` espera `zonaNombre` ("Interior 1", "AMBA", "Patagonia"). La clave buscada es `${courierId}-${zona}` donde zona es el resultado del normalizador. Resultado: el `diccionarioSlas.get()` raramente matchea y se aplica el fallback `meta = 5 dias` para la mayoria de los envios.

**Impacto:** el `slaHealthIndex` actual usa meta=5d casi siempre, por lo que el indice esta calculado contra una meta uniforme en lugar de la pactada por courier+zona.

**Plan de correccion:** unificar el sistema de zonas. Opciones:

1. Normalizar `SlaCourier.zonaNombre` para coincidir con la normalizacion de `calcularMapaSLA` (cambio en BD).
2. Refactorizar `normalizarZona()` para producir las mismas zonas canonicas que `SlaCourier.zonaNombre` ("Interior 1", "AMBA", "Patagonia").
3. Cargar mapeo provincia → zona canonica desde tabla maestra (mas mantenible).

Opcion 3 es la mas robusta pero requiere mas trabajo.

### BUG 2 — metaPactada sobrescribe en mapaZonas

En el loop por envio, si una zona tiene multiples couriers con metas distintas, la asignacion `desgloseZonas[zona].meta = meta` (linea 152) sobrescribe la meta del envio anterior. La zona reporta solo la meta del ultimo courier procesado, no un promedio o desglose.

**Impacto:** si una zona tiene Courier A con 3 dias pactados y Courier B con 5 dias pactados, la zona en el mapa puede reportar 3 o 5 dependiendo del orden de iteracion.

**Plan de correccion:** cambiar `desgloseZonas[zona]` a mantener un mapa `meta -> count` para reportar la meta dominante (mayor cantidad de envios) o exponer un objeto `metasPorCourier` con desglose completo.

### BUG 3 — Tabla MetricaSLA pre-computada ignorada

Existe modelo `MetricaSLA` con campos `courierId + provinciaDestino + slaPromedioHs + muestraEnvios` que es poblado por el cron `metricas-sla` con calculos pre-procesados sobre ventana 90 dias. El endpoint legacy y el nuevo helper recalculan on-the-fly en lugar de leer esta tabla.

**Impacto:** queries lentas en datasets grandes. Trabajo redundante en cada request al endpoint Torre. La tabla pre-computada existe pero no aporta.

**Plan de correccion:** modificar `calcularMapaSLA()` para leer de `MetricaSLA` cuando la query es analitica (lectura del Torre dashboard). Mantener el calculo on-the-fly solo para validaciones o calculos en tiempo real. Requiere alineacion con `MetricaSLA.provinciaDestino` (BUG 1 relacionado).

**Prioridad de DEUDA 61:** Media-alta. Los 3 bugs degradan la precision de la metrica pero no la rompen funcionalmente. El BUG 1 es el de mayor impacto porque distorsiona el `slaHealthIndex` global.

**Estimado:** 4-6 horas (BUG 1: 2-3h, BUG 2: 1h, BUG 3: 1-2h). Sugerencia: resolver BUG 1 y BUG 3 en conjunto porque comparten el sistema de zonas. BUG 2 es independiente.

**Adicional para validar:** despues de corregir BUG 1, verificar que el `slaHealthIndex` cambia significativamente con BD real. Si los numeros cambian mucho hay que comunicar a equipo operacional antes de pushear.

---

## DEUDA 62 — Sistema unificado scope-aware para metricas Panel cliente + Torre (Phase 1+2+4 ✅, Phase 3 pendiente)

**Status:** Abierta 2026-06-13. Phases 1 (5/5 Categoria A) + 2 (5/5 Legacy) + 4 (alpha/beta/g cleanup global) ✅ CERRADAS. Phase 3 (expansion Categoria B/C) PENDIENTE.

**Problema legacy:** Cada metrica tenia dos pipelines paralelos — Torre `/torre-de-control` consumia endpoints dedicados con guard `modoDios`, Panel cliente `/dashboard` consumia endpoint monolitico `/api/dashboard` con logic inline duplicada (432 lineas, 17 fields). Mantenimiento doble + risk divergencia + Panel no podia reutilizar la inteligencia del Torre.

**Patron resuelto:** Helper en `lib/utils/<metrica>.ts` con `calcular<X>Analitica(ctx, opts?)` que retorna discriminated union `{scope: "cliente" | "shipro"}`. Endpoint reducido a ~50 lineas delegando al helper. Panel cliente rebindeado a endpoint Torre unificado.

**Phases ejecutadas:**
- Phase 1 ✅ (5 metricas Categoria A): Fuga Ruteo, Desvio Peso, Efectividad 1ra Visita, Tiempos Colecta, Promesa Calibrada (commits 671feb3 a 47a704c).
- Phase 2 ✅ (5 metricas Legacy): Mapa SLA, Modalidades, NPS Comprador, Tickets Soporte, Concentracion Courier (commits 14e5516 a 4d5d30b).
- Phase 4 alpha ✅: cleanup global ~360 lineas (commit 294203b).
- Phase 4 beta + g ✅: refactor `/api/dashboard` → kpis-hero + lista-couriers helpers + endpoint `/api/torre-de-control/kpis-hero`, delete legacy endpoint, eliminacion filtros cosmeticos 3 modales (commit 6b8b75c, DEUDA 65 registrada).

**Phase 3 PENDIENTE:** expansion Categoria B/C — metricas adicionales al Panel cliente. Requiere decisiones de producto frescas sobre que metricas valen la pena. Estimado 5-7h.

**Arquitectura final post-Phases 1+2+4:**
- 10 helpers scope-aware en `lib/utils/` (concentracion-courier, desvio-peso, efectividad-primera-visita, fuga-ruteo, kpis-hero, lista-couriers, modalidades, nps, sla, tickets-mesa-ayuda).
- 10 endpoints Torre delegan a helpers.
- 0 endpoints legacy en `/api/dashboard/`.
- 1 filter WIRED en Panel (filtroTiempo Card 1 Hero KPIs).
- Cleanup neto Phase 4: -186 lineas en 2 commits (+451 / -637).

**DEUDAS proyectadas vinculadas:**
- DEUDA 53 (TicketSoporte.origen) — identificada Phase 2.4.
- DEUDA 61 (Mapa SLA bugs) — identificada Phase 2.1.
- DEUDA 65 (filtros funcionales) — registrada Phase 4.g.

---

## DEUDA 68 — Gaps de UI + endpoints para audit log de Empresa.* sensible fields (registrada 2026-06-17, scope chico)

**Origen:** DEUDA 19 Sub-paso 19.d.3 + 19.f.3 PRE-STEPs, 2026-06-17. Durante la implementacion del audit log de configuracion (DEUDA 19) se detectaron 2 gaps:

**Gap 1 — Endpoints faltantes para campos sensibles de Empresa:**
- `Empresa.modalidadPago` — sin endpoint que lo mute.
- `Empresa.limiteDescubierto` — sin endpoint que lo mute.
- `Empresa.modeloAHabilitado` — sin endpoint que lo mute.

Los 3 campos estan en `CAMPOS_AUDITABLES` (lib/auditoria-configuracion.ts) listos para auditarse, pero ningun endpoint los muta hoy. Probablemente se manejan via Prisma Studio o SQL directo. Cuando se construyan los endpoints (probablemente como parte de DEUDA 17 onboarding wizard o DEUDA 22 suspension auto), agregar `registrarCambioConfiguracion` para activar el audit.

**Gap 2 — UI page para rotacion de API Key del cliente:**
- Backend `/api/empresa/api-key` GET + POST listos con audit log integrado (DEUDA 19 Sub-paso 19.d.2).
- Frontend page para que `gerente_cliente` pueda rotar su API Key NO EXISTE.
- Hoy la rotacion solo es posible via Postman/curl.

**Plan de resolucion:**
- Gap 1: agregar endpoints PUT/PATCH cuando se prioricen (durante DEUDA 17 o DEUDA 22).
- Gap 2: crear `app/(dashboard)/configuracion/api-key/page.tsx` durante DEUDA 17 onboarding wizard (logico fit ya que el gerente_cliente necesita su API Key al integrar e-commerce).

**Por que no se cierra en DEUDA 19:** scope creep — DEUDA 19 era audit log, no construir endpoints/UI faltantes. La infraestructura de audit esta lista para esos casos cuando se construyan.

---

## DEUDA 65 — Cablear filtros funcionales en 3 modales analiticos (registrada 2026-06-16, scope medio)

**Status:** Registrada en commit 6b8b75c (Phase 4.g de DEUDA 62). NO INICIADA. Requiere decisiones de producto antes de implementar.

**Origen:** Descubierta durante Phase 4.f.e verification cuando director observo que cambiar dropdowns no producia efecto. Auditoria revelo 4 filter states cosmeticos sin cableo (0 fetch URL refs, 0 useEffect deps, 0 .filter() calls). Phase 4.g elimino los 4 states + JSX wrappers (~50 lineas cleanup). `filtroTiempo` Card 1 preservado (unico WIRED).

**Modales afectados:** Fuga por Ruteo, Desvio Financiero por Peso Volumetrico, Efectividad de Entregas en 1ra Visita.

**3 issues criticos detectados que bloquean implementacion quick:**

1. **Disconnect select options vs schema modalidad.** Select Fuga Ruteo ofrece "TODOS|domicilio|sucursal" pero schema usa 8 modalidades canonicas (en `lib/utils/modalidades.ts`). El select NO cubre "Punto de Retiro" ni "e-locker" — envios quedarian invisibles al filtrar.

2. **Filtros no uniformes por modal.** Fuga Ruteo tiene 3 controles (dates + servicio + courier), Desvio Peso tiene 2 (dates + courier), Efectividad tiene 1 (dates). Cada modal requiere implementacion distinta.

3. **Encoding strings con tilde.** Legacy "Estándar" (tilde) vs "Estandar" (sin tilde) no matchearian exactos en `contains`. SQLite case-sensitive sin `mode: "insensitive"`. Bug sutil potencial.

**Decisiones de producto requeridas up-front:**
1. Mapping select options UI vs schema modalidad (agregar Punto de Retiro + e-locker, mantener invisibles, o reemplazar con multi-select de 8 buckets canonicos).
2. Encoding tildes consistente (normalizar `Envio.modalidad` en DB via migration o en runtime via normalizer).
3. Backend re-fetch vs client-side filter (re-fetch con query params nuevos vs filter in-memory).
4. State namespacing per-modal (`filtroFugaRuteoDesde`, etc) vs antipatron shared.

**Helpers afectados (si se cablea backend):** `fuga-ruteo.ts`, `desvio-peso.ts`, `efectividad-primera-visita.ts` — extender signature a `(ctx, opts: {ventanaDias?, dateRange?, courier?, modalidad?})`. Endpoints aceptarian query params nuevos preservando defaults backwards-compat.

**Estimado:** 180-240 min con decisiones de producto claras up-front.

**Prioridad:** Media. No bloquea funcionalidad core (Card y metricas funcionan sin filter), pero degrada UX si director espera analisis profundo via filtros.

---

## DEUDA 66 — Postgres migration para produccion (BLOCK 1.1, registrada 2026-06-24, PARCIAL 2026-07-01: infra local + schema + Decimal RESUELTOS, falta Pieza 5 Linode)

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

## DEUDA 69 — Audit log de cambio de password (registrada 2026-06-23, scope chico)

**Status:** ABIERTA. Detectada durante implementacion DEUDA 17.E.1 (`/api/onboarding/cambiar-password`).

**Origen:** Claude Code observo durante 17.E.1 que el endpoint cambia `Usuario.password` sin pasar por `registrarCambioConfiguracion`. Razon de no implementarlo en el momento: scope creep — DEUDA 17 era wizard onboarding, no extender audit log. Decision explicita del director: registrar como deuda separada.

**Trabajo:**
- Agregar `passwordUsuario` a `CAMPOS_AUDITABLES` en `lib/auditoria-configuracion.ts` con `sensible: true`.
- Modificar POST `/api/onboarding/cambiar-password` para llamar `registrarCambioConfiguracion` post-update.
- Valor anterior y nuevo NO se loggean (solo el evento + timestamp + usuario + IP).

**Estimado:** 30 min.

**Prioridad:** Baja. Security audit de baja prioridad — sin audit, el incidente queda sin trazabilidad, pero el log de Next.js capta el endpoint hit.

---

## DEUDA 70 — `$transaction` para Empresa+Usuario updates en /api/onboarding/confirmar-datos (registrada 2026-06-23, scope chico)

**Status:** ABIERTA. Detectada durante implementacion DEUDA 17.E.2.

**Origen:** El endpoint hace 2 updates separados (Empresa + Usuario) sin envolver en `prisma.$transaction`. Si Empresa update succeed y Usuario falla, queda inconsistencia (razon social actualizada pero gerente nombre no).

**Trabajo:**
- Envolver `prisma.empresa.update` + `prisma.usuario.update` en `prisma.$transaction([...])`.
- Validacion: ambos updates atomicos o ninguno.
- Mantener audit log calls separados (ejecutar despues del transaction success).

**Estimado:** 30 min.

**Prioridad:** Media. Baja probabilidad de ocurrencia (DB local SQLite, Postgres en futuro), pero buena practica defensiva.

---

## DEUDA 71 — Guardar credenciales courier automaticamente al finalizar wizard (registrada 2026-06-24, scope medio)

**Status:** ABIERTA. Detectada durante DEUDA 17.E.4.4 (paso 4 wizard).

**Origen:** El paso 4 del wizard embebe `TransportesTab` con prop `embeddedInWizard=true`, lo que oculta el boton "Guardar Credenciales" interno. El cliente puede activar couriers (toggle activo=true) pero las credenciales que cargue (Andreani user/pass, Mocis API key) NO se guardan al hacer click en "Finalizar onboarding" — solo se guarda el flag `activo`.

**Impacto UX:** Cliente termina onboarding con couriers "activos" pero sin credenciales validas. Debe ir a `/configuracion/transportes` post-onboarding a cargar credenciales antes del primer envio.

**Mitigacion actual:** Mensaje en paso 4 paso al cliente "Las credenciales podes cargarlas ahora o mas tarde" + redirect manual post-wizard.

**Trabajo:**
- Extender `TransportesTab` con callback `onSaveCouriers: (couriers: CourierConfig[]) => Promise<void>` que devuelve el estado interno al wrapper.
- En el wizard, antes de llamar `/api/onboarding/finalizar`, llamar `POST /api/configuracion/couriers` con el state actual.
- Si falla el POST de couriers, mostrar error y NO finalizar (no marcar `onboardingCompletado=true`).

**Estimado:** 60-90 min.

**Prioridad:** Media-alta. UX flow incompleto. Cliente puede llegar al dashboard sin couriers funcionales y confundirse.


---

## DEUDA 72 — Motor de actualizacion masiva de fees Modelo B (registrada 2026-06-25, scope medio)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10. Post-launch, NO bloqueante.

**Problema:** El `OperacionFee` (DEUDA 10) tiene estructura fee base + override por empresa. Algunos clientes Modelo B tendran un fee personalizado (tipicamente un descuento, temporal o indefinido). Cuando Shipro decida aumentar el fee estandar, hace falta propagar el cambio SIN tocar cliente por cliente, respetando los overrides/descuentos personalizados vigentes.

**Pendiente de resolver:** politica de propagacion (¿el aumento del base se aplica solo a quienes estan en estandar? ¿los descuentos personalizados se recalculan proporcionalmente o se respetan tal cual? ¿los descuentos con fecha de caducidad vuelven al nuevo base al vencer?).

**Vinculo:** DEUDA 10 (OperacionFee). DEUDA 10 deja solo la estructura de datos; el motor de propagacion es esta DEUDA.

---

## DEUDA 73 — Completar formula de precio: seguro + descuento del cliente (registrada 2026-06-25, scope medio)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10 (discovery de `lib/cotizador.ts:170-176`). Post-launch, NO bloqueante (salvo que un piloto lo requiera).

**Problema:** Hoy `calcularPrecios()` en `lib/cotizador.ts` implementa solo: `tarifa_courier + fee_shipro (ajusteTarifaPorcentaje % + markupFijo) + IVA`. Faltan dos terminos de la formula de negocio completa:

1. **Seguro:** existe el flag `CredencialCourier.requiereSeguro` (Boolean) y `Paquete.requiereSeguro`, pero NINGUN codigo suma un cargo de seguro al precio. El flag esta desconectado del calculo. Falta una tasa (ej: % sobre `valorDeclarado`) que se sume cuando `requiereSeguro=true`.

2. **Descuento del cliente sobre la tarifa publicada:** lo aplica el e-commerce sobre lo que le cobra a SU comprador final (ej: subvencionar 50% el envio por estrategia, o sumar 3% por cuestion financiera). Es un campo CON SIGNO (negativo=subvencion, positivo=recargo). NO existe hoy. **OJO:** es DISTINTO del descuento de Shipro sobre su propio fee (capa onboarding, Shipro→cliente). Este es capa cliente→comprador.

**How to apply (estimado):** agregar campos a `CredencialCourier` (tasa seguro + descuento cliente con signo) + extender `calcularPrecios()`. Mecanicamente simple (la funcion es una linea), pero es decision de producto el orden de aplicacion de los terminos.

**Nota de diseño:** DEUDA 10 guarda el precio CRUDO del courier en HistoricoCotizaciones y re-aplica markup al leer (D-10-PRICE-STORE). Por eso, cuando DEUDA 73 se implemente, el fallback aplicara seguro+descuento igual que una cotizacion normal, sin trabajo extra.

**Conocimiento de dominio — el seguro por courier (aportado 2026-06-25):** cada courier maneja el seguro distinto y de forma inconsistente:
- **Andreani (via integracion):** pasa tarifa + seguro en UN SOLO numero (sin IVA discriminado). El seguro cubre hasta $4.500.
- **Andreani (lo que Mocis nos factura):** Mocis nos presta sus credenciales, asi que la factura/liquidacion REAL viene de Mocis, NO de Andreani. Mocis nos factura tarifa +10% sobre la de la integracion Andreani, y un seguro fijo de $90/etiqueta (+$80 sobre el que Andreani pasa por integracion).
- **Mocis (via integracion):** NO discrimina el costo del seguro; segun ellos esta incluido en su tarifa. Cobertura desconocida.
- **Otros couriers:** algunos mandaran el seguro en su tarifa, otros por separado, otros no lo mandaran.
- **Realidad operativa:** ningun seguro de courier garantiza nada (no aparece el paquete -> no lo resuelven).

**Decision de producto — Seguro Minimo Obligatorio (SMO):** normalizar todo esto definiendo un seguro fijo propio de Shipro (ej: $120/etiqueta), como UNA variable global actualizable con una sola accion para todos los clientes. Cubre los tres casos (seguro en tarifa, seguro separado, sin seguro) de forma uniforme. Se incorpora como termino "Seguro" a la tarifa publicada Y debitada. Reemplaza/normaliza la heterogeneidad de los seguros de courier. Es la pieza que hoy falta para que la tarifa publicada sea correcta.

**Vinculo con DEUDA 10:** el cobro Modelo B (DEUDA 10 Paso 4b) hoy debita costo courier + fee + IVA, SIN seguro. Cuando DEUDA 73 agregue el SMO, el debito y la tarifa publicada lo incluiran automaticamente (mismo punto de calculo).


---

## DEUDA 74 — Refresco obligatorio periodico de tarifaPlanaRespaldo (registrada 2026-06-25, scope medio)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10 (Paso 3). Post-launch, NO bloqueante.

**Problema:** La `tarifaPlanaRespaldo` (DEUDA 10, D-10-4) se carga obligatoriamente en el onboarding, pero puede quedar congelada e ir perdiendo vigencia con la inflacion. Un valor cargado hace un año puede estar muy desactualizado y, cuando el fallback lo use, publicaria un precio irreal.

**Solucion propuesta:** mecanismo tipo Home Banking — modal post-login que OBLIGA al gerente_cliente a revisar/actualizar su tarifaPlanaRespaldo cuando paso demasiado tiempo desde la ultima actualizacion (ej: cada 90-180 dias). Bloquea el acceso al dashboard hasta confirmar/actualizar el valor.

**Alcance estimado:** feature completa — toca login flow, estado de sesion (flag tipo "tarifaRespaldoVencida"), UI del modal, timestamp de ultima actualizacion en Empresa. Similar en espiritu al gate de onboarding (DEUDA 17) y al passwordTemporal.

**Vinculo:** DEUDA 10 (tarifaPlanaRespaldo). DEUDA 10 garantiza que el valor EXISTE (obligatorio en onboarding); DEUDA 74 garantiza que se mantiene VIGENTE.

**Por que no bloquea deploy:** al lanzamiento, todos los clientes recien cargaron su tarifa (esta fresca). El problema de vigencia recien aparece meses despues. Hay tiempo de sobra para construirlo post-launch.


---

## DEUDA 75 — Conciliacion tarifa virtual vs facturada + exclusion de no-recolectadas (Modelo A) (registrada 2026-06-25, scope grande)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10 (Paso 4). Post-launch, NO bloqueante.

**Contexto:** En Modelo A, la tarifa publicada al comprador es "virtual" (estimada al crear el envio). La tarifa REAL que Shipro factura al cliente se ajusta a fin de mes contra lo que el courier efectivamente facturo (via Excel/liquidacion del courier). Ademas, las etiquetas que el courier NUNCA recolecto NO se facturan (el courier tampoco se las facturo a Shipro).

**Problema:** Hoy no existe el motor que: (1) ajuste tarifa virtual -> facturada por envio, (2) excluya de la facturacion mensual las etiquetas no-recolectadas, (3) concilie contra la liquidacion del courier. Parte de la infra existe (FinanzasEnvio.costoCourierFacturado, costoCourierEsperado, estadoAuditoria; ruta /api/conciliacion; "Escudo Tarifario") pero el flujo completo no esta cerrado.

**Vinculo:** DEUDA 10 publica la tarifa virtual de fallback; DEUDA 75 la concilia a fin de mes. Probablemente se cruza con el sistema de conciliacion existente — revisar antes de construir.

**Por que no bloquea deploy:** la facturacion mensual ocurre semanas despues del primer envio. Hay tiempo de construirlo post-launch.

---

## DEUDA 76 — Metrica de fuga: etiquetas creadas vs entregadas al courier + reclasificacion de fee (registrada 2026-06-25, scope medio-grande)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10 (Paso 4). Post-launch, NO bloqueante.

**Problema:** Un cliente Modelo A podria crear etiquetas en Shipro (usando la tecnologia) pero despachar los paquetes por afuera con otro courier, sin que esas etiquetas se recolecten ni facturen. Shipro absorbe el costo de esas etiquetas sin ingreso.

**Solucion propuesta:** medir el ratio etiquetas_creadas vs etiquetas_entregadas_al_courier (o facturadas) por cliente. Si el ratio de fuga es bajo, se absorbe (costo operativo normal). Si es alto (indicio de uso de tecnologia + despacho externo), reclasificar a ese cliente para cobrarle el fee de Shipro + impuestos como si fuera Modelo B (cobro por uso de tecnologia).

**Vinculo:** DEUDA 10 (OperacionFee da el mecanismo de cobro de fee); DEUDA 72 (motor de fees); DEUDA 75 (datos de recoleccion/facturacion alimentan esta metrica).

**Por que no bloquea deploy:** es una optimizacion de monetizacion que requiere meses de datos de envios reales para detectar patrones de fuga. No tiene sentido antes de tener volumen.


---

## DEUDA 77 — Limite de operaciones al descubierto + aviso de saldo bajo (registrada 2026-06-25, scope medio)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10 (Paso 4b). Post-launch, NO bloqueante.

**Contexto:** Hoy la suspension de cuenta (DEUDA 22) se dispara por umbral de MONTO (saldoActivo <= -(limiteDescubierto * 1.5)). Para un cliente PREPAGO (Modelo B) que opera en descubierto, ese umbral es poco comunicable: el cliente no sabe cuantas operaciones mas puede hacer antes de que lo suspendan.

**Solucion propuesta (2 partes):**
1. AVISO PROACTIVO de saldo bajo: cuando el saldo del cliente baja de cierto umbral, notificarle ("te quedan ~N etiquetas de saldo, carga para no frenar tus ventas"). Previene el 90% de las suspensiones sorpresa: el cliente recarga ANTES de quedarse sin credito.
2. LIMITE POR CANTIDAD de operaciones al descubierto (alternativa/complemento al umbral por monto): permitir hasta N operaciones en descubierto antes de bloquear, en unidades que el cliente entiende.

**Por que importa:** la premisa "la venta nunca se cae" choca con la suspension por falta de saldo. El aviso proactivo + el limite por cantidad dan al cliente la chance de recargar a tiempo, sin frenar ventas.

**Por que no bloquea deploy:** el limiteDescubierto bien calibrado en el onboarding (Paso 5 de DEUDA 10) sostiene la operacion mientras tanto. El aviso es una mejora de UX que se suma despues.

---

## DEUDA 78 — Flujo de recarga con comprobante + verificacion del operador (registrada 2026-06-25, scope grande)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10 (Paso 4b). Post-launch, NO bloqueante.

**Problema:** La recarga de saldo es 100% manual hoy: el cliente transfiere, manda comprobante por mail, un humano de Shipro verifica contra el banco y carga el saldo. El DELAY entre la transferencia y la carga puede ser de minutos (martes 11hs) o de ~63 horas (viernes 20hs -> lunes 9hs). En ese hueco, si el cliente se queda sin credito, su e-commerce NO PUEDE VENDER. Es un problema operativo critico: el cliente pierde ventas por un cuello de botella de Shipro con horario de oficina.

**Solucion propuesta:** flujo semi-automatizado donde el cliente sube el comprobante a la plataforma, queda en una bandeja de verificacion para el operador de Shipro, el operador confirma contra el banco y da OK, y la plataforma acredita el saldo. Mediano plazo: integracion bancaria para verificacion automatica.

**Mitigacion actual (sin construir esto):** limiteDescubierto calibrado para cubrir un fin de semana de operacion (Paso 5 onboarding) + aviso de saldo bajo (DEUDA 77). Con eso, el cliente opera en descubierto durante el hueco y no pierde ventas.

**Por que no bloquea deploy:** la mitigacion (descubierto + aviso) sostiene el lanzamiento. El flujo automatizado es la solucion correcta a mediano plazo, pero es un proyecto en si mismo (upload, bandeja de verificacion, audit, eventual integracion bancaria).


---

## DEUDA 79 — Cobro del fee de operacion en el desbloqueo posterior (registrada 2026-06-25, scope chico)

**Status:** ABIERTA. Identificada al cerrar DEUDA 10 (Paso 4b-ii-3). Post-launch, NO bloqueante.

**Contexto:** DEUDA 10 (D-10-FEE-CHARGE) cobra el fee Modelo B (PREPAGO) SOLO cuando se emite etiqueta REAL del courier, dentro del gate de debito de envio en `lib/envios/crear.ts`. Las etiquetas genericas/bloqueadas NO debitan nada (decision de producto 2026-06-25: el cobro espera a que haya etiqueta real).

**Problema:** cuando un envio bloqueado (BLOQUEADO_SALDO, BLOQUEADO_PARCIAL, etc.) se DESBLOQUEA despues — el operador o el flujo automatico genera la etiqueta real via `procesarEnviosBloqueados` (y sus variantes -deposito, -operatividad) — ese flujo HOY solo debita el costo del envio (tipo "DEBITO_ENVIO"), NO el fee de operacion. Para clientes PREPAGO, el fee deberia cobrarse en ese momento (es cuando recien se emite la etiqueta real).

**Solucion:** replicar la logica de D-10-FEE-CHARGE (calcularFeeOperacion + MovimientoFinanciero "DEBITO_OPERACION_FEE") dentro de los flujos procesar-bloqueados*.ts, en el punto donde generan la etiqueta real y debitan el envio. Reusa el helper `lib/utils/operacion-fee.ts` ya existente.

**Por que no bloquea deploy:** el camino directo (etiqueta real al crear el envio, courier funcionando) ya cobra el fee — cubre el caso normal mayoritario. El desbloqueo posterior es el caso secundario (courier caido al momento del alta, resuelto despues). El fee de esos casos se puede cobrar manualmente o con un ajuste hasta que se implemente. Scope chico: replicar un patron ya escrito en 3 archivos hermanos.


---

## DEUDA 80 — Que el gerente_cliente cargue su propia tarifaPlanaRespaldo (registrada 2026-06-25, scope chico-medio)

**Status:** ABIERTA. Identificada al cerrar DEUDA 10 (Paso 5). Post-launch, NO bloqueante.

**Contexto:** En DEUDA 10 (D-10-ONBOARDING-RESPALDO, Opcion A) la tarifaPlanaRespaldo la carga el admin de Shipro en el alta del cliente (`app/(dashboard)/clientes/page.tsx`). Responsabilidad del numero: Shipro.

**Propuesta (Opcion B diferida):** que el gerente_cliente cargue/edite su propia tarifaPlanaRespaldo desde su wizard de onboarding (`app/onboarding/page.tsx`) o su panel, para que ASUMA la responsabilidad del numero (si la tarifa de respaldo resulta baja cuando se usa, es decision del cliente).

**A resolver en el diseño:** (1) que la tarifa exista desde el alta igual (el admin pone una inicial, el cliente la ajusta despues); (2) que pasa mientras el cliente no la actualizo — se usa la del admin; (3) validacion en el wizard del cliente. Se cruza con DEUDA 74 (refresco obligatorio periodico).

**Por que no bloquea deploy:** la carga por admin (Opcion A) ya garantiza que la tarifa exista desde el dia uno. Que el cliente la maneje es una mejora de responsabilidad/autonomia, no un requisito de lanzamiento.


---

## DEUDA 81 — Fix seed command: alias `@/` no resuelve con ts-node crudo (registrada 2026-07-01, scope chico, dev-only)

**Status:** ABIERTA. Detectada durante DEUDA 66 smoke test (2026-07-01).

**Origen:** `package.json` declara `"prisma": { "seed": "npx ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts" }`. Al correr `npx prisma db seed` falla con `Cannot find module '@/lib/prisma'`. `prisma/seed.ts` importa `../lib/couriers/serviciosSoportados` que a su vez importa `@/lib/prisma` (alias de Next.js). ts-node crudo NO resuelve el alias `@/` porque `tsconfig.json` define `"paths"` pero NO `"baseUrl"`.

**Workaround conocido (para correr scripts ad-hoc con imports `@/*`):**

```
TS_NODE_BASEURL=./ npx ts-node -r tsconfig-paths/register --compiler-options '{"module":"commonjs","baseUrl":"./"}' <script>.ts
```

`tsconfig-paths` resuelve `@/lib/prisma` correctamente con esa combinacion. `tsconfig-paths` ya esta en `node_modules` (transitive dep) — no requiere install adicional en el corto plazo.

**Fix propuesto:**
- Actualizar el seed command en `package.json` a: `npx ts-node -r tsconfig-paths/register --compiler-options '{"module":"CommonJS","baseUrl":"./"}' prisma/seed.ts`.
- Agregar `tsconfig-paths` como `devDependency` explicita en `package.json` (evita que `npm prune` lo saque como transitive).

**Por que no bloquea deploy:** el seed es exclusivamente dev/local. En produccion el populate se hace via onboarding admin (no via seed script). Prioridad: baja, dev-only. Mientras tanto el workaround permite correr scripts que dependan de `@/` desde CLI.

---

## DEUDA 82 — `tipoCuenta`: default incorrecto (POSTPAGO) + falta logica direccional cliente/Shipro por valor (registrada 2026-07-01, scope medio)

**Status:** ABIERTA. Detectada en QA manual post-seed (2026-07-01), logueado como `cliente@demo.com` (`gerente_cliente`).

**Origen:** al activar un courier en Configuracion → Transportes, el `gerente_cliente` no puede setear el metodo de pago. Dos problemas: **(a) Default incorrecto** — `CredencialCourier.tipoCuenta` es `null` y cae a `Empresa.modalidadPago` cuyo default de schema es `POSTPAGO`; el intento de producto es que un cliente nuevo arranque en **PREPAGO** y opere ya. **(b) Permiso demasiado restrictivo** — `MATRIZ_PERMISOS.tipoCuenta = ["admin_shipro"]` (`lib/permisos.ts:53`, politica DEUDA 16) bloquea el campo por completo para el cliente; el selector se renderiza `disabled` (`components/configuracion/TransportesTab.tsx:323`).

**Modelo de producto correcto (definido por el usuario 2026-07-01):** dos ejes independientes con permiso **por valor**, no por eje.
- Eje credenciales: `propias` (cliente puede) ↔ `de Shipro` (solo admin_shipro).
- Eje metodo de pago: `prepago` (cliente puede) ↔ `postpago` (solo admin_shipro).
- **Inmutabilidad direccional:** el cliente siempre puede volver a los valores de default (propias / prepago); solo Shipro puede habilitar los privilegiados (Shipro / postpago). Una vez que Shipro habilita un valor privilegiado, el cliente puede bajar a default pero no volver a subir solo. 4 combinaciones resultantes (propias+prepago default; propias+postpago; Shipro+prepago; Shipro+postpago).

**Nota de reuso:** el eje credenciales YA tiene esta logica (`usaCredencialesPropias @default(true)` + `Empresa.modeloAHabilitado` con inmutabilidad direccional A→B documentada en schema). La DEUDA es **replicar ese patron en el eje `tipoCuenta`** + corregir el default a PREPAGO. No inventar uno nuevo.

**Por que importa:** sin esto, un cliente nuevo no puede autoactivarse y operar — requiere intervencion manual de Shipro para cada alta. Bloquea el flujo de onboarding self-service.


---

## DEUDA 83 — Ruteo: dos pantallas divergentes leyendo de fuentes distintas (registrada 2026-07-01, scope medio)

**Status:** ABIERTA. Detectada en QA manual (2026-07-01).

**⚠️ Prerrequisito de abordaje:** NO implementar sin diagnostico exhaustivo previo. El ruteo es logica de negocio central del cliente (motor de decision de courier) y cruza con diseno ya consolidado — DEUDA 29 (arquitectura multicourier, `docs/ARQUITECTURA-MULTICOURIER.md`), las `ReglaRuteo`, y el patron de `condicionValor1/2`. Antes de tocar: mapear ambas superficies completas, que escribe/lee cada endpoint, y confirmar que ningun cambio rompa la evaluacion de reglas en el flujo de cotizacion/creacion de envios. Sesion dedicada, read-only primero.

**Origen:** existen **dos superficies de "ruteo" desconectadas entre si**. (1) El link del sidebar "Reglas de Ruteo" (`app/(dashboard)/layout.tsx:151`) apunta a `/couriers` (componente `ReglasLogisticas`), blindado solo para Shipro (`esEquipoShipro`, bloquea al cliente con "Acceso Restringido"). (2) La solapa Configuracion → Ruteo (`app/(dashboard)/configuracion/ruteo/page.tsx` → `RuteoTab`) si la ve el cliente, y lee de `/api/admin/reglas` + `/api/empresa/reglas`. Son URLs, componentes y endpoints distintos: por eso las reglas que se ven en una no aparecen en la otra.

**A resolver en el diseno:** definir cual es la fuente de verdad de reglas para el cliente y cual para Shipro, y si la solapa de Configuracion debe mostrar las reglas de la empresa (scope) en vez del catalogo admin. Cruza con DEUDA 84.

**Por que no bloquea deploy:** funcionalidad de configuracion avanzada, no el camino critico de crear envios. Prioridad media.


---

## DEUDA 84 — `/api/admin/reglas` sin gate de rol (SEGURIDAD) (registrada 2026-07-01, scope chico, seguridad)

**Status:** ABIERTA. Detectada durante el diagnostico de DEUDA 83 (2026-07-01).

**Origen:** `app/api/admin/reglas/route.ts` GET hace `prisma.reglaRuteo.findMany()` **sin `where`, sin `resolverContext`, sin chequeo de `x-rol`**. Devuelve **todas las reglas de ruteo de todas las empresas** a cualquier request que pase el check de sesion del proxy — incluido un `gerente_cliente`. Viola la politica defense-in-depth (`docs/POLITICAS-TECNICAS.md`): un endpoint bajo `/api/admin/*` debe validar `x-rol` aunque el proxy autentique la sesion. `RuteoTab` (que ve el cliente) consume este endpoint (`components/configuracion/RuteoTab.tsx:31`), o sea la fuga es alcanzable desde la UI del cliente.

**Fix propuesto:** agregar gate `x-rol === "admin_shipro"` al inicio del handler (ignorar/403 segun patron), o migrar el consumo del cliente a `/api/empresa/reglas` (scope-aware) y reservar `/api/admin/reglas` para Shipro.

**Por que importa:** fuga de datos entre clientes (reglas de ruteo de una empresa visibles a otra). Prioridad **alta** dentro de lo no-bloqueante — es seguridad, revisar antes de onboarding real de clientes.


---

## DEUDA 85 — Mesa de Ayuda no segmenta por cliente (a revisar) (registrada 2026-07-01, scope a definir)

**Status:** ABIERTA — **a revisar** (no confirmada como bug). Observada en QA manual (2026-07-01), logueado como `admin_shipro`.

**Origen:** la seccion "Mesa de Ayuda" no parece segmentar la vista por cliente/empresa. **Pendiente de confirmar si es bug o by-design** (puede que la mesa de ayuda sea global a proposito). No se inspecciono el codigo todavia.

**Proximo paso:** cuando se retome, verificar en codigo si Mesa de Ayuda deberia scopear por empresa (como el resto del Panel) o si es intencionalmente global. Registrar el diseno correcto recien ahi.

**Por que no bloquea deploy:** observacion sin confirmar. Prioridad baja hasta clarificar.


---

## DEUDA 86 — Typo "dias" → "dias" en Torre de Control (registrada 2026-07-01, scope trivial)

**Status:** ABIERTA. Detectada en QA manual (2026-07-01).

**Origen:** en un modal de Torre de Control (sin datos), el mensaje vacio dice "No hay direcciones en la ventana de 90 dias" — falta el acento en "dias" (deberia ser "dias" con tilde). String a corregir en el componente correspondiente (probablemente el modal de auditoria de direcciones / Torre de Control).

**Fix propuesto:** buscar el string `90 dias` (o `ventana de` / `dias`) en los componentes de Torre de Control y corregir el acento. Trivial.

**Por que no bloquea deploy:** cosmetico. Prioridad minima, buen "primer commit" de calidad.

## DEUDA 87 — Auditoria transversal de aislamiento entre clientes (registrada 2026-07-03, scope grande, seguridad)

**Status:** ABIERTA — auditoria en curso. Pass 1 (inventario) completo; pass 2 (verificacion por endpoint) iniciado.

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

## DEUDA 88 — Credenciales de servicios externos ausentes + verificar integraciones (registrada 2026-07-04, scope medio, entorno)

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

## DEUDA 89 — Verificacion en browser de DEUDA 87 FAMILIA 2 (cancelar/inversa) (registrada 2026-07-04, scope chico, encadenada a DEUDA 88)

**Status:** ABIERTA — ENCADENADA a DEUDA 88. El fix de FAMILIA 2 (commit de ownership en cancelar/inversa) se commiteo revisado + tsc 0, pero NO se pudo verificar funcionalmente en browser: `.env.local` vacio (Andreani no autentica) + empresa demo sin envios que cancelar.

**Testeo pendiente (hacer APENAS DEUDA 88 cargue credenciales + haya envios de prueba):**
- Cliente (`cliente@demo.com`) cancela un envio PROPIO desde dashboard → debe funcionar igual que antes.
- Cliente intenta cancelar un envio de OTRA empresa → debe dar 404 (sin filtrar existencia).
- Shipro (`admin@shipro.pro`) cancela cualquiera → debe funcionar (scope global).
- Idem para logistica inversa (`/inversa`).
- Confirmar que un llamador sin sesion recibe 401 en el proxy (ya no es DUAL).

**Por que importa:** cierra la verificacion del fix de seguridad. El codigo esta revisado y compila, pero "un fix que no se pudo probar no esta 100% terminado" — esta DEUDA existe para no olvidar ese ultimo paso.


---

## DEUDA 90 — Creacion manual de tickets por Shipro (preparado, no habilitado) (registrada 2026-07-06, scope chico)

**Status:** ABIERTA — preparado, deshabilitado a proposito. Decidido 2026-07-06.

**Contexto:** los tickets nacen por 3 vias: barrido automatico (>36h sin cambio de estado), estado de problema de envio, y creacion por el cliente (POST /api/tickets). Las 2 automaticas usan `prisma.ticketSoporte.create` directo heredando `empresaId` del Envio. El POST es hoy client-only: `empresaId` se estampa desde `resolverContext` (sesion del cliente), y un usuario shipro (`ctx.empresaId === null`) es RECHAZADO con 403.

**Extension futura (cuando se decida):** permitir que admin/operador_shipro creen tickets manualmente. Requeriria: quitar el rechazo de `ctx.empresaId === null` en el POST, permitir que shipro pase `empresaId` explicito en el body (con validacion de que la empresa existe), y un gate de rol. El punto exacto esta marcado con comentario en `app/api/tickets/route.ts` POST.

**Por que no ahora:** evitar complejidad operativa que todavia no se necesita. La restriccion es deliberada, no un olvido — el codigo lo documenta.

**Por que importa:** baja prioridad. Registrada para que la restriccion actual sea trazable y la extension sea un cambio consciente, no un descubrimiento.

## DEUDA 91 — Cablear el catálogo ServicioCourier al runtime de cotización (adapter integration) (registrada 2026-07-06)

**Tipo:** Arquitectura — continuación de DEUDA 32+37 (NO arquitectura nueva).
**Origen:** Detectada durante testeo post-migración (2026-07). Síntoma disparador: Moci's
cotiza "entrega en sucursal" que NO ofrece (y que ROMPERÍA la creación del envío si se
elige), y no se distingue "Same Day" de "Next Day".
**Estado:** PENDIENTE. Insumo de NotebookLM YA OBTENIDO (ver tablas de mapeo abajo).
Bloqueante parcial: falta confirmar los service id de Moci's (sub-tarea M-1).

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

## DEUDA 93 — Servicio de recolección tarifado del courier recolector (extensión de DEUDA 91) — registrada 2026-07-08

**Tipo:** Diseño de producto + modelo comercial. NO implementable aún — depende de información externa (Moci's).
**Relación:** Extensión de la DEUDA 91 (catálogo `ServicioCourier` cableado al runtime de cotización).
Es la "Cosa 2" que se separó de M-92: M-92 era la etiqueta combinada (ya resuelta); esta es la
**facturación** de la recolección.
**Estado:** DISEÑO. Bloqueada por respuesta de Moci's (ver "Preguntas para Moci's").
**Prioridad (Nacho):** Alta como diferencial comercial. No bloquea producción.

---

## El modelo (Nacho, 2026-07-08)

Cuando Shipro negocia con un courier para que actúe como **recolector para terceros**, ese
courier debe **crear y exponer un servicio específico de recolección**, con su propio código de
servicio y un **costo diferenciado** de cualquier otro servicio suyo.

**Definición arquitectónica clave:** el servicio de recolección **siempre opera con las
credenciales de Shipro**, nunca con las del cliente. Shipro es quien contrata la recolección con
el courier recolector; el cliente ni ve ni carga credenciales del recolector. (Esto es lo que
permite que el cliente elija recolector en el onboarding sin tener credenciales propias.)

## Modelo de costo y facturación (decisión: Shipro absorbe y refactura)

Se evaluaron dos caminos:
- (a) Tratar la recolección como un envío normal (con sus reglas de prepago/postpago, credenciales
  propias o de Shipro).
- (b) **Shipro asume el costo de la recolección y lo refactura.** ✅ ELEGIDA — menos compleja de
  implementar y comercialmente más clara.

**Ejemplo numérico (Nacho):**
- Moci's (recolector) le cobra a Shipro: **$1.500 + IVA** por recolección.
- Shipro refactura al cliente: **$2.000 + IVA** por recolección.
- Más el fee de operación de Shipro: **$1.600 + IVA**.
- (El envío del entregador y el seguro se facturan por separado, ver abajo.)

## Descomposición de la tarifa publicada (cuatro conceptos)

Cada operación se descompone en servicios facturables independientes:

| Concepto | Quién factura | Notas |
|---|---|---|
| **Recolección** | El courier recolector (a Shipro) → Shipro refactura al cliente | Servicio especial, credenciales de Shipro |
| **Entrega** | El courier entregador | Puede ir con credenciales del cliente o prestadas por Shipro |
| **Tecnología** | Shipro | Fee de operación |
| **Seguro** | El seguro | Cuando aplica |

Todo se **publica como tarifa** al cliente: sumando IVA y restando el descuento del cliente si
corresponde. El débito se hace de la **cuenta corriente** según el modelo y la matriz de
prepago/postpago ya diseñados (DEUDA 16 + bloque 72-80).

## Qué hay que construir (cuando Moci's responda)

1. **Catálogo:** un código de servicio canónico nuevo en `lib/couriers/serviciosSoportados.ts`
   para la recolección para terceros (ej. `recoleccion_terceros`), con su `capacidadTecnicaMapeada`
   por courier. Extiende el registry de la DEUDA 91.
2. **Adapter:** el `MocisAdapter` (y futuros recolectores) debe poder cotizar/despachar ese
   servicio específico con su código, usando credenciales de Shipro (no del cliente).
3. **Cotizador:** cuando el par (depósito × entregador) tiene `recogeViaConsolidador=true`, sumar
   el costo de recolección del recolector a la cotización, como línea separada.
4. **Precio:** aplicar el markup de refacturación (costo del recolector → precio al cliente),
   respetando la fórmula de precio existente (DEUDA 73: seguro + descuento).
5. **Facturación / cuenta corriente:** debitar la recolección como concepto propio, distinguible
   del fee de operación y del envío. Reusar la matriz prepago/postpago.
6. **UI:** que el cliente vea el desglose (operación + recolección + envío + seguro, todo + IVA).

## Preguntas para Moci's (bloqueantes — mandarlas para destrabar)

1. ¿Pueden exponer un **servicio específico de recolección para terceros** en su API? ¿Con qué
   `service` ID numérico? (Recordar: Moci's/Akeron rutea por parámetro `service`; hoy la doc solo
   define un genérico `service: 1`.)
2. ¿Cuál es la **tarifa** de ese servicio? ¿Es por retiro (flat), por bulto, por peso, o mixta?
3. ¿Se **factura por separado** del envío, o viene incluido en la liquidación general?
4. ¿El servicio de recolección genera su **propio tracking** (como el 0000125551 del envío de
   prueba), o se asocia al del entregador?
5. ¿Hay mínimos, ventanas horarias o zonas donde no prestan el servicio de recolección?

> Nota: también queda pendiente la sub-tarea **M-1** de la DEUDA 91 (confirmar los service IDs de
> Same/Next Day de Moci's) y **A-1** (confirmar el contrato express de Andreani). Conviene mandar
> todas las preguntas juntas.

## Visión de negocio (contexto)

El trabajo comercial de Shipro es **convencer a los couriers de transformarse también en
"couriers recolectores" para terceros**. Cada courier que acepta ese rol amplía la red: permite que
clientes fuera del área de cobertura directa de un entregador puedan igual usarlo, consolidando en
el hub del recolector. Es un diferencial de la plataforma.

**Del lado de Shipro (onboarding del courier):** en el alta del courier, el admin marca que también
es "courier recolector" (`puedeConsolidar=true` + `cpDepositoConsolidador`). Por API se consume su
tarifa de recolección.

**Del lado del cliente (onboarding del cliente):** el cliente activa el servicio de recolección
eligiendo **uno** de los "couriers recolectores" disponibles, y eso impacta en todos los couriers
entregadores que active (les desplaza el CP de origen al hub del recolector). Ver DEUDA 36.E.

## Relación con otras DEUDAS

- **DEUDA 91** (padre): el catálogo `ServicioCourier`. Esta es su extensión al servicio de recolección.
- **DEUDA 36.E**: el eje ACTIVACIÓN/COBERTURA (dónde opera cada courier). Esta es el eje FACTURACIÓN.
  No confundir: la 36.E ya resolvió *que* el recolector recolecte; esta resuelve *cuánto cuesta y
  quién factura qué*.
- **DEUDA 73** (fórmula de precio: seguro + descuento) y **DEUDA 16 / 72-80** (matriz prepago/postpago,
  cuenta corriente): la recolección debe integrarse a esa fórmula y a ese débito.
- **DEUDA 13** (QR de Mocis en etiqueta de Andreani): resuelta en la práctica vía el zócalo de
  `etiquetas/masiva` — verificado 2026-07-08 con la etiqueta combinada (tracking recolección
  0000125551 + entrega 360003031154600).

  ## DEUDA 94 — POST /api/configuracion/couriers no es transaccional (activación + ficha) (registrada 2026-07-12, scope medio)

**Tipo:** Robustez / integridad de datos. ZONA SENSIBLE (activación de couriers + fichas).
**Status:** ABIERTA. Detectada durante DEUDA 36.E Diseño 2 Paso B (2026-07-12).

**Origen:** El endpoint de activación de couriers (`POST /api/configuracion/couriers`) hace varias
escrituras en secuencia — `empresa.update`, luego el loop de `credencialCourier.upsert` por cada
courier, luego (Paso B) el loop de `depositoCourierConfig.upsert` de las fichas — pero **NO están
envueltas en una `$transaction`**. A diferencia de `PUT /api/depositos/[id]`, que sí es atómico.

**Riesgo:** Si el proceso falla a mitad (ej. error de red, timeout, excepción entre el upsert de la
credencial y el de la ficha), puede quedar un estado inconsistente: un courier activado (`activo=true`)
pero sin su `DepositoCourierConfig` creada, o parte de los couriers procesados y parte no. El candado
de cobertura (Paso A) sí rechaza antes de escribir, así que el riesgo no es de cobertura inválida —
es de escritura parcial.

**Impacto:** Bajo en la práctica (las escrituras son rápidas y el fallo a mitad es raro), pero es una
grieta de integridad que conviene cerrar antes de escalar el volumen.

**Trabajo:**
- Envolver las escrituras del handler (empresa.update + upserts de credencial + upserts de ficha +
  audit) en una sola `prisma.$transaction([...])`, replicando el patrón atómico de `PUT /api/depositos/[id]`.
- Verificar que el audit log (DEUDA 19) siga funcionando dentro de la transacción.

**Por qué no se hizo en el momento:** convertir el endpoint a transaccional es un cambio más grande y
riesgoso que el Paso B en sí; se separó para no ampliar el alcance de un paso ya verificado. Prioridad:
media (integridad, no bloqueante).

---

## DEUDA 95 — Couriers mixtos por depósito: algunos vía recolector, otros directo (registrada 2026-07-12, scope grande, a pensar bien)

**Tipo:** Diseño de producto + modelo de datos. ZONA SENSIBLE (ruteo/consolidación).
**Status:** ABIERTA — DISEÑO PENDIENTE. Marcada por Nacho como "hay que pensarla bien antes de ejecutarla".

**Origen:** Durante DEUDA 36.E, Nacho identificó un caso que el modelo actual no cubre.

**El caso:** Hoy, cuando un depósito tiene un courier recolector, el modelo es **todos o ninguno**: el
CP de origen de TODOS los couriers entregadores se desplaza al hub del recolector. Nacho quiere que el
cliente pueda decidir, **por courier**, cuáles pasan por el recolector y cuáles van directo a buscar los
paquetes a su propio depósito.

**Por qué es difícil:** implica que el **CP de origen deje de ser único por depósito** y pase a ser
**por par (depósito × courier)**. Hoy el `cpOrigenEfectivo` se calcula una vez (depósito o hub del
recolector); este cambio lo vuelve una decisión individual de cada courier. Toca el cálculo de cobertura,
la creación de fichas, la cotización, y probablemente el modelo de datos (un flag por ficha que diga
"este va por el recolector" vs "este va directo").

**Trabajo (a diseñar, NO ejecutar aún):**
- Definir el modelo: ¿un flag `usaRecolector` por `DepositoCourierConfig`? ¿Cómo se refleja en la grilla?
- Cómo se recalcula la cobertura cuando cada courier puede tener un origen distinto.
- Impacto en cotización (cada courier cotiza desde un CP potencialmente distinto).
- UX: cómo el cliente elige esto sin que sea confuso (la grilla ya muestra estados; agregar un toggle
  por fila "vía recolector / directo").

**Prioridad:** media-baja. Es una mejora de flexibilidad, no un bloqueante. Requiere sesión de diseño
dedicada antes de tocar código (por la sensibilidad de la zona de ruteo).

---

## DEUDA 96 — Login: link "¿La olvidaste?" no funciona + falta el flujo de recuperación de contraseña (registrada 2026-07-12, scope grande)

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

## DEUDA 97 — Login: botón "Continuar con Google" es decorativo (Google OAuth no configurado) (registrada 2026-07-12, scope medio — decisión de producto primero)

**Tipo:** Funcionalidad faltante + decisión de producto. Puerta de entrada (login).
**Status:** ABIERTA. Detectada durante prueba del wizard (2026-07-12).

**Síntoma:** El botón "Continuar con Google" en el login no hace nada (o no inicia sesión).

**Alcance real (confirmado por diagnóstico):** Google OAuth **nunca se configuró**. NextAuth solo tiene
el `CredentialsProvider` (email/password); no hay `GoogleProvider`. El botón es puramente decorativo.

**Decisión de producto primero (antes de tocar código):** ¿Shipro **quiere** login con Google? No es
obvio que sí — los clientes son empresas con usuarios `gerente_cliente` creados por Shipro en el alta
(con email/password temporal). El login con Google implicaría que un usuario entre con su cuenta de
Google, lo que choca con el modelo actual de "Shipro da de alta al usuario". Puede tener sentido, o no.

**Dos caminos:**
- **Si NO se quiere:** sacar el botón (arreglo trivial, frontend). Evita prometer algo que no existe.
- **Si SÍ se quiere:** configurar `GoogleProvider` en NextAuth (client ID + secret de Google Cloud),
  decidir cómo se vincula una cuenta de Google con un `Usuario`/`Empresa` existente (matching por email),
  y qué pasa si alguien entra con un Google que no corresponde a ningún cliente dado de alta.

**Prioridad:** baja. Primero la decisión de producto; recién después, el trabajo técnico (que depende de
cuál sea la decisión). Mientras tanto, sacar el botón evita confundir al usuario.
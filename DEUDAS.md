# Deudas técnicas pre-producción Shipro

> **Fuente de verdad**: este archivo (DEUDAS.md). El agente Claude mantiene una memoria
> espejo en `~/.claude/projects/.../memory/deudas_pre_produccion.md` que se carga
> automáticamente al iniciar sesiones de trabajo. Si las dos versiones difieren, gana
> este. Al actualizar/resolver/agregar deudas, hacerlo acá; la memoria del agente se
> reconcilia desde acá en la próxima sesión.

Identificadas durante SUB-PASO 5 (proxy + dual auth) el 2026-04-28. A retomar antes o durante el deploy a producción en Linode.

## DEUDA 1 — `lib/envios/crear.ts`: catch del despacho deja estado "Pendiente"

Cuando falla el despacho al courier (catch del try/catch ~líneas 203-220 de `lib/envios/crear.ts`), el `estadoInicialEnvio` queda en `"Pendiente"`. Debería ser `"RETENIDO"` para que aparezca en la mesa de ayuda y un operador lo procese.

**Why:** sin ese cambio, los envíos con falla de courier se mezclan con los pendientes normales y no aparecen en la vista de retenidos del dashboard. Operadores no detectan la falla.

**How to apply:** fix de 3 líneas dentro del catch — setear `estadoInicialEnvio = "RETENIDO"`, `falloPorPeaje = true`, `motivoRetencion = "Falló el despacho al courier"`. Planificado para SUB-PASO 7 cuando ya estemos refactoreando ese archivo.

## DEUDA 2 — Caché de cotizaciones (post-prod)

`/api/cotizar` tarda ~5-6 segundos por llamada por la latencia agregada de las APIs de couriers (Andreani, Mocis, etc.). En el flujo del dashboard cada cotización es síncrona y bloqueante.

**Why:** UX pobre en `/cotizar` y `/cotizador-rapido`; a escala también costo de API hits.

**How to apply:** caché en memoria (Redis o LRU server-side) con clave `(empresaId, cpOrigen, cpDestino, peso, modalidad)` y TTL 5-10 min. Después de pasar a producción — no es bloqueante para deploy.

## DEUDA 3 — `crear.ts:251` self-fetch a `/api/cotizar` rompe con dual auth

Con el proxy actual, el self-fetch HTTP a `/api/cotizar` desde dentro de `crearEnvio` no manda ni cookie de NextAuth ni Bearer shipro_live_, entonces el proxy lo rechaza con 401. La métrica `fugaFinanciera` queda en 0 pero el envío se crea bien (está en try/catch aislado).

**Why:** funcionalmente no rompe la creación, pero perdemos la auditoría de fuga financiera, que es uno de los productos de valor de Shipro.

**How to apply:** SUB-PASO 7 del plan general — refactorear el self-fetch a llamada directa a la función `cotizar` (extraída a `lib/cotizador.ts` siguiendo el mismo patrón de `lib/envios/crear.ts`).

## DEUDA 4 — Módulo de Depósitos (CRÍTICA, bloqueante pre-producción)

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

## DEUDA 5 — Modelar correctamente los usuarios de Shipro (Importante pre-producción)

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

## Otras deudas menores (no críticas, registradas para no perderlas)

- **`obtenerCredencialesShipro` duplicado** en 4-5 archivos: `app/api/cotizar/route.ts`, `app/api/etiquetas/masiva/route.ts`, `app/api/cron/rastreo/route.ts`, `lib/envios/crear.ts`, posiblemente más. Centralizar en `lib/couriers/credenciales.ts`.
- **8 vulnerabilities** (`npm audit`) preexistentes desde el scaffold inicial de create-next-app. Revisar con `npm audit fix` después de SUB-PASOs.
- **Provincias duplicadas** en seed: tras correr `prisma db seed` quedan 44 provincias en lugar de las 24 reales de Argentina. Causa probable: diferencias de mayúsculas/acentos al cargar `prisma/data/codigos.csv`. Limpiar al re-seedear.
- **Dropdowns hardcoded** en `app/(dashboard)/etiquetas/page.tsx`, `app/(dashboard)/historial-manifiestos/page.tsx`, `app/(dashboard)/colectas/page.tsx`: listas de couriers `["Moova", "Andreani", "Correo Argentino", "Moci's", "Javit"]`. Tres de esos no están soportados por `CourierFactory` hoy. Reemplazar por fetch a la lista activa de couriers.
- **Comentario obsoleto** en `prisma/schema.prisma` línea 17: `<--- ¡ESTE ES EL CAMPO VITAL QUE FALTABA!`. Limpiar en una pasada de polish.
- **Página `/seguimiento/[tracking]` deprecada** vs `/s/[tracking]` (la nueva). Solo la referencia el mail de creación en `lib/envios/crear.ts`. Migrar el link del mail a `/s/...` y borrar la deprecada.
- **NextAuth `pages.signIn` flow**: si `authorize()` lanza Error con mensaje custom (ej: "Empresa deshabilitada"), NextAuth v4 devuelve genérico "CredentialsSignin" al frontend. Para mostrar el mensaje custom hay que mapearlo en `app/login/page.tsx`.

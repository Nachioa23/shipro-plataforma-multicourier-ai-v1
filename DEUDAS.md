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

## Otras deudas menores (no críticas, registradas para no perderlas)

- **`obtenerCredencialesShipro` duplicado** en 4-5 archivos: `app/api/cotizar/route.ts`, `app/api/etiquetas/masiva/route.ts`, `app/api/cron/rastreo/route.ts`, `lib/envios/crear.ts`, posiblemente más. Centralizar en `lib/couriers/credenciales.ts`.
- **8 vulnerabilities** (`npm audit`) preexistentes desde el scaffold inicial de create-next-app. Revisar con `npm audit fix` después de SUB-PASOs.
- **Provincias duplicadas** en seed: tras correr `prisma db seed` quedan 44 provincias en lugar de las 24 reales de Argentina. Causa probable: diferencias de mayúsculas/acentos al cargar `prisma/data/codigos.csv`. Limpiar al re-seedear.
- **Dropdowns hardcoded** en `app/(dashboard)/etiquetas/page.tsx`, `app/(dashboard)/historial-manifiestos/page.tsx`, `app/(dashboard)/colectas/page.tsx`: listas de couriers `["Moova", "Andreani", "Correo Argentino", "Moci's", "Javit"]`. Tres de esos no están soportados por `CourierFactory` hoy. Reemplazar por fetch a la lista activa de couriers.
- **Comentario obsoleto** en `prisma/schema.prisma` línea 17: `<--- ¡ESTE ES EL CAMPO VITAL QUE FALTABA!`. Limpiar en una pasada de polish.
- **Página `/seguimiento/[tracking]` deprecada** vs `/s/[tracking]` (la nueva). Solo la referencia el mail de creación en `lib/envios/crear.ts`. Migrar el link del mail a `/s/...` y borrar la deprecada.
- **NextAuth `pages.signIn` flow**: si `authorize()` lanza Error con mensaje custom (ej: "Empresa deshabilitada"), NextAuth v4 devuelve genérico "CredentialsSignin" al frontend. Para mostrar el mensaje custom hay que mapearlo en `app/login/page.tsx`.

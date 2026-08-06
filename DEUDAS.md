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

## DEUDA 8 — Vista de Calidad Postal (REFORMULADA 2026-06-02 — backend listo, UI pendiente)

**Status original (2026-04-28):** Descubierta durante SUB-PASO 6 como endpoint huérfano `/api/torre-de-control/route.ts`. PENDIENTE — decidir si borrar o reactivar.

**Status reformulado (2026-06-02):** El endpoint NO se borra. Computa 4 metricas estrategicas de Calidad Postal (tasa precision postal, tiempo resolucion retenciones, atribucion comprador vs operador, top 5 provincias con errores) que son valor pendiente de exponer en UI. Decision del director: Shipro es plataforma de datos — endpoints/logica de analitica NO se borran aunque no tengan UI activa hoy. Backend listo, construir vista UI cuando se priorice. La metrica de Calidad Postal forma parte del sistema integral Torre de Control (ver DEUDA 39).

**Detalle:** [app/api/torre-de-control/route.ts](app/api/torre-de-control/route.ts) existe pero nadie del dashboard lo llama. La página `app/(dashboard)/torre-de-control/page.tsx` fetchea `/api/clientes` y `/api/metricas`, no `/api/torre-de-control`. Posibles explicaciones: (a) endpoint planeado para una vista que se reemplazó por el flujo actual contra `/api/metricas`; (b) endpoint legado de un refactor anterior; (c) endpoint para un futuro consumidor externo.

**Cómo se cierra:** decidir entre dos caminos:
- **Borrar** `app/api/torre-de-control/route.ts` si no hay consumidor previsto (limpieza simple).
- **Mantener** y documentar el caso de uso si va a ser endpoint público (ej: API para un panel externo o app móvil).

Mientras se decide, la lógica está protegida por el mismo `resolverContext()` que el resto de las rutas, así que no representa un agujero de seguridad.

## DEUDA 10 — Manejo de fallas de courier para clientes Modelo B (Producto — importante pre-producción)

**Status:** NÚCLEO RESUELTO 2026-07-24. `OperacionFee` en schema + `calcularFeeOperacion` en `lib/utils/operacion-fee.ts` + Fee dentro de la tarifa publicada de ambas ramas (dentro de `montoDebito` en un solo `DEBITO_ENVIO`, vía commits 996142f + d850272 bajo la DEUDA 73). Cierra el último pendiente de FASE 2 de `docs/COMERCIALIZACION-CHECKLIST.md`. FOLLOW-UPS remanentes (no bloqueantes): cotización-por-similitud histórica para el fallback y UI para configurar el fee por-empresa en el onboarding.

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

**Status:** RESUELTA (FASE 1) 2026-07-24. Fórmula de precio completa: cascada intermediario+Shipro sobre netos, SMO por courier, Fee neto, IVA una vez al final, débito rama-aware (Rama A tarifa publicada completa / Rama B solo Fee), `precioFactura` congelado al alta + `costoAforo` separado en conciliación, dos vías de liquidación (Fee/Logística). Commits: 8d40f58 (IVA policy), 996142f (fórmula FASE 1), d850272 (débito rama-aware), d623b9d (aforo/conciliación), 0d6fd7b (dos-vías). FOLLOW-UPS menores (no bloqueantes): descuento del cliente con signo (paso 6 del modelo, capa cliente→comprador); rename cosmético `seguroFijoIntermediarioConIva` → sin-IVA; política de seguro por-courier (flag `quiereSeguroCourier` en schema pero adapters aún no lo consumen).

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

### DISEÑO FINAL FASE 1 (consolidado tras debate 2026-07-21)

**Fórmula objetivo (orden de los términos):**

```
  tarifaAPI (cruda, del caché — SIEMPRE pura, nada encima)
+ markup del intermediario   → SOLO si la cuenta NO es del cliente (Modelo A)
+ seguro (según modelo del courier — ver ANEXO seguro)
+ markup de Shipro
+ IVA (donde el courier no lo trae, ej. Andreani)
= precio que Shipro le debita al cliente (costo real Shipro→cliente)

+/- descuento/markup del cliente → capa cliente→comprador, SIN tope
= precio que ve el comprador final
```

**Decisión 1 — Descuento del cliente SIN guardrail.** El cliente puede aplicar el descuento que
quiera (monto fijo o %), incluso mayor que la tarifa, convirtiéndolo en plata que le regala a su
comprador. Es su estrategia comercial; Shipro NO la interrumpe. Vive en la capa cliente→comprador
(paso 6), separada del precio Shipro→cliente (paso 5). Son dos números que conviven.

**Decisión 2 — Markup del intermediario SOLO si la cuenta no es del cliente.**
- Cuenta del CLIENTE (Modelo B, usaCredencialesPropias=true): NO modelamos el markup de su
  intermediario — su trato con su proveedor no nos importa. Solo medimos su desvío declarado-vs-real.
- Cuenta de SHIPRO o de un courier-prestador (Modelo A, usaCredencialesPropias=false): SÍ modelamos
  el markup del intermediario — es costo real de Shipro, con impacto fiscal (IVA de esa transacción).

**Decisión 3 — El desvío declarado-vs-real se mide SIEMPRE** (sea cuenta de quien sea). Es la métrica
de fuga (DEUDA 76): el e-commerce declara peso/dimensiones que pocas veces se cumplen, y el courier
factura lo que efectivamente recibió. La diferencia entre lo cotizado y lo facturado es la fuga.

**Decisión 4 — SMO (seguro) configurable POR COURIER**, no global. Cada courier maneja el seguro
distinto (incluido en tarifa / porcentual sobre valor declarado / con su propio mínimo), así que la
config del seguro vive junto al courier. Ver ANEXO seguro abajo para los dos modelos.

**Decisión 5 — El caché (HistoricoCotizaciones) guarda SOLO la tarifa cruda.** Todo lo demás (markup
intermediario, seguro, markup Shipro, IVA, descuento) se aplica AL LEER, en el proceso. Así, si cambia
cualquier variable, el caché sigue siendo verdad y el resultado se recalcula correcto. Verdad pura
abajo, capas arriba. (Mismo patrón que DEUDA 10 ya estableció para el markup de Shipro.)

**Riesgo de implementación identificado (relevamiento 2026-07-21):** NO cambiar el significado de
`precioProveedor` (hoy = tarifa cruda). La conciliación (app/api/conciliacion/route.ts:60) lo lee como
costoEsperado. Si se le cambia el significado sin backfill, TODOS los envíos históricos parecerían
anomalías (falso SOBREPRECIO_RECLAMAR masivo). Solución: agregar campo NUEVO precioProveedorReal (=
tarifa + markup intermediario), que la conciliación prefiera cuando existe; precioProveedor legacy
queda intacto para el histórico.

**Modelo de datos que surge (a implementar en Fase 1, aún NO ejecutado):**
- Nuevo modelo CourierIntermediario 1:many a Courier: { courierId, nombreIntermediario,
  markupPorcentaje, seguroFijoIntermediarioConIva, tarifaIncluyeIvaIntermediario, activo,
  vigenciaDesde, vigenciaHasta?, notas }. Intercambiable por vigencias (Mocis→Intralog sin perder
  histórico).
- Config de seguro POR COURIER (en Courier o tabla asociada): modelo (INCLUIDO/PORCENTUAL), y según
  el modelo: tope de cobertura, o { porcentaje, mínimo, piso de valor declarado }.
- FinanzasEnvio + campos de desglose: tarifaCourierBase, markupIntermediarioAplicado,
  seguroAplicado, descuentoClienteAplicado, precioProveedorReal.
- CredencialCourier + descuentoClienteSobreTarifa (signed, capa cliente→comprador).

### ANEXO seguro — los dos modelos por courier (aporte de dominio 2026-07-21)

El seguro NO es un valor fijo: depende de cada courier. Dos modelos que el sistema debe representar:

**Modelo A — Seguro INCLUIDO en la tarifa (ej. Mocis):** el courier presenta la tarifa con el seguro
adentro ("$5.000, incluye cobertura hasta $50.000 ante siniestro"). No hay línea separada, no depende
del valor declarado. La tarifa API ya lo trae. Guardar (informativo) el tope de cobertura.

**Modelo B — Seguro PORCENTUAL sobre valor declarado (ej. Andreani):** porcentaje sobre el valor
declarado (ej. 0,7%), con mínimo obligatorio (ej. $10) y valor declarado mínimo obligatorio (ej. desde
$2.000). Cubre el 100% del valor declarado. Ejemplos: declarás $4.500 → $10 (mínimo); declarás
$100.000 → $700 (0,7%). Andreani NO manda IVA por API — hay que agregarlo.

**La capa del intermediario (cruza con DEUDA 107):** la cuenta de Andreani es de Mocis, así que ni la
tarifa ni el seguro que Andreani publica por API contemplan el markup de Mocis. Andreani "dice" $10 de
seguro; Mocis factura $90; Shipro cobra $121,50. Si no se incluye el markup del intermediario (en
tarifa Y en seguro), hay desfasaje publicado vs facturado SIEMPRE, sin importar si se factura a Shipro
o al cliente. Y como a Shipro se lo facturan, esa transacción lleva su IVA — costo real de Shipro.

**Checklist por courier antes de codear:** ¿tarifa incluye IVA? ¿seguro INCLUIDO o PORCENTUAL (%,
mínimo, piso)? ¿pasa por intermediario (markup % + fijo + IVA)? Para Andreani vía Mocis: confirmar la
regla exacta del mínimo y el piso de valor declarado obligatorio.

### REFINAMIENTO FINAL DEL SEGURO (debate 2026-07-21) — SIMPLIFICA EL SCHEMA

Conclusión clave: **Shipro NUNCA calcula el seguro porcentual. Siempre lo calcula el courier.** Shipro
controla el seguro mandando el `valorDeclarado`, y solo agrega valores FIJOS encima.

**El cliente elige (flag por credencial): ¿quiere el seguro del courier, sí o no?**

**Rama 1 — Cliente QUIERE el seguro del courier:**
- Shipro manda el `valorDeclarado` REAL → el courier calcula su seguro (cada courier con su propio %,
  por eso lo calcula él, no Shipro).
- Ese seguro viene SUMADO en la tarifa (ej. Andreani lo funde en el número que devuelve).
- Si la cuenta es de otro courier (Modelo A): se suma además el markup FIJO del intermediario (el
  $90 de Mocis — NO viene por API, lo define el dueño de la cuenta) + el markup de Shipro (nos
  facturan a nosotros, con su costo fiscal).

**Rama 2 — Cliente NO quiere el seguro:**
- Shipro manda `valorDeclarado` en 0 o un número irrisorio → el courier devuelve su seguro mínimo.
- Si la cuenta es de otro courier (Modelo A): igual se suma el valor FIJO que define el dueño de la
  cuenta + el markup de Shipro.

**Consecuencia para el schema (SIMPLIFICACIÓN):**
- NO se necesitan campos {porcentaje, mínimo, piso} por courier — Shipro no calcula %.
- Nuevo campo REAL necesario: un flag en CredencialCourier, ej. `quiereSeguroCourier` Boolean, que
  decide si se manda valorDeclarado real o mínimo al cotizar/despachar.
- Los valores fijos del intermediario YA están en el modelo CourierIntermediario
  (seguroFijoIntermediarioConIva). El markup de Shipro YA existe. No hay campos de seguro nuevos más
  allá del flag.
- (Informativo, opcional) topeCobertura por courier, solo para mostrar al cliente "cubre hasta $X".

**Riesgo de doble cobro (verificado en relevamiento 2026-07-21):** los adapters HOY no mandan
valorDeclarado al cotizar (sí al despachar). Andreani, sin valorDeclarado, igual mete su seguro
mínimo en el número que devuelve. Por eso el control es explícito: mandar valorDeclarado real (Rama 1)
o mínimo (Rama 2) para que el número del courier ya traiga el seguro correcto, y Shipro NO recalcule
sobre eso — solo suma los fijos. Nunca sumar un seguro Shipro-computado encima del que ya trae el
courier.

### MODELO COMPLETO DE PRECIO — DOS RAMAS (debate 2026-07-21, FINAL)

**Distinción esencial: TARIFA PUBLICADA vs DÉBITO.**
- TARIFA PUBLICADA = lo que ve y paga el COMPRADOR en el checkout. Incluye SIEMPRE el Fee de Shipro.
- DÉBITO = lo que Shipro le factura/cobra al CLIENTE (su usuario). Varía por rama.
- El Fee se cobra UNA sola vez: se muestra en la tarifa publicada y se cobra vía el débito. NO hay
  doble cobro (son flujos entre partes distintas: comprador→cliente y cliente→Shipro).

**RAMA A — Credenciales de Shipro/intermediario (Modelo A, usaCredencialesPropias=false):**

Tarifa publicada (la paga el comprador):

```
  Tarifa del courier (API)
+ Markup del intermediario (ej. Mocis +10% por prestar la credencial)
+ Markup de Shipro sobre la tarifa (cubre SUS costos fiscales/financieros — ver nota)
+ SMO de Shipro ($147,02 — ya con su margen del 35%)
+ Fee de Shipro ($1.600)
+ IVA de todo
+/- Descuento/markup del cliente (su herramienta, sin tope)
= Tarifa publicada
```

Débito (lo paga el cliente a Shipro): TODO lo de arriba (tarifa+Mocis+markup+SMO+Fee+IVA),
porque las credenciales son de Shipro: Shipro le paga al courier y le cobra todo al cliente.

**RAMA B — Credenciales del cliente (Modelo B, usaCredencialesPropias=true):**

Tarifa publicada (la paga el comprador):

```
  Tarifa del courier (API — ya incluye su propio SMO y costos)
+ Fee de Shipro ($1.600)
+/- Descuento/markup del cliente
= Tarifa publicada
```

Débito (lo paga el cliente a Shipro): SOLO el Fee de Shipro ($1.600 + IVA),
porque el courier le factura el flete directo al cliente. Shipro solo cobra su Fee por la plataforma.

**Nota — el markup de Shipro cubre su estructura fiscal/financiera.** Igual que el intermediario
(Intralog mostró que su markup del 10% se lo comen IIBB 3%, Impuesto al Cheque 1,2%, Seg. e Higiene
0,4%, Ganancias 30%, y financiación 45 días al 28% TNA — terminando en utilidad neta NEGATIVA), Shipro
tiene su propia estructura de costos sobre lo que factura. DECISIÓN (Opción A): NO se modela cada
impuesto en el sistema. Nacho calcula UN porcentaje (con su contador) que cubre impuestos+financiación
y deja el neto deseado, y lo carga como `ajusteTarifaPorcentaje` (campo YA existente). El sistema
guarda el número final, no la estructura fiscal. Regla de oro: el sistema guarda decisiones, no
calcula impuestos.

**Prepago vs Postpago:** no cambian los montos, solo el timing. Prepago debita al crear el envío;
Postpago factura y cobra a fin de mes. En ambos, el total facturado al cliente es el mismo por rama.

**Los dos markups de Shipro (bases distintas):**
- Sobre la tarifa del courier → `ajusteTarifaPorcentaje` (CredencialCourier), solo Rama A.
- Sobre el SMO → el 35% ya está fijado en el número $147,02 (smoPrecioAlClienteConIva). Dato fijo.

**Datos confirmados Andreani-vía-Mocis (2026-07-21):**
- Andreani factura a Mocis: $12,10 seguro (con IVA) — referencia.
- Mocis factura a Shipro: $108,90 seguro (con IVA) → seguroFijoIntermediarioConIva. Markup tarifa 10%.
- Shipro factura al cliente: $147,02 SMO (con IVA, margen 35%) → smoPrecioAlClienteConIva.
- Fee de Shipro: $1.600 + IVA (OperacionFee), en la tarifa publicada de ambas ramas.

**Implementación del Fee (riesgo de doble cobro — verificado 2026-07-21):** hoy OperacionFee se cobra
SOLO al debitar y SOLO en la rama PREPAGO/Modelo B (crear.ts:641-676), y NO aparece en la cotización.
Al llevarlo a la tarifa publicada de ambas ramas: MOSTRARLO en la cotización (aplicarMarkup) + cobrarlo
UNA vez vía el débito existente. Cuidado de no sumarlo dos veces. Para Modelo A: hoy no hay OperacionFee
cargado (Modelo A paga vía markup%); hay que asegurar que exista el Fee para que la fórmula lo encuentre.

### CRITERIO DE IVA + CASCADA + EJEMPLO NUMÉRICO (2026-07-21) — AJUSTA EL SCHEMA

**Criterio de IVA (CAMBIA un supuesto previo):** TODO se guarda y calcula SIN IVA. El IVA se aplica UNA
sola vez al final, sobre la suma de los netos. Razón: si la tarifa de Andreani viene sin IVA y todos
los demás costos son sin IVA, no tiene sentido mezclarlos con IVA para volver a sumar el IVA de la
tarifa. Se acumulan bases imponibles netas y el IVA es la sumatoria final.

**CONSECUENCIA — ajuste de schema pendiente:** el campo `seguroFijoIntermediarioConIva` guarda "con
IVA" ($108,90). Con el nuevo criterio debe guardar SIN IVA ($90). El nombre del campo quedó
engañoso. PENDIENTE (próxima sesión): renombrar a `seguroFijoIntermediario` (sin IVA) o similar +
migración, y cargar los valores SIN IVA (Mocis $90, SMO $121,50, Fee $1.600). NO cargar datos ni
escribir la fórmula hasta resolver esto.

**Markup en CASCADA (markup sobre markup):**
- Mocis aplica su 10% sobre la tarifa de Andreani: 10.000 → 11.000.
- Shipro aplica su 10% sobre el resultado de Mocis (11.000), NO sobre los 10.000 originales: → 12.100.
- Es cascada, no suma plana. Da $1.100 de margen de tarifa (no $1.000).

**EJEMPLO NUMÉRICO COMPLETO (caso de prueba de la fórmula) — verificado al centavo:**

```
LO QUE SHIPRO PUBLICA AL COMPRADOR (Rama A, Andreani-vía-Mocis):
  Tarifa: 10.000 (Andreani) +10% Mocis +10% Shipro (cascada) = 12.100,00
  SMO Shipro:                                                 =    121,50
  Fee Shipro:                                                 =  1.600,00
  Neto (sin IVA):                                             = 13.821,50
  IVA (21%):                                                  =  2.902,52
  TARIFA PUBLICADA:                                           = 16.724,02

LO QUE MOCIS LE FACTURA A SHIPRO:
  Tarifa 11.000 + SMO 90 = neto 11.090 + IVA 2.328,90 = 13.418,90

LO QUE ANDREANI LE FACTURA A MOCIS:
  Tarifa 10.000 + SMO 10 = neto 10.010 + IVA 2.102,10 = 12.112,10

MARGEN BRUTO DE SHIPRO POR ENVÍO: 2.731,50
  (tarifa 1.100 + SMO 31,50 + fee 1.600) — antes de impuestos de Shipro
```

**Cuando la fórmula esté escrita, este es el test:** tarifa cruda 10.000 de Andreani-vía-Mocis, con
markup Mocis 10%, markup Shipro 10%, SMO 121,50, fee 1.600 → debe dar 16.724,02 de tarifa publicada.

---

## DEUDA 74 — Refresco obligatorio periodico de tarifaPlanaRespaldo (registrada 2026-06-25, scope medio)

**Status:** ABIERTA. Identificada durante el diseño de DEUDA 10 (Paso 3). Post-launch, NO bloqueante.

**Problema:** La `tarifaPlanaRespaldo` (DEUDA 10, D-10-4) se carga obligatoriamente en el onboarding, pero puede quedar congelada e ir perdiendo vigencia con la inflacion. Un valor cargado hace un año puede estar muy desactualizado y, cuando el fallback lo use, publicaria un precio irreal.

**Solucion propuesta:** mecanismo tipo Home Banking — modal post-login que OBLIGA al gerente_cliente a revisar/actualizar su tarifaPlanaRespaldo cuando paso demasiado tiempo desde la ultima actualizacion (ej: cada 90-180 dias). Bloquea el acceso al dashboard hasta confirmar/actualizar el valor.

**Alcance estimado:** feature completa — toca login flow, estado de sesion (flag tipo "tarifaRespaldoVencida"), UI del modal, timestamp de ultima actualizacion en Empresa. Similar en espiritu al gate de onboarding (DEUDA 17) y al passwordTemporal.

**Vinculo:** DEUDA 10 (tarifaPlanaRespaldo). DEUDA 10 garantiza que el valor EXISTE (obligatorio en onboarding); DEUDA 74 garantiza que se mantiene VIGENTE.

**Por que no bloquea deploy:** al lanzamiento, todos los clientes recien cargaron su tarifa (esta fresca). El problema de vigencia recien aparece meses despues. Hay tiempo de sobra para construirlo post-launch.


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

**Status:** RESUELTA POR REFACTOR 2026-07-24. La premisa cambió: hoy el Fee va DENTRO de `precioFactura` en un SOLO `DEBITO_ENVIO` (rama-aware, congelado al alta, commit d850272). Los `procesar-bloqueados*` heredan ese `precioFactura` autoritativo con el Fee ya incluido, así que replicar un `DEBITO_OPERACION_FEE` separado en el desbloqueo ya no aplica — el modelo cambió y esta ruta desapareció. No hay trabajo pendiente.

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

# FAMILIA — Calidad del sistema de Reglas de Ruteo (registradas 2026-07-13)

**Contexto de descubrimiento:** Al crear la primera regla maestra de ruteo desde `/admin-couriers`
(catálogo `ReglaRuteo`, plantillas `empresaId=null`), se detectaron cinco deudas de calidad en la
zona del sistema de reglas — el formulario de admin, el motor de cotización (`lib/cotizador.ts`), y
la navegación del menú. Ninguna bloquea, pero varias son "bugs esperando que un cliente las pise":
el formulario ofrece opciones que el motor no ejecuta. Se registran juntas por pertenecer a la misma
zona funcional.

---

## DEUDA 99 — Condición "Provincia de Destino" está en el formulario pero el motor no la ejecuta (opción muerta) (scope chico, bug silencioso)

**Status:** ABIERTA. Detectada 2026-07-13.

**Síntoma:** El formulario de reglas ofrece `PROVINCIA_DESTINO` como variable de condición, pero el
motor de cotización (`lib/cotizador.ts:355-356`) solo evalúa `VALOR_CARRITO` y `PESO_PAQUETE`. Una
regla creada con `PROVINCIA_DESTINO` **se guarda pero nunca se dispara** — silenciosamente inerte.

**Fix (dos caminos):**
- Rápido: sacar `PROVINCIA_DESTINO` del `<select>` del formulario hasta que el motor la soporte
  (evita prometer algo que no funciona).
- Completo: implementar la evaluación de `PROVINCIA_DESTINO` en el motor (comparar contra la provincia
  de destino del envío).

**Prioridad:** media (bug silencioso — el peor tipo, porque no falla, simplemente no hace nada).

---

## DEUDA 100 — Operador "Está Entre" (ENTRE) está en el formulario pero el motor no lo ejecuta (opción muerta) (scope chico, bug silencioso)

**Status:** ABIERTA. Detectada 2026-07-13.

**Síntoma:** El formulario ofrece el operador `ENTRE` (con su segundo valor, `condicionValor2`), pero
el motor (`lib/cotizador.ts:358-360`) solo evalúa `MAYOR_A`, `MENOR_A` e `IGUAL_A`. Una regla con
`ENTRE` **nunca se cumple** — inerte.

**Fix (dos caminos):**
- Rápido: sacar `ENTRE` del `<select>` de operadores hasta soportarlo.
- Completo: implementar `ENTRE` en el motor (`valorEval >= valor1 && valorEval <= valor2`).

**Prioridad:** media (mismo patrón silencioso que DEUDA 99).

---

## DEUDA 102 — Botón de menú "Reglas de Ruteo" tiene nombre engañoso y lleva a una pantalla vieja (scope chico, navegación/UX)

**Status:** ABIERTA. Detectada 2026-07-13.

**Síntoma:** En el menú lateral (`app/(dashboard)/layout.tsx:151`), el botón **"Reglas de Ruteo"**
apunta a `/couriers` — que es una pantalla vieja (`ReglasLogisticas`, ~279 líneas, con tabs de
"cordones" y "reglas") que **NO** tiene nada que ver con la creación de reglas de ruteo del catálogo
`ReglaRuteo`. Parece infraestructura previa al sistema de reglas (mapa de cobertura / cordones
logísticos). La creación real de reglas vive en `/admin-couriers`, que en el menú figura con otro
nombre ("Gestión de Couriers", solo admin_shipro).

**Doble problema:**
- El nombre "Reglas de Ruteo" promete una cosa y lleva a otra (confuso para el equipo Shipro).
- Un `gerente_cliente`/`operador_cliente` que clickea "Reglas de Ruteo" es enviado a `/couriers`, que
  le muestra un bloque "sin acceso" (la pantalla es shipro-only). Mala experiencia.

**Fix propuesto (decisión de producto primero):**
- Renombrar el botón `/couriers` a algo que refleje lo que realmente es (ej. "Mapa de Cobertura" o
  "Cordones Logísticos"), y/o
- Revisar si esa pantalla vieja sigue teniendo sentido o si su contenido útil debería absorberse en
  `/admin-couriers` con tabs.
- Aclarar los nombres del menú para que "dónde se crean las reglas" sea obvio.

**Prioridad:** media-baja. Es navegación/claridad, no rompe funcionalidad. Pero conviene resolverlo
antes del onboarding de clientes reales (un cliente no debería toparse con botones que lo mandan a
pantallas sin acceso).

---

**Nota de método:** estas cinco se descubrieron explorando el sistema de reglas para crear la primera
regla maestra. Ninguna bloquea comercialización. La más accionable de cara al usuario es la DEUDA 98
(desplegable de couriers). Las 99 y 100 son "opciones muertas" que conviene al menos sacar del
formulario para no prometer lo que no funciona.

# FAMILIA — Prerequisitos de la API externa para plugins de e-commerce (registradas 2026-07-13)

**Contexto de descubrimiento:** Relevamiento de readiness para documentar la API multicourier de cara a
integraciones externas (plugins Tiendanube, WooCommerce, etc.). Resultado: 4 de 5 capacidades críticas
ya existen y son usables por API key (auth `shipro_live_*`, cotización, creación de envío con etiqueta,
tracking). Faltan tres piezas antes de poder documentar una API con integridad. NINGUNA bloquea el deploy
ni la venta directa de la plataforma — bloquean el frente de PLUGINS, que Nacho decidió posponer hasta
tener producción en pie. Se registran para no perderlas.

---

## DEUDA 103 — Modelo de bultos completo: motor de reglas de empaquetado (por cliente) + creación multi-bulto + soporte etiqueta madre/hija (scope grande, prerequisito plugins)

**Status:** ABIERTA. Reescrita 2026-08-05 tras clarificación del modelo de negocio de Nacho + relevamiento de dolores del mercado (Tiendanube/OCA/Andreani: *"el sistema asumió mal los bultos → el comerciante paga sobrepeso"*). Reemplaza la definición previa (2026-07-13) que sólo hablaba de multi-bulto en la creación — el hueco real es más amplio y tiene tres capas conceptuales distintas.

**El modelo correcto** — un producto en el carrito **NO es un bulto**. La relación producto → bulto es una **regla configurable por cliente**, no una identidad. Antes de la creación del envío hay que resolver, para cada carrito, CUÁNTOS bultos físicos salen y QUÉ dimensiones tiene cada uno. Después la creación acepta ese output. La cadena tiene tres capas.

---

### CAPA 1 — Motor de reglas de empaquetado (por cliente, en la NPMS)

**Input:** el carrito (cantidad de productos + tipo de cada producto).
**Output:** cuántos bultos físicos + dimensiones (largo/ancho/alto) + peso + valor declarado de cada uno.

**Casos reales de Nacho:**
- **Moda** (por rangos de cantidad): 1–3 productos → bolsa 20×30×30, 2 kg. 4–6 productos → bolsa 30×40×40, 4 kg.
- **Tecnología** (por tipo de producto): smartphones se consolidan en una sola caja; impresoras no (cada una en su propio bulto).

**⚠️ Decisión de producto PENDIENTE (no resolver todavía — hay que fijar la política).** Los dos ejemplos de arriba usan lógicas DISTINTAS. Al menos cuatro ejes posibles para la regla de empaquetado:
1. **Rangos de cantidad** (moda).
2. **Tipo/categoría del producto** (consolidable vs no — tecnología).
3. **Peso o volumen acumulado** (thresholds tipo "cuando pasa X kg / Y cm³ arma otro bulto").
4. **Combinación** de los anteriores (mixed rules).

Hay que decidir con Nacho: ¿el motor soporta las 4 lógicas desde el día uno? ¿Empieza sólo con rangos de cantidad y evoluciona? ¿Templates por vertical (moda / tecnología / muebles / alimentos)? Impacto directo en la UI de configuración (cuántos parámetros expone) y en el modelo de datos de la regla.

**Ticket to win** — este motor es un diferencial competitivo, no un check-box. En el mercado local hay un dolor recurrente compartido entre Tiendanube, OCA y Andreani: el sistema asume mal los bultos y el comerciante paga sobrepeso silenciosamente en la conciliación. Un motor de empaquetado configurable (no un fudge de "peso volumétrico promedio") resuelve el pain point que hoy nadie resuelve bien.

---

### CAPA 2 — Creación multi-bulto (`POST /api/envios` acepta `paquetes[]`)

**Estado actual:** el endpoint sólo acepta `pesoReal` escalar. La cotización (`POST /api/cotizar`) SÍ acepta `paquetes[]` con dimensiones — el hueco está sólo en la creación.

**Contrato propuesto:** `POST /api/envios` acepta `paquetes[]` (`pesoKg`, `largoCm`, `anchoCm`, `altoCm`, `valorDeclarado`, `fragil?`, `contenido?`). Es el output natural del motor de la Capa 1.

**Caso común (una etiqueta por bulto):** cada bulto viaja con su propia etiqueta + su propia tarifa cotizada + facturada por separado. Sin descalce silencioso entre lo cotizado y lo facturado por peso volumétrico.

**Backward-compat:** si el body trae sólo `pesoReal` sin `paquetes[]`, mantener el comportamiento actual (una etiqueta unibulto). Nadie que ya integre contra la API se rompe.

**Threading:** `crearEnvio` → `dispatch.ts` → adapters. Andreani soporta `bultos[]` nativo. Mocis requiere unir las tuplas por paquete (una llamada por bulto o batch según su API). Persistir el agregado en `Envio` (`pesoReal = suma(pesoKg)`, `pesoVolumetrico = suma(volumen/factor)`).

Además restaurar los dos campos que el modelo `Envio` ya soporta pero el endpoint no acepta hoy: `fragil` (boolean) y `contenido` (string).

---

### CAPA 3 — Excepción: etiqueta madre / etiqueta hija (courier-dependent)

Algunos couriers permiten UN tracking para varias cajas con una sola tarifa de aforo (suma de dimensiones/peso; valor declarado consolidado para el seguro). **No es lo común** — depende de cada courier ofrecerlo. Andreani, Mocis y los demás se relevan uno por uno.

Cuando el courier lo ofrece, el motor de empaquetado puede sugerir la ruta "madre/hija" como alternativa a "una etiqueta por bulto" cuando el aforo consolidado sale más barato. Es un segundo camino, no reemplazo del común de Capa 2.

**Modelo de datos:** `Envio` madre + N `EnvioBulto` hijas (o un flag en `Envio` con `paquetes[]` embebidos con sub-tracking por bulto). A diseñar cuando se relevan los couriers que lo soportan.

---

**Prioridad:** alta dentro del frente de plugins. La Capa 2 es prerequisito duro para documentar la creación de envío en la API externa (sin ella un plugin sólo despacha unibulto). La Capa 1 es el diferencial que convierte a Shipro de "otro plugin más" en la respuesta al pain point del mercado. La Capa 3 se pospone hasta relevar cada courier.

**Scope estimado:** grande. Capa 2 son ~1-2 días (extender endpoint + threading a adapters). Capa 1 son ~1-2 semanas (modelo de datos + UI de configuración + motor de evaluación) según el alcance de política que se elija. Capa 3 depende de qué couriers ofrezcan la opción.

---

## DEUDA 104 — No existe sistema de webhooks salientes (Shipro → e-commerce) (scope grande, prerequisito plugins)

**Status:** ABIERTA. Detectada 2026-07-13. **Es el gap más grande para plugins.**

**Síntoma:** Shipro no emite eventos hacia sistemas externos. No hay modelo `Webhook`, ni despachador, ni cola
de reintentos, ni firma de seguridad. Hoy, para saber si un envío cambió de estado (EN_TRANSITO, ENTREGADO),
un e-commerce tendría que **preguntar en loop** (polling) a `/api/envios/buscar` — caro, lento, y quema la
cuota de Shipro con los couriers.

**Por qué importa:** todo plugin serio de marketplace (Andreani oficial, Envío Fácil, EasyPost) entrega
eventos de cambio de estado vía webhook. Sin esto: (a) el comprador se entera tarde del estado; (b) escala
mal; (c) los curadores de marketplaces (Tiendanube, Shopify) lo exigen para aprobar el plugin. Es un requisito,
no un lujo.

**Fix propuesto (a diseñar):**
- Modelo `Webhook` (empresaId, url, secretHmac, eventos[], activo).
- Despachador que corre en las transiciones de estado (en el pipeline de rastreo/dispatch).
- Cola de reintentos con backoff exponencial.
- Firma HMAC de cada payload (para que el consumidor verifique autenticidad).
- UI chica para que la empresa registre su URL de webhook y rote el secreto.

**Prioridad:** alta dentro del frente de plugins (es el desbloqueante del "tercer momento" — la trazabilidad
publicada dentro del panel del e-commerce). ~1-2 días. Requiere diseño dedicado.

---

## DEUDA 105 — Cancelación de envíos: decisión de producto — solo desde la plataforma (NO via plugin)

**Status:** RESUELTA POR DECISIÓN DE PRODUCTO. Confirmada en múltiples sesiones (2026-07-13, 2026-08-05).
No hay código que construir.

**Decisión:** la cancelación de un envío es una acción operativa que ejecuta el cliente
desde la plataforma NPMS. Los plugins de e-commerce (Tiendanube, etc.) NO tienen acceso
a `/api/envios/cancelar`. El endpoint permanece clasificado como `session` en `proxy.ts`
— no se abre a API key.

**Razón:** cancelar implica juicio operativo (¿el courier ya retiró el paquete?, ¿hay
costo de cancelación?, ¿el saldo se acredita?). Eso no se delega a un sistema externo
automático. El flujo es: e-commerce notifica al cliente → cliente cancela manualmente
desde la plataforma.

**Impacto en plugins:** ninguno. Los plugins crean envíos y consultan estado. La
cancelación queda fuera del contrato de la API externa deliberadamente.

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

## DEUDA 129 — Contrato de resiliencia del checkout: circuit breaker amigable + fallback rates (prerequisito plugins, ticket to play) (registrada 2026-08-05, scope medio)

**Status:** RESUELTA. Commits 9e4864d + ced0dbf (2026-08-05). Deployada a producción
2026-08-05. Timeout 8s (AbortController) en ambos adapters. 503/422 en route.ts.
Fallback per-courier con nombre real + SLA calibrado + tarifaPlanaRespaldo override
en CredencialCourier. Migración 20260805223416.

**Problema:** la cotización que consume el plugin (`POST /api/cotizar`) tiene que responder **rápido y sin 5xx innecesarios**, porque los marketplaces la clasifican como transporte crítico del checkout y aplican circuit breakers agresivos:

| Marketplace | Timeout de cotización | Circuit breaker |
|---|---|---|
| Tiendanube | 5s | Se activa con >500 req en 30 min y >50% de fallas 5xx/timeout. Cuando se abre, **bloquea el transporte 5 min para TODOS los clientes que lo usen**. |
| VTEX | 2.5s | Similar (SLA de checkout). |
| Shopify | 10s / 5s / 3s dinámico según región | Similar. |

Un checkout que devuelve 5xx o tarda >5s se transforma en un **transporte bloqueado 5 min** para todos los clientes de esa plataforma. Un solo courier caído puede sacarnos del canal entero.

**Regla clave de implementación — errores de negocio NUNCA son 5xx:**

- **`5xx` = error del SISTEMA Shipro.** Cuenta para el circuit breaker (Tiendanube et al. los clasifican como "no saludable"). Uso legítimo: bug interno, DB caída, código crashea. Poco común, se resuelve con monitoreo + alerts.
- **`4xx` = error del PEDIDO / CP / NEGOCIO.** NO cuenta para el circuit breaker (los marketplaces los clasifican "saludable"). Uso legítimo: CP inválido, sin cobertura del courier, dirección incompleta, fuera de peso máximo.

**El bug clásico que hay que evitar:** devolver `500 { error: "El CP 9999 no tiene cobertura de Andreani" }` en vez de `422 { error: "SIN_COBERTURA", detalle: "..." }`. **Un error de negocio devuelto como 5xx nos autobloquea el transporte** en la puerta de Tiendanube. Auditar cada branch de `/api/cotizar` + `/api/envios` para clasificar cada excepción como 4xx (negocio) o 5xx (sistema). Tabla mínima de códigos: `422 SIN_COBERTURA`, `422 CP_INVALIDO`, `422 DIRECCION_INCOMPLETA`, `422 SUPERA_PESO_MAX`, `409 CREDENCIAL_INVALIDA`, `503 COURIER_TIMEOUT` (este último SÍ es 5xx correctamente porque es fallo del sistema aguas arriba).

**Fallback rate cuando el courier se cae o tira timeout:**
- La `tarifaPlanaRespaldo` (per-empresa, ya existe, obligatoria en el alta desde DEUDA 10 Paso 5b) sirve como **fallback rate del checkout**. Extender su uso: hoy se dispara sólo cuando el histórico + APIs fallan en la creación; ampliarla al escenario "courier lento/caído durante la cotización del plugin".
- Threshold sugerido: si un courier no responde en <2s (< timeout marketplace), retornar `tarifaPlanaRespaldo` marcada como `fallback: true` + `motivo: "COURIER_TIMEOUT"`. El e-commerce muestra tarifa, se cierra la venta, Shipro conserva el margen. Consigna Nacho: **"el cliente vende siempre".**
- Log estructurado del fallback para observabilidad (contar cuántas cotizaciones cayeron a respaldo, por courier, por empresa — feed a la Torre de Control).

**Por qué importa para plugins:** un plugin sin este contrato de resiliencia se autobloquea la primera vez que Andreani tira 500ms de latencia extra. La regla 4xx-vs-5xx + el fallback son **contratos de convivencia con el marketplace**, no optimizaciones.

**Prioridad:** alta. Prerequisito duro. Scope medio (~1-2 semanas: auditar códigos de error en cotizar + envios, extender `tarifaPlanaRespaldo` al camino "courier timeout", tests de scenarios de fallo). Conecta con `tarifaPlanaRespaldo` existente (obligatoria per-cliente al alta desde DEUDA 10 Paso 5b) — es reutilización, no diseño nuevo.

---

## DEUDA 130 — Requisitos de homologación de Tiendanube para la app de envíos (shipping carrier) — preparar para publicar en marketplace (scope grande, plugin Tiendanube)

**Status:** ABIERTA. Registrada 2026-08-05. **Spec reference del plugin Tiendanube.** Cuando se ataque el plugin de Tiendanube en una sesión dedicada, este documento manda: la app se construye desde el día uno cumpliendo TODOS los requisitos de homologación para no rehacer, aunque se lance antes de homologar.

---

### Estrategia de lanzamiento (LOCKED, Nacho)

**Dos velocidades:**
1. **Vender YA vía link directo** — igual que la plataforma legacy hoy: Nacho manda al cliente la URL de instalación de la app en su Tiendanube, el cliente la instala. No se espera homologación ni publicación en el App Store. Onboardings inmediatos.
2. **Homologar / publicar después** — cuando Nacho decida (masa crítica de clientes reales, feedback estabilizado, capacidad operativa para la reunión de validación conjunta).

**Consecuencia arquitectónica:** la app se construye desde el día uno cumpliendo TODAS las specs de homologación de abajo. No se toma ningún atajo "porque hoy no vamos al marketplace" — reharlo después es doble trabajo y arrastra decisiones incompatibles.

---

### Hallazgos de la doc oficial (dev.tiendanube.com, consultado 2026-08-05)

**1. HOMOLOGACIÓN SÍNCRONA obligatoria.** Las apps tipo Envíos (junto con Pagos y ERP) requieren homologación **síncrona** — reunión de validación conjunta donde el equipo de Tiendanube revisa la app ítem por ítem contra la checklist técnica. Más exigente que la asíncrona (que otras categorías de apps usan). Fuente: `dev.tiendanube.com/docs/homologation/sync`.

**2. ⚠️ NubeSDK OBLIGATORIO (impacta el stack).** Desde el **5-jun-2026**, la parte visual de la app (lo que el merchant ve dentro del panel de Tiendanube) DEBE construirse con **NubeSDK**, corriendo dentro de un **Web Worker**.

- **PROHIBIDO** (motivo directo de rechazo): `document`, `window`, `jQuery`, manipulación directa del DOM.
- **OBLIGATORIO**: UI con componentes NubeSDK + sistema de diseño **Nimbus**. Stack React.
- La fecha ya pasó → **aplica sí o sí** desde el momento en que empecemos la app.
- Fuentes: `dev.tiendanube.com/docs/homologation/checklist` + `dev.tiendanube.com/applications/native`.

**Impacto**: la sección de la app que vive dentro del panel de Tiendanube no puede ser una vista Next.js/React "normal" — tiene que compilarse contra NubeSDK y correr en un Web Worker. Todo lo que necesite acceder al DOM, a `window` o a librerías DOM-dependientes queda del lado de la NPMS/servidor Shipro, no del lado del panel del merchant.

**3. WEBHOOKS NO DIFERIBLES.** La doc exige "uso eficiente de recursos" y explícita que hacer **GETs continuos para detectar cambios (polling)** en vez de escuchar un webhook es motivo de observación o rechazo. **Confirma que DEUDA 104 (webhooks salientes) es parte del core obligatorio para homologar, no diferible.** Sin webhooks Shipro→e-commerce, no hay homologación.

**4. ARTEFACTOS OBLIGATORIOS de homologación (a producir para la reunión síncrona):**
- **Diagrama de secuencia** — cómo la app interactúa con la API de Tiendanube: qué evento dispara qué llamado, con qué payload, y qué resultado esperado.
- **Video demo** con escenarios específicos:
  - Instalación desde Tiendanube vía URL `https://www.tiendanube.com/apps/{app_id}/authorize`.
  - Registro de usuario nuevo (primer alta del comerciante).
  - Login de usuario existente (que ya tiene cuenta Shipro).
  - Reinstalación tras desinstalar (flujo de re-onboarding limpio).
- **Cuenta demo** ya liberada de suscripciones/esperas: entregar credenciales de una tienda Tiendanube activa + cuenta Shipro asociada + saldo/config listos para que el revisor pruebe end-to-end sin fricción.
- **Documento FAQ + contactos** de soporte: nivel 1 (comerciante), nivel 2 (técnico primer piso), nivel técnico avanzado, ventas. Ownership por nivel.

**5. Mecanismo Shipping Carrier (API doc).** La app registra un carrier con:
- `callback_url` — endpoint que Tiendanube llama para pedir rates durante el checkout. Debe responder rápido y sin 5xx (conecta con DEUDA 129: circuit breaker de Tiendanube corta a 5s con >50% 5xx).
- `callback_labels_url` — endpoint asíncrono para la Labels API (crear etiqueta post-orden).
- **`rates[]`** — JSON array con campos obligatorios (contrato exacto A CONFIRMAR con Tiendanube — ver pendientes).
- Tipos de tarifa: `ship` (envío a domicilio) y `pickup` (retiro en sucursal).
- **Fulfillment Events** para tracking bidireccional (Shipro emite eventos hacia Tiendanube; Tiendanube los muestra al comerciante y al comprador).
- Fuente: `tiendanube.github.io/api-documentation/resources/shipping-carrier`.

---

### Pendientes de conseguir (Nacho lo pide vía WhatsApp a su contacto en Tiendanube AR, Franco Radavero)

1. **Checklist técnico específico de apps de Envíos** — el que revisan en la reunión síncrona; no está público en la doc general.
2. **Contrato exacto de `rates[]`** — schema completo con campos obligatorios / opcionales / tipos / rangos.
3. **Especificación completa de la Labels API** — flujo asíncrono, timeouts, reintentos esperados, formato de etiqueta.
4. **Webhooks obligatorios + requisitos de seguridad** — qué eventos de Tiendanube debemos escuchar sí o sí, firma HMAC (algoritmo, header, formato del secret), política de reintentos que hace Tiendanube.
5. **Umbrales de performance/timeout evaluados** — más allá del corte de 5s conocido en checkout, qué otros SLAs miden en la homologación (Labels API, tracking events, disponibilidad).
6. **Acceso a sandbox/testing** para apps de envíos — entorno específico donde probar sin afectar tiendas reales.

Sin estas 6 respuestas, la implementación queda con huecos de contrato que van a salir en la reunión síncrona.

---

### Relación con otras DEUDAs del frente plugins

- **DEUDA 103** (motor de reglas de empaquetado + multi-bulto + madre/hija): la CAPA 2 de 103 (creación multi-bulto) es lo que despacha las etiquetas que Tiendanube pide vía Labels API. Prerequisito duro.
- **DEUDA 104** (webhooks salientes): **NO es diferible para homologar Tiendanube** (ver hallazgo 3). Cambia de "gap grande" a "prerequisito duro de homologación".
- **DEUDA 105** (cancelar por API): un plugin completo cancela desde Tiendanube. Sin esto, la reunión síncrona lo va a observar.
- **DEUDA 128** (idempotencia): Tiendanube reintenta webhooks; sin idempotencia se duplican etiquetas en cada reintento (bloqueante).
- **DEUDA 129** (resiliencia checkout / 4xx-vs-5xx / fallback rate): directamente contra el circuit breaker de Tiendanube (5s + >50% 5xx = 5 min bloqueado). Prerequisito duro para pasar la homologación.

**Todas las 5 anteriores son necesarias para tener una app Tiendanube homologable.** DEUDA 130 es la envoltura que las une + lo específico de la plataforma (NubeSDK + Nimbus + artefactos + reunión síncrona).

---

### Scope y prioridad

**Scope:** grande. Estimación gruesa (pendiente de refinar cuando lleguen las respuestas de Radavero):
- Componente NubeSDK + Web Worker + Nimbus (parte visual dentro del panel): ~2-3 semanas.
- OAuth Tiendanube + instalación + `callback_url` (rates) + `callback_labels_url` (Labels): ~1-2 semanas.
- Fulfillment Events (bidireccional con webhooks): depende de DEUDA 104.
- Idempotencia (DEUDA 128) + resiliencia checkout (DEUDA 129) + multi-bulto (DEUDA 103 Capa 2) + cancelar (DEUDA 105) resueltas **antes** de la app Tiendanube.
- Artefactos de homologación (diagrama, video, cuenta demo, FAQ): ~1 semana concentrada.

**Total razonable para app homologable**: ~2-3 meses de trabajo enfocado, asumiendo que las 5 DEUDAS prerequisito ya están cerradas.

**Prioridad:** el plugin Tiendanube es el primer canal comercial serio (mayor share de e-commerce en AR). Pero **no es urgente por el marketplace** (Nacho lanza por link directo). Lo urgente es que las DEUDAs prerequisito (103, 104, 105, 128, 129) se ataquen antes del plugin, y que cuando el plugin arranque, se construya cumpliendo estas specs.

---

**Próxima acción:** ejecutar por WhatsApp el pedido a Franco Radavero (6 puntos de "Pendientes de conseguir"), esperar respuesta, y con esa info recién arrancar la sesión de diseño dedicada al plugin.

---

## DEUDA 131 — Race condition en idempotency check de POST /api/envios (scope pequeño, follow-up DEUDA 128)

**Status:** ABIERTA. Registrada 2026-08-05.

**Problema:** si dos requests llegan exactamente al mismo tiempo con la misma
`Idempotency-Key` y `empresaId`, ambos pasan el `findFirst` (el primero no existe
aún), y ambos intentan crear el `Envio`. El segundo obtiene una violación P2002
(`@@unique([empresaId, idempotencyKey])`) que sube al catch-all de `route.ts` y
devuelve 500 en lugar de 200 con la etiqueta ya creada.

**Frecuencia:** muy baja en producción — requiere dos webhooks de Tiendanube
disparándose en el mismo milisegundo con la misma key. No es un bloqueante para
el lanzamiento del plugin.

**Fix:** en el catch del `prisma.envio.create` dentro de `route.ts`, detectar el
código Prisma `P2002` y hacer un segundo `findFirst` para devolver el envío ya
creado con `replayed: true`. Patrón: try-create → catch P2002 → re-query → return.

**Archivos:** `app/api/envios/route.ts`.

---

**Nota de secuencia:** el orden lógico de construcción antes de documentar la API externa es: DEUDA 103
(multi-bulto — el hueco que más muerde), DEUDA 104 (webhooks — el desbloqueante grande), DEUDA 105 (cancelar —
chico). Las tres, más la redacción de la especificación OpenAPI, son el trabajo del frente de plugins, POSPUESTO
hasta tener el deploy en producción. El diseño de "qué datos pedir al e-commerce y para qué" (la normalización)
se puede trabajar en paralelo — no depende del código.

---

## APRENDIZAJE DE DEPLOY — Rebuild limpio obligatorio cuando el deploy toca `proxy.ts` o el schema Prisma (registrado 2026-08-04)

**Descubierto durante el deploy de DEUDA 106 pieza 2 a prod (2026-08-04).** La migración aditiva `20260804190000_envio_correccion_token` se aplicó con `prisma migrate deploy` sin problema, pero el build/restart estándar dejó dos regresiones sutiles que sólo se detectaron probando el flujo end-to-end en prod.

**Síntomas observados:**
1. **Middleware caché de Next.js** — `GET /api/envios/rastreo-publico` (endpoint agregado a `PUBLIC_API_EXACT` en `proxy.ts` por mov 1) devolvía `{"error":"No autenticado"}` a llamadas anónimas después de `git pull && npm run build && pm2 restart shipro`. El `proxy.ts` compilado quedó cacheado en `.next/` con la lista vieja de rutas públicas — la ruta nueva no estaba clasificada como `public`, así que el gate del proxy la trataba como default (session-required).
2. **Prisma client desincronizado** — el build tiraba `Property 'correccionToken' does not exist on type 'EnvioWhereInput'`. Prisma genera el client tipado (`@prisma/client`) a partir del `schema.prisma`; sin correr `prisma generate` post-migración, los tipos del client no conocen las columnas nuevas y `tsc` falla al compilar cualquier handler que las use en un `where` / `select` / `create`.

**Procedimiento correcto — rebuild limpio (para deploys que tocan `proxy.ts` O `prisma/schema.prisma`):**

```bash
git pull                    # (obvio)
npx prisma migrate deploy   # sólo si el schema cambió — aplica migraciones pendientes en orden
npx prisma generate         # sólo si el schema cambió — regenera @prisma/client contra el nuevo schema
rm -rf .next                # fuerza a Next a recompilar middleware + rutas desde cero (no reusa build viejo)
npm run build
pm2 restart shipro
```

**Para deploys que NO tocan `proxy.ts` NI el schema** el flujo incremental sigue sirviendo (`git pull && npm run build && pm2 restart shipro`); el rebuild limpio es específicamente para los dos triggers de arriba.

**Verificación post-deploy de DEUDA 106 pieza 2:** después del rebuild limpio, `curl` anónimo a `/api/envios/rastreo-publico?tracking=360003057165780` devuelve el DTO L1 (estado + courier + vendor + timeline, sin PII) — el gate del proxy clasifica correctamente y el handler responde. Flujo verde.

**Regla operativa incorporada:** cualquier futuro cambio en el clasificador del proxy (agregar/quitar rutas de `PUBLIC_API_EXACT`, `DUAL_EXACT`, `API_KEY_EXACT`) o en el schema Prisma (nuevas columnas, tablas, índices, o cualquier cosa que altere el shape del client generado) dispara este checklist de rebuild limpio. Añadir al runbook de deploy cuando se materialice como documento propio.

**Cross-reference:** DEUDA 106 pieza 2 (arriba).

---

## DEUDA 107 — El markup del intermediario que presta credenciales no está modelado (NEGOCIO/PRECIO) (registrada 2026-07-17, scope medio-grande)

**Status:** RESUELTA 2026-07-24. Modelo `CourierIntermediario` (markupPorcentaje + seguroFijo + vigencias) + cascada en `aplicarMarkup` (intermediario% aplicado sobre el neto ANTES del markup Shipro) + desglose `matchedA.desglose.{cascadaNeto, smoNeto, feeNeto, netoAcumulado}` propagado por `OpcionTarifa` y persistido en `FinanzasEnvio` (feeNetoFacturado / logisticaNetaFacturada / ivaFacturado) — la conciliación ya distingue esperado vs anomalía sobre estos campos. Commits: 996142f (fórmula), 0d6fd7b (desglose propagado + persistido). FOLLOW-UPS (no bloqueantes): UI admin para editar el intermediario por-courier (hoy solo seed/manual DB); el fallback `resolverPrecioFallback` aún NO reconstruye la cascada (`intermediarioMarkupPorcentaje: null`) — documentado como GAP en `lib/envios/crear.ts` con el contrato de OBSERVADO + breakdown NULL en esa rama.
**Prioridad histórica: ALTA.** Afectaba directamente el margen de cada envío en Modelo A y rompía la conciliación — ambos cerrados.

---

### El modelo de negocio (contexto que faltaba en el sistema)

Shipro **no puede** conseguir cuentas directas con los couriers grandes: los couriers ven a Shipro
como competencia (Shipro les administra los clientes). La solución encontrada: **un courier
local/chico que ya redespacha paquetería le "presta" sus credenciales a Shipro.**

Hoy: **Mocis presta sus credenciales de Andreani.** Shipro cotiza contra la API de Andreani con esas
credenciales, y esa es la "tarifa corporativa de Shipro" que usan los clientes en **Modelo A**.

**El intermediario cobra por prestar.** Datos reales (2026-07):
- Mocis factura **la tarifa de Andreani + 10%**.
- Mocis factura **$90 + IVA de seguro por etiqueta**, cuando Andreani cobra **$10 + IVA**.
  (Diferencia de $80/etiqueta. Sea correcto o no, es lo que factura.)

**El intermediario es intercambiable.** Si mañana Intralog presta las credenciales de Andreani a
mejor precio, Shipro cambia — con **otro markup** (ej. +5% + $150). El sistema tiene que poder
modelarlo sin tocar código.

---

### El problema

**La tarifa que devuelve la API NO es el costo real de Shipro.** El sistema hoy asume que sí.

`lib/cotizador.ts` calcula:
```
precioProveedor = tarifaAPI                                  ← ¡INCOMPLETO!
precioFinal     = tarifaAPI + markupShipro + IVA
```

Falta el término del intermediario. El costo real es:
```
costoReal = tarifaAPI × (1 + markupIntermediario%) + seguroIntermediarioFijo
```

**No existe NINGÚN campo, tabla ni concepto** que modele esto. Grep de
`prestamo|intermediario|emisor|credencialesDe|redespacho` → cero resultados. El flag
`usaCredencialesPropias` solo distingue Modelo A vs B (de quién son las credenciales), **no la cadena
de markups sobre la tarifa cruda**.

### Las dos consecuencias

**1. Fuga de margen (Modelo A).** Cada envío se publica sin el markup del intermediario. Si el markup
de Shipro no lo cubre, Shipro absorbe el 10% + $90 de su bolsillo. Hoy no duele (la plataforma nueva
no tiene clientes), **pero muerde el día uno del primer onboarding**.

**2. Conciliación rota.** `FinanzasEnvio.precioProveedor` guarda la tarifa de la API y se usa en
`app/api/conciliacion/route.ts:60` como `costoEsperado` ("lo que dijo la cotización inicial"), para
comparar contra la liquidación real del courier. Con credenciales prestadas, **la liquidación de
Mocis SIEMPRE va a diferir** — y la métrica de fuga va a marcar una anomalía que **no es anomalía:
es el markup del intermediario, esperable y contractual.** La métrica va a gritar todos los meses por
algo estructural, enmascarando las fugas reales.

---

### Diseño de la solución (decisiones de producto ya tomadas, 2026-07-17)

**Decisión 1 — El intermediario es de SHIPRO, por courier.** No es per-empresa. Es un acuerdo entre
Shipro y quien presta. Un solo lugar de configuración, aplica a todos los clientes de Modelo A.

**Decisión 2 — Solo aplica a Modelo A** (`usaCredencialesPropias = false`). En Modelo B el cliente usa
sus propias credenciales y **se asume que su tarifa de API ya trae todos sus costos** — no hay
intermediario en el medio.

**Decisión 3 — El orden de los términos:**
```
1. tarifaAPI                          (lo que devuelve el courier)
2. + markup del intermediario         (%y/o fijo — solo Modelo A)   ← EL COSTO REAL DE SHIPRO
3. + markup de Shipro                 (ajusteTarifaPorcentaje + markupFijo)
4. + IVA                              (si tarifaIncluyeIva = false)
   = precio publicado
```
Y **`precioProveedor` debe pasar a ser el paso 2** (el costo real esperado), no el paso 1.

**Modelo de datos sugerido (a validar):**
```
model CourierIntermediario {
  id                    Int
  courierId             Int       // Andreani — el courier que se cotiza
  intermediarioNombre   String    // "Moci's" — quién presta las credenciales
  markupPorcentaje      Decimal   // 10.00
  markupFijoPorEtiqueta Decimal   // 90.00 (el "seguro" que factura el intermediario)
  markupFijoIncluyeIva  Boolean
  activo                Boolean
  vigenciaDesde         DateTime
  vigenciaHasta         DateTime?
  notas                 String?   // "Andreani cobra $10+IVA de seguro; Mocis factura $90+IVA"
}
```
Con vigencias, para poder cambiar de intermediario (Mocis → Intralog) **sin perder el histórico** de
qué markup aplicaba cuando se cotizó cada envío.

**Y en `FinanzasEnvio`, guardar el desglose** (no solo el total):
```
tarifaCourierBase      // lo que dijo la API
markupIntermediario    // lo que agrega quien presta
precioProveedor        // = base + markup = el costo real esperado
```
Así la conciliación puede distinguir *"el intermediario aplicó su markup esperado"* (normal) de
*"hay una anomalía real"* (fuga a investigar).

---

### Visión de futuro (por qué este modelo sirve a largo plazo)

Cuando Shipro tenga **volumen suficiente para acceder a tarifas directas** con los couriers, el
intermediario desaparece — y **ese mismo espacio de la fórmula pasa a ser margen de Shipro**. El
modelo no se tira: se reutiliza. El campo `markupIntermediario` en 0 o reasignado a Shipro.

### Relación con otras deudas

- **DEUDA 73** (completar fórmula: seguro + descuento del cliente) — es la deuda hermana. El SMO
  (Seguro Mínimo Obligatorio) que propone la 73 y el markup del intermediario de esta 107 **se
  aplican en el mismo punto de cálculo** (`aplicarMarkup`). Conviene diseñarlas juntas para no tocar
  la fórmula de precio dos veces.
- **DEUDA 10** guarda el precio crudo en `HistoricoCotizaciones` y re-aplica markup al leer. Cuando se
  implemente esta deuda, el fallback debe aplicar el markup del intermediario también.

### Trabajo (a diseñar, no ejecutar todavía)

1. Modelo `CourierIntermediario` + migración.
2. UI de admin para cargar/editar el intermediario por courier (quién presta, qué markup, vigencias).
3. Extender `aplicarMarkup` en `lib/cotizador.ts` para el término del intermediario, solo cuando
   `usaCredencialesPropias = false`.
4. Cambiar `precioProveedor` para que refleje el costo real (base + markup intermediario).
5. Desglose en `FinanzasEnvio` para que la conciliación distinga esperado vs anomalía.
6. Verificar el impacto en las métricas de la Torre de Control que leen `precioProveedor`.

**Nota:** el paso 3 es mecánicamente simple (la función es corta). Lo pesado es el modelo de datos,
la UI, y no romper la conciliación ni las métricas existentes.

---

## DEUDA 108 — Servidor viejo (beta.shipro.pro, 5 clientes reales) sin firewall, bajo ataque SSH (SEGURIDAD) (registrada 2026-07-17, scope medio, seguridad — servidor de Fran)

**Status:** ABIERTA. El servidor 45.33.1.16 (Dallas) aloja beta.shipro.pro (Shipro v1, 5 clientes reales operando) + proyectos de terceros + NO tiene firewall. Durante el deploy del server nuevo (2026-07-17) se confirmó en logs que estos servidores reciben ataques de fuerza bruta SSH constantes (decenas de IPs/segundo probando root). El server nuevo (pm.shipro.pro) nació con firewall Linode (SSH restringido a IP de Nacho); el viejo está expuesto. **Acción:** avisar a Fran para que aplique un Cloud Firewall al servidor viejo (inbound DROP default + reglas 22 restringido / 80 / 443). No es código de Shipro, es infra del server compartido.

---

## DEUDA 109 — Limpiar el pm viejo del servidor de Fran (registrada 2026-07-17, scope chico, infra)

**Status:** ABIERTA. Hasta el 2026-07-17, pm.shipro.pro corría en el servidor viejo (45.33.1.16) con código desactualizado. El DNS ya apunta al server nuevo (172.233.20.199). Queda el despliegue viejo de pm en /var/www/html/pm del server de Fran, ya sin tráfico. **Acción:** cuando la plataforma nueva esté validada y estable, coordinar con Fran para desmontar el pm viejo (liberar recursos, evitar confusión). Sin apuro — no molesta mientras el DNS apunte al nuevo.

## DEUDA 110 — Motor de optimización de la propuesta logística (PRODUCTO — diferencial competitivo) (registrada 2026-07-21, scope grande)

**Status:** ABIERTA. Idea de producto (aporte de especialista en Marketing + Nacho, 2026-07-21).
**Ubicación en el roadmap: DESPUÉS de Fase 1 (precio), Fase 2 (couriers) y Fase 3 (plugins).** Este
motor se alimenta de datos reales de envíos + eventos de checkout; sin clientes operando y sin la
captura de la DEUDA 111, no tiene con qué trabajar. Construirlo antes sería un motor sin combustible.
**Depende de:** modelo de precio correcto (73+107 — el ahorro se mide en pesos que tienen que estar
bien), Torre de Control (39 — ya calcula varias métricas base), y la captura de la DEUDA 111.

### Objetivo

Transformar los datos del Panel de Control en **recomendaciones accionables** que permitan reducir
costos logísticos sin deteriorar conversión, SLA ni experiencia del comprador.

### Problema actual

Hoy Shipro puede detectar patrones ("el 78% elige domicilio aunque el punto de retiro cuesta 22%
menos"), pero deja toda la **interpretación y ejecución** en manos del cliente. Eso exige capacidad
analítica, tiempo y criterio logístico — recursos que el segmento de 500-5.000 envíos/mes suele
tener limitados.

### Historia de usuario

Como responsable de e-commerce u operaciones, quiero que Shipro me indique qué cambio podría aplicar
en mi propuesta logística, cuánto podría ahorrar y qué riesgos tendría, para decidir si implementarlo
sin analizar manualmente múltiples métricas.

### Funcionamiento propuesto

1. **Detectar una oportunidad.** Ej: "En AMBA Norte, para pedidos < $80.000, el 74% elige domicilio.
   El punto de retiro cuesta en promedio 19% menos."
2. **Calcular impacto potencial** (escenarios de adopción): si migra 10%/20%/30% → ahorro mensual
   estimado por escenario.
3. **Controlar variables de servicio** antes de recomendar: plazo real, cumplimiento SLA, primera
   visita, reclamos, NPS, ticket promedio, cobertura por zona, diferencia económica real.
4. **Proponer una acción concreta.** Ej: "Destacar punto de retiro como recomendado para pedidos <
   $80.000 en estas zonas." Otras: cambiar orden de publicación, descuento a punto de retiro, mostrar
   "opción más económica", subsidiar parcialmente una modalidad, ocultar servicio con bajo SLA,
   priorizar express en tickets altos, envío gratis condicionado, cambiar courier recomendado por zona.
5. **Simular antes de publicar:** regla actual vs propuesta, ahorro estimado, impacto sobre precio
   mostrado, alcance en cantidad de pedidos, riesgos operativos.
6. **Aprobar y publicar:** el cliente acepta / modifica parámetros / descarta / programa por período /
   aplica solo a ciertas zonas, tickets o productos.
7. **Medir el resultado:** comparar comportamiento antes/después, ahorro real, cambio en el mix de
   modalidades, variación en conversión, SLA, reclamos y NPS.

### Recomendación para el MVP (del especialista)

NO automatizar cambios en el checkout sin autorización. Empezar con el ciclo:
**Detectar → Recomendar → Simular → Aprobar → Medir.**
Más adelante, con evidencia suficiente, habilitar reglas automáticas con límites definidos por el
cliente.

### Ejemplo de recomendación en pantalla

> **Oportunidad detectada.** En los últimos 30 días realizaste 620 entregas estándar a domicilio en
> zonas con cobertura de puntos de retiro. El punto de retiro fue en promedio $1.140 más económico y
> tuvo un SLA similar. Si el 20% de esos compradores hubiera elegido retiro, el ahorro estimado
> habría sido de $141.360.
> **Acción sugerida:** publicar el punto de retiro primero y aplicar un descuento de $500 por 30 días.
> **Impacto esperado:** ahorro neto estimado de $79.360, sujeto a adopción y comportamiento del comprador.

**La distinción clave:** el sistema no dice solo "había una opción más barata". Dice: "existe esta
oportunidad, bajo estas condiciones, con este impacto económico estimado y este riesgo de servicio".

### Relación con otras deudas
- **DEUDA 111** (Capa de Inteligencia del Checkout) — es su fuente de datos. El motor interpreta lo
  que la 111 captura. Sin la 111, el motor está ciego a la conversión.
- **DEUDA 39** (Torre de Control) — ya calcula varias métricas base (fuga de ruteo, concentración,
  SLA, NPS). El motor es la capa de recomendación por encima de esas métricas.
- **DEUDA 73/107** (precio) — el ahorro estimado se mide en pesos; el modelo de precio tiene que estar
  correcto primero.

---

## DEUDA 111 — Capa de Inteligencia del Checkout: captura de eventos del embudo (PRODUCTO — cimiento de datos) (registrada 2026-07-21, scope grande)

**Status:** ABIERTA. Idea de producto (Nacho, 2026-07-21).
**Ubicación en el roadmap: la CAPTURA arranca con la Fase 3 (plugins) — ver nota abajo; el análisis
viene después.** Es el cimiento de datos sobre el que se construye la DEUDA 110.

### El problema

El e-commerce NO le va a pasar a Shipro sus métricas de embudo (opciones mostradas, opción elegida,
carrito abandonado, compra completada). Sin eso, Shipro no puede entender **dónde se detuvo el
proceso** ni por qué una cotización no terminó en compra.

### La oportunidad

Crear una **Capa de Inteligencia del Checkout** que capture eventos:
- opciones y precios de envío mostrados;
- orden en que fueron presentados;
- modalidad seleccionada;
- cambio de opción durante el checkout;
- compra completada;
- carrito abandonado.

Todo vinculado por un **identificador anónimo de carrito o sesión**. Con eso, se pueden responder
preguntas de alto valor:
- ¿Cuánto cae la conversión cuando el envío supera cierto % del ticket?
- ¿Qué modalidad aumenta la compra sin destruir margen?
- ¿Qué descuento logístico genera ventas incrementales y cuál solo subsidia compras que igual se
  habrían hecho?

### Requisito de captura desde el DÍA UNO de los plugins (Fase 3)

**Decisión (Nacho, 2026-07-21):** desde que exista el primer plugin, cada cotización debe **persistir
un snapshot completo**: identificador único de carrito/sesión + TODAS las opciones y tarifas que
Shipro devolvió (con su orden). Aunque el motor (110) y el análisis de esta deuda todavía no existan.

**Por qué desde el día uno:** los datos que no se capturan hoy no se recuperan mañana. Si el plugin
arranca sin guardar esto, el día que se construya el motor habrá meses de envíos sin historia de
"qué se mostró y qué se eligió" — un agujero irrecuperable. Capturándolo desde el principio, el motor
nace con meses de datos reales esperándolo.

**Conecta con PRINCIPIO 1** (la plataforma es un producto de datos: la lógica/endpoints no se borran
aunque no haya UI). Esta es la versión de captura: **guardar el dato aunque todavía no se consuma.**

**El molde ya existe a medias:** `CotizacionSnapshot` está en el schema **sin consumer** (DEUDA 58).
Esta deuda le da propósito. La captura del snapshot con ID de carrito es un **requisito de diseño de
la Fase 3 (plugins)** — el punto donde nace el dato —, no del motor.

### Fases sugeridas
1. **Captura (con los plugins, Fase 3):** persistir CotizacionSnapshot con ID de carrito + opciones +
   tarifas + orden. Los eventos de selección/abandono/compra los reporta el plugin cuando el
   e-commerce los expone (varía por plataforma).
2. **Análisis (después, junto con DEUDA 110):** construir las preguntas de embudo sobre los datos ya
   acumulados.

### Relación con otras deudas
- **DEUDA 110** (Motor de optimización) — es el consumidor de estos datos. 111 captura, 110 interpreta.
- **DEUDA 58** (CotizacionSnapshot sin consumer) — el molde de datos que esta deuda activa.
- **DEUDA 103-105** (prerequisitos plugins) — la captura se implementa junto con el primer plugin.

## DEUDA 113 — Vulnerabilidades npm en producción (registrada 2026-07-30, scope medio, seguridad/dependencias)

**Status:** ABIERTA — DEFERRED. Durante el deploy 2026-07-30 (commit `b11f7f8`) `npm audit` reportó 11 vulnerabilidades en el árbol de dependencias: **1 crítica, 7 altas, 2 moderadas, 1 baja**. Se identificaron cuatro clusters: **(a) postcss** (alta, build-time only, el fix requiere bumpear `next` a 16.2.12 — fuera del rango declarado); **(b) sharp/libvips** (alta, el fix también bumpea `next` a 16.2.12); **(c) uuid** (moderada, fixeable en-rango con `npm install uuid@<patched>` puntual); **(d) xlsx/SheetJS** (alta, prototype pollution + ReDoS, **sin fix en el registro npm** — SheetJS movió la distribución fuera de npm; para actualizar hay que consumir el tarball oficial desde `https://cdn.sheetjs.com`). **Decisión:** se probó `npm audit fix` (sin `--force`), que tocó 29 paquetes; se revirtió con `git checkout package-lock.json && npm ci` restaurando el lockfile de `b11f7f8`. **La remediación se hace en la Mac de Nacho, en una branch dedicada, paquete por paquete con verificación de build (`npm run build` + tsc 0) y prueba manual antes de mergear** — NO con audit fix ciego en el server de prod. **No bloquea operación** (nada explota hoy; xlsx solo procesa Excels subidos por operadores admin_shipro que confían en la fuente).

---

## DEUDA 114 — Nomenclatura de vigencias inconsistente entre OperacionFee (`vigente*`) y las nuevas tablas config (`vigencia*`) (registrada 2026-07-31, scope chico, higiene)

**Status:** ABIERTA — deferred. Al implementar sub-piece 1 de config-variables de tarifa (2026-07-31, ver `docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md`) se detectó que `OperacionFee` ya tiene el patrón de vigencias implementado con la ortografía `vigenteDesde` / `vigenteHasta` / `activo` (schema `prisma/schema.prisma:1326-1328` y su único reader `lib/utils/operacion-fee.ts:48/50/54`). Las tablas nuevas de la misma sub-piece (`MarkupShiproVigencia`, `SmoCourier`) y la ya existente `CourierIntermediario` usan `vigenciaDesde` / `vigenciaHasta` — la casa camina hacia `vigencia*`. Coexisten dos ortografías para el mismo patrón; funciona, pero es ruido al leer y confunde en code review.

**Alcance del fix:** renombrar `OperacionFee.vigenteDesde` → `vigenciaDesde` y `OperacionFee.vigenteHasta` → `vigenciaHasta`. Requiere: migración de RENAME de columnas (no-op de datos) + actualizar `lib/utils/operacion-fee.ts` (líneas 48, 50, 54). Se dejó fuera de sub-piece 1 (config variables schema) para evitar cruzar el borde del motor de plata (fee reader) en un cambio que era puramente aditivo. Higiene chica, cerrar en una sesión dedicada.

---

## DEUDA 115 — UI para editar el SMO por courier (tabla ya existe, falta pantalla) (registrada 2026-08-01, scope chico-medio, producto/admin)

**Status:** ABIERTA. La tabla `SmoCourier` fue creada en sub-piece 1 de config-variables (commit `3a0ce72`, 2026-07-31) y es configurable por courier con vigencias — el esquema soporta cerrar la vigencia actual + abrir una nueva por courier sin pisar datos (asiento inverso). Hoy el valor se siembra vía `prisma/seed.ts` (SMO parejo $121.50 por courier, confirmado 2026-08-01). Falta la pantalla admin para editarlo desde la app: crear vigencia nueva por courier, ver histórico, cerrar la vigente. Necesaria en el corto plazo para los **+12 couriers en carpeta**, que tratarán el SMO distinto (incluido en tarifa, o valores distintos): sin UI cada alta forzaría un edit del seed + reseed, y encima no permite cambios en caliente sobre una BD viva.

**Alcance del fix:** pantalla admin (`admin_shipro`) con listado por courier del SMO vigente + acción "editar" (crea `SmoCourier` nueva y cierra la vigente con `vigenciaHasta=now`, mismo patrón que va a usar la UI del markup Shipro global — paso 2 del §7 de `docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md`). Nada de motor: la lectura del SMO desde `SmoCourier` la hace la sub-piece posterior del motor (paso 5 del mismo §7); esta DEUDA es sólo la pantalla de edición.

---

## DEUDA 116 — Herencia del markup Shipro global en el onboarding de courier (sub-pieza 2b) (registrada 2026-08-01, scope chico-medio, producto/pricing)

**Status:** ABIERTA. La sub-pieza 2a de config-variables (commit `9b6aa1d`, 2026-08-01) creó la pantalla admin para ver/editar el markup Shipro global (`MarkupShiproVigencia`, hoy 10%). Falta la pieza siguiente (sub-pieza 2b): que ese valor global aparezca como **default automático** en el flujo de onboarding cuando se da de alta un courier para un cliente (Rama A) — sin que el gerente tenga que copiar el número a mano al `CredencialCourier.ajusteTarifaPorcentaje`. Vacío/null en la credencial = "hereda el global vigente"; con valor = override puntual (ver DEUDA 117).

**Alcance del fix:** en el onboarding de courier (Fase I / wizard onboarding), leer la fila activa de `MarkupShiproVigencia` (`where activo=true order by vigenciaDesde desc`) y prellenar el campo de markup en el UI. La lectura desde `MarkupShiproVigencia` en el motor de plata se hace **junto con el cambio del motor** (paso 5 del §7 de `docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md`); antes de eso el motor todavía consume `CredencialCourier.ajusteTarifaPorcentaje` directamente, así que la herencia en el onboarding no cambia precios hasta que el motor pivotee. No requiere schema — `MarkupShiproVigencia` y el campo destino ya existen.

---

## DEUDA 117 — UI para el override del markup Shipro por empresa (gancho ya existe) (registrada 2026-08-01, scope chico, producto/admin)

**Status:** ABIERTA. El campo `CredencialCourier.ajusteTarifaPorcentaje` (schema `prisma/schema.prisma:428`) queda como **gancho de override opcional**: vacío/null = la credencial hereda el markup Shipro global (`MarkupShiproVigencia`, ver DEUDA 116); con valor = override puntual para ese par cliente↔courier. Sub-pieza 2a (commit `9b6aa1d`) shippeó la UI del global; falta la UI para pisar el global por cliente-courier puntual. Ver `docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md` §5.2.

**Alcance del fix:** en la pantalla de configuración de credenciales por empresa (o en admin-couriers per-empresa), permitir setear/limpiar `ajusteTarifaPorcentaje` con visualización explícita del "heredado del global vigente" cuando está vacío. El permiso ya está gated (`ajusteTarifaPorcentaje: ["admin_shipro", "gerente_cliente"]` en `lib/permisos.ts:55`) y auditado (`CAMPOS_AUDITABLES.ajusteTarifaPorcentaje` en `lib/auditoria-configuracion.ts:72`). Prioridad: no urgente — el gancho está listo; la UI del override viene después del cambio del motor (paso 5 del §7 del diseño).

---

## DEUDA 118 — IVA configurable (hoy constante, requiere caché para no romper imports síncronos) (registrada 2026-08-01, scope chico, config/pricing)

**Status:** ABIERTA — DEFERRED. Hoy el IVA argentino vive como constante en fuente única (`IVA_AR_MULTIPLIER` en `lib/constants/iva.ts`, consolidada en el commit `489cea4` del 2026-07-31). Se importa **síncronamente** en muchos sitios del motor de plata (`lib/cotizador.ts`, `lib/utils/operacion-fee.ts`, `app/api/conciliacion/route.ts`, `app/api/cron/sweep-6m/route.ts`, `app/api/admin/liquidaciones/route.ts`, `app/(dashboard)/liquidaciones/page.tsx`), así que hacerlo editable desde la config exigiría uno de: **(a)** volver asíncronas todas esas lecturas (cambio grande de firma, cruza el motor de plata en muchos sitios), o **(b)** cargar el valor una vez al bootstrap y cachear en memoria (más chico, pero requiere hook de invalidación cuando cambia). Ver `docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md` §5.5.

**Alcance del fix:** probable (b) — nueva tabla `IvaVigencia` (patrón de vigencias) + módulo de bootstrap que la lee al arranque y expone la constante actual + invalidación cuando se edita desde la UI admin. Prioridad **baja**: el IVA es la variable que MENOS cambia (alícuota por ley argentina, cada varios años); se mantiene como constante hasta que valga la pena hacer el mecanismo de caché.

---

## DEUDA 119 — Regla de negocio "SMO vs seguro completo" (cliente elige seguro por valor declarado) (registrada 2026-08-01, scope chico-medio, producto/pricing)

**Status:** ABIERTA. Regla de negocio identificada durante el diseño de config-variables (2026-07-31): cuando el cliente elige contratar **seguro por valor declarado** (bandera `quiereSeguroCourier=true` en `CredencialCourier`, ya en schema), el **SMO no se cobra** (SMO=0 para esa etiqueta) y el seguro real viene por la API del courier incluido en la tarifa cruda. La convivencia es toma-una-de-las-dos: SMO parejo por courier ($121.50, sembrado por seed) O seguro courier por valor declarado — no ambos. Hoy el flag `quiereSeguroCourier` existe pero los adapters no lo consumen y el motor tampoco lo lee.

**Alcance del fix:** al conectar el motor con `SmoCourier` (paso 5 del §7 de `docs/DISENO-MODELO-DATOS-CONFIG-VARIABLES.md`), añadir el gate: `SMO = quiereSeguroCourier ? 0 : SmoCourier.valorNeto vigente`. Los adapters de courier (Andreani, Moci's y futuros) deben leer `quiereSeguroCourier` para propagarlo a la API. Es **regla de negocio**, no config — no vive en tabla de vigencias, vive en la lectura del motor + la selección del cliente en el UI. Va con la pieza de **recolección/servicios** de FASE 2 (que reorganiza la elección del cliente sobre entrega + seguro + otros servicios). Ver `docs/DISENO-CONFIG-VARIABLES-TARIFA.md` §4.3.

---

## DEUDA 120 — Error genérico al bloquear un envío Rama A sin dueño de credencial (mensaje real no se propaga al frontend) (registrada 2026-08-01, scope chico, UX)

**Status:** ABIERTA. Detectada durante FASE 2 pieza 1 sub 3 (bloqueo `BLOQUEADO_CREDENCIAL`, commit `c85269d`, 2026-07-30). Cuando el flujo de creación de envío rechaza una credencial Rama A sin `propietarioTipo` seteado, el backend arma un mensaje claro (`CredencialSinPropietario: configurá el dueño en /configuracion/transportes`), pero el frontend muestra al operador un cartel genérico ("Error interno al crear el envío") — el mensaje real se pierde en el catch de la UI. El operador queda sin pista sobre qué configurar.

**Alcance del fix:** propagar el `error` real del response 4xx al toast/cartel de error en la UI de creación de envío (dashboard + wizard). Es un cambio local en el handler del catch (probablemente en `app/(dashboard)/pedidos/*` o el componente de creación de envíos). No toca la lógica del guard ni el estado bloqueado — sólo la superficie del mensaje. Scope chico.

---

## DEUDA 121 — Verificación pendiente: destrabe automático de BLOQUEADO_CREDENCIAL por vía e-commerce/API (registrada 2026-08-01, scope chico, verificación)

**Status:** ABIERTA. FASE 2 pieza 1 sub 3 (commit `c85269d`, 2026-07-30) introdujo el bloqueo `BLOQUEADO_CREDENCIAL` cuando se intenta crear un envío Rama A con credencial sin dueño, y el auto-unblock (`lib/envios/procesar-bloqueados-credencial.ts`, gatillado desde `app/api/configuracion/couriers/route.ts` tras setear el propietario — mirror del patrón de `operatividad`). Se verificó el **rechazo desde el panel** (dashboard) y el auto-unblock desde ahí. Falta probar EN VIVO el **rechazo por vía e-commerce/API** (POST directo a `/api/envios` con credencial sin dueño, sin sesión de dashboard) y su destrabe automático cuando `admin_shipro` completa el propietario — la vía dual-auth debe generar el mismo `BLOQUEADO_CREDENCIAL` y el retry debe reprocesarlo igual.

**Alcance:** test manual (curl o e-commerce sandbox) que dispare el POST sin dueño → verifica estado `BLOQUEADO_CREDENCIAL` en BD → setea propietario vía panel → verifica que la etiqueta pase de bloqueada a procesada. No requiere código nuevo, sólo verificación. Riesgo si no se hace: la vía API podría fallar silenciosa distinto al panel y quedar etiquetas colgadas.

---

## DEUDA 122 — Promociones de Fee con vencimiento automático (distinguir promo-0 de legacy-0) (registrada 2026-08-01, scope chico-medio, producto/pricing)

**Status:** ABIERTA. Hoy un Fee=0 (empresa sin `OperacionFee` activa) puede ser (a) una **promoción intencional temporal** (ej. "3 meses de bonificación para arrancar") o (b) **legacy / sin configurar** (empresa vieja pre-DEUDA-10 Paso 5a, o alta manual que se saltó el onboarding). El sistema NO los distingue — ambos caen bajo la misma rama "sin row → $0" en `calcularFeeOperacion` (`lib/utils/operacion-fee.ts:57-59`). La vista previa del ajuste masivo de Fee (FASE 2 sub 4 parte B PASO 1, commit `da27bcf`, 2026-08-01) hoy saltea todos los $0 por igual — un proporcional de 0 es 0 y no vale la pena forzar la creación de vigencias iniciales durante un ajuste masivo. Al implementar promociones, hay que **distinguir** promo-0 de legacy-0 para que las promos se ajusten (o al menos se marquen como necesitadas de revisión), y para que la promo termine sola cuando vence.

**Alcance del fix:** marcar un Fee=0 (o un valor bonificado en general) como PROMOCIÓN con `fechaVencimiento`. Al vencer, el Fee pasa solo al valor default post-promo — probablemente un cron que revise vigencias con promo vencida y genere la nueva vigencia con el valor "post-promo" (o simplemente jubile la promo y deje al motor caer en el default configurado). La fecha límite se setearía en el onboarding (`app/api/clientes/route.ts:172`) o vía el editor de sub-piece 4 parte A. Consecuencia sobre el ajuste masivo: promo-0 se ajusta (o al menos se lista aparte); legacy-0 sigue skippeado. Requiere schema (nuevo campo `fechaVencimiento` en `OperacionFee` o tabla lateral de promos) + cron + UI del gancho.

---

## DEUDA 123 — `CredencialCourier.tarifaIncluyeIva` default `true` es un footgun de SUBCOBRO (mordió en prod 2026-08-03) (registrada 2026-08-03, scope chico, PRIORIDAD ALTA, pricing/schema)

**Status:** ABIERTA — PRIORIDAD ALTA. El schema declara `tarifaIncluyeIva Boolean @default(true)` en `prisma/schema.prisma:438`, pero los adapters de Andreani y Moci's devuelven tarifa NETA (Andreani lee `data.tarifaSinIva.total` con fail-loud si falta; Moci's confirmado empíricamente 2026-07-21 que `opcionAkeron.price` viene sin IVA — ver `prisma/seed.ts:154-159`). El seed corrige las credenciales existentes con `prisma.credencialCourier.updateMany({ where: { nombreCourier: { in: ["Andreani", "Moci's"] } }, data: { tarifaIncluyeIva: false } })` (`prisma/seed.ts:161-163`), pero **cualquier credencial creada FUERA del seed nace en `true`** — típicamente vía el wizard de onboarding (`app/api/clientes/route.ts`, path que no toca `tarifaIncluyeIva`). Efecto: `aplicarMarkup` en `lib/cotizador.ts:156` toma la rama `secoNeto = seco.div(IVA_AR_MULTIPLIER)` sobre una tarifa que YA es neta → todos los precios cotizados quedan un factor `1/1.21 ≈ 0.826` más bajos: **SUBCOBRO de ~17.36%** (`1 - 1/1.21`) en cotización y en creación de envío (montoDebito y precioFactura).

**Confirmado en producción durante el deploy de FASE 2 (2026-08-03):** las 2 credenciales de Argenshipro SAS estaban en `true` (creadas fuera del seed) y cotizaban ~17% por debajo del valor esperado. Se corrigió a mano en la BD de prod con un `UPDATE "CredencialCourier" SET "tarifaIncluyeIva" = false WHERE "nombreCourier" IN ('Andreani', 'Moci''s')`. Sin envíos reales todavía, así que no hubo pérdida — pero el próximo cliente onboardeado lo dispararía otra vez.

**Alcance del fix:**
1. **Cambiar el default del schema** a `tarifaIncluyeIva Boolean @default(false)` en `prisma/schema.prisma:438` + migración de rename del default. No requiere backfill (los rows existentes conservan su valor).
2. **Endurecer el onboarding** (`app/api/clientes/route.ts` — la ruta que crea la CredencialCourier inicial) para setear explícitamente `tarifaIncluyeIva: false` al crear una credencial de Andreani o Moci's; opcionalmente extenderlo a todo `nombreCourier` conocido cuyo adapter devuelve neto (registry en `lib/couriers/serviciosSoportados.ts` o similar).
3. **Documentar la política**: el flag describe el SHAPE del número que devuelve el adapter (¿la API del courier ya sumó IVA?), NO una decisión comercial. Su valor debe ser conocido en el momento de dar de alta el courier — no es negociable por empresa. Este comentario ya vive en `lib/cotizador.ts:151-155` y en `prisma/seed.ts:154-159`; conviene consolidarlo en el schema.

---

## DEUDA 125 — Endurecer el alta de `CredencialCourier`: exigir `propietarioTipo` en credenciales Rama A al crearlas (registrada 2026-08-03, scope chico, hardening/onboarding)

**Status:** ABIERTA. El único creador de `CredencialCourier` en el sistema es el upsert en `app/api/configuracion/couriers/route.ts:301`. Su cuerpo aplica un set de `Patch` (activo, usaCredencialesPropias, credencialesJson, servicios, ajuste, markup, seguro, tipoCuenta, propietarioTipo, propietarioCourierId) donde cada uno se gate'ea por rol vía `puedeEditarCampo` — pero **el patch de `propietarioTipo` puede quedar vacío** cuando el rol que llama no puede editarlo (típico: `gerente_cliente` en el onboarding no tiene el permiso). Resultado: una credencial Rama A (`usaCredencialesPropias=false`) puede nacer sin `propietarioTipo` seteado, y `admin_shipro` tiene que completarlo después. Esto mordió en el deploy FASE 2 (2026-08-03): las dos credenciales de Argenshipro SAS se crearon con `propietarioTipo=null` y tuvieron que parchearse a mano en prod.

**Red de seguridad actual (funciona pero es post-hoc)**: la sub-pieza 3 de FASE 2 pieza 1 (commit `c85269d`, 2026-07-30) agregó el guard `BLOQUEADO_CREDENCIAL` en `lib/envios/crear.ts`: cualquier intento de crear un envío Rama A sobre una credencial con `propietarioTipo=null` bloquea el envío (no llama al courier, no debita), lo etiqueta `BLOQUEADO_CREDENCIAL`, y se destraba automáticamente cuando `admin_shipro` completa el dueño (`lib/envios/procesar-bloqueados-credencial.ts`). El resultado observable: **ningún envío sale silenciosamente mal cotizado** — pero el operador entra a una experiencia post-hoc de "creé la credencial y ahora los envíos caen bloqueados hasta que el admin la termine de configurar".

**Alcance del fix**: en el upsert de `app/api/configuracion/couriers/route.ts` (rama `create` — la de nacimiento), rechazar con 400 (`error: "PropietarioRequerido: las credenciales Rama A requieren propietarioTipo. Configuralo antes de guardar."`) toda combinación `usaCredencialesPropias=false && propietarioTipo=null`. Sub-cases:
- Si el rol del caller no tiene permiso para editar `propietarioTipo` (matriz `lib/permisos.ts`), pero está creando una credencial Rama A → 403 con un mensaje que explique que la creación inicial de credenciales Rama A la debe hacer `admin_shipro` (o extender la matriz para permitir a `gerente_cliente` setear el campo al alta, decisión de producto).
- El path de UPDATE existente (que puede llevar una credencial Rama A a `propietarioTipo=null` retroactivamente) también debería rechazar la transición → null si `usaCredencialesPropias=false`.
- Testear específicamente el path e-commerce/API que también terminó relacionado con DEUDA 121 (verificación de destrabe API de BLOQUEADO_CREDENCIAL).

**Relación con otras deudas**:
- Cierra el modo de falla que originó DEUDA 124 ítem (d) (credenciales Rama A born con owner null).
- Complementa DEUDA 121 (verificación EN VIVO del destrabe de BLOQUEADO_CREDENCIAL por la vía API): DEUDA 125 previene el bloqueo, DEUDA 121 verifica que el destrabe funciona cuando aparece.
- Relacionada con DEUDA 120 (el mensaje de error genérico "Error interno al crear el envío" que oculta el mensaje real): al implementar DEUDA 125, propagar el error 400 con mensaje claro tanto al panel como a la vía API.

**Prioridad**: FASE 4 (pre-primer-cliente hardening) — no bloquea la operación con Argenshipro (parche a mano ya aplicado), pero sí bloqueante para onboarding masivo (cada cliente nuevo que se cree por gerente_cliente puede caer en el mismo modo de falla y requerir intervención admin post-hoc).

---

## DEUDA 126 — `/api/envios/rastreo-manual` sigue leakeando PII del comprador en su DTO (SEGURIDAD/PRIVACIDAD) (registrada 2026-08-03, scope chico, seguridad)

**Status:** ABIERTA. Descubierta durante el recon de DEUDA 106 pieza 1 (2026-08-03). `POST /api/envios/rastreo-manual` (`app/api/envios/rastreo-manual/route.ts`) es un endpoint `PUBLIC_API_EXACT` (`proxy.ts:11`) que hand-picka un DTO — a diferencia de la vieja versión de buscar, este ya NO devuelve `saldoActivo/limiteDescubierto/apiKeyHash/cuit/direccionFiscal*` (bien). PERO **sí devuelve el bloque completo de destinatario con PII**: `documento` (DNI), `email`, `telefono`, `direccionStr`, `localidad`, `cp` (`route.ts:68-76`). Cualquiera con un tracking (que no es secreto — viaja por mail, en la etiqueta) puede leer el DNI/email/teléfono del comprador de ese envío. Misma clase de leak que DEUDA 106 pieza 1 en un endpoint distinto.

**Alcance del fix (chico):**
- Trim del bloque `destinatario` del DTO: quitar `documento`, `email`, `telefono`. Mantener sólo lo que la UI de rastreo público realmente necesita (nombre para saludo + localidad para contexto — la dirección completa NO es necesaria en la vista de rastreo).
- Considerar aplicar el mismo `verificarAccesoEnvio` que ahora vive en buscar. Complicación: `rastreo-manual` está en `PUBLIC_API_EXACT` (no en `DUAL_EXACT`), y su único caller runtime es `components/AccionesEnvio.tsx:80` (dashboard, session-gated en la práctica). Opciones: (a) migrar a `DUAL_EXACT` + gate ownership (cierra el path anónimo); (b) mantener público pero sólo trimmear PII (deja el endpoint como una API de rastreo pública real, correcta si el producto lo quiere así). Decidir con producto.
- Consumidor único a verificar: `components/AccionesEnvio.tsx` — leer qué campos del `envio.destinatario` renderiza y validar que la trimmed version le alcanza.

**Relación con DEUDA 106**: misma clase (endpoint tracking-as-key devolviendo PII de más). Se separa como deuda propia porque el endpoint es distinto y su clasificación en el proxy es distinta — no comparte el fix con PIEZA 1 (que fue cirugía sobre buscar) ni con PIEZA 2 (que introduce el token).

**Prioridad:** media. Menos grave que DEUDA 106 pieza 1 (no leaka finanzas de empresa), pero sigue exponiendo PII del comprador. Cerrar antes del onboarding masivo.

---

## DEUDA 127 — `magicLink` a `/fix/[orden]` en `/api/checkouts` apunta a una ruta que NO existe (limpieza / seguridad futura) (registrada 2026-08-03, scope chico, limpieza)

**Status:** ABIERTA. Descubierta durante el recon de DEUDA 106 (2026-08-03). En `app/api/checkouts/route.ts:82` el código construye:
```
const magicLink = `https://shipro.pro/fix/${id_orden}`;
```
y lo devuelve en el response como `magicLinkGenerado` (`route.ts:93`). PERO **no existe** una página `app/fix/[orden]/page.tsx` ni un handler `app/api/fix/*` — grep en el repo confirma cero coincidencias. El URL emitido es o bien (a) una feature nunca-shippada (stub que se dejó en el response), o (b) apunta a una app externa/servicio distinto que no vive en este repo.

**Alcance del fix (decidir con producto):**
- **Opción A — construir el flujo**: si el producto quiere que el comprador pueda "arreglar" un checkout desde ese link, construir la página `/fix/[orden]` con autenticación decente (token + proyección segura, mismo mecanismo que DEUDA 106 pieza 2). Cuidado: el `id_orden` es también no-secreto (adivinable/enumerable), aplica la misma lógica que tracking.
- **Opción B — remover la emisión muerta**: si el flujo no existe ni va a existir, borrar la construcción del `magicLink` de `route.ts:82` y su emisión en `magicLinkGenerado` — evita que consumidores de la API confíen en un URL que 404-a.

**Relación con DEUDA 106 pieza 2:** misma clase de problema en un subsistema distinto (checkout vs envíos). Si se resuelve como Opción A, reutilizar el mecanismo de token de PIEZA 2.

**Prioridad:** baja. No es una vulnerabilidad activa (el URL no lleva a nada), pero es un dangling emission que confunde a integradores y es una superficie de riesgo si en el futuro alguien construye la página sin auth.

---

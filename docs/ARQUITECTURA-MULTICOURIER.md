# ARQUITECTURA MULTICOURIER - DEUDA 29

## Diseno completo para Plataforma Shipro 2.0

**Fecha de diseno:** 6 de mayo de 2026
**Autor del diseno:** Sesion colaborativa Nacho Albinati + Claude (arquitecto)
**Implementador:** Claude Code en Cursor
**Estado:** Listo para implementacion

---

## 1. RESUMEN EJECUTIVO

Este documento contiene el diseno completo de la arquitectura multi-courier multi-sucursal para Shipro 2.0. Resuelve la DEUDA 29 (bug critico de cotizacion con origen incorrecto) y establece la base para integrar 12-15 couriers heterogeneos.

**Alcance MVP (15 dias):** Andreani y Mocis refactorizados con la nueva arquitectura + 1-2 couriers nuevos como prueba de concepto.

**Alcance completo (7 meses):** Todos los couriers integrados, UI completa, plugins de e-commerce.

**Regla para Claude Code:** Antes de implementar cada bloque, explica que vas a hacer y espera confirmacion de Nacho. Nunca tomes decisiones que contradigan lo que esta documentado aca sin consultar primero.

---

## 2. DECISIONES EXPLICITAS DEL DISENO

Esta lista enumera cada decision tomada durante la sesion de diseno. Claude Code NO debe cuestionarlas ni cambiarlas sin aprobacion de Nacho. Si alguna genera conflicto tecnico al implementar, consulta antes de modificar.

### Modelo conceptual

1. **Un envio es una cadena de tramos**, no un evento atomico. Tiene origen (deposito del cliente) y destino (direccion del comprador), con 1 a N etapas operativas entre medio.
2. **Los hubs internos del courier NO se modelan.** Son operacion interna de cada courier (clasificacion, cross-dock, etc.). La plataforma solo modela los tramos visibles: que courier es responsable de cada parte del recorrido.
3. **N tramos desde el inicio**, no 2 hardcoded. Cuesta lo mismo disenar bien que mal. Si se modela para 2, agregar un tercero requiere migracion.
4. **El "tramo del cliente" (drop-off) NO se modela como fila** en la tabla de tramos. Se modela como atributo del envio (tipoOrigen). El cliente no es un courier y no tiene tracking.
5. **El comprador siempre ve UN courier y UN precio.** La composicion interna de la cadena es invisible para el comprador.

### Cobertura geografica

6. **Siempre preguntar al courier para cobertura de destino**, no guardar cobertura en la BD. Cada courier es la fuente de verdad de sus tarifas y su cobertura. No duplicamos esa informacion.
7. **Cobertura de origen se valida al activar el courier**, no al cotizar. Si Mocis no opera en Cordoba, eso se detecta cuando admin_shipro o gerente_cliente activan Mocis para el cliente.
8. **Eliminar los campos tipoAlcance, provinciasCobertura y localidadesActivas de CredencialCourier.** Estan inactivos en produccion (todas las listas vacias). localidadesActivas nunca se uso en ningun archivo del codigo. Si en el futuro se quiere un "filtro voluntario del cliente" (limitar donde ofrece un courier), se disena como feature nueva con modelo y UI propios.

### Sucursales y puntos

9. **Tabla unica SucursalCourier** para todos los couriers. Campos comunes en columnas explicitas (para poder filtrar y consultar), JSON solo para datos de display.
10. **Columnas explicitas para todo campo que se use en logica**: aceptaB2B, aceptaB2C, tieneBuzonInteligente, aceptaAdmision, aceptaEntrega, aceptaDevolucion.
11. **Soft delete con fechaUltimaConfirmacion.** Las sucursales no se borran porque hay envios historicos que las referencian.
12. **Sincronizacion manual desde admin_shipro en el MVP** (boton "Sincronizar sucursales de X" con logging). Sincronizacion automatica queda como deuda post-MVP.
13. **Sucursal del deposito por courier**: la asignacion depende de la modalidad operativa del courier deducida por el sistema segun la configuracion del cliente en Mis Transportes.
    - Si el courier recoge en el deposito del cliente: la sucursal se **asigna automaticamente** buscando cual atiende el CP del deposito. El cliente NO elige. La plataforma confia en la operativa del courier.
    - Si el cliente lleva los paquetes a una sucursal del courier (drop-off): el cliente **elige manualmente** entre las sucursales del courier, con sugerencia automatica de la mas cercana al deposito. La eleccion se guarda en DepositoSucursalPreferida.
    - Si hay courier recolector consolidador: la sucursal del courier recolector se asigna automaticamente (por CP del deposito del cliente). La sucursal de los couriers de ultima milla tambien se asigna automaticamente, pero usando el CP del deposito del courier recolector (no del cliente).
    Almacenamiento: solo se persiste la eleccion manual del cliente (caso drop-off). Las asignaciones automaticas se calculan al momento del despacho usando SucursalCourierCp, para que reflejen siempre la operativa vigente del courier.
14. **Haversine en servidor para distancias, Google Maps solo para autocompletado de direcciones.** Haversine es matematica pura, gratis y sin rate limit. Google Maps se reserva para donde realmente se necesita.
15. **Performance geoespacial: bounding box + Haversine.** Pre-filtrar por rango aritmetico de latitud/longitud (usa indice), despues calcular distancia Haversine solo sobre el subconjunto.

### Configuracion del courier por cliente

16. **First-Mile es configuracion global por courier (Opcion A pura).** Se decide al activar el courier. NO hay override por envio. Las excepciones puntuales se resuelven operacionalmente: el cliente no le entrega el paquete a Mocis y lo lleva directo a la sucursal del courier de ultima milla. La etiqueta ya esta emitida y es valida. Sin codigo adicional.

    **[ACTUALIZACION - 2026-05-19]:** Decision invalidada. El First-Mile NO se configura globalmente por courier ni se decide al activar el courier. Es deducido por el sistema segun cobertura del CP del deposito + flag dropOffCliente del par. Ver decision #49.
17. **Logistica inversa granular: 3 sub-capacidades.** aceptaInversaCambioMercaderia, aceptaInversaSoloRetiro, aceptaInversaDropOff. Cada una mapea a un flujo de negocio distinto.
18. **9 capacidades booleanas en la tabla Courier.** Son la base para validar combinaciones y filtrar couriers candidatos.
19. **Inmutabilidad direccional Modelo A/B.** admin_shipro decide en onboarding si el cliente puede usar Modelo A (credenciales Shipro). El gerente_cliente puede ir A->B (obtener credenciales propias), pero NO B->A (las credenciales de Shipro son recurso comercial).
20. **Empresa.modeloAHabilitado** (boolean, default segun admin_shipro).
21. **modoFirstMile + courierRecolectorId reemplazan** el string legacy courierRecolector. Migracion: "pickup" -> modoFirstMile = "mismo_courier", courierRecolectorId = null.

    **[ACTUALIZACION - 2026-05-19]:** Decision modificada. Al profundizar en el ejemplo operativo de 3 couriers (Mocis consolidador + Andreani + un tercer courier con coberturas mixtas en CABA/GBA/Cordoba), se detecto que el modelo era incorrecto. modoFirstMile NO es un atributo configurado por el cliente: es deducido por el sistema segun cobertura del CP del deposito + flag dropOffCliente del par. courierRecolectorId NO va por par: hay como maximo 1 recolector por deposito (regla operativa: una camioneta no pasa 2 veces por el mismo deposito), asi que se modela como Deposito.courierRecolectorId. Lo unico que el cliente decide por par (deposito x courier) es dropOffCliente y recogeViaConsolidador (booleans). Ver decision #49 (al final de esta seccion) y secciones 6.11 (DepositoCourierConfig rectificada) y 6.12 (Deposito - campo nuevo) para el modelo final.
22. **Validaciones cruzadas** capacidades del courier vs. configuracion del cliente al activar, en frontend (feedback inmediato) Y backend (defense in depth).
23. **Wizard de 5 pasos** para activar un courier: elegir courier -> credenciales -> First-Mile -> sucursal de imposicion -> ajustes comerciales. Defaults inteligentes en cada paso.
24. **Defaults inteligentes**: Modelo A si esta habilitado, First-Mile "mismo_courier", sucursal mas cercana al deposito, markup 0%.

### Tramos del envio

25. **Error handling diferenciado en 3 categorias:** (a) transitorios (retry con backoff), (b) validacion (BLOQUEADO_PARCIAL inmediato), (c) autorizacion (BLOQUEADO_CREDENCIALES + alerta).
26. **Estados bloqueados ortogonales con orden de resolucion:** DEPOSITO -> SALDO -> PARCIAL -> CREDENCIALES. Banner inteligente de DEUDA 4 los presenta en este orden.
27. **Idempotencia:** pasar Envio.id como external_reference al courier al crear envio. Evita duplicados ante reintentos.
28. **Creacion de tramos en secuencia**, no en paralelo. Si el primero falla, el segundo no se llama. Coherencia importa mas que velocidad en logistica.
29. **Respuesta al e-commerce: HTTP 200 + flag** bloqueadoPorTramoFallido. NUNCA 500. La venta no se cae por una falla de tramo.
30. **Sincronizacion Envio.estadoActual con tramos:** application-level, funcion pura recalcularEstadoEnvio. Se invoca explicitamente cuando un tramo cambia.
31. **Nomenclador por tramo:** cada tramo usa el nomenclador de su propio courier.
32. **Estado fallback ESTADO_DESCONOCIDO + alerta** a admin_shipro cuando un courier devuelve un estado que no existe en el nomenclador.

### Cotizacion y precios

33. **En logistica, la cotizacion es una estimacion referencial, NO contractual.** El courier factura lo que mide al procesar el paquete, no lo que se cotizo. La plataforma no necesita re-validar precios al cierre de venta.
34. **CotizacionSnapshot: proposito analytics y tracking de conversion**, no validacion temporal. Sin campo validaHasta.
35. **Escudo Tarifario:** la discrepancia entre cotizacion y facturacion real del courier ya esta modelada en FinanzasEnvio. Lo que se agrega es la UX de visualizacion.
36. **Devoluciones inteligentes:** se arman como cadenas independientes del envio original. La plataforma elige el courier de devolucion segun conveniencia operativa (cercania del drop-off al comprador, trazabilidad), no segun el courier de ida.

### Performance

37. **Llamada en vivo a couriers en cada cotizacion** (decision MVP). Sin cache.
38. **Paralelizacion** de llamadas a todos los couriers activos del cliente, simultaneamente.
39. **Timeout escalonado por courier** (campo timeoutCotizacionMs en tabla Courier). Mocis: 3000ms. Andreani/OCA: 6000-7000ms. Couriers nuevos: 8000ms.
40. **Tolerancia a fallos parciales.** Si 3 de 5 couriers responden, se muestran esas 3 opciones. El comprador nunca se entera de las que faltaron.
41. **Connection pooling (keep-alive HTTP)** en cada adapter. Ahorra 200-500ms por llamada evitando TCP+TLS handshake.
42. **Pre-filtro de capacidades** antes de llamar a couriers. No llamar a couriers que sabemos que no aplican (inactivos, sin capacidad de entrega al tipo solicitado, etc.).
43. **Sin cache de cotizaciones en MVP** (YAGNI). Documentado como DEUDA 30.
44. **Logging de latencia** por courier y operacion en MetricaCourierLatencia.
45. **Manejo de falla total:** cuando TODOS los couriers fallan, buscar en HistoricoCotizaciones el promedio de ultimos 30 dias. Mostrar como estimado con mensaje claro al comprador.

### UX

46. **UX comparativa en 2 secciones:** "Envio a domicilio" y "Retiro en punto". Cada seccion con sus opciones ordenadas segun configuracion del cliente.
47. **SLA pactado en checkout** (lo que el courier promete), SLA real en motor de ruteo interno.

48. **Modalidad de asignacion de sucursal por courier (logica hibrida BD + codigo).** Cada courier tiene su propia politica de como se asigna la sucursal operativa para un deposito. La plataforma se adapta a 3 tipos:
    - `por_cp_origen`: el courier define que sucursal atiende cada CP (ejemplo: Andreani). La plataforma usa SucursalCourierCp para auto-asignar.
    - `libre_cercania`: el courier acepta operar desde cualquier sucursal (decision interna del courier que camioneta envia). El cliente elige entre las top 3-5 sucursales mas cercanas (ejemplo potencial: OCA, Correo Argentino).
    - `sucursal_unica`: el courier tiene 1 sola sucursal operativa. Asignacion trivial (ejemplo: Mocis).
    Implementacion: el tipo vive en el codigo del adapter de cada courier (no hay campo en BD por ahora). Si en el futuro aparece necesidad de cambiar la modalidad sin tocar codigo, evaluamos agregar campo `modalidadAsignacionSucursal` en tabla Courier. YAGNI hasta que se justifique con un caso real.

49. **Modelo de First-Mile rectificado (2026-05-19).** Despues de analizar el ejemplo operativo de 3 couriers (Mocis consolidador + Andreani + un tercer courier con coberturas mixtas), se descarta el modelo de "modoFirstMile como atributo configurado por el cliente". Nueva descomposicion:

    a) **El modo de First-Mile es DEDUCIDO, no configurado.** Lo deduce el sistema combinando: (i) si existe un `Deposito.courierRecolectorId` Y el courier cubre el CP del recolector, modo "consolidador" via recogeViaConsolidador del par; (ii) si `DepositoCourierConfig.dropOffCliente=true`, modo "drop_off_cliente"; (iii) caso contrario, modo "mismo_courier" (courier recoge en CP del deposito del cliente). El cliente no elige el modo: elige los inputs (recogeViaConsolidador, dropOffCliente).

    b) **El recolector es por deposito, no por par.** Hay como maximo 1 recolector activo por deposito (regla operativa: una camioneta de Mocis no puede pasar 2 veces por el mismo deposito). Se modela como `Deposito.courierRecolectorId` (FK opcional al Courier consolidador). La regla "1 solo recolector por deposito" pasa de ser validacion explicita en endpoint a ser limitacion estructural de la fila.

    c) **Lo unico que el cliente decide por par (deposito x courier) es:**
       - `dropOffCliente: Boolean` (default false). Cuando true, fuerza modo "drop_off_cliente" para ese courier desde ese deposito.
       - `recogeViaConsolidador: Boolean` (default false). Cuando true (y existe `Deposito.courierRecolectorId`), el courier recoge en el deposito del consolidador (usa `Courier.cpDepositoConsolidador` del recolector). Cuando false, el courier recoge en el deposito del cliente.

    d) **Reglas de elegibilidad para activar un courier:** un courier solo aparece como opcion para un deposito si cubre uno de estos 2 CPs: (i) el CP del deposito del cliente, (ii) el CP del consolidador del deposito (si esta configurado). Si no cubre ninguno, el courier NO es elegible. La validacion la hace el sistema al ofrecer opciones (no la elige el cliente). El cliente confirma una de las opciones elegibles.

    e) **`Courier.cpDepositoConsolidador` se mantiene.** Es el CP central del consolidador (donde otros couriers vienen a recoger tras la consolidacion). Para Mocis = "1702".

    Migracion: la tabla `DepositoCourierConfig` (creada en commit 6.D.1 con `modoFirstMile` + `courierRecolectorId`) se reestructura en commit 2 de esta rectificacion para tener solo `dropOffCliente` + `recogeViaConsolidador`. Los campos `modoFirstMile` y `courierRecolectorId` de CredencialCourier (decision #21) se eliminan; el segundo se materializa como `Deposito.courierRecolectorId`. Detalle completo en secciones 6.11 (DepositoCourierConfig rectificada) y 6.12 (Deposito - campo nuevo).

    **Cascada inteligente al PUT del deposito (implementada en commit 3add6cc, 2026-05-20):** cuando el cliente cambia `Deposito.courierRecolectorId` via PUT al endpoint del deposito, el backend ejecuta una cascada atomica:
       - **Set null (quita consolidador):** resetea `recogeViaConsolidador=false` en todas las configs del deposito que lo usaban.
       - **Set X (asigna por primera vez, previo era null):** NO auto-setea nada. Reporta en `response.cambiosCascada.eligiblesParaActivar` los couriers que cubren `Courier.cpDepositoConsolidador` del nuevo recolector. El cliente decide despues si activar `recogeViaConsolidador=true` en cada par via PUT al endpoint de courier-configs.
       - **Set Y (cambia consolidador, previo era X≠Y):** para cada config con `recogeViaConsolidador=true`, verifica si su courier cubre `Courier.cpDepositoConsolidador` de Y. Si cubre, preserva el flag (reporta en `recogeViaConsolidadorPreservado`). Si no cubre, resetea a false (reporta en `recogeViaConsolidadorReset`).

    La cascada y el update del `Deposito.courierRecolectorId` van en la misma transaccion Prisma (atomicidad garantizada). El response incluye `cambiosCascada` solo cuando hubo cambio real (no-op si previo === nuevo).

    Validacion best-effort de cobertura del CP del deposito por el consolidador: si el consolidador no tiene filas en `SucursalCourierCp` (caso Mocis, modelado con sucursal unica via `cpDepositoConsolidador`), SKIP la validacion y reporta el motivo en `skipsDeValidacion`. Resolvera DEUDA 32 post-MVP.

    **UX del consolidador (DEUDA 33 - RESUELTA 6.D.7):** el selector de courier recolector y el modal de confirmacion que muestra los couriers afectados antes de aplicar el cambio estan implementados en DepositoForm. El backend expone un modo dry-run (?dryRun=true) que computa la cascada sin escribir.

---

## 3. QUE PROBLEMA RESUELVE

### El bug original

Al final de DEUDA 4 (modulo de depositos), se detecto en smoke test que las cotizaciones daban precios incorrectos cuando el origen no era AMBA:

- Cotizacion origen CP 5000 (Cordoba) -> destino CP 1900 (La Plata).
- Mocis aparecio como opcion aunque NO opera fuera de AMBA.
- Andreani devolvio tarifa de ~$8.000 (precio AMBA->La Plata) en lugar de ~$15-25k (Cordoba->La Plata).

### Causa raiz

**Andreani:** el adapter (lib/couriers/AndreaniAdapter.ts) no manda el parametro sucursalOrigen al cotizar. La API de Andreani lo acepta como opcional y usa un default interno (probablemente una sucursal AMBA del contrato). Resultado: siempre cotiza como si el origen fuera AMBA.

**Mocis:** la API de Mocis no tiene campo para origen en cotizacion. Mocis siempre cotiza desde su deposito central. El adapter cotiza correctamente segun la logica de Mocis, pero la plataforma no sabe que Mocis solo puede recoger en zona AMBA, asi que lo ofrece como opcion para cualquier origen.

### Por que no es un parche simple

El bug no se resuelve agregando un campo al adapter de Andreani. Es un problema de arquitectura:

- Cada courier maneja el concepto de "origen" de forma distinta (sucursal ID, CP, direccion completa, implicito en la cuenta).
- La plataforma necesita modelar couriers heterogeneos con una interface unificada.
- La plataforma necesita saber cuando un courier es candidato viable ANTES de cotizar.
- La plataforma necesita soportar cadenas logisticas multi-actor (Mocis recoge -> Andreani entrega).

### Dato contextual para Claude Code

El flujo de first-mile con courier consolidador (Mocis recogiendo para Andreani) NUNCA corrio en produccion. Existe codigo teorico en lib/envios/dispatch.ts, app/api/envios/cancelar/route.ts, app/api/envios/corregir/route.ts, app/api/etiquetas/masiva/route.ts y components/configuracion/TransportesTab.tsx, pero hay 0 envios con trackingFirstMile no nulo en la BD. El valor courierRecolector es "pickup" en las 4 credenciales existentes (legacy).

Esto significa: el refactor de DEUDA 29 reemplaza codigo teorico no probado, no codigo productivo. La primera implementacion real de cadena multi-courier va a ser con la nueva arquitectura de tramos.

---

## 4. PRINCIPIOS QUE GUIAN LAS DECISIONES

Estos principios aplican a cada decision de implementacion. Cuando haya ambiguedad sobre como resolver algo, recurrir a estos principios.

1. **"Trust the source of truth"** - cada courier sabe su cobertura y sus tarifas. No replicamos esa informacion en nuestra BD. Le preguntamos al courier cada vez que necesitamos el dato.

2. **"Cuesta lo mismo hacer las cosas bien que mal"** - cuando hay opcion A (parche) vs B (refactor correcto), elegir B salvo justificacion fuerte. Ejemplo: N tramos en vez de 2 hardcoded.

3. **"El usuario manda"** (Escenario 3 de DEUDA 4) - si la plataforma sugiere algo (ej. sucursal mas cercana), el usuario puede sobrescribir. Nunca forzar.

4. **"Operacion antes que relato"** - las excepciones operacionales se resuelven operacionalmente. No sobre-ingenieria para cubrir edge cases que la realidad operacional ya resuelve.

5. **DRY - Don't Repeat Yourself** - lo reutilizable se modifica en un solo lugar.

6. **Defense in depth** - el backend valida igual que el frontend. Nunca confiar solo en validacion del navegador.

7. **"Make the constraint visible"** - el sistema le muestra al usuario que espera, en lugar de corregir silenciosamente.

8. **Soft delete para entidades referenciadas** - no borrar fisicamente lo que tiene envios historicos apuntando. Marcar como eliminado.

9. **Snapshot para datos historicos** - cuando un dato puede cambiar con el tiempo pero un evento historico debe preservar el estado del momento.

10. **YAGNI para infraestructura compleja** - no implementar cache, jobs automaticos, ni optimizaciones sin datos que justifiquen la necesidad.

---

## 5. MODELO CONCEPTUAL

### La cadena logistica

Un envio en Shipro 2.0 se compone de tramos. Cada tramo tiene un courier responsable con su propio tracking.

**Los 5 casos de cadena:**

**Caso 1 - Cadena corta, entrega a domicilio:**
```
[Deposito cliente] -> [Andreani recoge y entrega] -> [Comprador recibe en casa]
```
1 tramo: tipo=ciclo_completo, courierId=Andreani.

**Caso 2 - Cadena con consolidador:**
```
[Deposito cliente] -> [Mocis recoge] -> [Andreani entrega] -> [Comprador recibe]
```
2 tramos: Tramo 1 (recoleccion, Mocis), Tramo 2 (entrega, Andreani).

**Caso 3 - Drop-off del cliente:**
```
[Cliente lleva a sucursal Andreani] -> [Andreani entrega] -> [Comprador recibe]
```
1 tramo: tipo=entrega, courierId=Andreani, sucursalOrigenId=sucursal donde el cliente dejo el paquete.

**Caso 4 - Retiro en sucursal/punto por el comprador:**
```
[Deposito cliente] -> [Andreani recoge y lleva a sucursal] -> [Comprador retira]
```
1 tramo: tipo=ciclo_completo, courierId=Andreani, sucursalDestinoId=sucursal elegida por el comprador.

**Caso 5 - Devolucion:**
```
[Comprador deja en Punto Pickit] -> [Pickit entrega en deposito cliente]
```
1 tramo: tipo=entrega, courierId=Pickit, sucursalOrigenId=punto donde dejo el comprador.

### Lo que ve el comprador

En todos los casos: un solo courier visible y un solo precio. Nunca ve la composicion. Si Mocis recoge y Andreani entrega, el comprador ve "Andreani $1500".

### La etiqueta

Una sola etiqueta por envio (la del courier de ultima milla). Cuando hay First-Mile alternativo (ej. Mocis), se agrega un codigo QR del courier consolidador en la etiqueta del Last-Mile. Para generar ese QR, se crea un "envio de recoleccion" en Mocis.

### La trazabilidad

Cuando hay cadena con 2 couriers, se toma la trazabilidad de Mocis (tramo 1) y se le suma la de Andreani (tramo 2), en orden cronologico. Cada estado crudo del courier se mapea con el Nomenclador existente a estados unificados de Shipro. El resultado: una historia unica y limpia para el usuario.

---

## 6. MODELO DE DATOS

### 6.1 Tabla Courier - campos nuevos

Agregar estos campos a la tabla Courier existente:

```prisma
model Courier {
  // --- Campos existentes (NO tocar) ---
  id                Int      @id @default(autoincrement())
  nombre            String   @unique
  activo            Boolean  @default(true)
  emailSoporte      String?
  telefonoSoporte   String?
  contactoComercial String?
  logoUrl           String?

  // --- CAMPOS NUEVOS: Capacidades de cadena ---
  puedeRecogerDomicilio       Boolean @default(true)
  puedeConsolidar             Boolean @default(false)
  puedeEntregarDomicilio      Boolean @default(true)
  puedeEntregarSucursal       Boolean @default(false)
  aceptaDropOff               Boolean @default(false)
  tieneSucursales             Boolean @default(false)

  // --- CAMPOS NUEVOS: Capacidades de logistica inversa ---
  aceptaInversaCambioMercaderia Boolean @default(false)
  aceptaInversaSoloRetiro       Boolean @default(false)
  aceptaInversaDropOff          Boolean @default(false)

  // --- CAMPO NUEVO: Performance ---
  timeoutCotizacionMs  Int     @default(7000)

  // --- Relaciones existentes (NO tocar) ---
  envios            Envio[]
  nomencladores     Nomenclador[]
  encuestasNPS      EncuestaNPS[]
  metricasSLA       MetricaSLA[]
  slas              SlaCourier[]

  // --- Relaciones nuevas ---
  sucursales        SucursalCourier[]
  tramos            TramoEnvio[]
  latencias         MetricaCourierLatencia[]
}
```

**Valores iniciales para los couriers del MVP:**

| Courier | recogerDom | consolidar | entregarDom | entregarSuc | dropOff | tieneSuc | inversaCambio | inversaRetiro | inversaDropOff | timeoutMs |
|---|---|---|---|---|---|---|---|---|---|---|
| Andreani | true | false | true | true | true | true | ? | ? | ? | 7000 |
| Mocis | true | true | true | false | false | false | false | false | false | 3000 |
| OCA | true | false | true | true | true | true | true | true | ? | 7000 |
| Correo AR | true | false | true | true | true | true | ? | ? | ? | 7000 |
| Urbano | true | false | true | true | true | true | ? | ? | ? | 7000 |
| Hop | true | false | false | true | true | true | ? | ? | true | 7000 |
| Pickit | true | false | true | true | true | true | ? | ? | true | 7000 |
| Moova | true | false | true | false | false | false | ? | ? | false | 8000 |
| DPD AR | true | false | true | false | false | false | ? | ? | ? | 8000 |

Los ? se completan al integrar cada courier con su documentacion.

### 6.2 Tabla CredencialCourier - cambios

**Campos a ELIMINAR:**
```
tipoAlcance           // Inactivo, logica inerte
provinciasCobertura   // Filtro nunca actua (todas vacias)
localidadesActivas    // 100% muerto en codebase
courierRecolector     // Reemplazado por modoFirstMile + courierRecolectorId
```

**Campos nuevos a AGREGAR:**

```prisma
model CredencialCourier {
  // --- Campos existentes que se mantienen ---
  id                     Int      @id @default(autoincrement())
  empresaId              Int
  empresa                Empresa  @relation(fields: [empresaId], references: [id])
  nombreCourier          String
  activo                 Boolean  @default(true)
  usaCredencialesPropias Boolean  @default(true)
  credencialesJson       String?
  tipoCuenta             String?
  ofreceDomicilio        Boolean  @default(true)
  ofreceSucursal         Boolean  @default(true)
  tarifaIncluyeIva       Boolean  @default(true)
  ajusteTarifaPorcentaje Float    @default(0.0)
  markupFijo             Float    @default(0.0)
  fechaCaducidadPromo    DateTime?
  ordenamientoDefault    String   @default("PRECIO_ASC")
  serviciosActivos       String?
  ordenamientoDomicilio  String   @default("PRECIO_ASC")
  ordenamientoSucursal   String   @default("PRECIO_ASC")
  requiereSeguro         Boolean  @default(false)
  slaPromedioHs          Int      @default(48)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  // --- CAMPOS NUEVOS ---
  modoFirstMile       String  @default("mismo_courier")
  // Valores posibles: "mismo_courier" | "consolidador" | "drop_off_cliente"

  courierRecolectorId Int?
  // FK al Courier que hace la recoleccion consolidada.
  // Solo se llena cuando modoFirstMile = "consolidador".
  // null = mismo courier o drop-off del cliente.

  @@unique([empresaId, nombreCourier])
}
```

**[ACTUALIZACION - 2026-05-19]:** Los campos `modoFirstMile` y `courierRecolectorId` quedan deprecados y se eliminan de CredencialCourier en el commit 2 de la rectificacion 6.D. Razon: el modo de First-Mile pasa a ser deducido por el sistema (no configurado por el cliente), y el recolector pasa a ser atributo del Deposito (no de la credencial empresa-level). Ver decision #49 (Seccion 2) y nuevas secciones 6.11 (DepositoCourierConfig rectificada) y 6.12 (Deposito - campo nuevo courierRecolectorId).

**Migracion de datos:**
- Las 4 filas existentes tienen courierRecolector = "pickup".
- Migrar a: modoFirstMile = "mismo_courier", courierRecolectorId = null.
- Eliminar la columna courierRecolector despues de la migracion.

### 6.3 Tabla Empresa - campo nuevo

```prisma
model Empresa {
  // ... campos existentes ...

  // --- CAMPO NUEVO ---
  modeloAHabilitado  Boolean @default(false)
  // Decidido por admin_shipro en onboarding.
  // true = el cliente puede elegir Modelo A (creds Shipro) al activar couriers.
  // false = solo Modelo B (creds propias).
  // Inmutabilidad direccional: gerente_cliente puede ir A->B, pero NO B->A.
}
```

### 6.4 Tabla SucursalCourier - NUEVA

```prisma
model SucursalCourier {
  id              Int      @id @default(autoincrement())

  courierId       Int
  courier         Courier  @relation(fields: [courierId], references: [id])

  // Identidad
  idExterno       String   // ID que el courier usa en su API
  codigo          String?  // Codigo corto humano (ej. "SFN", "CNQ")
  nombre          String   // Nombre legible (ej. "SANTA FE (CENTRO)")
  tipo            String   @default("sucursal_propia")
  // Valores: "sucursal_propia" | "punto_red" | "locker"

  // Direccion
  direccionCalle  String?
  direccionAltura String?
  direccionPiso   String?
  direccionDpto   String?
  codigoPostal    String
  localidad       String
  provincia       String
  pais            String   @default("Argentina")

  // Geolocalizacion (CRITICO para busqueda de cercania)
  latitud         Float?
  longitud        Float?

  // Capacidades operativas (columnas indexables, NO JSON)
  aceptaAdmision    Boolean @default(false)
  aceptaEntrega     Boolean @default(false)
  aceptaDevolucion  Boolean @default(false)
  aceptaB2B         Boolean @default(false)
  aceptaB2C         Boolean @default(true)
  tieneBuzonInteligente Boolean @default(false)

  // Atencion
  horariosJson    String?  // JSON estructurado con horarios por dia
  telefono        String?
  email           String?

  // Estado y auditoria
  activa          Boolean  @default(true)
  eliminada       Boolean  @default(false)  // Soft delete
  fechaUltimaConfirmacion DateTime?         // Tracking de sincronizacion

  // Datos no-logicos
  metadatosJson   String?  // Info de display, descripciones largas, etc.

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Relaciones
  tramosOrigen     TramoEnvio[] @relation("TramoSucursalOrigen")
  tramosDestino    TramoEnvio[] @relation("TramoSucursalDestino")
  depositosPreferidos DepositoSucursalPreferida[]

  @@index([courierId])
  @@index([latitud, longitud])
  @@index([courierId, codigoPostal])
  @@unique([courierId, idExterno])
}
```

**Sincronizacion (MVP):**
- Boton en panel admin_shipro: "Sincronizar sucursales de [Courier]".
- Al presionar, llama al endpoint de sucursales del courier (cada adapter implementa getSucursales()), compara con BD, inserta nuevas, marca como eliminadas las que ya no existen.
- Logging visible para admin_shipro.
- Post-MVP: convertir en job automatico periodico.

### 6.5 Tabla DepositoSucursalPreferida - NUEVA

```prisma
model DepositoSucursalPreferida {
  id                Int      @id @default(autoincrement())

  depositoId        Int
  deposito          Deposito @relation(fields: [depositoId], references: [id])

  courierId         Int

  sucursalCourierId Int
  sucursal          SucursalCourier @relation(fields: [sucursalCourierId], references: [id])

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([depositoId, courierId])
}
```

Agregar relacion en Deposito:
```prisma
model Deposito {
  // ... campos existentes ...
  sucursalesPreferidas DepositoSucursalPreferida[]
}
```

### 6.6 Tabla TramoEnvio - NUEVA

```prisma
model TramoEnvio {
  id              Int      @id @default(autoincrement())

  envioId         Int
  envio           Envio    @relation(fields: [envioId], references: [id], onDelete: Cascade)

  orden           Int      // 1, 2, 3... Secuencia cronologica.

  courierId       Int
  courier         Courier  @relation(fields: [courierId], references: [id])

  tipo            String
  // Valores: "recoleccion" | "entrega" | "ciclo_completo"

  trackingExterno String?  // Tracking propio del courier para este tramo.

  estadoActual    String   @default("PENDIENTE")
  // Estado homogeneizado por Nomenclador (lenguaje Shipro).

  estadoCrudoUltimo String? // Ultimo estado raw del courier, para auditoria.

  sucursalOrigenId  Int?
  sucursalOrigen    SucursalCourier? @relation("TramoSucursalOrigen", fields: [sucursalOrigenId], references: [id])

  sucursalDestinoId Int?
  sucursalDestino   SucursalCourier? @relation("TramoSucursalDestino", fields: [sucursalDestinoId], references: [id])

  fechaCreacion   DateTime @default(now())
  fechaInicio     DateTime? // Cuando el courier tomo posesion (primer evento real).
  fechaFin        DateTime? // Cuando el tramo se cerro.

  metadatosJson   String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([envioId, orden])
  @@index([envioId])
  @@index([trackingExterno])
  @@index([estadoActual])
}
```

### 6.7 Tabla Envio - cambios

```prisma
model Envio {
  // --- Campos existentes que se mantienen ---
  // (todos los actuales MENOS trackingFirstMile)

  // --- CAMPO NUEVO ---
  tipoOrigen      String   @default("recoleccion_courier")
  // Valores: "recoleccion_courier" | "drop_off_cliente"

  // --- CAMPO DEPRECADO ---
  // trackingFirstMile -> DEPRECAR (la info ahora vive en TramoEnvio)
  // Migracion: 0 envios con trackingFirstMile no nulo. Eliminar directamente.

  // --- Relacion nueva ---
  tramos          TramoEnvio[]
}
```

### 6.8 Tabla CotizacionSnapshot - NUEVA

```prisma
model CotizacionSnapshot {
  id                    Int      @id @default(autoincrement())
  empresaId             Int
  depositoOrigenId      Int
  destinoSnapshotJson   String
  paqueteSnapshotJson   String
  opcionesSnapshotJson  String
  usadaEnEnvioId        Int?
  createdAt             DateTime @default(now())
}
```

Proposito: tracking de conversion y analytics. NO se usa para validar precios al cierre de venta.

### 6.9 Tabla MetricaCourierLatencia - NUEVA

```prisma
model MetricaCourierLatencia {
  id            Int      @id @default(autoincrement())
  courierId     Int
  operacion     String   // "cotizar" | "despachar" | "tracking" | "etiqueta"
  latenciaMs    Int
  status        String   // "success" | "timeout" | "error"
  envioId       Int?
  createdAt     DateTime @default(now())

  @@index([courierId, operacion])
  @@index([createdAt])
}
```

### 6.10 Tabla HistoricoCotizaciones - NUEVA

```prisma
model HistoricoCotizaciones {
  id            Int      @id @default(autoincrement())
  courierId     Int
  cpOrigen      String
  cpDestino     String
  pesoKg        Float
  precio        Float
  servicio      String?
  createdAt     DateTime @default(now())

  @@index([courierId, cpOrigen, cpDestino])
  @@index([createdAt])
}
```

Proposito: fallback para cuando TODOS los couriers fallan. Se busca promedio de ultimos 30 dias. Limpieza periodica de registros > 30 dias.

### 6.11 Tabla DepositoCourierConfig - RECTIFICADA (2026-05-19)

Version rectificada del modelo original de 6.D.1. Lo unico que el cliente decide explicitamente por par (deposito x courier).

```prisma
model DepositoCourierConfig {
  id          Int      @id @default(autoincrement())
  depositoId  Int
  deposito    Deposito @relation(fields: [depositoId], references: [id], onDelete: Restrict)
  courierId   Int
  courier     Courier  @relation(fields: [courierId], references: [id], onDelete: Restrict)

  // Cliente elige llevar fisicamente los paquetes a la sucursal del courier
  // en vez de que el courier recoja en el deposito. Fuerza modo "drop_off_cliente".
  dropOffCliente        Boolean @default(false)

  // Cliente elige que ESTE courier (last-mile) recoja en el deposito del
  // consolidador en vez de en el deposito del cliente. Requiere que
  // Deposito.courierRecolectorId este seteado. El sistema deduce modo
  // "consolidador" cuando este flag es true.
  recogeViaConsolidador Boolean @default(false)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([depositoId, courierId])
  @@index([courierId])
}
```

**Cambios respecto a la version de 6.D.1:**
- Eliminados: `modoFirstMile`, `courierRecolectorId`, FK `courierRecolector` (apuntaba a Courier).
- Agregados: `dropOffCliente`, `recogeViaConsolidador`.
- La regla "1 solo recolector por deposito" deja de vivir aca y pasa a ser limitacion estructural de `Deposito.courierRecolectorId` (FK nullable, no array). Ver 6.12.

### 6.12 Tabla Deposito - campo nuevo courierRecolectorId (2026-05-19)

Agregar a la tabla Deposito existente:

```prisma
courierRecolectorId Int?
courierRecolector   Courier? @relation("DepositoRecolector", fields: [courierRecolectorId], references: [id], onDelete: SetNull)
```

**Semantica:** identifica al unico courier consolidador que recoge en este deposito. null = no hay recoleccion consolidada configurada (el deposito opera con cada courier de forma directa o con drop-off del cliente, sin recolector intermedio).

**Por que va en Deposito y no en DepositoCourierConfig:** la regla operativa "una camioneta no pasa 2 veces por el mismo deposito" implica que hay como maximo 1 recolector por deposito. Modelarlo como columna en Deposito hace que esa regla sea estructural (impuesta por el schema) en vez de validacion runtime en endpoint. Ademas, simplifica el modelo: el recolector NO depende de que se haya creado un par con ese courier; es atributo independiente del deposito.

**Inverso en Courier:**
```prisma
depositosDondeRecolecta Deposito[] @relation("DepositoRecolector")
```

---

## 7. LOGICA DE NEGOCIO

**[ACTUALIZACION - 2026-05-21]:** El pseudo-codigo de esta seccion menciona `credencialCourier.modoFirstMile` y `credencialCourier.courierRecolectorId`. Esos campos fueron ELIMINADOS de CredencialCourier en Sub-fase 6.D.6. La modalidad de First-Mile se resuelve ahora a nivel par (deposito x courier) via `DepositoCourierConfig.recogeViaConsolidador` + `DepositoCourierConfig.dropOffCliente` + `Deposito.courierRecolectorId` (ver decision #49 y secciones 6.11/6.12). El refactor del codigo real (dispatch.ts + crear.ts) se completo en Sub-fase 6.D.5 (commit ad68902). El pseudo-codigo de esta Seccion 7 NO fue reescrito y debe leerse como descripcion del flujo logico de First-Mile, NO como contrato literal de campos de BD.

### 7.1 Generacion de tramos al crear un envio

```
FUNCION generarTramos(envio, credencialCourier):

  SI envio.tipoOrigen == "drop_off_cliente":
    Crear 1 TramoEnvio:
      orden = 1
      courierId = courier de Last-Mile
      tipo = "entrega"
      sucursalOrigenId = sucursal donde el cliente dejo el paquete
    Llamar al adapter del courier para crear envio externo
    Guardar trackingExterno en el tramo

  SINO SI credencialCourier.modoFirstMile == "mismo_courier":
    Crear 1 TramoEnvio:
      orden = 1
      courierId = courier de Last-Mile
      tipo = "ciclo_completo"
    Llamar al adapter del courier para crear envio externo
    Guardar trackingExterno en el tramo

  SINO SI credencialCourier.modoFirstMile == "consolidador":
    courierRecolector = buscar Courier por credencialCourier.courierRecolectorId

    Crear TramoEnvio 1:
      orden = 1
      courierId = courierRecolector.id
      tipo = "recoleccion"
    Llamar al adapter del recolector para crear "envio de recoleccion"
    Guardar trackingExterno del recolector

    SI tramo 1 fue exitoso:
      Crear TramoEnvio 2:
        orden = 2
        courierId = courier de Last-Mile
        tipo = "entrega"
      Llamar al adapter del Last-Mile para crear envio externo
      Guardar trackingExterno del Last-Mile
    SINO:
      Aplicar error handling segun categoria (ver 7.2)
```

Creacion SECUENCIAL. Cada llamada incluye envio.id como external_reference para idempotencia.

### 7.2 Error handling diferenciado

```
FUNCION manejarErrorDeTramo(error, tramo, envio):

  SI error es transitorio (timeout, HTTP 5xx, red):
    Reintentar con backoff exponencial: 1s, 2s, 4s, 8s
    Despues de 4 intentos fallidos:
      envio.estadoActual = "BLOQUEADO_PARCIAL"
      Crear EventoTracking con detalle
      Alertar al cliente

  SINO SI error es de validacion (HTTP 400):
    NO reintentar
    envio.estadoActual = "BLOQUEADO_PARCIAL"
    Crear EventoTracking con mensaje de error del courier
    Alertar al cliente con detalle del error

  SINO SI error es de autorizacion (HTTP 401, 403):
    NO reintentar
    envio.estadoActual = "BLOQUEADO_CREDENCIALES"
    Crear EventoTracking
    Alertar a admin_shipro Y al cliente

  En todos los casos: devolver HTTP 200 al e-commerce con flag de bloqueo. NUNCA 500.
```

### 7.3 Sincronizacion Envio.estadoActual

```
FUNCION recalcularEstadoEnvio(envioId):

  tramos = TramoEnvio donde envioId = envioId, ordenados por orden

  SI todos los tramos tienen estadoActual == "ENTREGADO":
    envio.estadoActual = "ENTREGADO"
  SINO SI algun tramo tiene estadoActual que empieza con "BLOQUEADO_":
    envio.estadoActual = ese estado bloqueado
  SINO SI algun tramo tiene estadoActual == "FALLIDO" o "DEVUELTO":
    envio.estadoActual = ese estado
  SINO:
    tramoActivo = primer tramo cuyo estado NO es "ENTREGADO" ni "FALLIDO"
    envio.estadoActual = tramoActivo.estadoActual

  Actualizar envio en BD
```

Se invoca explicitamente cuando un tramo cambia de estado. No es trigger de BD.

### 7.4 Nomenclador aplicado por tramo

```
FUNCION procesarEventoTracking(trackingExternoDelCourier, estadoCrudo):

  tramo = TramoEnvio donde trackingExterno = trackingExternoDelCourier
  SI no existe: logear y salir

  mapping = Nomenclador donde courierId = tramo.courierId Y estadoCrudo = estadoCrudo

  SI mapping existe:
    tramo.estadoActual = mapping.estadoShipro
  SINO:
    tramo.estadoActual = "ESTADO_DESCONOCIDO"
    Crear alerta para admin_shipro: "Estado nuevo en courier [nombre]: '[estadoCrudo]'. Falta nomenclador."

  tramo.estadoCrudoUltimo = estadoCrudo

  Crear EventoTracking:
    envioId = tramo.envioId
    estado = tramo.estadoActual
    observacion = estadoCrudo
    fecha = ahora

  recalcularEstadoEnvio(tramo.envioId)
```

### 7.5 Composicion de precios

```
FUNCION componerPrecio(tarifaCourierLastMile, credencial, configFirstMile):

  precioBase = tarifaCourierLastMile

  SI configFirstMile.modoFirstMile == "consolidador":
    tarifaFirstMile = cotizar con adapter del consolidador
    precioBase = precioBase + tarifaFirstMile

  SI credencial.requiereSeguro:
    seguro = calcularSeguro(valorDeclarado)
    precioBase = precioBase + seguro

  feeShipro = calcularFeeShipro(precioBase, empresa)
  precioBase = precioBase + feeShipro

  SI NO credencial.tarifaIncluyeIva:
    impuestos = precioBase * 0.21
    precioBase = precioBase + impuestos

  ajustePorcentaje = precioBase * (credencial.ajusteTarifaPorcentaje / 100)
  precioFinal = precioBase + ajustePorcentaje + credencial.markupFijo

  RETORNAR precioFinal
```

### 7.6 Pre-filtro de couriers antes de cotizar

```
FUNCION filtrarCouriersCandidatos(empresa, deposito, destino, tipoEntrega):

  credenciales = CredencialCourier donde empresaId = empresa.id Y activo = true
  candidatos = []

  PARA CADA credencial EN credenciales:
    courier = buscar Courier por credencial.nombreCourier

    SI courier.activo == false: SALTAR
    SI tipoEntrega == "domicilio" Y courier.puedeEntregarDomicilio == false: SALTAR
    SI tipoEntrega == "sucursal" Y courier.puedeEntregarSucursal == false: SALTAR
    SI tipoEntrega == "domicilio" Y credencial.ofreceDomicilio == false: SALTAR
    SI tipoEntrega == "sucursal" Y credencial.ofreceSucursal == false: SALTAR

    SI credencial.modoFirstMile == "consolidador":
      recolector = buscar Courier por credencial.courierRecolectorId
      SI recolector NO puede operar desde este deposito: SALTAR

    candidatos.agregar(credencial)

  RETORNAR candidatos
```

---

## 8. UX Y FLOW DE CONFIGURACION

### Onboarding completo: las 3 condiciones para operar

Un cliente no puede crear envios hasta tener completas las 3 condiciones:

1. **Couriers activos y configurados** (/configuracion/transportes)
2. **Depositos con sucursales asignadas** (/configuracion/depositos)
3. **Plata cargada o cuenta corriente aprobada** (Billetera)

El orden de las pestañas refleja el orden logico: el cliente primero define con quien va a operar (couriers), despues donde va a operar desde (depositos), despues como paga.

### Pestaña 1 — Mis Transportes

Pantalla de tarjetas (no wizard step-by-step). Cada courier se presenta como una tarjeta con toggle de activacion. Al activar un courier, se expanden 4 secciones de configuracion visibles en simultaneo:

- **Seccion 1 — Accesos API:** credenciales. Si empresa.modeloAHabilitado == true: opciones A (Cuenta Shipro) o B (Cuenta Propia). Si false: solo B. Default: Modelo A si habilitado.
- **Seccion 2 — Modalidad de First-Mile:** dropdown con 3 opciones:
    - "Este courier recoge en mi deposito" (mismo_courier)
    - "Yo llevo los paquetes a su sucursal" (drop_off_cliente, solo si courier acepta drop-off)
    - "Este courier consolida envios de otros" (consolidador, solo si courier puedeConsolidar)
- **Seccion 2.5 — Tipo de Cuenta** (solo admin/gerente): PREPAGO o POSTPAGO. Fuera del flow visible para operadores.
- **Seccion 3 — Ajustes Comerciales:** markup %, costo fijo, fecha caducidad. Defaults en 0.
- **Nota de señalizacion al pie:** mensaje informativo que dirige al cliente al siguiente paso del onboarding (Depositos).

**Diseño:** form plano permite ver todo el estado del courier de un vistazo sin navegacion paso a paso. Decision tomada en Sub-fase 6.A tras evaluar que un wizard real seria overhead innecesario (4-6 horas) sin beneficio funcional. La sucursal NO se configura aca — se asigna/elige en la pestaña Depositos segun la modalidad de First-Mile elegida.

### Pestaña 2 — Depositos

**Pre-requisito:** el cliente debe tener al menos 1 courier activo en Mis Transportes antes de poder crear un deposito. Si entra a Depositos sin couriers activos, ve un mensaje con boton directo a Mis Transportes.

**Al crear o editar un deposito**, el formulario tiene dos partes:

**Parte A — Datos del deposito (actual):** nombre, direccion, contacto, codigo postal, localidad, provincia, horarios, observaciones.

**Parte B — Configuracion por courier (nuevo):** una seccion por cada courier activo del cliente. El comportamiento depende de la modalidad de First-Mile configurada en Mis Transportes y de la modalidad de asignacion de sucursal del courier (decision 48):

**Caso 1 — Courier recoge en mi deposito + courier usa `por_cp_origen`:**

Auto-asignacion. Sin selector. La plataforma muestra que sucursal queda asignada para transparencia. Ejemplo:

> Andreani:
> ℹ️ Auto-asignado: San Miguel (Centro) — atiende tu CP 1614
> Andreani decide que sucursal recoge segun tu zona.

**Caso 2 — Yo llevo los paquetes a sucursal del courier (drop-off):**

Dropdown con sugerencia automatica de la mas cercana. El cliente puede cambiar. Ejemplo:

> Andreani — Elegi donde vas a llevar tus paquetes:
> [ Seleccionar sucursal ▼ ]
>   ├── San Miguel (Centro) — 3.82 km ✓ Sugerida
>   ├── Jose C. Paz (Centro) — 5.68 km 📮 Cubre tu CP
>   ├── Tigre — 8.44 km
>   └── ... [Ver mas]

**Caso 3 — Courier es consolidador (recolector):**

Las 2 sucursales se calculan automaticamente. La sucursal del courier recolector se asigna por CP del deposito del cliente. La sucursal del courier de ultima milla se asigna por CP del deposito del courier recolector. Ejemplo:

> Mocis (recolector):
> ℹ️ Auto-asignado: Deposito Central Mocis — unica sucursal operativa
>
> Andreani (entrega ultima milla):
> ℹ️ Auto-asignado: Sucursal X — atiende el CP del deposito Mocis

**Caso 4 — Courier sin sucursales que atiendan el CP del deposito:**

Aviso claro. El courier queda bloqueado para ese deposito especifico. Ejemplo:

> Hop:
> ⚠️ Hop no opera en la zona de este deposito (CP 9405).
> No vas a poder usar Hop desde aca.

### Regla de bloqueo selectivo

Si un cliente tiene 3 couriers activos y solo configuro sucursal para 2 en un deposito determinado, **el deposito puede operar con los 2 configurados** pero NO con el tercero. El cliente ve el deposito con un cartel claro indicando que falta.

### Cambios posteriores

- **Cliente activa un courier nuevo despues de tener depositos:** todos los depositos quedan con flag "configuracion incompleta para ese courier" hasta que el cliente entre a editar cada uno.
- **Cliente elimina un courier:** las preferencias de sucursal vinculadas a ese courier se ignoran automaticamente. No se eliminan en BD (auditoria).
- **Cliente modifica modalidad de First-Mile de un courier:** los depositos vinculados quedan marcados como "necesita revision" hasta que el cliente confirme la nueva configuracion.
- **Cliente modifica direccion del deposito (cambia CP):** auto-asignaciones se recalculan al guardar. Si quedan sucursales sin asignacion valida, aviso claro al cliente.

### Cotizacion comparativa (checkout)

Dos secciones: "Envio a domicilio" y "Retiro en punto". Cada opcion: Logo + Nombre + Precio + SLA. Ordenado segun configuracion del cliente. Primera opcion pre-seleccionada.

### Visualizacion de discrepancias (Escudo Tarifario)

Torre de Control: calidad de datos por cliente (verde/amarillo/rojo). Panel del cliente: sus discrepancias con recomendaciones.

---

## 9. PERFORMANCE Y RESILIENCIA

- Paralelizacion de llamadas a couriers.
- Timeout escalonado por courier (timeoutCotizacionMs).
- Tolerancia a fallos parciales.
- Connection pooling (keep-alive HTTP) en adapters.
- Pre-filtro de capacidades.
- Sin cache en MVP (DEUDA 30).
- Logging en MetricaCourierLatencia.
- Falla total: fallback con HistoricoCotizaciones (promedio 30 dias).
- Busqueda geoespacial: indice en lat/lng, bounding box + Haversine.
- Google Maps solo para autocompletado, NO para distancias.

---

## 10. REFERENCIA DE COURIERS ANALIZADOS

| Courier | Origen en cotizacion | Cobertura | Auth | Notas |
|---|---|---|---|---|
| Andreani | sucursalOrigen (ID) | Catalogo sucursales | Token Bearer 24h | Hop es de Andreani |
| Mocis | No acepta, cuenta-bound | Zonal AMBA | JWT 6h | CP con prefijo ISO |
| OCA | CP origen + operativa | Endpoint por CP | usr+pwd+nrocuenta+CUIT | XML, SOAP+REST |
| Correo AR | CP origen (MiCorreo) | /agencies filtrable | JWT | 2 APIs: MiCorreo + paq.ar v2 |
| Urbano | Implicito en shipper | canalizador por CP | shipper + password | 1 shipper = 1 direccion |
| Hop | Sucursal configurable | Red 3000+ puntos | TBD | Usa estructura Andreani |
| Pickit | Direccion per-quote | Acuerdo + puntos | apiKey + token | De OCASA, 8000+ puntos |
| Moova | Direccion per-request | Try-and-404 | TBD | Cotiza por lat/long |
| DPD | TBD | TBD | TBD | Similar a Andreani |

**Patron A:** Couriers que aceptan origen al cotizar (Andreani, OCA, Correo, Pickit, Moova). El adapter manda origen.

**Patron B:** Couriers con origen implicito (Urbano, Mocis). La plataforma filtra por zona al activar.

---

## 11. RELACION CON OTRAS DEUDAS

| Deuda | Relacion | Impacto |
|---|---|---|
| DEUDA 12 (Refactor couriers) | Se absorbe parcialmente | Evaluar si queda cerrada post-DEUDA 29 |
| DEUDA 15 (Capacidades courier) | Se absorbe completamente | Cerrar al implementar DEUDA 29 |
| DEUDA 16 (BLOQUEADO_SALDO) | Se extiende el patron | Verificar compatibilidad con nuevos estados |
| DEUDA 11 (nombreCourier) | Se facilita | courierRecolector string -> FK elimina inconsistencia |
| DEUDA 5 (Usuarios Shipro) | Sin impacto directo | Nuevos estados necesitan visibilidad por rol |
| DEUDA 19 (Auditoria) | Se complementa | Coordinar formato de logs |

---

## 12. ORDEN DE IMPLEMENTACION

### Fase MVP (15 dias)

**Sub-fase 1: Modelo de datos (2-3 dias)**
- Crear tablas nuevas: SucursalCourier, TramoEnvio, DepositoSucursalPreferida, CotizacionSnapshot, MetricaCourierLatencia, HistoricoCotizaciones.
- Modificar: Courier (+capacidades +timeout), CredencialCourier (-4campos +2campos), Empresa (+modeloAHabilitado), Envio (+tipoOrigen -trackingFirstMile).
- Migracion: courierRecolector "pickup" -> modoFirstMile "mismo_courier". **[ACTUALIZACION - 2026-05-19]:** la migracion en CredencialCourier queda obsoleta; modoFirstMile y courierRecolectorId se eliminan de esa tabla (ver decision #49). La migracion real ahora es: (a) crear Deposito.courierRecolectorId, (b) crear DepositoCourierConfig.dropOffCliente + recogeViaConsolidador, (c) eliminar CredencialCourier.modoFirstMile + courierRecolectorId despues de migrar datos. Cubierto en commit 2 de la rectificacion 6.D.
- Archivos: prisma/schema.prisma + crear migracion.
- Listo cuando: npx prisma migrate dev corre sin errores.

**Sub-fase 2: Adapters refactorizados (3-4 dias)**
- Andreani: mandar sucursalOrigen al cotizar y origen.sucursal.id al despachar.
- Mocis: normalizar CP con prefijo ISO.
- Ambos: implementar getSucursales() + connection pooling.
- Archivos: lib/couriers/AndreaniAdapter.ts, MocisAdapter.ts, CourierInterface.ts.
- Listo cuando: Andreani cotiza con origen correcto; Mocis no aparece para origenes fuera de AMBA.

**Sub-fase 3: Logica de tramos (2-3 dias)**
- Implementar generarTramos(), error handling, recalcularEstadoEnvio(), procesarEventoTracking().
- Archivos: crear lib/envios/tramos.ts, modificar dispatch.ts y crear.ts.
- Listo cuando: crear envio genera tramos; cambio de estado actualiza Envio.estadoActual.

**Sub-fase 4: Cotizacion refactorizada (2-3 dias)**
- Pre-filtro, paralelizacion, timeout escalonado, composicion de precios, logging de latencia.
- Archivos: lib/cotizador.ts, crear lib/cotizacion/prefiltro.ts y componer-precio.ts.
- Listo cuando: cotizacion devuelve opciones correctas con precios compuestos.

**Sub-fase 5: Sincronizacion de sucursales (1-2 dias)**
- Boton admin_shipro + getSucursales() en adapters + carga de sucursales Andreani.
- Archivos: crear app/api/admin/sucursales/sync/route.ts.
- Listo cuando: admin_shipro puede sincronizar sucursales.

**Sub-fase 6: UI de configuracion (3-4 dias)**

Sub-fase 6 cubre la UI de las pestañas que completan el flow de onboarding. NO es un solo commit; se divide en sub-commits manejables:

- **6.A — TransportesTab actualizado** [IMPLEMENTADA — commit 4f9702e del viernes 15 mayo 2026]: alineacion de naming ("Estrategia de Despacho" → "Modalidad de First-Mile") y señalizacion visual del flow de onboarding al pie de cada tarjeta de courier. NO es refactor estructural — el form plano funciona bien y convertirlo a wizard step-by-step seria overhead innecesario (4-6 horas). La estructura conceptual (form plano con secciones numeradas) ya estaba correcta desde 1.C.3. Backend sin cambios (ya alineado).

- **6.B — DepositoForm extendido con Parte B:** agregar al formulario de crear/editar deposito la seccion de configuracion por courier (los 4 casos descriptos en seccion 8). Consume endpoint 2.B (sucursales cercanas) + nuevo endpoint de auto-asignacion por CP.

- **6.C — Validaciones de bloqueo operacional:** implementar la regla "no opera sin tener las 3 condiciones completas." Backend valida en cada accion operativa. Frontend muestra carteles claros en cada pestaña.

- **6.D — Endpoint de auto-asignacion:** nuevo helper `GET /api/depositos/[id]/sucursal-asignada/[courierId]` que devuelve que sucursal del courier atiende el CP del deposito (usando SucursalCourierCp). Reusado en Parte B del formulario y al momento del despacho.

- **6.E — Manejo de cambios posteriores:** logica de re-marcado de depositos como "incompletos" cuando el cliente modifica algo en Mis Transportes.

Listo cuando: cliente nuevo puede recorrer el onboarding completo (Mis Transportes → Depositos → Billetera) y operar.

### Fase post-MVP (7 meses)

- Integrar couriers nuevos (OCA, Correo, Urbano, DPD, Hop, Pickit, Moova, resto).
- Sincronizacion automatica sucursales (DEUDA 31).
- Cache de cotizaciones (DEUDA 30).
- UX Escudo Tarifario visual.
- Motor de ruteo mejorado con datos reales.
- Plugins e-commerce (Tiendanube, WooCommerce).
- Logistica inversa completa (devoluciones inteligentes).

---

## 13. DEUDAS NUEVAS DETECTADAS

| Deuda | Descripcion | Prioridad | Activador |
|---|---|---|---|
| DEUDA 30 | Cache cotizaciones con zonificacion por courier | Post-MVP | Volumen alto o latencia degradada |
| DEUDA 31 | Sincronizacion automatica sucursales | Post-MVP | Mas de 5 couriers integrados |
| Bug menor | "pickup" en BD perpetuado por TransportesTab | Se resuelve con DEUDA 29 | N/A |
| Bug menor | etiquetas/masiva.ts no neutraliza "pickup" | Se resuelve con DEUDA 29 | N/A |
| DEUDA 32 | Sincronizacion periodica de cobertura de couriers en background | Post-MVP | BD local con sync nocturno/semanal para mantener latencia <100ms en cotizacion sin perder frescura de datos. Detectada 2026-05-19 durante rectificacion de 6.D. |
| DEUDA 33 | UX de gestion de consolidador con modal de confirmacion PRE-accion | RESUELTA (Sub-fase 6.D.7) | RESUELTA 2026-05-26 en Sub-fase 6.D.7. Implementado: (1) modo dry-run en el PUT del deposito (?dryRun=true computa la cascada sin escribir en BD); (2) selector de courier recolector en DepositoForm (solo modo edicion, filtra couriers con puedeConsolidar=true); (3) modal de confirmacion que muestra eligiblesParaActivar / recogeViaConsolidadorReset / recogeViaConsolidadorPreservado / skipsDeValidacion antes de aplicar el cambio. El modal aparece solo si la cascada tiene contenido. Detectada 2026-05-20 durante implementacion de cascada (Commit 3 de rectificacion 6.D). NOTA: el commit message 3add6cc se refiere a esta deuda como "DEUDA 34"; la numeracion canonica establecida en el doc es DEUDA 33 (correlativo sin gap). |
| DEUDA 34 | Destrabe automatico de envios en estado BLOQUEADO_OPERATIVIDAD al configurar el par (deposito x courier) | RESUELTA (post-6.D.7) | RESUELTA 2026-05-26. Implementado: nueva funcion procesarEnviosBloqueadosPorOperatividad(depositoId, courierId?) en lib/envios/procesar-bloqueados-operatividad.ts que reprocesa envios BLOQUEADO_OPERATIVIDAD de un par (o de todos los pares de un deposito si courierId es undefined). MAX_INLINE=50 envios por llamada. Dos disparadores: (1) PUT /api/depositos/[id]/courier-configs (primario, par exacto) cuando cambia la config del par; (2) PUT /api/depositos/[id] (secundario, todo el deposito) cuando cambia courierRecolectorId — afecta el motivo consolidador_inconsistente en multiples pares. Por envio: revalida operatividad → si sigue no-operativo deja en BLOQUEADO_OPERATIVIDAD (siguenBloqueados) → si operativo + saldo insuficiente transiciona a BLOQUEADO_SALDO → si operativo + dispatch OK transiciona a Pendiente con tracking real → si operativo + dispatch falla transiciona a BLOQUEADO_PARCIAL. Falla contenida: si el reproceso lanza, no se rompe la operacion principal del endpoint que lo dispara. Detectada 2026-05-21 durante Sub-fase 6.D.5 (commit ad68902). Tests E2E: 2/2 PASS (auto_consolidacion_invalida via primario, consolidador_inconsistente via secundario). |
| DEUDA 35 | Los endpoints de creacion de envio no mapean tipoOrigen del body al input de crearEnvio | Post-MVP | Ni /api/envios ni /api/envios/manual mapean el campo tipoOrigen del body al input de crearEnvio. El caso A (drop_off_cliente) de dispatch.ts esta implementado correctamente pero no puede activarse via API: tipoOrigen siempre queda en su valor por defecto "recoleccion_courier". Detectada 2026-05-21 durante TEST 5 de Sub-fase 6.D.5 (commit ad68902). |
| DEUDA 36 | Rediseno del flujo de onboarding de configuracion logistica | Post-MVP | Vision del director (2026-05-26): el flujo de configuracion logistica deberia funcionar como una cascada que va perfeccionando el proceso: primero se configura el deposito, despues los couriers que prestan servicio en el CP de ese deposito, y por ultimo -solo si se elige un courier recolector- aparecen los couriers extra que prestan servicio en el CP del deposito del courier recolector, con tarjetas de activacion para cada uno. Hoy las piezas estan dispersas (DepositoForm, TransportesTab, endpoints de courier-configs) y no hay un flujo guiado unico. Requiere una sesion de diseno de producto previa a implementacion. Registrada durante Sub-fase 6.D.7. |
| DEUDA 37 | ABM unificado de administracion de couriers (espacio Shipro y espacio cliente) | Post-MVP | Vision del director (2026-05-26): construir un ABM/matriz de administracion de couriers con dos espacios diferenciados. ESPACIO SHIPRO (administrado por Shipro): configuracion de credenciales del courier, capacidad de ser recolector (puedeConsolidar), datos postales, fiscales, comerciales y juridicos, servicios habilitados, mark-up de Shipro (fijo o variable segun se usen credenciales de Shipro o del cliente), y otros datos/accesos/disposiciones. ESPACIO CLIENTE (administrado por el cliente): activar/desactivar el courier, elegir si es recolector (capacidad que decreta Shipro), agregar credenciales propias (si no tiene cuenta corriente), y agregar o subsidiar el costo publicado. Hoy puedeConsolidar se setea directo en BD sin UI; el espacio cliente existe parcialmente en TransportesTab. Requiere una sesion de diseno de producto previa a implementacion. Registrada durante Sub-fase 6.D.7. |
| DEUDA 38 | Reproceso desacoplado de envios bloqueados (background + cron + boton manual) | Post-MVP | Hoy las funciones procesarEnviosBloqueadosPorDeposito y procesarEnviosBloqueadosPorOperatividad corren INLINE dentro del request HTTP que las dispara (configuracion del par, cambio de deposito predeterminado, cambio de courierRecolectorId). Limite MAX_INLINE=50 por llamada — la cola se vacia gradualmente en sucesivas configuraciones. Para volumen productivo conviene desacoplar: (1) job en background que drene la cola sin colgar requests; (2) cron de barrido periodico (ej. a las 9, 14, 18 hs) como red de contencion para casos residuales que nadie volvio a tocar; (3) boton manual en la UI ("procesar pendientes") que dispare el background job por pedido del cliente cuando vea envios trabados. Hoy con MAX_INLINE=50 y sin usuarios productivos no hay caso real de cola que supere ese limite. Cuando crezca el volumen, esta es la evolucion correcta del mecanismo de reproceso. Vision del director (2026-05-26): registrada durante la discusion del limite de DEUDA 34. |

---

## 14. COMO ACTUALIZAR ESTE DOCUMENTO

1. **Bloque implementado:** marcar sub-fase como "IMPLEMENTADA" con fecha y commit. No borrar contenido original.

2. **Decision modificada:** NO sobrescribir. Agregar debajo:
   ```
   [ACTUALIZACION - FECHA]: Decision modificada. Nueva decision: [X].
   Razon: [Y]. Aprobado por Nacho.
   ```

3. **Courier nuevo integrado:** agregar fila a tabla seccion 10. Actualizar capacidades seccion 6.1.

4. **Deuda nueva detectada:** agregar a seccion 13.

5. **Responsable:** quien implementa actualiza. Si es Claude Code, propone y Nacho aprueba.

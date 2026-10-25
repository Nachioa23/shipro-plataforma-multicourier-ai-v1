# BLUEPRINT MAESTRO — Módulo Mercado Envíos Flex (MEF) de Shipro

**Qué es:** el documento único y versionado que consolida la investigación, el diseño de
producto, la construcción y los aprendizajes del módulo Mercado Envíos Flex (MEF).
Fuente de verdad en el repo (docs/), no en la memoria de un chat.
**Origen del diseño:** CHAT C (2026-09-10). **Consolidado:** CHAT D (orquestador MEF),
con el estado real de las Fases 1 y 2 construidas.

---

## PARTE 1 — El producto en una página

**Problema que resuelve:** hoy un courier que hace Mercado Flex sufre doble trabajo (dos apps,
dos etiquetas). Shipro lo elimina: una sola etiqueta (la oficial de MEF) y una sola app en la
calle. El courier recibe toda la trazabilidad por detrás.

**Qué es Shipro en Flex:** el **cerebro operativo**. Mercado Libre manda en lo comercial
(zonas, horario de corte, cupo — el vendedor lo configura en ML, es SOLO LECTURA para
terceros). Shipro tiene control absoluto de lo operativo: asigna courier por zona, rutea,
gestiona depósito, sincroniza eventos, y —el diferencial— mide la performance.

**Los tres diferenciales:**
1. **Ruteo multicourier por zona:** un courier Flex distinto por cada zona de ML, con
   exclusividad (una zona = un courier).
2. **Métricas de performance:** on-time de cada courier contra la meta de ML (97%), con aviso
   cuando un courier pone en riesgo el filtro "Llega hoy".
3. **Alerta de cupo diario:** avisa antes de que ML pause "Llega hoy" por llenar el cupo.

**Límite del techo (confirmado):** Shipro NO escribe la config comercial en ML (zonas/corte/
cupo son de solo lectura vía API). El espejo es ML → Shipro (lectura), no al revés.

---

## PARTE 2 — Decisiones de producto (Nacho)

1. **Config por zona con exclusividad:** pestaña "Couriers Flex" en /configuracion. Cada zona
   de ML se asigna a UN courier. Reasignar reemplaza.
2. **Zonas urgentes:** zonas activas en ML sin courier asignado → ROJO "acción requerida".
   Zonas desactivadas en ML → gris/inactivas.
3. **~~SMO exento en Flex~~ → REVISADA (2026-09):** originalmente se decidió eximir el SMO en
   Flex. Se REVISÓ: Flex NO lleva tratamiento especial de plata — se cobra por la RAMA del
   courier como cualquier envío (Rama B = solo Fee; Rama A = cadena completa). Razón del cambio:
   cumplir "SMO exento siempre" obligaba a modificar el motor de precios (lo más sensible del
   sistema) por una regla no urgente — no justifica el riesgo. Revisable a futuro con data de
   siniestralidad (ver DEUDA de SMO por canal).
4. **Alcance v1:** ciclo feliz primero (ready_to_ship → shipped → delivered). Excepciones en v2.
5. **UX premium:** config clara + tablero de métricas accionable.

---

## PARTE 3 — Diseño de las piezas

### Pieza 1 — Config "Couriers Flex" [CONSTRUIDA, Fase 2.2]
Pestaña en /configuracion/couriers-flex. Lista las zonas de ML (auto-sincronizadas). Por zona:
courier asignado (verde), "sin asignar" (rojo, acción requerida) o "inactiva" (gris). Regla de
exclusividad enforced a nivel base. La asignación se ancla al zone_id de ML (sobrevive al
refresco de zonas).

### Pieza 2 — Tablero de métricas Flex en Torre de Control [FASE 4, pendiente]
On-time vs meta ML (97%), volumen Flex, tasa de fallidas/reintento, uso del cupo. Alerta de
cupo. Performance por courier con highlight cuando pone en riesgo el "Llega hoy".

### Pieza 3 — SMO → ver Parte 2 decisión 3 (revisada; sin tratamiento especial).

### Pieza 4 — Flujo del operario (depósito + etiqueta) [FASE 3, pendiente]
Etiqueta compuesta: PDF de ML intacto de fondo + capa Shipro con zona/courier (overlay), o
inyección ZPL. El QR de ML (shipment_id) es la clave interna — no se imprime etiqueta propia.

---

## PARTE 4 — División de tareas por chat

> CHAT D orquesta MEF end-to-end. Solo CHAT A edita núcleo; CHAT B, couriers.

### CHAT A (Núcleo) — construido: Fases 1 y 2
- OAuth con ML (patrón Tiendanube) + refresco de token LAZY (no cron: refresca al usar si está
  por vencer, single-flight, persist atómico del refresh rotado). [CONSTRUIDO]
- Modelo: CuentaMercadoLibre + TokenVinculacionMercadoLibre + NotificacionFlex + ShipmentFlex +
  zonas/CPs + AsignacionCourierZonaFlex. Vínculo por campos ML directos en Envio. [CONSTRUIDO]
- Webhook receiver: NO valida HMAC (el marketplace de ML no firma — ver Parte 8); valida por IP
  (fail-open) + GET autenticado /shipments/{id}. [CONSTRUIDO]
- Lectura de zonas (GET /users/{id}/shipping_preferences) + sync. [CONSTRUIDO, Fase 2.1]
- Motor de asignación CP→zona→courier + worker que crea el envío. [CONSTRUIDO, Fase 2.3]
- Mapeo de estados ML → internos. [pendiente afinar con datos reales]
- Datos del tablero de métricas + alerta de cupo. [FASE 4, pendiente]

### CHAT B (Couriers) — FASE 3, pendiente
- Etiqueta compuesta (overlay PDF / inyección ZPL con zona/courier).
- Entrega del vínculo al courier (shipment_id + data + zona a su TMS).
- NOTA: la zonificación CP→zona resultó ser NÚCLEO (las zonas se leen de ML), ya construida por
  CHAT A en Fase 2 — no fue territorio de CHAT B como preveía el diseño original.

### CHAT C (Plugins/Docs) — residual (hecho).

### Nacho (Producto)
- Config comercial base en ML (requisito previo).
- Validar UX. Conseguir el entorno de validación real (ver Parte 8).

---

## PARTE 5 — Orden de construcción y estado

Fase 1: OAuth + modelo + webhook receiver [CONSTRUIDA + en prod]
Fase 2: zonas + config courier + motor de ruteo [CONSTRUIDA + en prod]
Fase 3: etiqueta compuesta + entrega al courier [PENDIENTE — bloqueada, ver Parte 8]
Fase 4: eventos + Torre de Control + métricas + cupo[PENDIENTE]
Fase 5: (v2) excepciones [PENDIENTE]


**Validación e2e (aprendizaje DEUDA 133):** ninguna fase se da por validada sin probarla de
verdad. CRÍTICO: la validación real de Flex NO es posible con usuarios de prueba (ver Parte 8) —
requiere una cuenta de producción con reputación verde + Flex activo.

---

## PARTE 6 — Lo que Flex REUSA (no inventa)

OAuth (patrón Tiendanube) · ack rápido de webhook (patrón Tiendanube, vía after() de Next) ·
ruteo/couriers por zona · mapeo de estados · manejo de bloqueos (familia de estados) ·
composición de etiquetas PDF/ZPL · Torre de Control (se le suma la vista Flex) · motor de
precios existente (Flex entra sin cambios, cobra por rama).

---

## PARTE 7 — Estado real (2026-09 / actualizado 2026-10-23)

- **Fase 1 (conexión) — construida + en prod.** OAuth self-service, tokens con refresh lazy,
  receiver corregido. VALIDADO: la conexión OAuth (un test user se conectó, token guardado
  encriptado). PENDIENTE de validar: el handshake del webhook real.
- **Fase 2 (ruteo) — construida + en prod.** Zonas + asignación courier + motor de ruteo +
  worker. PENDIENTE de validar: con datos de un envío Flex real.
- Ventas no ruteables NO crean envío falso: quedan en el buzón (NotificacionFlex) con causa,
  re-escaneables (o estancadas si no se resuelven solas), y se rutean cuando se destraban.

### 🚀 Scoring de couriers Flex (recomendación) — CONSTRUIDO + EN PROD (deployado 2026-10-23)

**Primer "ticket to win" de Flex implementado — inteligencia sobre el ruteo, no solo vincular
courier.** La pantalla **Couriers Flex** (`/configuracion/couriers-flex`) ahora muestra, por cada
zona asignada:

- **On-time del courier asignado** con semáforo contra la meta de la empresa:
  - 🟢 **Verde**: on-time ≥ meta.
  - 🟡 **Amarillo**: on-time ≥ 95% pero < meta (borderline).
  - 🔴 **Rojo**: on-time < 95% (riesgo real).
  - ⚪ **Midiendo**: muestra < 30 envíos (umbral industria para proporción confiable).
- **Recomendación automática** cuando el asignado está bajo meta Y existe otro courier operable
  del cliente que (a) cumple la meta con muestra suficiente real y (b) tiene **mejora ≥ 3 puntos
  on-time**. Si se cumplen las dos condiciones, aparece un alert ámbar con el courier recomendado +
  botón **"Reasignar a {courierRecomendado}"**. El cliente decide con un click; **nada se
  auto-asigna**. El reasignar reusa el PUT manual existente.

**Reusa el motor del núcleo DEUDA 186**:
- `calcularConfiabilidad(courierId, provincia, ventana, nombre, zoneIdMl)` — helper con fallback
  escalonado 5 niveles (zona Flex → provincia → ventana mayor → global del courier → teórico 100%).
- `resolverMetaOnTimeFlex(empresaId, zoneIdMl)` — helper único de precedencia zona→empresa (UI y
  scoring usan la misma regla, no divergen).
- `MetricaConfiabilidad` extendida con `zoneIdMl` + el cron `metricas-confiabilidad` ahora agrega
  por `(courier, zona Flex)` además de por provincia y global.

**Metas on-time configurables (dos niveles con precedencia)**:
- **`Empresa.metaOnTimeFlexPct`** — piso general del cliente. Default **97%** = meta ML.
- **`AsignacionCourierZonaFlex.metaOnTimeFlexPct`** — override opcional por zona (null = usa la de
  empresa). Para clientes que exigen metas distintas por zona (ej. CABA 97%, Patagonia 90%).

**Pendientes conocidos (explícitos — no bloquean el deploy, bloquean data real)**:

1. **Nace "midiendo"** — sin operación Flex real, todas las zonas muestran `caption gris "Midiendo
   confiabilidad — 0 de 30 entregas"`. El fallback cae al Nivel 4 teórico (100% constante) hasta
   que haya envíos entregados que alimenten la tabla.
2. ⚠️ **El cron `metricas-confiabilidad` NO está wireado en el crontab del server** — la tabla de
   performance NO se puebla sola; hay que agendar ese cron cuando haya primer cliente operando, o
   el scoring queda en "midiendo" incluso con operación real. Mismo bucket operativo que
   `mef-sincronizar-zonas` + `mef-procesar-notificaciones` (los 3 crons MEF relevantes están sin
   wirear — tracked en DEUDA 180).
3. **Validación e2e** del scoring (que las zonas pasen de midiendo → verde/amarillo/rojo según
   on-time real) depende del mismo prerequisito que el resto de Fase 2+: operación Flex real + cron
   agendado.

**Alcance de la pieza (deploy conjunto 2026-10-23, confirmado contra server: migrate status
up-to-date, 62 migraciones aplicadas)**:
- Núcleo (Chat A): `Envio.zoneIdMl` + `MetricaConfiabilidad.zoneIdMl` + cron 3er agregador +
  `calcularConfiabilidad` Nivel 0 + metas on-time + helper `resolverMetaOnTimeFlex` (commits
  `3d1f18d`, `e589710`, `17594fe`).
- MEF (Chat D): endpoint `GET /api/empresa/mercadolibre/couriers-flex` extendido con performance +
  semáforo + recomendación; pantalla extendida con bloque de performance per-zona + CTA reasignar
  (commit `3c8ab31`).

**Zero riesgo money confirmado**: analytics + recomendación read-only. El `zoneIdMl` en `Envio` es
pure plumbing (snapshot al create). El único write del endpoint es el PUT manual de reasignación
que ya existía antes. **No auto-asigna, no mueve plata, no cambia el motor del cotizador**.

---

## PARTE 8 — Aprendizajes verificados de la API de ML + pendientes

**Aprendizajes (verificados en doc oficial):**
- El marketplace de ML NO firma sus webhooks: valida por IP de origen (lista publicada, ~14 IPs,
  cambian) + HTTPS. El x-signature/HMAC es de Mercado PAGO, no del marketplace.
- El candado real de un webhook es el GET autenticado /shipments/{id} (header x-format-new: true)
  con el token del seller — solo devuelve envíos de sellers conectados.
- Zonas Flex: GET /users/{id}/shipping_preferences (services.self_service): zonas + zip_codes
  (disjuntos entre zonas activas) + cut_off_time + daily_capacity. ML garantiza un CP en una
  sola zona activa. ML NO dice a qué zona va un envío: solo trae el CP; el mapeo lo hacemos
  nosotros.

**Pendiente de validación e2e real (DEUDA abierta):** validar Flex de punta a punta con test
users es IMPOSIBLE (reputación no seteable en sandbox; Programa de Despegue exige depósito real;
la app de Flex rechaza test users). Requiere cuenta de producción real con reputación verde +
Flex activo (vía: cuenta propia de Shipro llevada a verde, o cliente real).

**NUDO ABIERTO DE FASE 3:** la app de Flex es obligatoria para escanear entregas y NO está
disponible para integraciones. Pista a investigar con entorno real: el "código de autorización"
(Configuración > Preferencias de venta) que un chofer ingresa en colectas fuera de la dirección
del vendedor — posible vía para meter un courier tercero. SIN RESOLVER.

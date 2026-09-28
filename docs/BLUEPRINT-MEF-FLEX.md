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

## PARTE 7 — Estado real (2026-09)

- **Fase 1 (conexión) — construida + en prod.** OAuth self-service, tokens con refresh lazy,
  receiver corregido. VALIDADO: la conexión OAuth (un test user se conectó, token guardado
  encriptado). PENDIENTE de validar: el handshake del webhook real.
- **Fase 2 (ruteo) — construida + en prod.** Zonas + asignación courier + motor de ruteo +
  worker. PENDIENTE de validar: con datos de un envío Flex real.
- Ventas no ruteables NO crean envío falso: quedan en el buzón (NotificacionFlex) con causa,
  re-escaneables (o estancadas si no se resuelven solas), y se rutean cuando se destraban.

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

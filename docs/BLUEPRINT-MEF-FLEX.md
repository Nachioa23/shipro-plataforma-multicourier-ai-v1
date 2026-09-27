# BLUEPRINT — MEF (Mercado Envíos Flex) integración Shipro ↔ Mercado Libre

**Contexto**: canal logístico de ML para que sellers Argentina/AMBA + Córdoba operen su propio last-mile (mismo día / día siguiente) o via couriers de terceros. Shipro se integra como "meta-carrier" del seller — recibe webhooks + rutea a nuestros couriers reales. Fase 1 (núcleo OAuth + receiver) + Fase 2 (ruteo por zonas) ya en prod y verificadas. Ver **[[DEUDA 180]]** en `DEUDAS-RESUELTAS.md` para el detalle de piezas + commits.

Este blueprint concentra los **aprendizajes verificados de la API ML** durante Fases 1 y 2 (research propia + confirmación con Soporte ML + investigaciones GN) para que la información no muera en la memoria de una conversación.

---

## Decisiones de diseño (histórico + estado actual)

### Parte 2 — Decisiones de motor de precios

- **Decisión 1** — Rama del courier decide todo (LOCKED): Flex pasa por `crearEnvio` como cualquier envío; el motor cobra según `CredencialCourier(empresaId, nombreCourier).usaCredencialesPropias`. Rama A cascada completa, Rama B Fee-only. Sin flag canal-aware.
- **Decisión 2** — Idempotencia por shipment ML (LOCKED): `Envio.mercadolibreShipmentId` (@@index) + `idempotencyKey="mef-${shipmentId}"` (@@unique compuesta con empresaId).
- **Decisión 3** — ~~SMO exento siempre en Flex~~ **REVISADA 2026-09-23** (Nacho + Chat D):

  **Antes** (premisa original registrada en el chat): *"En Flex se cobra SMO exento siempre — el canal se auto-asume Rama B para no cobrar seguro sobre operaciones que ML ya asegura."*

  **Después** (corregido): **Flex NO tiene tratamiento especial de plata**. Cobra por la rama del courier asignado en Fase 2.2 exactamente como cualquier envío Tiendanube/dashboard/plugin. El motor de precio ya es rama-aware, no channel-aware; cada variable (SMO, markup Shipro, markup fijo, intermediario, Fee) tiene su propio gate per-courier/per-empresa que se maneja con la config del courier. Si el negocio quisiera exentar SMO específicamente para Flex a futuro (con data de siniestralidad que lo justifique), sería una pieza NUEVA canal-aware — probablemente 1 flag `smoExento?: boolean` en `CotizarInput` + campo `canalOrigen` en `Envio` — pero ES un cambio de motor y se diseña como pieza separada, con gran cuidado. NO es pendiente activo.

  Ver también **"Aprendizajes de la API de ML (verificados)"** abajo, sección SMO.

---

## Aprendizajes de la API de ML (verificados)

Confirmados durante Fases 1 y 2 con research propia + Soporte ML + investigaciones GN. Todos entran en producción a través del código; se registran acá para que el racional no se pierda.

- **ML marketplace NO firma sus webhooks; valida por IP de origen + HTTPS**. El header `x-signature`/HMAC es de **Mercado Pago**, NO del marketplace. La lista de IPs es publicada por ML (~14 IPs, cambian sin aviso). Esto corrige el supuesto original del receiver (Fase 1 inicial rechazaba webhooks sin firma → hubiese 401-eado todos los webhooks reales; fix `eccfa3f` reemplazó "firma requerida" por "IP allowlist fail-open-but-loud + x-signature log-only si viene").

- **El candado real de un webhook no es la firma ni la IP: es el GET autenticado `/shipments/{id}`** (con header `x-format-new: true`, obligatorio para shape moderno). El GET usa el token OAuth del seller y devuelve el shipment sólo si pertenece a la cuenta ML conectada a nuestra plataforma. Un atacante que forje el body del webhook con un `shipmentId` inventado no puede fabricar el response del GET → clasificamos `get_shipment_no_existe` y no procesamos.

- **Las zonas Flex se leen de `GET /users/{id}/shipping_preferences`** (path del token del seller). Estructura de `services.self_service`:
  - `zones[]` con `zone_id`, `name`, `enabled` (el vendedor puede deshabilitar zonas sin borrarlas).
  - `zip_codes[]` — CPs individuales por zona.
  - `cut_off_time` (hora de corte declarada) + `daily_capacity` (envíos/día).

  **ML garantiza que los CPs son DISJUNTOS entre zonas ACTIVAS** de la misma cuenta (un CP dado matchea 0 o 1 zona con `enabled=true`). No hay que desempatar. Si aparecen >1 zonas activas matcheando el mismo CP → drift ML → fail-fast (variante `anomalo` del resolver 2.3.a), NO ruteamos silenciosa.

  Un CP PUEDE aparecer en zona `enabled=false` (el vendedor la deshabilitó pero conservó los CPs); el filtro `enabled=true` va DENTRO del where del resolver — nunca matchea zona desactivada.

- **ML NO dice a qué zona va un envío**. El payload del shipment trae solo el CP del destinatario (`receiver_address.zip_code`). El mapeo `CP → zona → courier asignado` lo hacemos nosotros (`resolverCourierPorCpFlex` en `lib/mercadolibre/resolver-courier-zona.ts`).

- **SMO en Flex — NO se hace tratamiento especial** (ver Parte 2 decisión 3 arriba). El motor cobra por la rama del courier asignado por el vendedor en Fase 2.2. Si el vendedor pone su courier en Rama B (credenciales propias), Shipro cobra sólo Fee + IVA — la exención de SMO ocurre naturalmente por la rama, no por el canal.

- **Validación con test users: IMPOSIBLE** (dictamen consolidado de 3 investigaciones independientes: research propia + GN + Soporte ML). Razones estructurales confirmadas:
  - Los test users nacen con `seller_reputation.level_id=null` y **no hay vía** (API / Soporte / flag / ventas sintéticas) para cambiarlo. Soporte respondió "el user no presenta bloqueos" pero el level_id siguió null tras el pedido.
  - El **Programa de Despegue** (rampa oficial para acceder a Flex sin reputación consolidada) exige un depósito real (~$45.000 ARS en garantía), no simulable en sandbox.
  - La **app móvil de Flex** (obligatoria para escanear entregas y marcar `shipped`/`delivered`) rechaza credenciales de test users.

  Consecuencia: la validación e2e real de Flex necesita cuenta de PRODUCCIÓN con reputación verde + Flex activo. Ver la deuda **"Validación end-to-end real de Flex"** en `DEUDAS.md` bajo DEUDA 180.

- **NUDO ABIERTO DE FASE 3 — app móvil Flex obligatoria** para el circuito operativo (chofer escanea el paquete → marca colecta → marca entrega). La app NO está disponible para integraciones ML explicó que "las empresas de logística tendrán que adaptarse". No hay endpoint API público que reemplace la app.

  Pista a investigar (Fase 3, cuando haya entorno Flex real): el **"código de autorización"** que se configura en `Configuración > Preferencias de venta` del panel del vendedor — un código que el chofer del courier tercero ingresa cuando viene a colectar el paquete a una dirección DISTINTA de la del vendedor. Podría ser la vía para meter a nuestros couriers (Andreani/Mocis/etc) en el circuito Flex sin que usen la app. **SIN RESOLVER**; requiere entorno Flex real para diseñarlo. Registrado como pendiente de Fase 3 bajo la dirección de Chat D.

---

## Referencias cruzadas

- **`DEUDAS-RESUELTAS.md` — DEUDA 180 Fase 1** — receiver + OAuth + tokens + install-link + fix por origen.
- **`DEUDAS-RESUELTAS.md` — DEUDA 180 Fase 2** — zonas + config Couriers Flex + retoque receiver (ShipmentFlex) + resolver + worker.
- **`DEUDAS.md` — DEUDA 180 header** — pendientes conocidos + link a la nueva DEUDA de validación e2e real.
- **`docs/CASO-SOPORTE-ML-WEBHOOK-TESTING.md`** — caso escalado a Soporte ML sobre imposibilidad de testing con sandbox.
- **Código**:
  - `lib/mercadolibre/sync-zonas.ts` — sync + guard empty-read.
  - `lib/mercadolibre/resolver-courier-zona.ts` — resolver puro CP→zona activa→courier.
  - `lib/mercadolibre/crear-envio-flex.ts` — worker Flex, molde Tiendanube.
  - `lib/mercadolibre/webhook-ip.ts` + `lib/mercadolibre/webhook-verify.ts` — IP allowlist + firma opcional.
  - `app/api/mercadolibre/webhooks/route.ts` — receiver.

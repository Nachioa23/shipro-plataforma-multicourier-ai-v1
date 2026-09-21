# Caso de soporte — Testing de webhooks del MARKETPLACE de Mercado Libre

**Para**: Soporte de Desarrolladores de Mercado Libre
**Fecha**: 2026-09-21
**App**: MLA (Argentina)
**client_id**: `666832293265716`
**Integración**: Shipro — plataforma logística multicourier (https://pm.shipro.pro)

---

## 1. Contexto

Estamos integrando el **receiver de webhooks del marketplace de Mercado Libre** en nuestra plataforma. Los topics que nos interesan son `shipments`, `questions` e `items`. La integración está construida y desplegada en producción:

- OAuth funcional end-to-end (verificado con test user real; tokens guardados encriptados con AES-256-GCM en nuestra base).
- Endpoint receiver: `POST https://pm.shipro.pro/api/mercadolibre/webhooks` (público vía HTTPS, egress a `api.mercadolibre.com` confirmado con `GET /users/me` autenticado devolviendo 200).
- Diseño de autenticación server-side: IP allowlist fail-open + resolución del seller (por `user_id` del payload contra nuestra tabla de cuentas ML vinculadas) + **GET autenticado `/shipments/{id}` con header `x-format-new: true`** como candado real (un webhook forjado no puede fabricar un shipment que exista en la cuenta del seller).

## 2. Objetivo

Validar en un **entorno de PRUEBA** que un webhook **GENUINO** originado por ML llega a nuestro endpoint y es procesado correctamente — **SIN necesidad de una venta real**. Todavía no tenemos un vendedor real operando el canal, y no queremos que la primera validación end-to-end del receiver dependa de la primera venta real de un cliente productivo.

## 3. Lo que intentamos y falló (con evidencia)

### 3.1 Test users creados vía API
- `POST /users/test_user` — OK. Creamos seller + buyer de prueba MLA. Endpoint responde con `id`, `nickname`, `password`.

### 3.2 Publicación de un ítem me2/custom con el test seller
- Logramos publicar tras varios ajustes:
  - Corregir `family_name` (requerido por la categoría).
  - Omitir `title` cuando el catálogo lo infiere.
  - Usar una URL de imagen válida (los pictures placeholders daban error).
- Resultado: ítem publicado con id **`MLA2104360157`**.

### 3.3 Ítem queda bloqueado por PolicyAgent
- Tras la publicación, el ítem quedó en estado `paused` y cualquier operación devuelve **`403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES`**.
- No pudimos destrabarlo: intentamos re-publicar, editar atributos, esperar, cambiar `condition`, cambiar `listing_type_id` — el PolicyAgent lo mantiene bloqueado.
- **Sin ítem publicable no hay preguntas ni compras posibles → no hay eventos → no hay webhooks.**

### 3.4 Guardar la Notification Callback URL en el DevCenter NO dispara ping de prueba
- Configuramos la URL de notificaciones (`https://pm.shipro.pro/api/mercadolibre/webhookscapture`, temporal para captura) en el DevCenter, con topics `shipments` + `questions` + `items` marcados.
- Al guardar, **ML no envía ningún ping de verificación** a nuestra URL.
- Evidencia: desplegamos un endpoint de captura pasiva (log de todos los headers + IP + body, respuesta 200 unconditional) — el log queda vacío tras guardar/re-guardar la config múltiples veces desde el panel.
- Notamos que documentación de 2015 mencionaba un ping post-save; en el panel actual no ocurre.

### 3.5 `GET /missed_feeds` está vacío
- Consulta: `GET /missed_feeds?app_id=666832293265716` con Bearer token de la app.
- Respuesta: `{"messages":null}`.
- Interpretación: ML **nunca intentó** enviar ninguna notificación a nuestra URL — no es un problema de nuestro endpoint recibiendo mal, es que del lado de ML no se disparó nada.

### 3.6 No hay simulador de notificaciones para el MARKETPLACE
- Encontramos el simulador "Enviar prueba" en la sección de Notificaciones, pero **corresponde a Mercado PAGO** (dominio de webhooks distinto, topic `payments`, formato de firma HMAC diferente).
- No encontramos una herramienta equivalente para los topics del marketplace (`shipments`, `questions`, `items`).

## 4. Preguntas concretas al soporte

### a. Método oficial de testing de webhooks del marketplace

¿**Existe un método oficial** para disparar un webhook de prueba del marketplace (topics `shipments` / `questions` / `items`) a nuestra `notification_url` en **entorno de test**, sin completar una venta real?

Puede ser: un simulador dentro del DevCenter, un endpoint API que gatille una notificación de prueba, una herramienta de la sección de Notificaciones que hoy no encontramos, o un flujo documentado que estemos pasando por alto.

### b. Si la única vía es compra simulada `test_buyer → test_seller`

¿Cuál es la **secuencia completa y soportada oficialmente** para MLA? Específicamente:

- **¿Cómo se destraba el `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`** de un ítem recién publicado por un test seller? ¿Hay categorías o listing_types "seguros" para test users que no gatillan el PolicyAgent?
- **¿Cómo paga el test buyer con dinero de prueba?** ¿Hay un método soportado de checkout para test users en MLA que evite pasar por el flow real de Mercado Pago?

### c. Autenticidad de los webhooks del marketplace

Confirmen por favor el **mecanismo canónico de autenticidad** de los webhooks del marketplace:

- ¿La validación server-side es **por IP de origen** (lista publicada por ML) **+ HTTP 200** dentro del SLA de respuesta?
- ¿El marketplace **firma sus webhooks con `x-signature` / HMAC-SHA256**, o esa firma es **exclusiva de Mercado Pago**?
- Nuestra investigación (research propia + documentación de seguridad) indica que el marketplace **no firma** y valida por IP + GET autenticado del recurso. Necesitamos que soporte lo confirme o corrija.

### d. Lista oficial y ACTUAL de IPs de origen

¿Nos pueden confirmar la **lista canónica y actualizada** de IPs desde las que ML envía webhooks del marketplace, para configurarla en nuestra allowlist?

La lista que estamos usando actualmente (basada en documentación pública que encontramos) es:

```
54.88.218.97
18.215.140.160
18.213.114.129
18.206.34.84
35.236.253.169
35.245.91.34
35.245.20.104
35.186.182.146
13.223.210.67
54.160.66.146
44.212.229.114
52.204.14.181
13.223.210.140
54.236.191.153
```

¿Es correcta? ¿Está desactualizada? ¿Cómo nos enteramos cuando cambia?

## 5. Cierre

Nuestro receiver está listo y desplegado desde hace semanas. Todos los mecanismos internos (OAuth, persistencia, resolución de seller, GET autenticado del shipment) están probados. **La única pieza que nos falta ratificar es que un webhook GENUINO de ML matchea nuestro parsing en el mundo real** — y no queremos que esa validación dependa de la primera venta real de un cliente productivo.

**Un método oficial de testing de webhooks del marketplace nos permitiría validar la integración end-to-end antes de exponer clientes reales al canal.** Agradecemos mucho la orientación.

---

**Contacto**: `<mail de contacto Shipro>`
**URL del receiver en producción**: `https://pm.shipro.pro/api/mercadolibre/webhooks`
**Test user MLA seller creado para pruebas**: `<nickname del test user>` (mlUserId `3686169320`)
**Ítem de test que quedó bloqueado por PolicyAgent**: `MLA2104360157`

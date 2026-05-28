# DISENO — DEUDA 32 + DEUDA 37 (fusionadas)
## Gestion de servicios de courier + sync de cobertura + alta de couriers

**Fecha de diseno:** miercoles 27 mayo 2026
**Estado:** decisiones lockeadas, listo para implementar
**Alcance:** Camino A (punta a punta) — todo junto

---

## 1. PROBLEMA QUE RESUELVE

Hoy la plataforma tiene huecos en como se gestionan los couriers y sus servicios:

1. Las capacidades de cada courier (flags como puedeEntregarSucursal, aceptaDropOff, etc.) no se editan desde ninguna UI — se setean por SQL directo o migracion. 8 de esos flags ni siquiera tienen codigo que los lea (huerfanos).
2. No hay un modelo de servicios comerciales que el courier ofrece al cliente final.
3. La cobertura de sucursales (tabla SucursalCourierCp) se sincroniza a mano corriendo un script. No hay forma de dispararlo desde la UI ni de que corra solo.
4. El proceso de integrar un courier nuevo es disperso y propenso a errores — adapter en codigo + case en CourierFactory + fila en BD + flags por SQL, todo en lugares distintos sin guia.
5. Hay couriers fantasma (Moova, Javit) declarados en el seed sin adapter ni integracion real.

---

## 2. DECISIONES DE ARQUITECTURA (lockeadas)

### 2.1 — Modelo C hibrido para servicios
- Cada adapter declara en codigo que servicios soporta tecnicamente.
- El admin activa/desactiva esos servicios desde la UI, eligiendo solo entre los que el adapter declara.
- Imposible activar un servicio que el adapter no soporta — limita errores operativos.

### 2.2 — Los 8 servicios comerciales
Grupo "entrega": entrega_domicilio_estandar, entrega_domicilio_express, entrega_sucursal, entrega_punto_retiro, entrega_elocker.
Grupo "logistica_inversa": inversa_cambio, inversa_devolucion_retiro_domicilio, inversa_devolucion_dropoff_sucursal.
La lista es expandible.

### 2.3 — Distincion servicios comerciales vs capacidades operativas
Servicios comerciales (los 8) -> tabla nueva ServicioCourier.
Capacidades operativas internas -> se quedan en Courier:
- puedeConsolidar — NO SE TOCA (instruccion explicita del director). Habilita al courier como recolector/consolidador.
- cpDepositoConsolidador — se reemplaza por 5 campos estructurados (ver 2.5).
- tieneSucursales — se queda, pero se unifica visualmente con el servicio entrega_sucursal (ver 2.6).
- timeoutCotizacionMs, activo, datos de contacto — se quedan.

### 2.4 — Modelo de datos: tabla ServicioCourier
model ServicioCourier {
  id                       Int      @id @default(autoincrement())
  courierId                Int
  courier                  Courier  @relation(fields: [courierId], references: [id])
  codigoServicio           String   // ej: "entrega_domicilio_estandar"
  grupo                    String   // "entrega" | "logistica_inversa"
  ordenVisual              Int
  activo                   Boolean  @default(false)  // switch del admin
  capacidadTecnicaMapeada  String?  // ej: "andreani_dispatch_domicilio_estandar"; null = no soportado
  fechaCreacion            DateTime @default(now())
  fechaActualizacion       DateTime @updatedAt
  @@unique([courierId, codigoServicio])
  @@index([courierId, activo])
}
codigoServicio es identificador estable (no se traduce). activo es la decision del admin. capacidadTecnicaMapeada conecta con el metodo del adapter; si es null el servicio no es soportado (switch bloqueado en UI).

### 2.5 — Direccion del consolidador (5 campos estructurados)
Reemplaza el campo suelto cpDepositoConsolidador por campos estructurados, autocompletados con Google Maps (mismo metodo que depositos y crear envio):
cpDepositoConsolidadorCalle, cpDepositoConsolidadorNumero, cpDepositoConsolidadorCp, cpDepositoConsolidadorLocalidad, cpDepositoConsolidadorProvincia (todos String?).
Usa AutocompleteAddress (frontend) + geocodificarDireccion (backend). El campo viejo cpDepositoConsolidador se deja temporalmente; la migracion copia "1702" a cpDepositoConsolidadorCp para Moci's. Se borra en etapa posterior.

### 2.6 — Unificacion tieneSucursales <-> entrega_sucursal
Etapa 1 (esta deuda): en la UI hay UN solo switch "Entrega en sucursal". Al prenderlo/apagarlo escribe en Courier.tieneSucursales Y en el ServicioCourier de entrega_sucursal (doble escritura, quedan en sync).
Etapa 2 (futura): migrar los 4 consumidores de tieneSucursales (modalidad.ts, dispatch.ts, courier-configs, sucursales-courier) para que lean del servicio, y borrar el flag.

### 2.7 — Adapters declaran servicios soportados
Cada adapter expone su lista de servicios soportados. Es la fuente de verdad de que servicios puede mapear el admin. Los nombres exactos de las capacidades tecnicas se confirman contra el codigo real de cada adapter durante la implementacion.

---

## 3. SEED INICIAL DE SERVICIOS

Andreani (id=1) — ACTIVOS: entrega_domicilio_estandar, entrega_sucursal, inversa_cambio, inversa_devolucion_retiro_domicilio, inversa_devolucion_dropoff_sucursal. APAGADOS: entrega_domicilio_express, entrega_punto_retiro, entrega_elocker.

Moci's (id=2) — ACTIVOS: entrega_domicilio_estandar, entrega_domicilio_express, inversa_cambio, inversa_devolucion_retiro_domicilio. APAGADOS: entrega_sucursal, entrega_punto_retiro, entrega_elocker, inversa_devolucion_dropoff_sucursal. Moci's ademas es recolector (puedeConsolidar=true) — NO SE TOCA.

---

## 4. UI DEL DRAWER (admin-couriers)

[ Datos del courier ] nombre, email soporte, telefono soporte, contacto comercial, logo URL, activo (switch).
[ Caracteristicas operativas ] Puede consolidar (switch) -> si prendido aparece Direccion del consolidador (AutocompleteAddress: calle, numero, CP, localidad, provincia).
[ Servicios al cliente — Entregas ] entrega domicilio estandar, entrega domicilio express, entrega en sucursal (unifica tieneSucursales; si prendido aparece arriba el boton "Sincronizar sucursales ahora" con info de ultima sync), entrega en punto de retiro, entrega en e-locker.
[ Servicios al cliente — Logistica inversa ] cambios, devoluciones con recoleccion por domicilio, devoluciones con despacho desde sucursal.

Estados de cada switch de servicio: prendido (adapter soporta + admin activo), apagado (adapter soporta, admin no), bloqueado/candado (adapter no soporta, capacidadTecnicaMapeada null, no se puede prender).

---

## 5. PROCESO DE ALTA DE NUEVO COURIER

El boton "Integrar Nuevo Courier" (hoy deshabilitado) se activa.
Pre-requisito (manual, dev): escribir el adapter + agregar case al CourierFactory + declarar serviciosSoportados.
Flujo: (1) admin abre el asistente; (2) el sistema detecta adapters registrados en CourierFactory que NO tienen courier en BD y los ofrece; (3) admin completa nombre, contacto, datos del consolidador; (4) admin activa servicios — la UI muestra solo los que el adapter declara; (5) el sistema crea todo en una transaccion (Courier + ServicioCourier) consistente.
Deteccion de integrables: CourierFactory expone la lista de couriers soportados; se compara contra los couriers en BD; la diferencia son los integrables.

---

## 6. SYNC DE COBERTURA (DEUDA 32)

6.1 Boton manual: dentro del drawer de cada courier con entrega_sucursal activo, boton "Sincronizar sucursales ahora". Dispara la logica del script existente adaptada a funcion reutilizable.
6.2 Endpoint cron-via-HTTP: /api/cron/sincronizar-couriers recorre todos los couriers con entrega_sucursal activo y sincroniza. Pensado para que un servicio externo lo llame el dia 1 de cada mes. El endpoint no sabe la cadencia.
6.3 Generalizacion: el script de Andreani se generaliza. Hoy solo Andreani tiene API publica de sucursales. La funcion chequea por courier si hay fuente; si no la hay, no hace nada para ese courier (no es error).

---

## 7. MENSAJE DE COBERTURA

Cuando un courier no tiene entrega_sucursal activo (o tieneSucursales=false en etapa 1), el mensaje debe decir "cobertura no aplica (courier sin entrega en sucursal)" en vez de "cobertura no validada".

---

## 8. LIMPIEZA

Borrar Moova y Javit del seed y de la BD. Nunca se integraron — fueron una prueba.

---

## 9. DEUDAS FUTURAS REGISTRADAS

- Etapa 2 de unificacion tieneSucursales: migrar los 4 consumidores a leer del servicio, borrar el flag.
- Borrar campo viejo cpDepositoConsolidador una vez migrados los consumidores a los 5 campos nuevos.
- Borrar los 8 flags huerfanos de Courier una vez confirmado que nada los lee y que ServicioCourier los reemplaza.

---

## 10. ORDEN DE IMPLEMENTACION (fases)

A — Migracion de schema: tabla ServicioCourier + 5 campos consolidador en Courier (riesgo medio, primera migracion del dia).
B — Borrar Moova/Javit + seed de ServicioCourier para Andreani y Moci's (bajo).
C — Adapters declaran serviciosSoportados (Andreani, Moci's) (bajo).
D — CourierFactory expone lista de couriers soportados (bajo).
E — Endpoint admin extendido: GET/PUT de servicios + datos consolidador; POST de alta guiada (medio).
F — Funcion de sync reutilizable, generalizada del script Andreani (medio).
G — Endpoint /api/cron/sincronizar-couriers + boton manual de sync (medio).
H — UI del drawer: secciones, switches, AutocompleteAddress, boton sync (alto).
I — UI del alta de courier: boton "Integrar Nuevo Courier" + asistente (alto).
J — Logica del mensaje de cobertura actualizada (bajo).
K — Etapa 1 de unificacion: doble escritura tieneSucursales <-> entrega_sucursal (medio).
L — Test E2E completo.
M — Doc en ARQUITECTURA-MULTICOURIER.md + commit(s) + push.

Cada fase se confirma con el director antes de pasar a la siguiente.

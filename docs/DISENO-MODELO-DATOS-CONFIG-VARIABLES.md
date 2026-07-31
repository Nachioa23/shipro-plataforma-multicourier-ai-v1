# Diseño — Modelo de Datos: Configuración de Variables de Tarifa

**Estado:** DISEÑO APROBADO (decisiones cerradas). Pendiente de implementación.
**Registrado:** 2026-07-31
**Alcance:** el modelo de datos que soporta `DISENO-CONFIG-VARIABLES-TARIFA.md`. Va después de la higiene del IVA (ya hecha, commit `2a5f9c1`) y antes de la UI y del cambio del motor.
**Regla de oro que aplica:** el código es la verdad; nada de valores de plata hardcodeados; todo neto, IVA al final; trazabilidad (vigencias + eventos) sobre simplicidad; no se toca prod sin plan revisado.

---

## 1. Qué resuelve este documento

Define **dónde vive en la base de datos** cada una de las cinco variables de tarifa, para que dejen de estar hardcodeadas o solo en el seed, y puedan configurarse (con historial). Es la base sobre la que se apoyan después la UI de configuración y el cambio del motor de precios.

---

## 2. Decisiones tomadas (firmes)

1. **Versionado con vigencias (sí).** Cada variable guarda "desde cuándo rige este valor" (`vigenciaDesde` / `vigenciaHasta`). Esto permite que una conciliación de un envío viejo use el valor que regía cuando el envío se creó, no el valor actual. Red de seguridad contra que un cambio de precio a futuro ensucie la conciliación de envíos pasados.
2. **Cada variable global en su propio registro** (no atadas artificialmente), pero **con historial** — resuelto reutilizando la tabla de config global existente (ver §3), una fila por variable.
3. **SMO por courier, en su propia tabla con vigencias** (no un campo suelto en `Courier`) — porque las vigencias exigen historial, y un campo suelto no lo tiene. Queda simétrico con `CourierIntermediario`.
4. **El ajuste masivo del Fee se registra como evento** (con fecha y porcentaje), no solo actualiza valores. Mismo espíritu que los asientos contables inversos: nunca pisar sin dejar rastro.

---

## 3. Hallazgo del recon que ajustó el diseño

El recon encontró que **ya existe una tabla de configuración global** en el schema. En vez de crear una `ParametroGlobal` nueva (como se pensó inicialmente), **se reutiliza la tabla existente** para alojar markup de Shipro e IVA. Evita duplicar estructura.

> **A confirmar en el recon de implementación:** si esa tabla existente soporta vigencias tal cual, o si hay que agregarle los campos de vigencia. Si agregárselos fuera invasivo para otros usos de esa tabla, se evalúa una tabla dedicada. La dirección es REUSAR; el detalle se cierra al implementar.

---

## 4. El modelo de datos — las cinco variables

| Variable | Dónde vive | Nuevo o existente | Vigencias |
|---|---|---|---|
| Markup intermediario | `CourierIntermediario` (por dueño) | existe (ya re-keyed) | ya las tiene |
| Markup Shipro | tabla config global (fila) | existe (se reutiliza) | agregar/confirmar |
| IVA | tabla config global (fila) | existe (se reutiliza) | agregar/confirmar |
| SMO | `SmoCourier` (por courier) | **nueva** | sí |
| Fee Shipro | `OperacionFee` (por empresa) + `AjusteMasivoFee` | existe + **nueva** | agregar a OperacionFee |

Resultado: se **reutiliza** la config global existente, se **extienden** `CourierIntermediario` (ya listo) y `OperacionFee`, y se **crean** solo dos tablas (`SmoCourier`, `AjusteMasivoFee`). Menos superficie nueva = menos riesgo.

---

## 5. Detalle por tabla

### 5.1 Markup intermediario — `CourierIntermediario` (ya existe)

Ya quedó modelado en la pieza de propiedad de credenciales (sub-pieza 1): keyed por el dueño (`propietarioCourierId`), con `markupPorcentaje`, un campo fijo, y vigencias. Sin cambios acá salvo confirmar que el campo fijo sirve como markup fijo general (neto), no solo "seguro" — ver `DISENO-PROPIEDAD-CREDENCIALES.md` y `DISENO-CONFIG-VARIABLES-TARIFA.md` §4.1.

### 5.2 y 5.3 Markup Shipro + IVA — tabla config global (se reutiliza)

Cada uno es una **fila** en la tabla de config global existente:
- `markup_shipro` → el porcentaje/valor global de markup de Shipro.
- `iva` → el multiplicador de IVA (hoy 1.21), fuente única. Conecta con la constante `IVA_AR_MULTIPLIER` ya consolidada en la higiene: el objetivo final es que esa constante lea de esta fila, para que cambiar la alícuota sea editar una fila y NO tocar código.
- Ambas con vigencias (a confirmar en implementación si la tabla ya las soporta).
- **Neto:** los valores se guardan netos; el IVA se aplica al final (regla de la casa).
- **Futuro (DEUDA):** override del markup de Shipro por empresa. La estructura debe dejar la puerta abierta sin implementarlo ahora.

### 5.4 SMO — `SmoCourier` (nueva)

Tabla nueva, una fila por courier con vigencias, espejo de `CourierIntermediario`:
- `courierId` (FK a Courier)
- `valor` (neto, Decimal)
- `activo`, `vigenciaDesde`, `vigenciaHasta`
- índice por `(courierId, activo)` — mismo patrón que la tabla del intermediario.

Migra el SMO desde la constante hardcodeada actual hacia esta tabla. Todos los sitios que hoy leen la constante pasan a leer de acá (ver recon: lista de read sites).

> **DEUDA separada (no acá):** la regla "SMO vs seguro completo" (el cliente elige seguro por valor declarado → SMO = 0, seguro viene por API del courier). Es una regla de negocio, no config. Va a la pieza de recolección/servicios de FASE 2. Ver `DISENO-CONFIG-VARIABLES-TARIFA.md` §4.3.

### 5.5 Fee Shipro — `OperacionFee` (existe) + `AjusteMasivoFee` (nueva)

**`OperacionFee`** (por empresa, ya existe) — se le agregan **vigencias** (no las tiene hoy). Sigue guardando el Fee base de cada empresa (neto). El genérico/default ($1.600) se mantiene como el valor que heredan las empresas nuevas.

**`AjusteMasivoFee`** (nueva) — registra cada operación de ajuste porcentual masivo como un evento:
- `porcentaje` (ej. +10.00)
- `fechaAplicacion`
- `aplicadoPor` (usuario admin que lo ejecutó)
- `cantidadEmpresasAfectadas` (o el detalle, a definir en implementación)
- notas opcionales

La operación de ajuste masivo: recalcula el Fee base de todas las empresas proporcionalmente (A=1.600→1.760, B=800→880, etc.), y deja el evento registrado. Con vigencias en `OperacionFee`, cada empresa conserva el histórico de su Fee. **Este es el componente que lleva más lógica** (una operación sobre toda la cartera + su registro), no un simple campo.

---

## 6. Patrón de vigencias (transversal, a espejar)

Todas las tablas con vigencias siguen el patrón que ya usa `CourierIntermediario`:
- Campos: `activo` (bool), `vigenciaDesde` (DateTime), `vigenciaHasta` (DateTime?, null = vigente).
- Query de "valor activo hoy": `where activo=true AND (vigenciaHasta is null OR vigenciaHasta > now)`, ordenado por `vigenciaDesde desc`, tomar el primero.
- Cambiar un valor = cerrar la vigencia del actual (`vigenciaHasta = now`) + crear una fila nueva. Nunca pisar (asiento inverso).

El recon confirmó el where-clause exacto a espejar. La implementación debe reusar ese patrón, no inventar uno nuevo.

---

## 7. Auditoría y permisos

- Todas estas variables mueven plata de la plataforma → cambios **auditados**, siguiendo el patrón de campos auditables ya existente (el mismo que usan `tipoCuenta` / `propietarioTipo`).
- Configuración **admin-only** (`admin_shipro`) — son parámetros globales/de courier/de empresa que afectan a todos.

---

## 8. Deudas registradas — NO en esta pieza

1. **Regla "SMO vs seguro completo"** (§5.4). Pieza propia, con recolección/servicios.
2. **Override del markup de Shipro por empresa** (§5.2). Hoy global; dejar la puerta abierta.

---

## 9. Sub-piezas de implementación (orden tentativo)

Cada una su commit, con verificación entre medio. Ninguna cambia números todavía (el motor se conecta al final).

1. **Schema + migración:** reutilizar config global para markup Shipro + IVA; crear `SmoCourier`; crear `AjusteMasivoFee`; agregar vigencias a `OperacionFee`. Migración escrita a mano, NO aplicada hasta confirmar. Seed migra el SMO de la constante a `SmoCourier` y el IVA/markup a la config global.
2. **UI global:** sección admin para markup Shipro + IVA (con vigencias).
3. **UI SMO por courier:** en la administración de couriers.
4. **UI Fee por empresa + ajuste masivo:** el componente más grande (base por empresa + botón de ajuste porcentual masivo con su evento).
5. **Recién después (pieza aparte): el cambio del motor** — que pasa a leer las cinco variables desde estas fuentes Y el markup por dueño, en un solo cambio, con su cotización de control.

---

## 10. Próximos pasos (después de aprobar este diseño)

1. Recon de implementación fino: confirmar si la config global existente soporta vigencias o hay que agregárselas; confirmar el shape exacto de `OperacionFee` para las vigencias; listar todos los read sites del SMO y del IVA que la migración debe redirigir.
2. Prompt de la sub-pieza 1 (schema + migración), aplicada primero a la base LOCAL, verificada, antes de cualquier deploy.
3. Registrar las dos DEUDAS (§8) en DEUDAS.md.

Nada de esto toca producción hasta tener cada paso revisado.

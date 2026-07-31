# Diseño — Modelo de Datos: Configuración de Variables de Tarifa

**Estado:** DISEÑO APROBADO (decisiones cerradas). Pendiente de implementación.
**Registrado:** 2026-07-31 · **Actualizado:** 2026-07-31 (v2, tras recon de implementación fino)
**Alcance:** el modelo de datos que soporta `DISENO-CONFIG-VARIABLES-TARIFA.md`. Va después de la higiene del IVA (hecha, commits `489cea4` + `cf7e52f`) y antes de la UI y del cambio del motor.
**Regla de oro que aplica:** el código es la verdad; nada de valores de plata hardcodeados; todo neto, IVA al final; trazabilidad (vigencias + eventos) sobre simplicidad; no se toca prod sin plan revisado.

---

## 0. Cambios de la v2 respecto de la v1 (para trazabilidad)

El recon de implementación fino reveló dos cosas que ajustaron el diseño:

1. **El IVA sale de esta pieza.** `IVA_AR_MULTIPLIER` se importa de forma SÍNCRONA en muchos lugares; hacerlo leer de la base (asíncrono) exigiría volver asíncronos todos esos sitios o construir un mecanismo de caché/bootstrap. Como el IVA es la variable que MENOS cambia (alícuota por ley, cada varios años) y ya está consolidada en fuente única, se DIFIERE como DEUDA chica (hacerlo configurable con caché cuando valga la pena). Las otras cuatro variables se hacen configurables ahora.
2. **El markup de Shipro NO va en la tabla de config global.** Esa tabla existe pero es de UNA SOLA FILA ANCHA (se lee con findFirst, columnas fijas). Las vigencias (decididas) PELEAN con una tabla de fila única. Por eso el markup de Shipro va en su PROPIA tabla con vigencias (`MarkupShiproVigencia`), simétrica a `CourierIntermediario` y `SmoCourier`. La tabla de config ancha queda para settings sin historial.

También se afinó el modelo del markup Shipro a **default global + herencia + override opcional** (ver §5.2).

---

## 1. Qué resuelve este documento

Define **dónde vive en la base** cada variable de tarifa, para que dejen de estar hardcodeadas o solo en el seed y puedan configurarse con historial. Base sobre la que se apoyan la UI de configuración y el cambio del motor.

---

## 2. Decisiones tomadas (firmes)

1. **Versionado con vigencias (sí)** para las variables configurables. Permite que una conciliación de un envío viejo use el valor que regía cuando el envío se creó. Red contra que un cambio de precio a futuro ensucie conciliaciones pasadas.
2. **IVA fuera de esta pieza** (§0.1). Queda constante en fuente única (`IVA_AR_MULTIPLIER`); DEUDA chica para hacerlo configurable con caché.
3. **Markup Shipro en tabla propia con vigencias** (§0.2), no en la config global ancha.
4. **Markup Shipro = default global + herencia + override opcional por empresa** (§5.2).
5. **SMO por courier, tabla propia con vigencias** (§5.3).
6. **Ajuste masivo del Fee = evento registrado** (con fecha y %), no solo actualiza valores.

---

## 3. El modelo de datos — las cuatro variables configurables (IVA aparte)

| Variable | Dónde vive | Nuevo o existente | Vigencias |
|---|---|---|---|
| Markup intermediario | `CourierIntermediario` (por dueño) | existe (ya re-keyed) | ya las tiene |
| Markup Shipro | `MarkupShiproVigencia` (global) + `CredencialCourier.ajusteTarifaPorcentaje` (override) | **nueva** + campo existente reusado | sí |
| SMO | `SmoCourier` (por courier) | **nueva** | sí |
| Fee Shipro | `OperacionFee` (por empresa) + `AjusteMasivoFee` | existe + **nueva** | agregar a OperacionFee |
| IVA | constante `IVA_AR_MULTIPLIER` | — (DEUDA aparte) | — |

Tablas nuevas: `MarkupShiproVigencia`, `SmoCourier`, `AjusteMasivoFee`. Se extiende `OperacionFee` (vigencias). Se reutiliza `CredencialCourier.ajusteTarifaPorcentaje` como gancho de override.

Las tres tablas de "valor con vigencias" (`CourierIntermediario`, `MarkupShiproVigencia`, `SmoCourier`) comparten el mismo patrón — un solo modelo mental.

---

## 4. Patrón de vigencias (transversal, a espejar)

Todas las tablas con vigencias siguen el patrón de `CourierIntermediario`:
- Campos: `activo` (bool), `vigenciaDesde` (DateTime), `vigenciaHasta` (DateTime?, null = vigente).
- Query "valor activo hoy": `where activo=true AND (vigenciaHasta is null OR vigenciaHasta > now)`, order by `vigenciaDesde desc`, tomar el primero.
- Cambiar un valor = cerrar la vigencia actual (`vigenciaHasta = now`) + crear fila nueva. Nunca pisar (asiento inverso).

El recon confirmó el where-clause exacto a espejar. La implementación reusa ese patrón, no inventa uno.

---

## 5. Detalle por variable

### 5.1 Markup intermediario — `CourierIntermediario` (ya existe)

Modelado en propiedad de credenciales (sub-pieza 1): keyed por dueño (`propietarioCourierId`), con `markupPorcentaje`, campo fijo y vigencias. Sin cambios acá salvo confirmar que el campo fijo sirve como markup fijo general (neto). Ver `DISENO-PROPIEDAD-CREDENCIALES.md`.

### 5.2 Markup Shipro — default global + herencia + override opcional

Modelo de **default global con herencia y override** (lo que resuelve el pedido real):

- **`MarkupShiproVigencia`** (nueva, con vigencias) → el markup de Shipro **global**, la fuente de verdad "general". Es el número que rige generalmente.
- **Herencia en onboarding:** cuando se hace el onboarding de un courier para un cliente, el global **aparece por default** — el cliente lo hereda automáticamente, sin cargarlo a mano.
- **`CredencialCourier.ajusteTarifaPorcentaje`** (campo existente, se MANTIENE) → **gancho de override opcional**. Vacío/null = "heredo el global vigente". Con valor = "override para este cliente-courier puntual".
- **El motor, al cotizar, pregunta:** ¿esta credencial tiene override? Si sí, usa ese; si no, usa el global vigente.

**Prioridad de implementación:** lo urgente es el **global + la herencia por default en onboarding**, que impacta en la tarifa. El override puntual (UI para pisar el global por cliente) queda como **gancho preparado pero no urgente** — estructura lista, UI del override para después. Ver DEUDA §8.

**Neto:** valor neto; IVA al final.

### 5.3 SMO — `SmoCourier` (nueva)

Tabla nueva, una fila por courier con vigencias, espejo de `CourierIntermediario`:
- `courierId` (FK), `valor` (neto, Decimal), `activo`, `vigenciaDesde`, `vigenciaHasta`
- índice `(courierId, activo)`.

Migra el SMO desde la constante hardcodeada actual. Todos los read sites (listados en el recon) pasan a leer de acá.

> **DEUDA separada (no acá):** regla "SMO vs seguro completo" (cliente elige seguro por valor declarado → SMO=0, seguro por API del courier). Regla de negocio, no config. Va con recolección/servicios de FASE 2. Ver `DISENO-CONFIG-VARIABLES-TARIFA.md` §4.3.

### 5.4 Fee Shipro — `OperacionFee` (existe) + `AjusteMasivoFee` (nueva)

**`OperacionFee`** (por empresa, existe) — se le agregan **vigencias**. Guarda el Fee base de cada empresa (neto). El genérico/default ($1.600) es el valor que heredan las empresas nuevas.

**`AjusteMasivoFee`** (nueva) — registra cada ajuste porcentual masivo como evento: `porcentaje`, `fechaAplicacion`, `aplicadoPor` (usuario admin), `cantidadEmpresasAfectadas` (o detalle), notas. Sigue el estilo de los modelos de evento/auditoría existentes (ej. ConciliacionRun).

La operación de ajuste masivo recalcula el Fee base de todas las empresas proporcionalmente (A=1.600→1.760, etc.) y deja el evento registrado. Con vigencias en `OperacionFee`, cada empresa conserva su histórico. **Es el componente con más lógica** (operación sobre toda la cartera + registro), no un campo.

### 5.5 IVA — constante (DEUDA aparte)

Queda como `IVA_AR_MULTIPLIER` en fuente única (`lib/constants/iva.ts`, ya consolidado en la higiene). NO se hace configurable en esta pieza (§0.1). DEUDA chica: hacerlo configurable con mecanismo de caché/bootstrap para no volver asíncronos los muchos read sites síncronos.

---

## 6. Auditoría y permisos

- Cambios de estas variables mueven plata → **auditados**, patrón de campos auditables existente (el de `tipoCuenta` / `propietarioTipo`).
- Configuración **admin-only** (`admin_shipro`).

---

## 7. Sub-piezas de implementación (orden tentativo)

Cada una su commit, verificación entre medio. Ninguna cambia números todavía (el motor se conecta al final).

1. **Schema + migración:** crear `MarkupShiproVigencia`, `SmoCourier`, `AjusteMasivoFee`; agregar vigencias a `OperacionFee`; mantener `CredencialCourier.ajusteTarifaPorcentaje` como override. Migración escrita a mano, NO aplicada hasta confirmar; aplicada primero a LOCAL. Seed migra el SMO de la constante a `SmoCourier` y siembra el markup Shipro global.
2. **UI global:** markup Shipro global (con vigencias) + su herencia por default en onboarding.
3. **UI SMO por courier.**
4. **UI Fee por empresa + ajuste masivo** (el componente más grande).
5. **Recién después (pieza aparte): el cambio del motor** — lee las 4 variables desde estas fuentes Y el markup por dueño, en un solo cambio, con cotización de control.

---

## 8. Deudas registradas — NO en esta pieza

1. **IVA configurable** (§5.5) — con mecanismo de caché. DEUDA chica.
2. **UI del override del markup Shipro por empresa** (§5.2) — el gancho (`ajusteTarifaPorcentaje`) queda listo; la UI para pisarlo por cliente, después.
3. **Regla "SMO vs seguro completo"** (§5.3) — pieza propia, con recolección/servicios.

---

## 9. Próximos pasos (después de aprobar este diseño)

1. Prompt de la sub-pieza 1 (schema + migración), aplicada primero a LOCAL y verificada.
2. Registrar las tres DEUDAS (§8) en DEUDAS.md.
3. Recién después, las UIs y por último el cambio del motor con su cotización de control.

Nada de esto toca producción hasta tener cada paso revisado.

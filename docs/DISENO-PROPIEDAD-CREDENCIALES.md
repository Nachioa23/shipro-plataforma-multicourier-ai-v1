# Diseño — Propiedad de Credenciales + Markup del Dueño

**Estado:** DISEÑO APROBADO (decisiones de producto cerradas). Pendiente de implementación.
**Registrado:** 2026-07-30
**Alcance:** FASE 2 — pieza 1 de 3 (propiedad + markup). Las otras dos piezas (linkeo de tracking, tarifa de recolección) se apoyan sobre ésta.
**Regla de oro que aplica:** el código es la verdad; todo neto internamente, IVA una sola vez al final; una decisión a la vez; no se toca prod sin plan revisado.

---

## 1. El problema en una frase

Hoy la plataforma sabe *con qué courier* despacha cada envío, pero no sabe *de quién son las credenciales* que usa para despachar. Y de quién son esas credenciales define cuánto cuesta (el markup del dueño). Sin ese dato, el motor de precios cobra de menos (o de más) sin que nadie se entere.

---

## 2. El modelo mental (la forma correcta de pensarlo)

La integración técnica con un courier —por ejemplo Andreani— es **una sola, genérica, ya resuelta**. La "cañería" para hablarle a Andreani es siempre la misma.

Lo que cambia de cliente a cliente no es *cómo se habla con Andreani*, sino *qué juego de credenciales se usa para hablarle*. Cada juego de credenciales tiene un **dueño**, y ese dueño define el costo (su markup).

El cliente elige, de un menú, con qué credenciales opera Andreani:

- **Las suyas propias** → Rama B (Shipro solo cobra el Fee).
- **Las de Shipro** → Rama A, sin markup de intermediario (Shipro es dueño pero no se cobra a sí mismo un markup de intermediario).
- **Las de un courier integrado** (Mocis, Intralog, etc.) → Rama A, hereda el markup de ese courier.

La cañería hacia Andreani es idéntica en los tres casos. Solo cambia la etiqueta de "estas credenciales son de fulano" y el markup que fulano cobra.

**Shipro no es un courier.** No despacha, no aparece en el checkout como alternativa logística, no tiene integración propia. Pero **sí puede ser dueño de credenciales de otros couriers** (guarda las llaves de Andreani, de otros, etc.). Por eso se representa como un dueño posible, con un identificador propio, sin ensuciar la tabla de couriers con una fila falsa.

---

## 3. Decisiones de producto tomadas (firmes, no renegociar)

1. **La propiedad de una credencial es por cliente, no global por courier.** El cliente A puede usar Andreani-de-Mocis mientras el cliente C usa Andreani-de-Intralog, al mismo tiempo.

2. **El dueño puede ser:** el cliente mismo (Rama B), Shipro (Rama A, markup 0), o un courier integrado (Rama A, hereda el markup de ese courier).

3. **El dueño se elige de un dropdown de couriers integrados + Shipro**, representado por un vínculo (ID), nunca por texto tipeado. Esto evita el problema de "Mocis" vs "MOCIS" y da integridad real.

4. **El markup del dueño se fija una vez, centralizado, y se hereda.** Un mismo porcentaje por dueño, para todos los clientes que usen sus credenciales. Motivo: Shipro recibe una única facturación y liquidación por dueño. Si el dueño cambia su markup, se toca en un solo lugar y se propaga.

5. **El dueño es obligatorio en Rama A.** Sin dueño definido, la credencial **no se puede usar**. No hay default silencioso. Motivo: un default "Shipro" podría ocultar que una credencial es en realidad de Mocis y omitir su markup — cobrar de menos sin que nadie se entere. Mejor frenar que adivinar con plata (misma filosofía que la `tarifaPlanaRespaldo` obligatoria).

6. **"Dueño de credencial" y "courier recolector" son roles separados**, aunque en la práctica coincidan seguido (Mocis presta credenciales *y* recolecta). Mantenerlos separados permite representar el caso donde no coinciden (ej: paquete de Andreani creado con credenciales de Intralog, recolectado por Mocis — tres couriers distintos).

7. **Un solo courier recolector activo por cliente** (aunque haya varios en el listado de posibles recolectores). La variante de múltiples recolectores simultáneos queda descartada en este momento del desarrollo.

---

## 4. Qué encontró el recon del código actual (punto de partida real)

- **El vínculo credencial↔courier hoy es por texto** (`nombreCourier`), no por ID. Todo el código junta las cosas por nombre. El campo nuevo del dueño **romperá esta convención a propósito**, usando vínculo por ID — porque el problema que resolvemos (integridad del dueño) es exactamente lo que el ID arregla de raíz. La deuda vieja de string-join no se propaga a lo nuevo.

- **El modelo `CourierIntermediario` ya existe** y ya guarda el markup centralizado por intermediario (`markupPorcentaje`) + un seguro fijo (`seguroFijoIntermediarioConIva`). O sea, media pieza ya está construida. Pero guarda el dueño como texto libre (`nombreIntermediario = "Moci's"`, hardcodeado en el seed).

- **Convertir ese texto a vínculo por ID es barato:** ese campo solo lo escribe el seed y **nadie lo lee para lógica** (todos los lectores consumen `markupPorcentaje`, no el nombre). Toca ~3 líneas del seed y cero código real.

- **Hoy el markup se resuelve a nivel courier** (respuesta global: "Andreani lo presta Mocis, para todos"). El modelo nuevo lo resuelve **a nivel credencial** (respuesta por cliente: "esta credencial de Andreani es de Mocis / de Intralog / de Shipro"). **El nuevo reemplaza al viejo.**

- **"Shipro" no existe como fila de courier** y no hay que forzarlo a existir.

---

## 5. Propuesta técnica (decisiones de arquitectura)

> Esta sección es la propuesta del arquitecto. Las decisiones de producto de la sección 3 son firmes; los detalles finos de acá se confirman con un recon de implementación antes de escribir código.

### 5.1 El campo nuevo en `CredencialCourier`

Se agrega la noción de **propietario** a la credencial de cada cliente. Como Shipro no es courier (y no debe estar en la tabla `Courier`), pero un courier-dueño sí es una fila de `Courier`, la representación limpia es un discriminador + un vínculo opcional:

- `propietarioTipo` — enum: `CLIENTE` | `SHIPRO` | `COURIER`.
- `propietarioCourierId` — vínculo (ID) a `Courier`, presente **solo** cuando `propietarioTipo = COURIER`.

Mapeo con las ramas:

| propietarioTipo | Rama | Markup de intermediario | Se usa hoy con |
|---|---|---|---|
| `CLIENTE` | Rama B | — (solo Fee) | credenciales propias del cliente |
| `SHIPRO` | Rama A | 0 | credenciales de Shipro |
| `COURIER` | Rama A | el del courier-dueño | Mocis, Intralog, etc. |

**Nota sobre `usaCredencialesPropias`:** el flag booleano actual (Rama A vs B) se mantiene para no romper el código de plata recién desplegado. `propietarioTipo = CLIENTE` es equivalente a `usaCredencialesPropias = true`. Durante la implementación se decide si se unifican en un solo concepto o conviven — a confirmar en recon de implementación.

### 5.2 Dónde vive el markup del dueño

El markup (y el seguro fijo) es una propiedad **del dueño cuando actúa como prestador de credenciales**, no del courier ejecutor. Se reutiliza el modelo `CourierIntermediario` existente, con dos cambios:

1. Convertir `nombreIntermediario` (texto) → un vínculo por ID al courier-dueño (el cambio barato que vimos).
2. Re-interpretar el modelo: la fila pasa a significar "este courier-dueño cobra este markup% cuando presta sus credenciales", en vez de "para este courier-ejecutor, el intermediario es tal".

Para el caso `SHIPRO` (markup 0), no hace falta fila: la ausencia o el tipo `SHIPRO` implica markup de intermediario = 0.

> **Detalle a confirmar en implementación:** si el markup de un dueño es único sin importar de qué courier preste credenciales (interpretación actual: sí, "un mismo porcentaje por dueño"), el modelo se keyea por el dueño. Confirmar contra la realidad de facturación antes de codear.

### 5.3 La regla de "dueño obligatorio"

En Rama A, si `propietarioTipo` no está definido (ni `SHIPRO` ni `COURIER` con su `propietarioCourierId`), la credencial queda **bloqueada para operar**: no se puede cotizar ni despachar con ella hasta configurarla. Se valida en el punto donde hoy se resuelve la credencial para crear el envío.

### 5.4 El cambio en el motor de precios ⚠️ TOCA PLATA EN PRODUCCIÓN

Hoy, en el código desplegado (commit `b11f7f8`), el markup del intermediario se busca preguntándole al **courier**: "¿quién te presta?" (lookup a nivel `Courier.intermediarios`).

Con el modelo nuevo, hay que buscarlo preguntándole a la **credencial del cliente**: "¿de quién sos?" (lookup por el `propietario` de la `CredencialCourier`).

**Esto cambia de dónde sale el markup en el motor de precios — el mismo motor que se blindó y verificó el 2026-07-30 con la cotización real.** No es cosmético: toca la cascada de plata en el punto exacto que se validó.

Además, cierra el **gap conocido del fallback** (`crear.ts`, `intermediarioMarkupPorcentaje: null` hardcodeado): en vez de `null`, el fallback busca el dueño de la credencial y hereda su markup.

**Consecuencia de método:** cuando se implemente esta pieza, lleva el mismo cuidado que el deploy de FASE 1 — recon de implementación, diseño de la query nueva revisado, y **verificación de que la cotización sigue dando los números correctos** después del cambio (una cotización real de control, comparada contra la fórmula canónica). No se despliega sin ese control.

### 5.5 La UI (dropdown del dueño)

El dropdown vive en `components/configuracion/TransportesTab.tsx`, junto al selector de Rama A/B que ya existe. Cuando el usuario elige Rama A, aparece el dropdown "Dueño de las credenciales" con las opciones: **Shipro** + la lista de couriers integrados. Obligatorio: no se puede guardar una credencial Rama A sin dueño elegido.

Nota: el markup del dueño **no** se edita en esta pantalla (es centralizado, por dueño). Esta pantalla solo *elige* el dueño. La edición del markup por dueño es otra UI (ver sección 7, deudas — hoy `CourierIntermediario` no tiene ninguna UI de edición).

---

## 6. Plan de migración (credenciales que ya existen en prod)

Al desplegar esta pieza, las credenciales Rama A que ya existen en producción quedarán **sin dueño definido → no usables** hasta configurarlas a mano (criterio elegido: seguridad sobre conveniencia).

- Como los testers de prod no tienen envíos activos (0 envíos, 0 finanzas), esto **no rompe nada real**.
- Es un **paso manual post-deploy**: entrar a cada credencial Rama A y elegir su dueño en el dropdown.
- La migración de datos NO asigna ningún dueño por default. Deja el campo vacío a propósito, para forzar la configuración consciente.

---

## 7. Deudas registradas — pensadas, NO implementadas hoy

Estas quedan documentadas para diseñar en profundidad cuando sean requisito. NO son parte de la pieza de hoy.

1. **Reglas de consistencia operativa del dueño.** Si un cliente elige operar con credenciales del courier Z, entonces Z debería activarse sí o sí en su operación (el dueño no puede quedar afuera). Además, Z probablemente sea una opción de courier recolector. Estas reglas cruzan "de quién es la credencial" con "quién recolecta" y caen naturalmente cuando se diseñen las piezas 2 y 3.

2. **UI de edición del markup por dueño.** Hoy `CourierIntermediario` no tiene ninguna pantalla de administración — se maneja por seed. Cuando haya más de un dueño-intermediario real (hoy solo Mocis), hace falta una UI admin para crear/editar/activar/vencer el markup de cada dueño.

3. **Unificación conceptual de `usaCredencialesPropias` con `propietarioTipo`.** Conviven por ahora para no romper el código de plata; evaluar si se fusionan más adelante.

4. **Las otras cinco variables de la tarifa publicada.** El usuario señaló que markup intermediario, markup Shipro, SMO, costo de recolección y Fee "son todas variables que en algún lado hay que poder configurar". Hoy están dispersas. Una UI unificada de configuración de estas variables es un tema propio, posterior.

---

## 8. Cómo se conecta con las otras dos piezas de FASE 2

- **Pieza 2 — Linkeo de tracking (código de Fran).** Cada vez que se usa una credencial de un courier B para crear una etiqueta en un courier A, hay que crear una etiqueta en B que linkee el tracking de A, para que B sepa a quién facturarle. Esta pieza **necesita el modelo de dueño de hoy** para saber a quién avisarle. El linkeo ocurre recolecte o no recolecte (la recolección es un servicio adicional encima).

- **Pieza 3 — Tarifa de recolección.** Cuando el cliente elige que un courier recolecte, ese courier cobra un servicio especial de recolección con tarifa propia, que entra en la tarifa publicada. Nueva capa en el motor de plata:
  - **Rama A:** tarifa courier A + markup dueño + markup Shipro + **tarifa de recolección** + SMO + Fee + IVA.
  - **Rama B:** Fee + **costo de recolección** + IVA de todo.

Ambas piezas se apoyan sobre la propiedad de credencial que se diseña acá.

---

## 9. Próximos pasos (después de aprobar este diseño)

1. Recon de implementación fino (confirmar la forma exacta del enum + FK, cómo keyea el markup por dueño, dónde se valida la regla de obligatoriedad).
2. Diseño de la query nueva del motor de precios (de courier-level a credential-level) + su verificación.
3. Prompts para Claude Code, por piezas atómicas, con STOP RULES y staging explícito.
4. Migración + paso manual de configuración en prod.
5. Verificación de cotización de control post-deploy.

Nada de esto toca producción hasta tener cada paso revisado.

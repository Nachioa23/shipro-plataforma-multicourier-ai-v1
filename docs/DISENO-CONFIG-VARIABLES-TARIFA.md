# Diseño — Configuración de Variables de Tarifa

**Estado:** DISEÑO APROBADO (decisiones de producto cerradas). Pendiente de implementación.
**Registrado:** 2026-07-30
**Alcance:** FASE 2 — pieza que se ANTEPONE al cambio del motor de precios. Ver relación con `DISENO-PROPIEDAD-CREDENCIALES.md`.
**Regla de oro que aplica:** nada de valores de plata hardcodeados; todo neto internamente, IVA una sola vez al final; una decisión a la vez; el código es la verdad; no se toca prod sin plan revisado.

---

## 1. El problema en una frase

Las cinco variables que arman la tarifa publicada —markup del intermediario, markup de Shipro, SMO, Fee de Shipro, IVA— hoy viven **hardcodeadas o en el seed**, dispersas en cinco lugares y a cuatro niveles distintos. No hay ninguna pantalla para configurarlas. El motor de precios las lee de constantes en el código. **Nada puede quedar hardcodeado**: cada variable tiene que venir a buscarse a una configuración editable.

---

## 2. Por qué esta pieza va ANTES del cambio del motor

Decisión de orden tomada (Opción A). El motor de precios va a cambiar para leer el markup "por dueño de credencial" (ver `DISENO-PROPIEDAD-CREDENCIALES.md`, sub-pieza del motor). Si construyéramos esa config DESPUÉS del cambio del motor, tendríamos que tocar el motor de plata **dos veces**: una para leer por dueño, otra para leer las variables desde la config. Cada vez que se toca el motor en producción es riesgo y verificación de números completa.

Haciendo la config PRIMERO, el motor se toca **una sola vez**, ya apuntando a la fuente definitiva (esta config) para todo — markup por dueño incluido. Más limpio, menos manoseo del motor de plata.

**Secuencia resultante:**
1. Propiedad de credenciales — sub-piezas 1, 2, 3 (schema + UI dueño + bloqueo). ✅ HECHAS.
2. **Esta pieza — Configuración de Variables de Tarifa.** (config + UI)
3. El motor de precios — tocado UNA vez, leyendo markup por dueño Y las variables desde esta config.
4. Migración a prod.

---

## 3. Las cinco variables — scope decidido

| Variable | Nivel | Estructura | Nota |
|---|---|---|---|
| Markup intermediario | Por dueño de credencial | % y/o fijo | ya casi modelado en CourierIntermediario |
| Markup Shipro | Global | valor variable | override por empresa = futuro |
| SMO | Por courier | valor | regla "seguro-vs-SMO" = DEUDA aparte |
| Fee Shipro | Por empresa | base + genérico + ajuste % masivo | el ajuste masivo es lo más grande |
| IVA | Global | valor único | editable solo por cambio de alícuota |

Las cinco viven a **cuatro niveles distintos** (por dueño, global, por courier, por empresa). Por eso NO es "una sola pantalla para todo": la UI tendrá secciones por nivel.

---

## 4. Detalle por variable

### 4.1 Markup del intermediario — por dueño, % y/o fijo

El courier dueño de las credenciales cobra un markup cuando presta sus credenciales. Se fija **una vez por dueño** (centralizado, se hereda — Forma 2, ya decidida en propiedad-credenciales).

- **Estructura:** un porcentaje **y/o** un fijo. Cualquiera de los dos puede ser 0.
  - Solo %: el dueño cobra un porcentaje sobre la tarifa.
  - Solo fijo: ej. "Courier B sobrefactura $3.000 fijos sobre la tarifa de Courier A".
  - Ambos: % + fijo.
- **Dónde vive hoy:** `CourierIntermediario.markupPorcentaje` + `seguroFijoIntermediarioConIva`. El porcentaje ya existe; hay que confirmar que el campo fijo sea de uso general (no solo "seguro") o agregar un `markupFijoIntermediario` neto.
- **Cuándo NO aplica:** dueño = SHIPRO → markup intermediario 0 (sin lookup). Dueño = CLIENTE → Rama B, no aplica.

### 4.2 Markup de Shipro — global (override por empresa a futuro)

Lo que Shipro suma sobre lo que le factura el courier, para compensar el margen que le comen los impuestos al refacturar. Es un costo variable que se ajusta cuando cambian los impuestos.

- **Nivel:** **global** — un mismo markup de Shipro para todos los clientes, hoy.
- **Estructura:** valor variable (porcentaje), editable con agilidad.
- **Futuro (DEUDA, no ahora):** poder subir el markup para un cliente en particular (override por empresa). El diseño debe dejar la "junta" preparada para admitir excepciones por empresa sin rehacerse, pero NO se implementa ahora.
- **Dónde vive hoy:** por empresa en `CredencialCourier.ajusteTarifaPorcentaje` / `markupFijo`. Migra a un valor global.

### 4.3 SMO — por courier

Cada courier tiene un costo de SMO distinto; algunos lo incluyen en la tarifa, otros lo cobran aparte. Lo prolijo es tenerlo **por courier**.

- **Nivel:** **por courier** — cada courier su valor de SMO.
- **Dónde vive hoy:** constante hardcodeada (ej. 121,50). Migra a un campo por courier.
- **DEUDA SEPARADA — regla "SMO vs seguro completo":** el cliente podrá elegir pasar del SMO al seguro completo (por valor declarado). En ese caso el SMO = 0 y el seguro viene por la API del courier dentro de la tarifa. **Esto NO es configuración de una variable — es una regla de negocio** (una elección del cliente que cambia de dónde sale el costo). Se registra como DEUDA propia y se hace con tiempo; encaja natural con la pieza de recolección/servicios de FASE 2. NO entra en esta pieza.

### 4.4 Fee de Shipro — por empresa, con genérico y ajuste masivo

El Fee es lo que Shipro cobra por operar cada etiqueta. Se gana siempre al crear la etiqueta (rama-aware, ya en FASE 1).

Tres componentes conviviendo (esta es la parte más grande de la pieza):

1. **Base por empresa:** cada cliente tiene su Fee (ej. A=1.600, B=800, C=2.400).
2. **Genérico / default:** un valor de referencia (1.600) que heredan las empresas nuevas.
3. **Ajuste porcentual masivo:** una operación que recalcula TODOS los bases de una, proporcionalmente. Ej: +10% → A=1.760, B=880, C=2.640. **Esto es una operación, no un campo** — "aplicá +10% a toda la cartera" — y es el componente que lleva más lógica.

- **Dónde vive hoy:** modelo `OperacionFee`. Default $1.600 pre-IVA definido en onboarding (D-10-ONBOARDING-FEE).
- **Neto:** el Fee se guarda y opera **neto**; el IVA se aplica al final (regla de la casa).

### 4.5 IVA — global único

- **Nivel:** **global**, un único valor.
- **Estructura:** editable solo si cambia la alícuota por ley (rara vez). No granular por courier ni empresa.
- **Dónde vive hoy:** constante `Prisma.Decimal("1.21")` en varios lugares del código.
- **Cuidado técnico:** al convertir la constante en valor configurable, TODOS los lugares que hoy usan `1.21` deben pasar a leer del mismo sitio único. No puede quedar ninguna copia hardcodeada suelta, o se desincroniza.

---

## 5. Principios de la config (transversales)

- **Todo NETO adentro.** Los valores se guardan y operan netos; el IVA se aplica una sola vez al final (nunca se guardan valores con IVA horneado).
- **Fuente única.** Cada variable tiene UN solo lugar de verdad. El motor viene a buscarla ahí. Cero constantes de plata sueltas en el código.
- **Vigencias (a evaluar en implementación):** si conviene versionar cambios de valor con fecha (como ya hace CourierIntermediario con vigencias) para trazabilidad de "desde cuándo rige este markup". A confirmar en recon de implementación.
- **Auditoría:** cambios de estas variables son sensibles (mueven plata) → deben auditarse, siguiendo el patrón de campos auditables que ya existe.

---

## 6. La UI (forma general)

Como las variables viven a cuatro niveles, la UI tiene secciones por nivel, en la zona admin (admin_shipro):

- **Global:** markup de Shipro + IVA (una sección de "parámetros globales de tarifa").
- **Por courier:** SMO por courier (en la administración de couriers).
- **Por dueño:** markup del intermediario (%/fijo) por dueño-courier.
- **Por empresa:** Fee base por empresa + el genérico + el botón de ajuste porcentual masivo.

Detalle de permisos: todas admin-only (mueven plata de toda la plataforma), siguiendo el patrón admin-only ya usado por `tipoCuenta` / `propietarioTipo`.

---

## 7. Deudas registradas — pensadas, NO implementadas en esta pieza

1. **Regla "SMO vs seguro completo"** (sección 4.3). Elección del cliente que pone el SMO en 0 y trae el seguro por la API del courier. Pieza propia, encaja con recolección/servicios de FASE 2.
2. **Override del markup de Shipro por empresa** (sección 4.2). Hoy global; dejar el diseño preparado para excepciones por empresa a futuro.

---

## 8. Cómo se conecta con el cambio del motor

Esta pieza es la que hace posible tocar el motor **una sola vez**. Después de construir la config:

- El motor (cotizador + fallback de crear.ts) pasa a leer las cinco variables desde esta config, en vez de constantes.
- En el mismo cambio, el motor pasa a resolver el markup del intermediario **por dueño de credencial** (de `DISENO-PROPIEDAD-CREDENCIALES.md`), no por courier ejecutor.
- La conciliación NO se toca (recon confirmó que es vestigial para el markup — consume campos congelados que la cotización deja bien guardados).
- **Verificación obligatoria:** después del cambio del motor, correr una cotización de control y comparar contra la fórmula canónica (Andreani neto → cascada intermediario → markup Shipro → SMO → Fee → ×IVA). Los casos que ya andaban deben dar el mismo número.

---

## 9. Próximos pasos (después de aprobar este diseño)

1. Recon de implementación: dónde vive exactamente hoy cada variable, cuántos lugares leen las constantes (IVA sobre todo), y a qué scope conviene el modelo de datos de cada una.
2. Diseño del modelo de datos de la config (tablas/campos por nivel) + vigencias si aplica.
3. Prompts para Claude Code, por sub-piezas atómicas (probablemente: modelo+migración → UI global → SMO por courier → markup intermediario %/fijo → Fee por empresa + ajuste masivo), con verificación entre cada una.
4. Registrar las dos DEUDAS (sección 7) en DEUDAS.md.
5. Recién después: el cambio del motor (una vez), con su cotización de control.

Nada de esto toca producción hasta tener cada paso revisado.

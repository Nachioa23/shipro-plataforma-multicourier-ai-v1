# BLUEPRINT — Motor de Reglas Avanzado + Scoring Ponderado (Shipro NPMS)

> **Documento maestro.** Fecha: 2026-10-08. Mirror operativo de `docs/BLUEPRINT-MEF-FLEX.md`'s role para MEF.
> **Fuente de verdad del diseño** del motor de selección de courier óptimo ("ticket to win" de la NPMS).
> **Deuda asociada**: `[[DEUDA 186]]` en `DEUDAS.md` (plan de ejecución + fases + status).

---

## 0. Propósito + decisión estratégica

El **motor de reglas avanzado** es el "ticket to win" de la NPMS Shipro: dado un pedido (CP, peso, dims, valor,
SKU, promesa), elige el courier óptimo combinando (a) reglas deterministas de negocio y (b) scoring ponderado
multidimensional (costo × confiabilidad × velocidad × capacidad). Es el diferencial sobre el estado del arte de
las agregadoras logísticas: automatiza decisiones hoy manuales (o pass-through) con criterio de dirección
comercial + feedback loop de datos reales.

### DECISIÓN NACHO (2026-10-08) — construir AHORA, oculto, encender con datos

Build-now-hidden-data-fed:
- **Construir AHORA**: el framework (reglas + scoring + fallback) se levanta como obra pre-primer-cliente, sin
  esperar datos. Nace **funcionando** porque la capa determinista no necesita histórico; la capa scoring usa
  **fallback escalonado** (patrón `calcularPromesaCalibrada`): con poca/nula data cae a reglas / cheapest
  (comportamiento idéntico al actual), con data suficiente pondera con confiabilidad real.
- **Dejarlo oculto / en sombra**: inicialmente corre en "shadow mode" (loguea qué habría elegido sin afectar la
  selección real) O detrás de un feature-flag off. Zero regresión funcional.
- **Encenderlo con datos**: cuando el histórico operativo (post-primer-cliente real) alcance umbral de muestra
  por `(courier, zona, volumen)`, se habilita el scoring con confiabilidad **real**, no teórica. "Solución a
  espaldas del cliente que impactará su negocio cuando los datos lleguen" — Nacho.

**Horizonte**:
- Reglas deterministas ricas (variables + operadores + acciones): **construibles YA**, zero data dependency.
- Framework scoring con fallback: **construible YA**, nace cayendo a reglas/cheapest.
- Scoring pleno (confiabilidad real por zona + curva por volumen): **post-primer-cliente** (necesita histórico).
- Features producto (free-shipping threshold, PUDO/lockers, carrier vetting): **post-datos**, prioridad según
  negocio.

---

## 1. Estado actual (Fase 0 map — qué YA tiene Shipro)

Mapa consolidado del recon 2026-10-08 (vs industry report de rules engines avanzados):

### Lo que YA existe (fundación reusable)

| Capability | Dónde | Estado |
|---|---|---|
| **Pipeline implícito** (validate→filter→rate→select) | `cotizar()` en `lib/cotizador.ts` + `crearEnvio()` en `lib/envios/crear.ts` + `despacharCourier()` en `lib/envios/dispatch.ts` | 🟡 orgánico, no formalizado como fases/módulos |
| **Filtro de elegibilidad** (DEUDA 91) | `mapaCapacidades` en [cotizador.ts:342-375](../lib/cotizador.ts) + `ServicioCourier.capacidadTecnicaMapeada` + `ServicioCourier.activo` (admin-managed) | ✅ 2 capas: adapter ceiling + Shipro catalog. Default estricto. |
| **Motor de reglas deterministas** | `cotizador.ts:727-756`. Variables `VALOR_CARRITO`, `PESO_PAQUETE`. Operadores `MAYOR_A/MENOR_A/IGUAL_A`. Acciones `PRIORIZAR_SLA/PRIORIZAR_PRECIO/FORZAR_COURIER` | 🟡 PARCIAL — schema prevé más (PROVINCIA_DESTINO, ENTRE, TOPE_COSTO_PORCENTAJE) pero no implementado |
| **Winner selection** | `aplicarEstrategia` en `cotizador.ts:745-750` | ordena por single-dim (precio O SLA), no scoring multi-dim |
| **Promesa calibrada (ASSET CLAVE)** | `calcularPromesaCalibrada` en [lib/utils/promesa-calibrada.ts:116](../lib/utils/promesa-calibrada.ts). **Cuádruple fallback**: (1) P75 por (depósito, courier, provincia) → (2) P75 por (courier, provincia) → (3) `MetricaSLA.slaPromedioHs` → (4) hardcoded por nombre courier. `UMBRAL_MUESTRA_MINIMA = 10`. | ✅ patrón de fallback escalonado **validado en prod** — es el blueprint arquitectural del scoring |
| **MetricaSLA por (courier, provincia)** | tabla `MetricaSLA` + cron `app/api/cron/metricas-sla` + mapa SLA en Torre | ✅ data existe + se actualiza + se consume |
| **Torre de Control** | 14 métricas (DEUDA 39), avanzada (13/16 cerradas, 3 pendientes) | ✅ fuente de datos operativa |
| **Failover técnico "venta nunca se traba"** (DEUDA 129) | contrato de resiliencia + handling de timeouts/4xx en `app/api/envios/route.ts:260-285` | ✅ en prod |

### Lo que NO existe (gaps a construir)

| Gap | Chat | Depende de data real? |
|---|---|---|
| Fases formalizadas (orchestrator explícito) | Chat A núcleo | No |
| Volumetric weight propio | Chat A + Chat B | **SÍ** (DEUDA 140: ningún courier publica fórmula) |
| Coverage per CP + weight/dim limits per-courier | Chat A + Chat B | No (declaración estática) |
| Variables ricas en reglas (PROVINCIA_DESTINO, CP patterns, SKU, promesa, cut-off) | Chat A | No |
| Operadores ENTRE + nuevos | Chat A | No |
| Acciones ricas (TOPE_COSTO_PORCENTAJE, EXCLUIR_COURIER, RESTRINGIR_A_PREMIUM, FREE_SHIPPING_SI, SUBSIDIAR_X) | Chat A | No |
| **Scoring ponderado multi-dim** | Chat A | SÍ para activarlo real; **No para el framework con fallback** |
| **Reliability real per-zona** | Chat A + Torre | **SÍ — histórico ≥ umbral** |
| Free-shipping threshold / subsidy | Chat A + Chat C | No |
| PUDO / lockers + cut-off time | Chat A + Chat B | No |
| Carrier vetting / health score / workflow | Chat A + producto | Parcial — health requiere data |

---

## 2. Arquitectura del motor (decisión técnica Chat A)

### PRINCIPIO RECTOR — fallback escalonado como en `calcularPromesaCalibrada`

El scoring **replica el patrón de fallback de cuatro niveles de `calcularPromesaCalibrada`**:
1. **Nivel más alto**: data real específica → mejor señal.
2. **Nivel intermedio**: data real agregada.
3. **Nivel bajo**: valor teórico declarado.
4. **Nivel default**: hardcoded conservador.

Esta estructura permite que el motor **nazca funcionando** desde el día 1:
- Con poca/nula data operativa → el scoring cae a reglas deterministas / cheapest (comportamiento actual byte-idéntico).
- Con data suficiente → pondera con confiabilidad real.
- **Auto-mejora sin rehacer**: no requiere migración ni redeploy cuando los datos empiezan a llegar; el fallback se re-evalúa cada vez que corre.

Es el mismo contrato que `promesa-calibrada` ya validó en prod: el checkout muestra una promesa real cuando puede, teórica cuando no, nunca falla.

### DOS CAPAS DE DECISIÓN

#### Capa 1 — Determinista (reglas condición → acción)

Filtra, fuerza o excluye couriers por **reglas de negocio duras**. **Ejecuta SIEMPRE** (no necesita datos). Es la
extensión directa del motor actual (`cotizador.ts:727-756`).

**Alcance ampliado** (vs lo que hay hoy):
- **Filtrar** del set de couriers aptos ANTES de scorear (ej. "si CP ∈ Patagonia profunda → solo Correo Argentino").
- **Forzar** un courier específico (ej. "si valorCarrito > $500k → Andreani con firma").
- **Excluir** couriers (ej. "si SKU=HAZMAT → excluir aéreo").
- **Restringir** a tier (ej. "si ticket VIP → solo premium con siniestralidad <1%").
- **Topes** económicos (ej. "costo flete ≤ 15% del valorCarrito").
- **Modificar los pesos** del scoring (ej. "si fase=liquidación → costo peso 70%").

**Modelo de datos**: extender `ReglaRuteo` o migrar a un modelo declarativo JSON (ver §8 decisión abierta).

#### Capa 2 — Scoring ponderado

Sobre los couriers que pasaron la capa 1, calcula:

```
score(courier) = Σᵢ wᵢ × cᵢ(courier)        donde Σwᵢ = 1.0
```

Dimensiones `i`:
- **Costo** (c_costo): tarifa final cotizada, normalizada en [0,1] respecto al rango de la decisión.
- **Confiabilidad / SLA** (c_sla): % de entregas on-time real por (courier, zona), con fallback a SLA teórico.
- **Velocidad** (c_velocidad): SLA calibrado horas (`calcularPromesaCalibrada`), normalizada inverso.
- **Capacidad / excepciones** (c_capacidad): puede entregar en sucursal, acepta HAZMAT, soporta locker, etc.

**Pesos `wᵢ`** configurables (ver §4).

**Fallback en el score de confiabilidad** (patrón calibrada):
1. Nivel 1 — `% on-time` real por `(depósito, courier, provincia)` con muestra ≥ UMBRAL.
2. Nivel 2 — `% on-time` real por `(courier, provincia)` con muestra ≥ UMBRAL.
3. Nivel 3 — `% on-time` real por `courier` global con muestra ≥ UMBRAL.
4. Nivel 4 — SLA teórico declarado por el courier (contrato comercial) → fallback pre-datos.

**Pre-datos**: todo courier arranca con `c_sla = 1.0` (SLA teórico, degradable). Con data real, baja según observación.

### Separación lógica/código

- Capa 1 (reglas) se evalúa ANTES de iterar los adapters: filtra el `couriersAptos` set.
- Capa 2 (scoring) se evalúa DESPUÉS de recibir las cotizaciones de todos los aptos: ordena por score (reemplaza
  o complementa el `aplicarEstrategia` single-dim actual).
- El pipeline existente (validate → filter → rate → select) se mantiene; las capas 1-2 lo refinan sin reescribir.

### Shadow mode (hidden pero funcionando)

Hasta que Nacho decida activar el motor, corre **en sombra**:
- El scoring se calcula + loguea estructurado (`[rules-engine] shadow: habría elegido X sobre Y porque score X=0.82 Y=0.74 ...`).
- La selección real sigue siendo la del `aplicarEstrategia` actual.
- Permite acumular histórico de "qué habría elegido" vs "qué eligió" → medir impacto antes de encender.

---

## 3. Catálogo de reglas deterministas (producto — input Nacho, umbrales en pesos AR)

### 3.1 — AOV (Average Order Value)

| Regla | Condición | Acción |
|---|---|---|
| **Ticket VIP** | `valorCarrito ≥ $200.000` | Restringir a couriers premium (siniestralidad < 1% histórica + firma en entrega). Scoring: subir peso de confiabilidad y bajar costo. |
| **Ticket bajo** | `valorCarrito < $80.000` | Priorizar económico (terrestre / postal, típico Correo Argentino). Scoring: subir costo (abaratar). |

### 3.2 — Geográficas

| Regla | Condición | Acción |
|---|---|---|
| **Rural / extendido** | CP ∈ zonas rurales (Patagonia profunda, interior sin cobertura de couriers privados) | Forzar / preferir **Correo Argentino** (cobertura universal, −30/40% costo vs premium). |
| **AMBA densidad urbana** | CP ∈ provincia del depósito **y** CP ∈ ring metropolitano | Preferir **flotas locales / last-mile** (Mocis, Intralog, Hop Envíos). |
| **Interior profundo (no rural)** | CP ∈ provincia distinta al depósito **y** no AMBA | Preferir couriers nacionales (Andreani). |

**Nota**: la clasificación "AMBA vs interior profundo vs rural" requiere un **mapa de zonas** (CP patterns o lookup
tabla) que no existe hoy. Se puede modelar como `ReglaRuteo.condicionVariable = "ZONA"` con valores enumerados o
como lookup a `Provincia`/`CodigoPostal.zonaCode` (nueva column, aditiva).

### 3.3 — Promesa de entrega

| Regla | Condición | Acción |
|---|---|---|
| **Upgrade por retraso interno** | `tiempoEnDepositoCliente ≥ umbralHoras` (métrica YA EXISTENTE Torre) | Elevar prioridad de courier más rápido (compensa el atraso interno con velocidad externa). Alerta operador. |
| **Ventana de corte diaria** | Ahora > `cutoffTimeDiario` (ej. 15:00 ART) | Marcar día 0 = día siguiente. Desactivar modalidades exprés en el checkout del plugin (coord Chat C). |

**Nota**: `cutoffTimeDiario` por courier + por depósito es dato nuevo — se declara en configuración del cliente
(`CredencialCourier.cutoffHoraDespacho?`) y en configuración de operación de Shipro.

### 3.4 — SKU-level (feature preparada, inert hoy — depende de que couriers lo soporten)

| Regla | Condición | Acción |
|---|---|---|
| **HAZMAT** | `producto.esHazmat = true` | Excluir aéreo (si en algún momento algún adapter oferta aéreo). |
| **Carga pesada** | `pesoReal > 30 kg` | Forzar LTL (Less-than-Truckload) — no existe hoy en Shipro AR, dejar el gancho. |
| **Perecederos / cadena de frío** | `producto.requiereFrio = true` | Restringir a courier con cadena de frío declarada (no existe en Shipro AR hoy). |

**Nota**: estas reglas se **declaran** en el modelo (regla + acción) pero el adapter correspondiente **no soporta**
la capacidad hoy. El motor evalúa la condición, no encuentra courier apto, y degrada a BLOQUEADO_* o mensaje al
operador. **Dejar el gancho** permite enganchar la capacidad cuando algún courier la ofrezca sin reescribir el motor.

### 3.5 — Resiliencia

| Regla | Condición | Acción |
|---|---|---|
| **Volume caps / load balancing** | `volumenAsignadoHoy[courier] ≥ cuotaDiaria[courier]` | Degradar prioridad del courier saturado; redirigir al siguiente mejor del score. |
| **Failover técnico** (YA IMPLEMENTADO) | API timeout, 5xx, no cotiza (DEUDA 129) | Siguiente mejor en el score. Mensaje al cliente: "No pierdes la venta — se registró, se despacha con otro courier". |

---

## 4. Scoring ponderado — fórmula + pesos

### Fórmula

```
score(courier) = w_costo × c_costo + w_sla × c_sla + w_velocidad × c_velocidad + w_capacidad × c_capacidad
```

Con `Σwᵢ = 1.0`. Todas las `cᵢ ∈ [0, 1]`.

### Pesos default (input Nacho)

| Dimensión | Peso default | Interpretación |
|---|---|---|
| Costo | 40% | el ancla comercial por volumen |
| Confiabilidad / SLA | 30% | lo que diferencia a Shipro vs cheapest-wins |
| Velocidad | 20% | SLA calibrado horas |
| Capacidad / excepciones | 10% | penaliza couriers con restricciones (sin sucursal, sin firma, etc.) |

### Pesos configurables por dirección comercial

Overrides declarativos (ejemplos de Nacho):
- **Fase liquidación** (empresa con cash flow crunch): `w_costo = 0.70, w_sla = 0.15, w_velocidad = 0.10, w_capacidad = 0.05`.
- **Línea premium** (empresa con buyers de alto AOV): `w_sla = 0.45, w_velocidad = 0.30, w_costo = 0.15, w_capacidad = 0.10`.
- **Reglas Capa 1** pueden sobrescribir pesos para una decisión puntual (ej. "si ticket VIP → `w_sla = 0.50`").

### Normalización de cᵢ

- **c_costo**: `(precio_max - precio_i) / (precio_max - precio_min)` → el más barato = 1, el más caro = 0.
- **c_velocidad**: `(sla_max - sla_i) / (sla_max - sla_min)` → el más rápido = 1.
- **c_sla**: ratio de confiabilidad real `on-time / total` con fallback escalonado (ver §2).
- **c_capacidad**: `1 - penalty` donde penalty acumula flags (no soporta sucursal, no soporta firma, no soporta
  modalidad X requerida) con pesos pequeños.

### Fallback pre-datos

Hasta tener histórico ≥ UMBRAL:
- `c_sla(courier) = 1.0` (asume SLA teórico cumplido 100% — degrada con observación).
- O alternativamente: `c_sla(courier) = contrato_sla_cumplimiento_declarado` si el courier declara una tasa en su
  SLA comercial (ej. "95% on-time contractual").

Resultado: scoring arranca aproximando "cheapest + fastest" (porque c_sla es constante), luego se refina con data.

---

## 5. 🆕 APORTE NACHO — confiabilidad como CURVA por volumen (dimensión nueva, no está en el informe)

### La observación

El SLA de un courier **degrada con el volumen diario que se le asigna**. Ejemplo empírico:

| Courier | Volumen diario | SLA on-time |
|---|---|---|
| Andreani | 100 paquetes | 99% |
| Andreani | 200 paquetes | 95% |
| Andreani | 300 paquetes | 92% |

Un courier con red saturada entrega peor; uno subutilizado entrega mejor. El volumen asignado por **Shipro mismo**
influye en el SLA real.

### Implicación de diseño

La dimensión "confiabilidad" del scoring **NO es un escalar fijo por courier** — es una **función del volumen que
Shipro le está por asignar hoy**:

```
c_sla(courier) = f_sla_volumen(courier, volumen_actual_del_dia + 1)
```

El scoring ideal pregunta: *"¿qué confiabilidad tiene el courier X al volumen V que le voy a dar HOY, con V+1 el
próximo despacho?"*, no "¿qué confiabilidad tiene X?".

### Métrica nueva requerida

**SLA vs volumen-diario por courier (curva empírica)**: se construye observando histórico de `(courier, volumen_del_día,
% on-time)` y ajustando una curva (regresión polinomial o segmentos lineales). Permite al scoring saber cuánto
degrada cada courier a medida que se le carga volumen.

**Diferencial sobre el informe**: la industria describe el feedback loop SLA-vs-real por courier/zona. **Nacho
agrega una dimensión más**: SLA-vs-volumen-asignado. Es anti-saturación por diseño — Shipro no concentra en el
mismo courier aunque sea el más barato, porque sabe que a más volumen peor cumple.

**Marcado como**: dimensión AVANZADA, post-datos, pero **registrada aquí como diferencial del motor Shipro
sobre el estado del arte**. Se encuentra en el framework desde el día 1 como `c_sla_volumen` placeholder; se
activa cuando la curva empírica tiene datos.

---

## 6. Métricas que alimentan el motor (link con Torre/Panel — input Nacho)

Nacho definió **4 bloques** de métricas que alimentan al motor y al monitoreo del negocio:

### Bloque A — Operativo / SLA

- `% entregas on-time` por (courier, zona, día del mes, volumen).
- `tiempo real de entrega` (horas desde impresión a `ENTREGADO` en estados COURIER canónicos — [lib/utils/estados.ts](../lib/utils/estados.ts)).
- `% de visitas fallidas` + `% de incidencias` + `% de devoluciones`.
- `tiempo en depósito cliente` (métrica YA EXISTENTE en Torre).

### Bloque B — Costos / margen / Cost-to-Serve

- `costo real courier` (facturado) vs `costo cotizado` (`costoCourierCotizado` vs `costoCourierFacturado` ya
  persistidos en `FinanzasEnvio`).
- `margen por envío` (Rama A: `precioFinal - costoCourierFacturado - operacionFee`; Rama B: `operacionFee` neto).
- `Cost-to-Serve` por empresa / por courier / por zona.
- `fugas` (aforo contaminado post-DEUDA 156; `fugaPorcentaje` ya en `desvio-peso.ts` tras DEUDA 159).

### Bloque C — Conversión / WISMO (Where Is My Order)

- `% conversión del checkout` (de cotización mostrada → envío creado) — DEUDA 111 captura.
- `% rastreos manuales / WISMO` (buyer busca su tracking porque está ansioso) — proxy de experiencia buyer.
- `NPS cliente empresa` (ya existe — `nps-empresa.ts`) + `NPS comprador final` (ya existe — `enviarMailEntregadoNPS`,
  pending disparo DEUDA 59).

### Bloque D — Infra / motor

- `% de fallos del adapter` (CourierTimeout, CourierRejected — por courier, por hora) — ya logueado via DEUDA 129.
- `latencia del cotizador` (p50/p95/p99) — relevante para DEUDA 138 stress-test.
- `% de reglas aplicadas` (cuántas cotizaciones matchearon una regla deterministra) — telemetría del motor.
- `% de shadow-mode = producción` (cuándo el scoring real "habría" elegido lo mismo que la selección actual).

### Cruce con las 14 métricas de Torre (DEUDA 39)

Las métricas de Torre YA diseñadas cubren PARCIALMENTE:
- Métrica 2.3 (SLA real vs nominal), 3.4 (desvío de peso), 4 (aforo), 1.3 (NPS histórico), promesa calibrada — todo esto se alinea con Bloques A + B.
- NUEVO/NO existe: Bloques C y D requieren métricas adicionales que recon dedicado de Torre define al construir
  esta parte.

**Recon dedicado de Torre** (cuando se construya este punto): mapear 1-a-1 cada bloque A/B/C/D con las métricas
existentes + listar las nuevas requeridas + sus queries.

---

## 7. Plan de construcción por fases (metodología Chat A)

### FASE 1 — Diseño consolidado ✅

Este documento (`docs/BLUEPRINT-MOTOR-REGLAS.md`) + DEUDA 186 (master). **Hecha 2026-10-08.**

### FASE 2 — Ampliar motor determinista (construible YA, zero data dependency)

Objetivo: habilitar las reglas de §3 (AOV, geo, promesa, SKU, resiliencia) en el modelo actual.

**Scope técnico**:
- Variables nuevas en `cotizador.ts:727-742`:
  - `PROVINCIA_DESTINO` (cierra DEUDA 99).
  - `ZONA` (requiere decisión de modelo: ¿enum `ZonaComercial` o `CodigoPostal.zonaCode` nueva columna?).
  - `CP_PATTERN` (regex o rango numérico — ej. `"CP ∈ [1000, 1999]"` para CABA).
  - `TICKET_SIZE` (equivale a `VALOR_CARRITO` pero con buckets semánticos VIP/MEDIUM/BAJO).
  - `TIEMPO_EN_DEPOSITO_HORAS` (promesa — métrica existente).
  - `SKU_FLAG` (HAZMAT, FRIO, PESADO — gancho, inert si no hay courier compatible).
  - `CUTOFF_TIME` (hora del día vs ventana de corte).
- Operadores nuevos:
  - `ENTRE` (cierra DEUDA 100 — ya tiene `condicionValor2` en schema).
  - `EN_LISTA` (ej. `PROVINCIA_DESTINO EN_LISTA ["Buenos Aires", "CABA"]`).
  - `COINCIDE_REGEX` (CP patterns).
- Acciones nuevas:
  - `EXCLUIR_COURIER` (vs `FORZAR_COURIER` que ya existe).
  - `RESTRINGIR_A_TIER` (ej. premium).
  - `TOPE_COSTO_PORCENTAJE` (ya en comment del schema, no implementado).
  - `AJUSTAR_PESOS_SCORING` (`{ w_costo: 0.7, w_sla: 0.15, ... }`).

**Entregables**:
- Cambios en `cotizador.ts` + migración aditiva al modelo `ReglaRuteo` si se necesita (ej. agregar `condicionValor3`
  o `condicionJson` para operadores enum/lista; alternativa: `ReglaRuteo` migra a modelo declarativo JSON — ver §8).
- UI admin para que empresas/Shipro declaren reglas con las variables/operadores/acciones nuevas.
- Audit log de cambios en reglas (patrón `AuditoriaConfiguracion` existente).

**Prereq**: zero data dependency. Buildable ya.

### FASE 3 — Framework scoring con fallback (construible YA)

Objetivo: estructura del score ponderado + patrón fallback de 4 niveles para `c_sla`.

**Scope técnico**:
- Helper nuevo `lib/cotizador/scoring.ts`:
  - `calcularScore(opcion, pesos, metricas): number`.
  - Normalización de `cᵢ` dentro del set de opciones.
  - Fallback escalonado para `c_sla` (patrón `calcularPromesaCalibrada`).
- Integración en `cotizador.ts`:
  - Después de collect de opciones, antes de `aplicarEstrategia`, calcular `score` para cada.
  - **Shadow mode flag**: `ENV.MOTOR_REGLAS_SHADOW=true` → loguea score sin afectar selección. Default off en prod.
  - Default `pesos` configurables en `Empresa.ponderacionScoring Json?` (nueva columna, nullable, migración aditiva).
- Métricas de telemetría:
  - `rules-engine.shadow.winner_matches_actual` (counter).
  - `rules-engine.shadow.winner_diff` (histogram de diferencias de score).

**Entregables**:
- Scoring en sombra funcionando 100% del tiempo (loguea), seleccionando con el motor viejo.
- Dashboard admin opcional para ver "qué habría pasado si".

**Prereq**: FASE 2 (reglas) permite overrides de pesos. Zero data dependency crítica (c_sla cae a 1.0 pre-data).

### FASE 4 — Encender scoring real (post-datos)

Objetivo: activar la ponderación real cuando el histórico alcance umbral.

**Prereq duro**:
- Primer cliente operando en prod ≥ 1-2 meses.
- Muestra `≥ UMBRAL_MUESTRA` por combinación `(courier, zona)` — espejo del `UMBRAL_MUESTRA_MINIMA=10` de promesa
  calibrada, posiblemente más alto (recon dedicado — ver §8).
- Pipeline de ingesta de `% on-time` + `% visitas fallidas` + `% incidencias` por `(courier, zona)` desde
  `MetricaSLA` extendido o nueva tabla `MetricaConfiabilidad`.
- Curva SLA-vs-volumen (§5) — opcional avanzado, se puede diferir a Fase 4.1.

**Scope técnico**:
- Switch global `ENV.MOTOR_REGLAS_SHADOW=false` → scoring real afecta selección.
- Agregar `c_sla_volumen` como dimensión condicional (§5): si existe curva empírica, usarla; si no, fallback a
  `c_sla` escalar.
- Monitoreo: alertas si el scoring produce selecciones muy diferentes de la expectativa (circuit breaker — si > N%
  divergencia, revertir a shadow).

### FASE 5 — Features producto (post-datos, prioridad según negocio)

- **Free-shipping threshold** + subsidy policy (DEUDA del catálogo + Chat A núcleo + Chat C plugins).
- **PUDO / lockers**: declaración en adapters (Chat B) + variables de ruteo (Chat A) + UI buyer (Chat C).
- **Carrier vetting / governance**: workflow de alta + health score automático (Chat A + producto).

Cada una se registra como obra separada cuando el negocio lo pida.

---

## 8. Decisiones abiertas (recons dedicados al construir cada fase)

1. **`ReglaRuteo` extendido vs motor JSON declarativo**:
   - Opción (a): seguir con `ReglaRuteo` + agregar columnas (`condicionValor3`, `condicionJson?`, `pesosOverrideJson?`).
     Scope chico, mantiene la UI existente.
   - Opción (b): migrar a modelo declarativo JSON tipo DSL (p.ej. `{"all": [{"var":"ticket","op":">","val":200000}, {"var":"provincia","op":"in","val":["BA","CABA"]}]}`).
     Más expresivo, requiere parser + UI más compleja. Patrón de rules engines maduros (JSON Logic, Drools, etc.).
   - Decisión al arrancar Fase 2.

2. **Shadow mode implementación**:
   - ¿Env flag puro (`MOTOR_REGLAS_SHADOW`) o config per-empresa (`Empresa.motorScoringActivo`)?
   - ¿Dónde se logean los scores en sombra? Prisma tabla nueva `MotorReglaShadowLog`, o solo console.log + agregador
     downstream (Postgres pg_query_stats)?
   - Decisión al arrancar Fase 3.

3. **Umbral de muestra para activar confiabilidad real**:
   - Espejo del `UMBRAL_MUESTRA_MINIMA = 10` de promesa calibrada, o más alto (ej. 30, 50)?
   - Por combinación `(courier, zona)` o también por `(courier, zona, mes)` para capturar estacionalidad?
   - Decisión al arrancar Fase 4.

4. **Curva SLA-vs-volumen** (§5):
   - ¿Regresión polinomial, splines, segmentos lineales?
   - ¿Qué considera "volumen diario"? Envíos por `fechaImpresion`? Por `fechaDespacho`?
   - ¿Granularidad: courier global, (courier, provincia), (courier, depósito)?
   - Decisión al arrancar Fase 4.1 (si Fase 4 lo defiere).

5. **Umbrales en pesos AR del catálogo (§3)**:
   - Ticket VIP $200.000, Ticket bajo $80.000 — inflación AR crítica. ¿Hard-coded, o `MarkupShiproVigencia`-style
     vigencia + edición admin sin deploy?
   - Mismo patrón que la DEUDA 183 (tope suave `limiteDescubierto`): tabla `UmbralReglasVigencia` + editor admin.
   - Decisión al arrancar Fase 2.

6. **Mapa de zonas comerciales** (§3.2):
   - Nueva `Provincia.zonaComercial` enum (AMBA / INTERIOR / RURAL / PATAGONIA) + mapeo manual, o derivar de `CodigoPostal` (patterns)?
   - Decisión al arrancar Fase 2.

---

## 9. Relación con deudas existentes

Cross-referencias al backlog actual:

| DEUDA | Vínculo con este blueprint |
|---|---|
| **99** | Variable `PROVINCIA_DESTINO` en motor — cierra con Fase 2. |
| **100** | Operador `ENTRE` en motor — cierra con Fase 2. |
| **110** | Motor de optimización de la propuesta logística (producto). **Este blueprint lo ABSORBE / lo precisa** — es el diseño detallado de esa deuda ampliada. 110 pasa a ser el placeholder histórico; 186 es el blueprint maestro. |
| **111** | Capa de inteligencia del checkout (producto — cimiento de datos). **Alimenta Bloque C de §6**. Captura de eventos del embudo = entrada para `c_sla` + conversión. |
| **39** | Torre de Control (14 métricas). **Alimenta Bloques A/B/C de §6**. 13/16 cerradas, 3 pendientes — recon dedicado en Fase 2 / 4 para mapear qué nuevas requiere el motor. |
| **43** | SLA nominal del courier por zona (contrato declarado). **Entra como Nivel 4 (fallback teórico) del `c_sla`** en §4. |
| **45** | Comparación calibrada vs nominal — alimenta el feedback loop del scoring. |
| **129** | Failover técnico "venta nunca se traba". **Ya implementado en el pipeline**; se mantiene como fallback técnico de la Capa 2 (si top-score courier falla, siguiente mejor). |
| **140** | Peso aforado/volumétrico sin fórmula publicada. **Bloquea cualquier intento de computar `volumetric` propio pre-despacho**. Se maneja como "consumo del dato expuesto por el courier" post-despacho; registrado como gap de la Capa 2 (`c_capacidad` no incluye volumétrico predictivo propio). |
| **156** | Descuento del cliente (estático). **No cubre free-shipping threshold** — Fase 5 agrega subsidio condicional. |
| **91** | Capability filtering (DEUDA cerrada). **Fundación de la Capa 1** — este blueprint lo extiende con reglas ricas sobre el mismo set `couriersAptos`. |
| **138** | Stress-test. **Alimenta Bloque D de §6** (latencia + fallos del adapter + % reglas aplicadas = telemetría del motor bajo carga). |
| **173** | Estados centralizados — foundations existen (`lib/utils/estados.ts`). **Prerequisito** para que las métricas de Bloque A puedan computarse consistentemente. |
| **50** | Refactor estados en 2 planos — relacionado con 173, impacta la pureza de las métricas. |

---

## Final: horizonte

- **Hoy (2026-10-08)**: FASE 1 completa. Blueprint consolidado. Zero código.
- **Pre-primer-cliente**: FASE 2 + FASE 3 construidas, scoring en sombra loguea sin afectar selección. Reglas
  deterministas ricas disponibles para que Nacho / clientes declaren.
- **Primer cliente + 1-2 meses**: histórico suficiente. **Encender FASE 4** — scoring real afecta selección.
- **Post-FASE 4**: FASE 5 features según prioridad producto.

**Mirror conceptual con MEF** (DEUDA 180): el motor de reglas es el ticket-to-win genérico; MEF es el canal
particular de ML Flex. Ambos son blueprints maestros que viven aquí.

**Status DEUDA maestra**: ABIERTA — Fase 1 cerrada; Fase 2+3 pre-cliente; Fase 4 post-datos; Fase 5 según negocio.
Ver [[DEUDA 186]].

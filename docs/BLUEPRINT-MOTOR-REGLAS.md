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
| **Torre de Control** | 16 métricas (DEUDA 39) organizadas en 5 bloques (ver `docs/TORRE-DE-CONTROL.md`), avanzada (13/16 cerradas, 3 pendientes) | ✅ fuente de datos operativa |
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

### 3.0 — Métricas Shipro ya disponibles que alimentan las reglas y el scoring

Antes del catálogo, listado de las señales operativas que la Torre YA está capturando (o que son triviales de
derivar) y pueden entrar como variables de reglas o como dimensiones del scoring:

- **Promesa calibrada** — SLA real por `(depósito, courier, provincia)` con cuádruple fallback. YA en prod
  (`lib/utils/promesa-calibrada.ts`). Patrón arquitectural del scoring (§2 + §4).
- **Efectividad en primera visita** — `% de envíos entregados en el primer intento` por courier/zona. La Torre
  tiene el dato (estados canónicos COURIER + eventos `ENTREGADO` vs `VISITA_FALLIDA`). Variable natural de regla
  ("si efectividad primera visita del courier X en zona Z < 85% → excluir / degradar") y dimensión del scoring
  (sub-componente de `c_sla`).
- **NPS del cliente empresa** — ya existe (`nps-empresa.ts`). Señal de salud de la cuenta — relevante para reglas
  que condicionan comportamiento según engagement del cliente.
- **🆕 Índice de tiempo de actualización de estado del tracking** (propuesto Nacho, métrica NUEVA): la NPMS
  verifica cambios de estado del envío cada ~30 min (cron de rastreo). Esto permite medir, por courier, **qué tan
  rápido reporta movimientos de tracking**: tiempo transcurrido entre un cambio real (ej. "en reparto" → "entregado")
  y el momento en que el courier lo informa a la API. Un courier opaco/lento = señal fuerte de peor calidad de
  servicio (buyers ansiosos, más WISMO, menor confianza). **Alimenta `c_sla` como sub-componente**: la dimensión
  confiabilidad no es solo "entrega on-time" sino también "comunica el progreso con baja latencia".
  - Dato ya capturable del log de cambios de `estadoCanonicoCourier` vs timestamps de ingesta en la API del courier.
  - Diferencial sobre industria: la agregadora que mide esto puede castigar en el ranking a los couriers oscuros
    aunque sean baratos y "cumplan el SLA de entrega".

Estas 4 señales (promesa + efectividad 1ra visita + NPS + índice actualización) son los inputs iniciales de la
capa scoring (§4) + se exponen como variables condicionales en las reglas (§3.1-3.5).

### 🚨 Umbrales: los fija CADA CLIENTE, no son constantes de Shipro

Los números concretos de los umbrales de las reglas AOV (`$200.000` VIP, `$80.000` bajo, etc. abajo) son
**ejemplos ilustrativos** — NO son constantes del motor Shipro. **Cada empresa cliente configura sus propios
umbrales** según su negocio (su ticket promedio, su mix de precios, su definición de "VIP").

El motor provee la **mecánica** (regla declarativa "si `valorCarrito ≥ X` entonces acción Y") y la UI para
que la empresa declare X; **el motor NO decide qué es un ticket alto para esa empresa** — lo decide la
empresa misma. Esto se refleja en el modelo (`ReglaRuteo.condicionValor` es `Decimal`, editable por cliente) +
en la UI admin (empresa escribe sus umbrales por regla).

**Excepción — reglas con criterio lógico universal**: las reglas geográficas (§3.2) tienen criterio **común a
todos los clientes AR** porque la cobertura real del mercado logístico argentino es la misma para todos:
Correo Argentino cubre rural donde los privados no llegan, flotas locales dominan AMBA denso, Andreani es
fuerte en interior profundo. Validado por Nacho como criterio lógico universal del mercado AR. Estas reglas
son defaults recomendados del motor; el cliente puede sobreescribirlas si tiene razón para hacerlo
(ej. un contrato específico con un courier regional).

### 3.1 — AOV (Average Order Value) — *valores de ejemplo; cada cliente configura los suyos*

| Regla | Condición (umbral configurable por cliente) | Acción |
|---|---|---|
| **Ticket VIP** | `valorCarrito ≥ X_vip` (ejemplo: $200.000 — fijado por cliente) | Restringir a couriers premium (siniestralidad < 1% histórica + firma en entrega). Scoring: subir peso de confiabilidad y bajar costo. |
| **Ticket bajo** | `valorCarrito < X_bajo` (ejemplo: $80.000 — fijado por cliente) | Priorizar económico (terrestre / postal, típico Correo Argentino). Scoring: subir costo (abaratar). |

### 3.2 — Geográficas (criterio lógico universal AR — validado Nacho)

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

### En criollo (lo que hace y por qué es el salto)

El scoring **le pone una NOTA a cada courier combinando varias dimensiones a la vez** (costo + confiabilidad +
velocidad + capacidad), **cada una con un PESO que configura el cliente** (cuánto importa cada cosa para su
negocio). El courier con la mejor nota gana el envío.

**Ejemplo concreto** — 3 couriers a una zona:

| Courier | Costo | Confiabilidad | Velocidad | Capacidad |
|---|---|---|---|---|
| Andreani | $$ caro | 95% on-time | 48 hs | sucursales + firma |
| Correo Argentino | $ barato | 85% on-time | 96 hs | solo domicilio |
| Flota local | $$ medio | 92% on-time | 24 hs | solo domicilio AMBA |

Si el cliente le pone **70% peso al costo** → gana Correo Argentino (barato).
Si el cliente le pone **50% peso a la velocidad** → gana la flota local (24 hs).
Si el cliente le pone **45% peso a la confiabilidad** → gana Andreani (95%).

**Hoy el motor de Shipro elige por UNA sola cosa**: ordena por precio solo, O por SLA solo (ver `aplicarEstrategia`
en `cotizador.ts:745-750`). **El scoring elige por la MEZCLA** — pondera todas las dimensiones a la vez con los
pesos del cliente. Ese es el **salto del "ticket to win"**: pasar de regla binaria (más barato / más rápido) a
decisión multi-dimensional que refleja la estrategia comercial de cada empresa.

### Fórmula (formalización de lo de arriba)

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

> **Infra de datos**: qué fuentes alimentan cada `cᵢ` (costo, c_sla, velocidad, capacidad), qué está ya capturado
> vs qué falta, y qué es "new analysis" vs "new capture" → ver **§10 Arquitectura de datos del scoring**.

---

## 5. 🆕 APORTE NACHO — confiabilidad = demora ponderada POR ZONA × VOLUMEN × VENTANA TEMPORAL

### Formulación en palabras de Nacho

> *"La demora ponderada de entrega POR ZONA, según el volumen que le dimos al courier en una ventana de tiempo."*

Es decir: lo que importa medir es **cuánto tarda REALMENTE el courier en entregar en tal zona, dado el volumen que
le estamos dando en una ventana temporal concreta**. Es la **métrica de oro de la dimensión confiabilidad**.

### Dos precisiones críticas sobre el estado del arte

#### (a) VENTANA TEMPORAL — no acumulado histórico

El volumen se mide en un **período acotado** (los N paquetes que el courier retiró de Shipro en una ventana
día/semana/mes), NO en acumulado histórico desde el inicio de la relación. Razón: la capacidad de un courier
oscila — esta semana puede tener su red cargada por el Black Friday de otro agregador, la semana que viene
estar vacía. El SLA de esta semana puede ser radicalmente distinto al de la semana pasada aunque el volumen
promedio histórico sea idéntico.

**Implica**:
- Ventana configurable (default propuesto: 7 días rolling).
- La curva se re-ajusta en cada ejecución del scoring con la ventana vigente, no un fit histórico fijo.
- Permite capturar degradación temporal del servicio (ej. mes de picos de ecommerce).

#### (b) POR ZONA — no SLA global del courier

Es el SLA del courier **en una zona específica**, NO el agregado nacional. Razón: un courier puede ser excelente
en AMBA (red densa de distribución) y mediocre en interior profundo (dependencia de operadores locales). Agregar
el SLA global oculta esta estructura y lleva al scoring a elegir mal cuando el envío es a zona de bajo
desempeño de un courier con buen promedio.

**Implica**:
- Granularidad mínima: `(courier, zona, ventana)`. Donde "zona" ≥ provincia; idealmente partidos / CP buckets
  (ver §3.2 — "mapa de zonas comerciales").
- Al cotizar envío a zona Z, el scoring consulta la curva de ese courier en Z, no la curva nacional.

### Observación empírica que justifica el diseño

El SLA de un courier **degrada con el volumen asignado por zona en la ventana**. Ejemplo empírico:

| Courier | Zona | Volumen semanal (ventana=7d) | Demora real promedio (hs) |
|---|---|---|---|
| Andreani | CABA | 100 paquetes | 48 hs |
| Andreani | CABA | 200 paquetes | 52 hs |
| Andreani | CABA | 300 paquetes | 68 hs |
| Andreani | Patagonia | 10 paquetes | 120 hs |
| Andreani | Patagonia | 30 paquetes | 180 hs |

El mismo courier, dos curvas distintas (CABA + Patagonia), ambas crecientes con el volumen, pero con **puntos de
saturación diferentes**. Un courier con red saturada en una zona entrega peor en esa zona; en otra zona
subutilizada el mismo courier puede seguir cumpliendo. El volumen asignado por **Shipro mismo**, en una ventana
reciente, influye en el SLA real que ese courier va a producir en el próximo envío.

### Implicación de diseño

La dimensión "confiabilidad" del scoring **NO es un escalar fijo por courier**, **ni siquiera un escalar por
`(courier, zona)`** — es una **función del volumen asignado en una ventana reciente, por zona**:

```
c_sla(courier, zona, ventana) = f_demora_ponderada(courier, zona, volumen_en_ventana + 1)
```

Donde `f_demora_ponderada` devuelve el valor (normalizado a `[0, 1]`) correspondiente a la demora esperada en
esa zona dado el volumen que el courier ya tiene asignado en la ventana + el envío que estamos por sumar.

El scoring pregunta: *"¿qué demora real tengo con el courier X al entregar en la zona Z, dado que ya le mandé V
paquetes en los últimos 7 días a esa zona, con V+1 el próximo despacho?"* — no "¿qué SLA tiene X?".

### Métrica nueva requerida

**Demora ponderada por `(courier, zona, ventana)` × volumen asignado**: se construye observando histórico de
`(courier, zona, volumen_en_ventana, demora_real_entrega)` y ajustando una curva por zona (regresión polinomial
o segmentos lineales). Permite al scoring saber cuánto degrada cada courier por zona a medida que se le carga
volumen.

Infraestructura necesaria (sub-items de la Fase 4.1 del plan §7):
- Tabla `MetricaDemoraPonderada` o extensión de `MetricaSLA` con columnas `zona` + `ventanaDias` + `volumen` +
  `demoraRealHoras`.
- Cron de agregación diario que calcula los puntos de la curva por `(courier, zona)` sobre la ventana rolling.
- Ajustador de curva (polinomial o lineal por tramos) + consulta eficiente en el scoring.

**Diferencial sobre el informe industria**: la industria describe el feedback loop SLA-vs-real por courier/zona
como **escalar**. **Nacho agrega 2 dimensiones más**: ventana temporal (no acumulado) + volumen asignado (función,
no escalar). Es anti-saturación POR ZONA y POR MOMENTO — Shipro no concentra en el mismo courier aunque sea el
más barato, porque sabe que a más volumen peor cumple **en esa zona, en esta semana**.

**Marcado como**: dimensión AVANZADA, post-datos, pero **registrada aquí como diferencial del motor Shipro
sobre el estado del arte**. Se encuentra en el framework desde el día 1 como `c_sla_volumen_zona_ventana`
placeholder; se activa en Fase 4.1 cuando los puntos de las curvas por `(courier, zona)` tengan muestra.

> **Método de cálculo** (hipótesis de proporcionalidad de volumen propio como proxy de volumen total del courier) y
> **data necesaria** (liquidaciones + zona del courier + volumen rolling) → ver **§10 Arquitectura de datos del
> scoring**, subsecciones B y C.

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

### Cruce con las 16 métricas de Torre (DEUDA 39)

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
| **39** | Torre de Control (16 métricas en 5 bloques — `docs/TORRE-DE-CONTROL.md`). **Alimenta Bloques A/B/C de §6**. 13/16 cerradas, 3 pendientes — recon dedicado en Fase 2 / 4 para mapear qué nuevas requiere el motor. |
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

## 10. Arquitectura de datos del scoring (recon Fase 0, 2026-10-08)

Consolidación de la recon de data inventory Chat A (2026-10-08) + 2 inputs nuevos de Nacho (liquidaciones como
fuente + hipótesis de volumen proporcional como método para la curva de confiabilidad). Esta sección es el
puente entre el diseño (§2-§5) y la ejecución (§7): dice **de qué data vive cada `cᵢ`**, qué está capturado,
qué no, y qué hay que empezar a guardar YA para que el motor en sombra acumule histórico desde el día 1.

### A. Fuentes de datos YA capturadas (reusables — "new analysis" no "new capture")

Lo que Shipro ya persiste y que alimenta el scoring sin cambiar el schema:

- **COSTO** — `FinanzasEnvio.costoCourierNativo` + `costoCourierCotizado` + `costoCourierFacturado` + `tarifaFullCotizada`
  ([prisma/schema.prisma:692-748](../prisma/schema.prisma#L692-L748)). El ciclo "nativo → cotizado → facturado" está
  completo. `costoCourierFacturado` lo escribe `/api/conciliacion` cuando el operador sube el Excel del courier
  (DEUDAS-RESUELTAS.md commit `0b1f6b0`). **Alimenta `c_costo` + feedback de calibración**.
  - **Gap**: nadie agrega todavía el **delta cotizado-vs-facturado por `(courier, zona)`** en forma de helper /
    endpoint Torre. Es signal fuerte para ajustar el scoring (si Andreani cobra sistemáticamente 15% más que
    cotizado en zona Patagonia, el scoring tiene que castigarlo). Classification: **PERSISTED BUT UNANALYZED**.

- **TIEMPO REAL DE ENTREGA** — `Envio.fechaImpresion` → `Envio.fechaEntrega`
  ([prisma/schema.prisma:904-906](../prisma/schema.prisma#L904-L906)), poblado por el cron rastreo
  ([app/api/cron/rastreo/route.ts:107-112](../app/api/cron/rastreo/route.ts#L107-L112)) al transicionar a
  `ENTREGADO`. **Alimenta `c_velocidad` + base de `c_sla`**.
  - Nota de precisión: la timestamp es **wall-clock de ingesta Shipro** (cuando el cron corrió), no el instante
    que el courier reportó. Para la mayoría de las dimensiones del scoring esto es suficiente; el **índice de
    actualización de estado** (§3.0) sí requiere la timestamp courier-side (ver gap D).

- **SECUENCIAS DE TRACKING** — `EventoTracking` ([prisma/schema.prisma:1003-1021](../prisma/schema.prisma#L1003-L1021))
  persiste cada cambio de estado (`estado + estadoCrudoOriginal + observacion + fecha + envioId`). Hoy solo lo
  consume la Métric 2.2 (`clasificarEfectividad` en
  [lib/utils/efectividad-primera-visita.ts](../lib/utils/efectividad-primera-visita.ts)). **Gold mine
  infraexplotado**: `% visitas fallidas`, tiempo entre eventos intermedios, patrones de retroceso, latencia
  entre `EN_DISTRIBUCION` → `ENTREGADO`, etc. Classification: **PERSISTED BUT UNANALYZED**.

- **PROMESA CALIBRADA** — [lib/utils/promesa-calibrada.ts:116-275](../lib/utils/promesa-calibrada.ts#L116-L275):
  P75 por `(depósito, courier, provincia)` con fallback 4 niveles + umbral muestra ≥ 10 + ventana 90d. **Es el
  patrón arquitectural del scoring** (§2) y **ya es consumible por `c_velocidad`** sin cambios.
  - Granularidad actual: PROVINCIA. Zona finer bloqueado por DEUDA 46.

- **NPS COMPRADOR** — `EncuestaNPS` ([prisma/schema.prisma:1184-1222](../prisma/schema.prisma#L1184-L1222)) con 7
  dimensiones (`experienciaEntrega`, `slaCumplido`, `cpDestino`, `provincia`, `modalidad`, etc.). Alimentado por
  `enviarMailEntregadoNPS` desde cron rastreo. Métric 5.1 ya expone. **Sub-componente de `c_sla` percibido**.

- **CAPABILITY FLAGS** — `Courier.puedeEntregarSucursal/Domicilio/...` + `ServicioCourier.capacidadTecnicaMapeada`
  ([prisma/schema.prisma:296-319, 398](../prisma/schema.prisma#L296-L319)). **Alimenta `c_capacidad` directo** +
  la Capa 1 determinista (DEUDA 91 cerrada).

### B. 🆕 Liquidaciones como fuente de datos (input Nacho 2026-10-08)

**Observación de Nacho**: la UI de carga de liquidación YA EXISTE (`/api/conciliacion`) y la operación de Shipro
ya mensualmente procesa el Excel que cada courier emite. **Hoy** captura (tarifa facturada + aforo + peso cobrado).
**Lo que falta**: capturar la **ZONA DEL COURIER** — la columna del Excel donde el courier declara qué zona
usó para facturar ese envío.

**Por qué importa la zona del courier (y no solo la zona inferida del CP)**: cada courier tiene **sus propias
zonas** operativas (su propio mapa comercial):
- **Andreani**: ~6 zonas en todo el país.
- **Mocis**: ~4 zonas en AMBA (su área de operación).
- **Correo Argentino**: ~4 zonas en todo el país.
- Cada courier futuro: su propio mapa.

La zona que el courier usó para facturar es la **verdad operativa del courier** — es más precisa que una zona
inferida por Shipro desde el CP, porque es la zona en la que el courier REALMENTE opera, con la que calcula sus
tarifas y mide su propia performance. Dos envíos al mismo CP pueden terminar en zonas distintas según el courier
(Andreani lo clasifica como "Interior 2", Correo Argentino como "Patagonia Norte") — y las dos clasificaciones
son correctas, cada una desde su mapa.

**Aporte al motor**:
- La liquidación entrega la tupla `(tracking + tarifa facturada + zonaCourier + aforo facturado)` por envío real.
- Esto alimenta: **COSTO POR ZONA REAL DEL COURIER** (`c_costo` calibrado por zona operativa, no inferida) +
  **CONFIABILIDAD POR ZONA REAL** (cruzando `fechaEntrega` con `zonaCourier` → tiempo real por zona del courier).
- Permite que el scoring compare apples-to-apples: "Andreani en su zona Interior 2 vs Correo Argentino en su
  zona Patagonia Norte, para el mismo CP destino", porque cada uno se juzga en su propia unidad operativa.

**Dependencia técnica**: **DEUDA 44 (ABIERTA)** — parser del Excel de liquidación + nuevo campo
`Envio.zonaCourier String?`. Cada courier tiene su formato de columnas, por lo tanto el parser es
courier-specific (normalizador por courier → columna "zona"). DEUDA 44 bloquea DEUDA 45 (comparación calibrada
vs nominal) y es el input duro para la dimensión confiabilidad por zona del scoring.

### C. 🆕 Hipótesis de volumen proporcional — método para la curva de confiabilidad (input Nacho 2026-10-08)

**El problema**: la §5 define `c_sla(courier, zona, ventana) = f_demora_ponderada(courier, zona, volumen_en_ventana)`.
Pero Shipro **no es el único player** que le da carga a un courier dado — Andreani también opera para Mercado
Libre, Fravega, Garbarino, etc. Shipro **no conoce el volumen total diario del courier** — solo conoce **su propio
volumen asignado**.

**Hipótesis de Nacho**: la carga de Shipro es **proporcional** a la carga general del courier. Si Shipro le da
el 10% del volumen mensual del courier en un mes de baja estacionalidad, le da **aproximadamente el 10%** en un
mes de alta estacionalidad. Es decir: Shipro escala con el courier, no contraciclíca.

**Consecuencia metodológica**: Shipro puede medir cómo performó el courier en los meses de **ALTO volumen propio**
(que son proxy de alto volumen total del courier) vs los meses de **BAJO volumen propio** (proxy de bajo volumen
total). Al observar la degradación del SLA cuando SU volumen crece, Shipro está infiriendo **la curva de capacidad
real del courier** — cuántos paquetes puede absorber el courier antes de que su SLA empiece a degradar
sistemáticamente.

**Cálculo concreto** (método, no fórmula cerrada):
1. Agregar `(courier, zona, mes, volumen_shipro, demora_real_promedio)` sobre el histórico.
2. Normalizar el volumen de Shipro a su propio percentil mensual (ej. "mes p25 vs p75 vs p95" del propio Shipro).
3. Observar la pendiente de demora vs volumen → curva empírica por `(courier, zona)`.
4. Usar la curva en el scoring: dado `volumen_shipro_asignado_en_ventana + 1`, estimar la demora esperada.

**Caveat explícito**: la proporcionalidad es una **HIPÓTESIS A VALIDAR** con datos reales. Puede no cumplirse si:
- Shipro crece más rápido que el courier (su share aumenta → la proporcionalidad se rompe hacia arriba).
- Alguno de los otros grandes del courier le pide una campaña puntual (su share baja → proporcionalidad se rompe
  hacia abajo).
- El courier re-dimensiona su capacidad (contrata flota, abre centro de distribución).

Mitigación: el shadow mode (§2) permite comparar scoring con hipótesis vs selección real, y si la hipótesis falla
sistemáticamente, revisarla antes de encender. Es "falsificable" por diseño.

**Esto convierte un dato que Shipro NO tiene (volumen total del courier) en uno que SÍ tiene (su propio volumen
en el tiempo)**. Es el **MÉTODO** de la curva de la §5 — sin él, la §5 queda formulada pero inimplementable.

### D. Gaps de captura (lo que falta — clasificado)

| Gap | Classification | Prerequisito/DEUDA | Day-1 priority |
|---|---|---|---|
| **Zona sub-provincial propia (ZonaLogistica)** | **MISSING** — no existe modelo | DEUDA 46 abierta | **ALTA** — bloquea granularidad zona de casi todo el scoring |
| **Zona del courier (`Envio.zonaCourier`) desde Excel liquidación** | **MISSING** — campo no existe, parser no existe | DEUDA 44 abierta | **ALTA** — es la verdad operativa del courier (§B) |
| **Volumen rolling por `(courier, zona, ventana)`** | **MISSING** — ningún agregado persistido ni cron | Nuevo cron/counter (no hay DEUDA registrada) | **CRÍTICA** — insumo de la curva §5+§C, cada día sin guardar es irrecuperable |
| **Timestamp courier-reported (payload raw por evento)** | **MISSING** — los 6 adapters descartan el payload, solo guardan el estado traducido | Extender `CourierInterface.rastrear` (cross-chat Chat B) | **ALTA** si se activa índice §3.0; **MEDIA** si se difiere |
| **MotorReglaShadowLog** (shadow mode log) | **MISSING** — no existe tabla | Decisión §8 abierta — mapear tabla + columnas | **CRÍTICA** — sin ella el motor en sombra no acumula la evidencia que justifica encenderlo |

**Precedente para la captura del payload courier**: Mercado Libre Flex **sí persiste el payload raw**:
`ShipmentFlex.payloadRaw Json` + `NotificacionFlex.payloadRaw Json`
([prisma/schema.prisma:2292, 2367](../prisma/schema.prisma#L2292)). **El patrón existe en el codebase** — falta
replicarlo al contrato de los adapters courier (`rastrear()` devuelve `String` hoy, debería devolver un objeto
con `estado + payloadRaw + fechaReportada`).

**Clasificación resumen**:
- **MISSING / NEW CAPTURE** (schema o adapter nuevo): zona logística, zona courier, volumen rolling, shadow log,
  timestamp courier-reported.
- **PERSISTED BUT UNANALYZED / NEW ANALYSIS**: delta cotizado-vs-facturado por zona, secuencias EventoTracking
  completas, `CotizacionSnapshot.opcionesSnapshotJson`, `MetricaCourierLatencia`, `AuditoriaCheckout` outcomes.

### E. Reconciliaciones del blueprint (correcciones encontradas en el recon)

1. **La Torre tiene 16 métricas**, no 14, organizadas en 5 bloques (ver `docs/TORRE-DE-CONTROL.md`). Ya corregido
   en §1 (línea tabla fundación) + §6 (header "Cruce con las 16 métricas") + §9 (fila DEUDA 39).

2. **`MetricaSLA.slaPromedioHs` guarda `avg Int`**
   ([prisma/schema.prisma:1302-1318](../prisma/schema.prisma#L1302-L1318)) — mientras que `calcularPromesaCalibrada`
   usa **P75** directamente ([lib/utils/promesa-calibrada.ts:116](../lib/utils/promesa-calibrada.ts#L116)).
   **Inconsistencia entre niveles de fallback** (los niveles 1-2 son P75; el nivel 3 cae a avg). A resolver cuando
   se construya Fase 4: recomputar `MetricaSLA` a P75 (+ P50 + muestra) o replantear la pirámide. Registrado como
   decisión abierta técnica.

3. **Dos ventanas distintas de "tiempo real de entrega"**:
   - **`fechaImpresion → fechaEntrega`**: usada por `calcularPromesaCalibrada`. Incluye **tiempo en depósito del
     cliente** (desde que imprime la etiqueta hasta que la entrega al courier) + tiempo del courier. Es la
     "promesa al comprador" (el buyer ve en el checkout cuánto tarda total desde que compra).
   - **`fechaColecta → fechaEntrega`**: usada por el cron `metricas-sla` ([app/api/cron/metricas-sla/route.ts](../app/api/cron/metricas-sla/route.ts)).
     Solo tiempo del courier (desde que lo retira hasta que lo entrega). Es la "velocidad real del courier".

   **El scoring debe elegir explícitamente cuál mide cada dimensión**:
   - **`c_velocidad` (velocidad del courier)** → `fechaColecta → fechaEntrega` (es decisión sobre el courier).
   - **"Promesa al comprador" (lo que ve el buyer)** → `fechaImpresion → fechaEntrega` (incluye tiempo depósito).

   Registrar explícitamente en Fase 3 para que la implementación del helper `scoring.ts` sea no ambigua.

### F. Prioridad DAY-1 (qué empezar a capturar YA para que la sombra tenga histórico)

**CRÍTICAS** (cada día sin captura = histórico irrecuperable):
1. **`MotorReglaShadowLog`** — tabla nueva con `(cotizacionSnapshotId, winnerActual, winnerShadow, scoreActual,
   scoreShadow, wᵢ snapshot, cᵢ snapshots, createdAt)`. Sin ella el shadow mode (§2) corre pero no acumula
   evidencia. **Prerequisito duro de Fase 3**.
2. **Volumen rolling por `(courier, zona, ventana)`** — nuevo cron de agregación o `MetricaVolumenCourier` persisted
   (col rolling counter). Prerequisito del método §C (curva volumen proporcional).
3. **Timestamp courier-reported** (si se activa el índice de actualización §3.0) — extensión del contrato del
   adapter (6 adapters a tocar, cross-chat Chat B). Si se difiere, también se difiere el índice.

**ALTAS** (data ya existe, solo falta análisis):
4. **Delta `costoCourierCotizado` vs `costoCourierFacturado` por `(courier, zona)`** — helper nuevo sobre data ya
   persistida vía conciliación. Signal fuerte y accionable.
5. **Secuencias EventoTracking agregadas** — más métricas derivadas (visitas fallidas, tiempo entre estados,
   patrones de retroceso) de la data ya guardada. "New analysis", zero capture change.
6. **`AuditoriaCheckout` outcomes** (Métric 1.3 pendiente) — cerrar el loop de calibración del auditor con la data
   ya persistida.

**MEDIAS** (consolidación DEUDAS zonas):
7. **DEUDA 44** (zona courier liquidación) — es el input duro para que el scoring por zona del courier funcione.
8. **DEUDA 46** (zona logística propia) — complemento para que Shipro infiera zonas antes de tener la del courier.
9. **DEUDA 43** (SLA nominal por `(courier, zona)` en `SlaCourier`) — es el **Nivel 4** de fallback de `c_sla`
   según §4; con `SlaCourier` precargado el scoring arranca con señal razonable incluso sin datos reales.

---

- **Hoy (2026-10-08)**: FASE 1 completa. Blueprint consolidado. Zero código.
- **Pre-primer-cliente**: FASE 2 + FASE 3 construidas, scoring en sombra loguea sin afectar selección. Reglas
  deterministas ricas disponibles para que Nacho / clientes declaren.
- **Primer cliente + 1-2 meses**: histórico suficiente. **Encender FASE 4** — scoring real afecta selección.
- **Post-FASE 4**: FASE 5 features según prioridad producto.

**Mirror conceptual con MEF** (DEUDA 180): el motor de reglas es el ticket-to-win genérico; MEF es el canal
particular de ML Flex. Ambos son blueprints maestros que viven aquí.

**Status DEUDA maestra**: ABIERTA — Fase 1 cerrada; Fase 2+3 pre-cliente; Fase 4 post-datos; Fase 5 según negocio.
Ver [[DEUDA 186]].

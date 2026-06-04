# Torre de Control de Shipro

**DEUDA 39 — Documento maestro de diseno**
**Fecha del diseno:** 2026-06-04
**Estado:** Diseno completo. Implementacion pendiente metrica por metrica.

---

## Vision

La Torre de Control es el corazon estrategico de la Plataforma Multicourier de Shipro. No es un dashboard mas. Es la materializacion del principio declarado el 2026-06-02: **Shipro es plataforma de datos**. La generacion de informacion estrategica para el cliente y para la operacion logistica es parte del core del producto, no un agregado.

Mientras las plataformas multicourier estandar gestionan envios, Shipro gestiona el conocimiento sobre esos envios. La diferencia es radical:

- Las plataformas estandar muestran al cliente sus envios, sus cotizaciones, sus tarifas.
- Shipro convierte cada envio, cada cotizacion, cada evento de tracking, cada respuesta de comprador en un instrumento de gestion que el cliente puede usar para tomar decisiones de negocio.

Esta es la verdadera propuesta de valor diferencial de Shipro. Quien quiera competir con esta capacidad va a tener que reconstruir anos de datos historicos, modelo de datos, integraciones, y disciplina de medicion.

## Propuesta de valor por audiencia

**Para el dueno del e-commerce:** la Torre de Control responde preguntas que ninguna otra plataforma responde. Cuanto plata estoy dejando en la mesa por como elijo couriers. Cual es la promesa real que puedo hacerle a mi comprador en el checkout. Cual de mis couriers genera mejor experiencia final. Donde tengo riesgos invisibles de concentracion. Si mi operacion esta cerca de quedarse sin saldo. Etcetera.

**Para el equipo operativo del cliente:** la Torre de Control convierte el dia a dia en gestion. Cuantas etiquetas necesitan correccion. Cuantos tickets de soporte se abrieron. Cuanto tarda mi depocito en despachar. Que SKUs tienen problemas sistematicos de peso. Etcetera.

**Para Shipro internamente:** la Torre de Control es el monitor de salud de toda la plataforma. Que couriers estan degradados tecnicamente. Que zonas tienen cobertura insuficiente. Que clientes estan en riesgo financiero. Que metricas se desvian y requieren intervencion.

## Principios transversales

Las 16 metricas comparten cinco principios de diseno innegociables:

**1. Datos como producto, no como reporting.** Cada metrica esta disenada para informar una decision concreta, no para llenar un dashboard. Si una metrica no genera accion, no esta bien disenada.

**2. Cortes de analisis multiples siempre disponibles.** Cada metrica permite desglozar, segmentar, individualizar, agrupar y analizar desde distintos puntos de vista. La data se ve global, por courier, por region, por usuario, por momento.

**3. Tiempo real cuando importa.** Las metricas que requieren accion inmediata se muestran en tiempo real. Las que requieren tendencia se calculan en ventanas moviles. El tiempo de la metrica matchea el tiempo de la decision.

**4. Honestidad en estado vacio.** Cuando no hay suficientes datos para calcular una metrica de manera significativa, la plataforma lo dice explicitamente en lugar de mostrar numeros falsos o graficos placeholder. La honestidad del estado vacio es parte de la propuesta de valor.

**5. UI/UX disenada para clientes serios.** Las visualizaciones no son adornos. Cada elemento (tarjeta principal, vista expandida, simuladores, alertas) esta pensado para clientes que toman decisiones sobre su negocio. No para impresionar con widgets.

## Estructura del documento

Las 16 metricas estan organizadas en 5 bloques tematicos. La distribucion por bloque es: Bloque 1 con 5, Bloque 2 con 3, Bloque 3 con 3, Bloque 4 con 4, y Bloque 5 con 1, totalizando 16.

**Bloque 1 — Calidad operativa de Shipro hacia el cliente (5 metricas).** Reflejan si la Plataforma esta cumpliendo su promesa de claridad y consistencia. Si estas metricas estan en rojo, el problema es de Shipro.

**Bloque 2 — Performance logistica (3 metricas).** Reflejan como se esta comportando la cadena logistica real. El motor de promesa calibrada (metrica 2.3) es el pilar mas ambicioso del bloque.

**Bloque 3 — Inteligencia de negocio para el cliente (3 metricas).** Convierten datos operativos en decisiones de margen y estrategia.

**Bloque 4 — Salud del ecosistema (4 metricas).** Miden condiciones estructurales: riesgos, dependencias, oportunidades, solidez financiera.

**Bloque 5 — Voz del comprador final (1 metrica).** Cierra el circulo con NPS Transaccional enriquecido.

Cada metrica esta documentada con 9 campos: Categoria, Definicion operativa, Por que importa para el cliente, Diferencial competitivo, Fuente de datos, Formula de calculo, Cortes de analisis disponibles, Experiencia del cliente UI/UX, Verificacion tecnica pendiente.

## Indice

- [Bloque 1 — Calidad operativa de Shipro hacia el cliente](#bloque-1)
  - 1.1 Resolver Nomenclador
  - 1.2 Auditar Checkouts
  - 1.3 Eficiencia del Auditor de Checkout
  - 1.4 Carga de Soporte
  - 1.5 Velocidad de Resolucion de Tickets

- [Bloque 2 — Performance logistica](#bloque-2)
  - 2.1 Tiempos Colecta (Tiempo de Despacho)
  - 2.2 Efectividad en Primera Visita
  - 2.3 Promesa de Entrega Calibrada

- [Bloque 3 — Inteligencia de negocio para el cliente](#bloque-3)
  - 3.1 Fuga por Ruteo
  - 3.2 Desvio de Peso (Fuga por Aforo)
  - 3.3 Modalidades de Eleccion

- [Bloque 4 — Salud del ecosistema](#bloque-4)
  - 4.1 Riesgo Courier
  - 4.2 Salud de Couriers
  - 4.3 Cobertura Postal Activa
  - 4.4 Salud Financiera de la Operacion

- [Bloque 5 — Voz del comprador final](#bloque-5)
  - 5.1 Experiencia del Consumidor (NPS Transaccional)

- [Deudas y refinamientos pendientes](#deudas)
- [Apendices](#apendices)

---

<a id="bloque-1"></a>
# Bloque 1 — Calidad operativa de Shipro hacia el cliente

Este bloque reune las metricas que reflejan si la Plataforma esta cumpliendo su promesa de claridad y consistencia hacia el cliente y, por extension, hacia el comprador final. Son metricas de salud del producto en si mismo, no de los couriers. Si estas metricas estan en rojo, el problema es de Shipro, no de la red logistica.

---

## 1.1 Resolver Nomenclador

### Categoria
Calidad operativa interna · Normalizacion de informacion

### Definicion operativa
Cantidad y porcentaje de estados crudos recibidos de couriers que aun no fueron mapeados a un Estado Shipro canonico en el nomenclador. Cada courier integrado publica su propio vocabulario de estados ("En reparto", "Visita fallida", "Aguardando despacho"). Shipro traduce todos esos vocabularios a un unico conjunto de Estados Shipro que se comunica al comprador y al cliente. Esta metrica mide cuanto de ese vocabulario crudo todavia no tiene traduccion asignada y, lo mas importante, cual es el impacto real de esa brecha medido por frecuencia de aparicion.

### Por que importa para el cliente
Un estado sin mapear es un comprador recibiendo informacion cruda del courier o ninguna informacion, y rompe la promesa de experiencia uniforme. El cliente de Shipro contrata la plataforma porque confia en que la comunicacion con su comprador es consistente independientemente del courier que entregue. Esta metrica le da visibilidad operativa de cuanta brecha existe entre lo que el courier dice y lo que Shipro transmite, y donde esta concentrada esa brecha.

Decisiones que habilita:
- ¿Tenemos que destinar tiempo de operaciones esta semana al nomenclador?
- ¿La incorporacion de un courier nuevo esta completa o falta cobertura de estados?
- ¿Que courier nos esta generando deuda de mapeo mas rapido que otros?
- ¿Hay un estado nuevo que aparecio con alta frecuencia que requiere atencion inmediata?

### Diferencial competitivo
Las plataformas multicourier estandar muestran al comprador el texto crudo del courier o un generico tipo "en transito" sin transparencia sobre la cobertura real de traduccion. Shipro hace explicita esa traduccion y la expone como metrica de calidad. El cliente ve no solo que su comunicacion es uniforme, sino cuanto del trabajo de uniformidad esta hecho y cuanto falta. Esa transparencia es producto, no metadata.

### Fuente de datos
- Modelo `Nomenclador` (schema linea 488): mapeo entre `estadoCrudo` (string del courier) y `estadoShipro` (string canonico), con FK a `Courier`. Unico por par `(courierId, estadoCrudo)`. Si `estadoShipro` esta vacio, el estado esta sin resolver.
- Modelo `EventoTracking` (schema linea 475): registra cada evento de estado por envio, con campo `estado` y `fecha`. Fuente para medir frecuencia de aparicion de cada estado crudo.
- Modelo `TramoEnvio` (schema linea 845): campo `estadoCrudoUltimo` guarda el ultimo estado raw del courier por tramo. Util para detectar estados activos hoy.
- Modelo `Courier` (schema linea 134): para cortes por courier.

### Formula de calculo
Conteo simple:
estados_no_mapeados = COUNT(Nomenclador WHERE estadoShipro IS NULL OR estadoShipro = "")
total_estados_crudos = COUNT(Nomenclador)
porcentaje_cobertura_simple = ((total - no_mapeados) / total) × 100

Ponderado por frecuencia de aparicion (recomendado como metrica principal):
eventos_sin_mapeo = COUNT(EventoTracking JOIN Nomenclador ON estadoCrudo
WHERE Nomenclador.estadoShipro IS NULL)
en ventana ultimos 30 dias
total_eventos = COUNT(EventoTracking) en ultimos 30 dias
porcentaje_cobertura_real = ((total - sin_mapeo) / total) × 100

La formula ponderada refleja impacto real: un estado crudo sin mapear que aparece 5.000 veces al mes pesa mas que diez estados sin mapear que aparecen dos veces cada uno. La primera formula sirve como diagnostico complementario.

**Semantica operativa de la frecuencia (decidido 2026-06-04 durante implementacion):** la frecuencia cuenta envios impactados por un estado sin mapear, no polls del courier. Es decir, si el cron de rastreo polleo 50 veces el mismo "EnReparto" para el mismo envio, cuenta 1 (transicion del envio al estado), no 50. Razon: el impacto operativo (comunicacion rota al comprador) ocurre una vez por envio que toca el estado, no por cada poll. Esta semantica esta implementada en el cron `/api/cron/rastreo` linea 70 (state-change detection) y no requiere ajuste.

### Cortes de analisis disponibles
- **Por courier:** Andreani vs. Mocis vs. cada nuevo integrado a futuro. Permite identificar si la deuda esta concentrada en un solo proveedor.
- **Por antiguedad del estado crudo:** estados nuevos (primera aparicion en ultimas N semanas) vs. historicos. Los nuevos son senal de cambios en el lado del courier que requieren atencion inmediata.
- **Por frecuencia de aparicion:** alta (mas de 1.000 eventos/mes), media, baja, rara. Foco operativo se asigna a los de alta frecuencia.
- **Por impacto en visibilidad al comprador:** estados que se publican al comprador vs. estados internos del courier. Los publicables tienen prioridad.
- **Tendencia temporal:** evolucion semana a semana, mes a mes. Permite responder si estamos cerrando gap o acumulando deuda.
- **Top 10 estados sin mapear ordenados por frecuencia:** cola priorizada para accion.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador grande central: porcentaje de cobertura ponderada por frecuencia (ej: `94,3%`).
- Subtitulo: cantidad absoluta de estados crudos sin resolver (ej: `12 estados sin resolver`).
- Mini-grafico de tendencia de las ultimas 4-8 semanas, como sparkline horizontal debajo del numero.
- Indicador semaforo en esquina: verde si cobertura >95%, amarillo si esta entre 85-95%, rojo si es menor a 85%. Los umbrales son configurables por cliente.
- CTA primario: "Resolver nomenclador" → lleva directo a `/app/(dashboard)/nomenclador/page.tsx`.

**Vista expandida (al hacer click en la tarjeta):**
Tabla con los estados crudos sin mapear, ordenados por frecuencia descendente. Columnas:
- Estado crudo (texto literal del courier)
- Courier de origen
- Primera vez visto (fecha)
- Ultima vez visto (fecha)
- Total de apariciones en ventana
- Impacto estimado (eventos/mes proyectado)
- Accion: boton "Mapear ahora" que abre el dropdown del nomenclador inline sin salir de la vista.

**Interacciones disponibles:**
- Filtros aplicables a la tabla: por courier, por rango temporal, por umbral de frecuencia minima.
- Busqueda libre por texto del estado crudo.
- Exportar tabla a CSV o Excel.
- Programar alertas con umbral configurable: "Avisame si la cobertura baja del 90%".

**Estado vacio (cliente nuevo o courier recien integrado):**
Mensaje honesto: "Aun no hay suficiente data historica para esta metrica. Volve en 7 dias o espera los primeros 1.000 eventos." Sin graficos placeholder ni numeros falsos.

**Estados de alerta:**
- Si aparece un estado crudo nuevo con alta frecuencia (mas de 100 eventos en 24h), notificacion inmediata al equipo de operaciones de Shipro y mencion en la tarjeta del cliente afectado.
- Si la cobertura cae por debajo del umbral configurado por el cliente, badge rojo en la tarjeta principal y correo automatico al cliente con resumen del impacto y CTA para resolver.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿Como se llena `Nomenclador.estadoCrudo` hoy? ¿Hay proceso automatico que lo registra al recibir un estado nuevo desde el courier, o se carga manualmente?
- ¿Existe ya un endpoint que devuelva el conteo agregado de estados no mapeados, o hay que crearlo? El endpoint `/api/torre-de-control/route.ts` actualmente solo tiene Calidad Postal (DEUDA 8).
- ¿El campo `estadoShipro` en `Nomenclador` es nullable o tiene default vacio? Esto afecta la query.
- ¿La pagina `/app/(dashboard)/nomenclador/page.tsx` ya tiene CRUD funcional o solo lectura?
- Para el corte por frecuencia, ¿conviene calcular sobre `EventoTracking` (granular por evento) o sobre `TramoEnvio.estadoCrudoUltimo` (solo ultimos estados)?

---

## 1.2 Auditar Checkouts

### Categoria
Calidad operativa de la creacion de etiquetas · Detective de datos postales

### Definicion operativa
Cantidad y porcentaje de etiquetas que pasaron por el auditor de Google Maps al ser creadas, segmentadas por resultado en una logica de tres niveles que evita fricciones innecesarias al comprador:

**Nivel 1 — Validacion dura (siempre):** verifica que la triada `calle + localidad + provincia` existe en la realidad segun Google Maps geocoding. Si Google Maps confirma la triada con alta confianza, la etiqueta avanza al nivel 2.

**Nivel 2 — Correccion automatica silenciosa:** si Google Maps devuelve la direccion normalizada con una correccion menor (acentos, abreviaturas tipo "Av.", typos detectables), Shipro toma la version corregida y emite la etiqueta directo. El comprador no se entera de la correccion. El cliente ve en la metrica que su etiqueta paso por auditoria y se corrigio internamente.

**Nivel 3 — Solicitud de correccion al comprador (solo si los niveles 1 y 2 no resuelven):** si Google Maps no puede confirmar la triada o hay ambiguedad fuerte que ni la correccion automatica puede resolver, se dispara un mail desde `operaciones@shipro.pro` al comprador con un link a un formulario web (`/app/corregir/[tracking]/page.tsx`) donde corrige los datos esta vez validados por Google Maps en tiempo real. Recien entonces se emite la etiqueta.

La sensibilidad de la auditoria es configurable por cliente con tres perfiles: laxo (solo bloquea si Google Maps no resuelve nada), estandar (bloquea ante ambiguedad significativa), estricto (bloquea ante cualquier duda). Esto permite que cada cliente balancee fricción al comprador vs. precisión de datos según su modelo de negocio.

### Por que importa para el cliente
Cada etiqueta emitida con direccion incorrecta es un envio que tiene alta probabilidad de no entregarse en primera visita, costar reintentos al courier (que despues facturara igual), generar tickets de soporte cuando el comprador reclame, y deteriorar el NPS. Esta metrica le permite al cliente entender la calidad de la informacion que sale de su operacion sin pagar el costo de molestar a sus compradores innecesariamente.

Si un cliente tiene 30% de sus etiquetas pasando por circuito de correccion manual (nivel 3), eso revela un problema upstream en su e-commerce: formularios mal disenados, ausencia de validacion postal en el checkout propio del cliente, o problemas con como carga sus envios manualmente.

Decisiones que habilita:
- ¿Mi e-commerce esta exigiendo datos completos en el checkout, o estoy descargando ese trabajo a Shipro?
- ¿Que tipos de errores postales son los mas frecuentes? ¿Provincia mal seleccionada? ¿CP que no corresponde a la localidad? ¿Calle inexistente?
- ¿Mis operadores que cargan envios manualmente estan entrenados? ¿Hay un patron de errores por usuario?
- ¿Cuantos envios se quedaron varados porque el comprador no completo el formulario de correccion?
- ¿Que nivel de sensibilidad me conviene segun mi tolerancia a fricción vs. tolerancia a errores?

### Diferencial competitivo
La mayoria de plataformas emite la etiqueta con los datos que recibe, sin validacion. El problema aparece despues, cuando el envio no llega y todos pierden plata: el cliente, el comprador, el courier, la plataforma. Shipro detiene el problema antes de que ocurra con un peaje pre-emision sostenido por Google Maps, pero criticamente, lo hace en niveles jerarquicos para no fastidiar al comprador con correcciones que el sistema mismo puede resolver. Esta metrica le da al cliente visibilidad sobre el valor que esta recibiendo de ese peaje y, al mismo tiempo, lo educa sobre donde esta la fuente de error en su propia operacion.

### Fuente de datos
- Modelo `AuditoriaCheckout` (schema linea 536): registra cada validacion que pasa por el auditor. Campos clave: `direccionCruda` (lo que entro), `score` (resultado de Google Maps), `problemas` (array de issues detectados), `resuelto` (boolean), `fechaCreacion`. FK a `Envio`.
- Modelo `Envio` (schema linea 397): para cruzar con `tipoOrigen` (e-commerce vs. plataforma) y `estadoActual`.
- Helper `lib/geo/geocodificar-direccion.ts`: logica del auditor.
- Endpoint `lib/envios/crear.ts` linea 235: punto de entrada de la validacion.

### Formula de calculo
Embudo de tres niveles:
nivel_1_ok_directo = COUNT(AuditoriaCheckout WHERE score >= umbral
AND problemas = vacio)
nivel_2_corregido_silencio = COUNT(AuditoriaCheckout WHERE correccion_aplicada = true
AND comprador_no_contactado = true)
nivel_3_enviado_a_comprador = COUNT(AuditoriaCheckout WHERE resuelto IS NOT NULL)
nivel_3_resueltos = COUNT(AuditoriaCheckout WHERE resuelto = true)
nivel_3_pendientes = nivel_3_enviado_a_comprador - nivel_3_resueltos

Tasa de calidad de input del cliente:
calidad_input = (nivel_1_ok_directo / total_etiquetas_creadas) × 100

Tasa de friccion al comprador:
friccion = (nivel_3_enviado_a_comprador / total_etiquetas_creadas) × 100

Tiempo medio de resolucion del nivel 3:
tiempo_resolucion = AVG(AuditoriaCheckout.fechaResuelto - fechaCreacion)
WHERE resuelto = true

### Cortes de analisis disponibles
- **Por origen de la etiqueta:** e-commerce vs. plataforma manual. Permite identificar que canal genera mas errores.
- **Por tipo de problema detectado:** CP invalido, calle inexistente, localidad-provincia incoherente, numero de calle improbable, otros. Requiere catalogar los `problemas` que Google Maps devuelve.
- **Por nivel del embudo:** distribucion entre nivel 1 (ok directo), nivel 2 (corregido silencio), nivel 3 (enviado a comprador).
- **Por usuario que creo la etiqueta:** si fue carga manual, que operador genera mas errores.
- **Por e-commerce/canal externo:** si el cliente tiene varios canales (Tiendanube, ML, etc.), cual genera mejor calidad de input.
- **Por momento del dia / dia de la semana:** revela si hay picos de errores correlacionados con turnos o volumenes.
- **Por provincia o region de destino:** algunas zonas tienen mas ambiguedad postal historica.
- **Tendencia temporal:** ¿estamos mejorando la calidad de input mes a mes?

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: porcentaje de etiquetas OK directo (nivel 1) en ultima ventana (ej: `87,4%`).
- Subtitulo: desglose del embudo (ej: `1.247 directo · 184 corregidas silencio · 23 enviadas a comprador · 5 pendientes`).
- Mini-grafico de embudo horizontal mostrando proporcion entre los 3 niveles.
- CTA: "Ver detalle de auditoria" y "Configurar sensibilidad".

**Vista expandida:**

Pestana 1 — **Embudo de tres niveles:** visualizacion completa del flujo. Permite ver donde se concentra el filtrado. Si nivel 2 es muy alto, significa que Google Maps esta corrigiendo mucho silenciosamente; si nivel 3 es alto, hay friccion al comprador.

Pestana 2 — **Pendientes de resolver:** lista de etiquetas detenidas en nivel 3 con tiempo desde deteccion, motivo, link al circuito de correccion, opcion de reenvio del mail al comprador.

Pestana 3 — **Analisis de errores:** distribucion de tipos de problemas detectados con grafico de barras horizontal. Permite click para profundizar en cada tipo.

Pestana 4 — **Tendencia y comparacion:** evolucion temporal del porcentaje de calidad de input. Si el cliente tiene multiples depositos o canales, comparativa entre ellos.

Pestana 5 — **Configuracion de sensibilidad:** selector entre los tres perfiles (laxo / estandar / estricto) con explicacion del trade-off. Simulador "Si cambiaras a estandar, tendrias X% menos friccion pero Y% mas etiquetas con errores".

Pestana 6 — **Educacion / Recomendaciones:** seccion donde Shipro le sugiere al cliente acciones concretas segun los patrones detectados. "El 45% de tus errores son CP invalido. Recomendamos: validar CP en el checkout de tu e-commerce con la API gratuita de Correo Argentino, o usar el widget de Shipro."

**Interacciones disponibles:**
- Filtros: por canal, por usuario, por tipo de error, por rango temporal, por nivel del embudo.
- Cambiar sensibilidad de la auditoria entre los tres perfiles.
- Exportar listado de pendientes.
- Reenviar mail de correccion con un click.
- Marcar manualmente como resuelto (con auditoria de quien y cuando).

**Estado vacio:**
"Aun no se procesaron suficientes etiquetas en esta ventana. Minimo recomendado: 50 etiquetas."

**Estados de alerta:**
- Si la tasa de OK directo cae bajo umbral configurado (default 75%), badge rojo y mail al cliente.
- Si hay mas de N etiquetas detenidas hace mas de 48h sin resolver, alerta de "envios varados".
- Si aparece un nuevo tipo de problema con alta frecuencia que antes no se veia, alerta a operaciones de Shipro.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿El modelo `AuditoriaCheckout` se esta poblando correctamente hoy en cada creacion de etiqueta? ¿Hay envios que esquivan el auditor?
- ¿Que estructura tiene exactamente el campo `problemas`? ¿Es JSON, string, array? ¿Como se catalogan los tipos de error?
- ¿La logica de tres niveles (validacion dura / correccion silenciosa / solicitud a comprador) esta implementada hoy o requiere desarrollo? Si solo existe nivel 1 y nivel 3, hay que disenar el nivel 2.
- ¿La sensibilidad configurable por cliente esta implementada o es nueva feature?
- ¿Existe el campo `fechaResuelto` o se infiere del momento del UPDATE? Para medir tiempo de resolucion necesitamos timestamp del cierre.
- ¿La pagina de correccion `/app/corregir/[tracking]/page.tsx` registra que cambio el comprador (delta entre direccionCruda original y corregida)?
- ¿El mail desde `operaciones@shipro.pro` se loguea? ¿Hay record de cuantos se enviaron y cuantos se abrieron?
- ¿Hay rate-limit o circuit-breaker en las llamadas a Google Maps? ¿Cuanto cuesta operacionalmente esa integracion?

---

## 1.3 Eficiencia del Auditor de Checkout

### Categoria
Calidad operativa de la creacion de etiquetas · Calibracion del detective

### Definicion operativa
Mide la efectividad del peaje de auditoria desde el angulo opuesto a la metrica anterior. Mientras "Auditar Checkouts" mira que pasa con las etiquetas del cliente, esta metrica mira que tan bien esta trabajando el auditor en si mismo. ¿Esta detectando los errores reales? ¿Esta deteniendo etiquetas validas por exceso de celo? ¿Esta dejando pasar basura?

Es una metrica de calibracion del detective. Permite responder: ¿el umbral de `score` de Google Maps esta bien fijado? ¿Hay tipos de errores que el detective no detecta y deberia?

### Por que importa para el cliente
El auditor es el principal mecanismo de calidad de Shipro. Si esta mal calibrado, todo el resto falla en cascada. Esta metrica le da al cliente confianza en que el peaje que paga (en latencia, en mails de correccion, en friccion) esta justificado por valor real.

Para el equipo de Shipro, es la metrica que permite ajustar el motor sin operar a ciegas. Si descubris que envios detenidos por "CP invalido" terminan entregandose perfectamente cuando se mandan igual, sabes que tu umbral esta demasiado estricto. Si descubris que envios que pasaron OK no se entregan por direccion erronea, sabes que tu umbral esta demasiado laxo.

Decisiones que habilita:
- ¿Estoy deteniendo etiquetas que en realidad eran validas? (falsos positivos)
- ¿Estoy dejando pasar etiquetas que despues no se entregan por direccion? (falsos negativos)
- ¿El score de Google Maps que estoy usando como umbral es el correcto, o hay que recalibrarlo?
- ¿Hay regiones o tipos de direccion donde el auditor falla sistematicamente?

### Diferencial competitivo
Ninguna plataforma estandar expone la calibracion de su propio sistema de validacion como metrica observable. Shipro la hace explicita y la audita continuamente con los outcomes reales de los envios. Eso es disciplina de producto al nivel de un sistema bancario, no de una plataforma logistica estandar.

### Fuente de datos
- Modelo `AuditoriaCheckout` (schema linea 536): score y problemas detectados.
- Modelo `Envio` (schema linea 397): outcome real del envio (`estadoActual`, `fechaEntrega`).
- Cruce: `AuditoriaCheckout` JOIN `Envio` para correlacionar score del auditor con resultado real de la entrega.

### Formula de calculo
Falsos positivos (auditor detuvo etiquetas que eran validas):
fp = COUNT(AuditoriaCheckout WHERE score < umbral
AND resuelto = true
AND envio_asociado.estadoActual = "ENTREGADO"
AND tiempo_entrega <= SLA_esperado)
Esto identifica casos donde el comprador corrigio la direccion pero la correccion fue minima (mismo CP, misma calle), sugiriendo que el original era valido.

Falsos negativos (auditor dejo pasar etiquetas con problemas):
fn = COUNT(AuditoriaCheckout WHERE score >= umbral
AND problemas = vacio
AND envio_asociado.estadoActual EN ("DEVUELTO_DIRECCION_ERRONEA",
"NO_ENTREGADO_DIRECCION"))

Tasa de precision del auditor:
verdaderos_positivos = detenidas que efectivamente tenian error grave
total_detenidas = COUNT(AuditoriaCheckout WHERE score < umbral)
precision = (verdaderos_positivos / total_detenidas) × 100

Tasa de recall del auditor:
problemas_reales_capturados = detenidas que efectivamente tenian problema
problemas_reales_totales = problemas_capturados + falsos_negativos_detectados
recall = (problemas_reales_capturados / problemas_reales_totales) × 100

### Cortes de analisis disponibles
- **Por tipo de problema:** que tipos de errores el auditor detecta bien y cuales no.
- **Por region:** zonas geograficas donde Google Maps tiene peor cobertura o mas ambiguedad.
- **Por umbral aplicado:** si se prueba bajar o subir el umbral, como cambia precision vs. recall.
- **Por courier final:** algunos couriers son mas tolerantes a direcciones ambiguas (encuentran al comprador igual), otros menos.
- **Tendencia temporal:** ¿la calidad del detective mejora con mas data?

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador dual: precision y recall del auditor en ultimas 4 semanas (ej: `92% precision · 87% recall`).
- Pequeno grafico de matriz de confusion 2x2 simplificada.
- CTA: "Ver analisis de calibracion".

**Vista expandida:**

Pestana 1 — **Falsos positivos sospechosos:** lista de etiquetas detenidas que despues se entregaron OK con correccion minima. Permite al equipo de Shipro revisar caso por caso.

Pestana 2 — **Falsos negativos confirmados:** lista de etiquetas que pasaron OK pero terminaron en problema. Cada una con analisis del por que el auditor no la detecto.

Pestana 3 — **Simulador de umbrales:** slider interactivo que muestra como cambiarian precision y recall si se ajustara el umbral. Permite tomar decisiones de calibracion con data, no a ciegas.

Pestana 4 — **Distribucion de scores:** histograma de todos los scores devueltos por Google Maps. Util para identificar si el umbral actual esta en el quiebre correcto de la distribucion.

**Interacciones disponibles:**
- Marcar manualmente un caso como "auditor acerto" o "auditor fallo". Eso entrena la calibracion futura.
- Exportar analisis para revision externa.
- Configurar umbrales por region si la data sugiere que conviene diferenciar.

**Estado vacio:**
"Necesitamos al menos 500 envios con outcome conocido para calcular esta metrica con confianza."

**Estados de alerta:**
- Si recall cae bajo 80%, alerta critica: el detective esta dejando pasar muchos problemas reales.
- Si precision cae bajo 85%, alerta de friccion innecesaria: estamos molestando compradores con correcciones que no eran necesarias.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿El score que devuelve Google Maps esta siendo guardado tal cual en `AuditoriaCheckout.score`? ¿Es numerico, categorico?
- ¿Como esta implementado hoy el umbral de aceptacion? ¿Hardcodeado, configurable, por cliente?
- ¿Existe relacion clara entre `AuditoriaCheckout` y `Envio` para hacer el cruce de outcome? ¿FK directa?
- ¿La pagina de correccion guarda diff entre direccion original y corregida? Esto es clave para detectar "correccion minima".
- ¿Tenemos historico de estados finales de envio que permita clasificar entrega exitosa vs. fallida por direccion? ¿O hay que construir esa categorizacion?

---

## 1.4 Carga de Soporte

### Categoria
Carga operativa interna del cliente · Eficiencia de la operacion logistica

### Definicion operativa
Mide cuantas intervenciones tuvo que hacer el equipo del cliente, expresadas como tickets de soporte generados, por cada 100 etiquetas creadas. La normalizacion por volumen permite comparar clientes de distinto tamano con la misma vara. Esta metrica responde la pregunta: "¿Que tan exigente es esta operacion logistica en terminos de atencion humana?"

Los tickets se generan por dos vias:
- **Automatica:** el cron de rastreo crea un `TicketSoporte` cuando un envio lleva mas de 36 horas sin cambio de estado y entra en zona de alerta. Esto esta implementado hoy en `/api/cron/rastreo`.
- **Manual (a desarrollar):** el cliente deberia poder crear tickets desde la Plataforma Multicourier cuando detecta un problema por iniciativa propia. Esta capacidad es parte del producto futuro.

Adicionalmente, la metrica desglosa motivos: por que se abrieron los tickets, cuantos por causa logistica, cuantos por error de informacion, cuantos por consulta del comprador.

### Por que importa para el cliente
Es la metrica que responde "¿cuanto me cuesta operativamente esta cadena logistica?" en terminos de tiempo humano, no solo de dinero. Un cliente puede tener tarifas baratas pero requerir 30 intervenciones por cada 100 envios. Otro puede tener tarifas mas caras pero generar solo 3 intervenciones. La eleccion entre uno y otro depende del costo del tiempo del equipo del cliente.

Tambien es una herramienta de negociacion con el courier: si un courier tiene mucho mayor carga de soporte que otros, eso es data para presentar y exigir mejoras.

Decisiones que habilita:
- ¿Cual de mis couriers genera mas carga operativa?
- ¿Hay clientes (si soy Shipro mirando todo el universo) que generan desproporcionadamente mas tickets?
- ¿Mi tasa de tickets esta mejorando o empeorando?
- ¿Tengo que aumentar mi equipo de soporte o el problema es del courier?
- ¿Que tipo de problemas son los mas frecuentes y donde concentrar entrenamiento?

### Diferencial competitivo
Las plataformas miden tickets cuando los hay, pero rara vez los normalizan por volumen y los exponen como metrica de salud operativa al cliente. Shipro convierte un dato interno de su propio sistema en un instrumento de gestion para el cliente. El cliente ve no solo "tuve 47 tickets este mes" sino "tuve 3,2 tickets cada 100 envios, comparado con 1,8 el mes pasado".

### Fuente de datos
- Modelo `TicketSoporte` (schema linea 503): `motivo`, `estado`, `fechaCreacion`, `fechaCierre`. FK a `Envio` y `Empresa`.
- Modelo `AuditoriaSoporte` (schema linea 521): `accion`, `usuarioEmail`, `fecha` por ticket. Permite ver que acciones humanas se hicieron.
- Modelo `Envio` (schema linea 397): para el denominador (total de envios en ventana).
- Cron `/api/cron/rastreo`: genera tickets automaticamente cuando detecta envios quietos.

### Formula de calculo
Tasa principal:
tickets_periodo = COUNT(TicketSoporte WHERE fechaCreacion EN ventana)
envios_periodo = COUNT(Envio WHERE fechaImpresion EN ventana)
carga_por_100 = (tickets_periodo / envios_periodo) × 100

Desglose por motivo:
GROUP BY TicketSoporte.motivo

Tickets activos hoy:
tickets_abiertos = COUNT(TicketSoporte WHERE estado = "ABIERTO"
AND fechaCierre IS NULL)

Edad promedio de tickets abiertos:
edad_promedio = AVG(ahora - fechaCreacion) WHERE estado = "ABIERTO"

### Cortes de analisis disponibles
- **Por courier:** cual genera mas tickets normalizados por sus propios envios.
- **Por motivo:** retraso, direccion erronea, paquete danado, consulta de comprador, otros.
- **Por origen del ticket:** automatico (cron detecto quietud) vs. manual (cliente o operador abrio).
- **Por usuario que abrio el ticket:** si fue manual, que operador del cliente.
- **Por tiempo de resolucion:** tickets que se cierran en menos de 24h vs. mas de 72h.
- **Por estado actual del envio asociado:** tickets sobre envios en transito, en problema, devueltos.
- **Tendencia temporal:** evolucion mes a mes de la carga.
- **Por region o destino:** si hay zonas donde la operacion genera mas soporte sistematicamente.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: tickets por cada 100 envios en ultima ventana (ej: `2,4 cada 100`).
- Comparacion con periodo anterior (ej: `↓ 0,7 vs mes anterior`).
- Mini-distribucion por motivo en forma de barras horizontales pequenas.
- CTA: "Ver tickets activos" y "Ver analisis de carga".

**Vista expandida:**

Pestana 1 — **Tickets activos:** lista ordenada por antiguedad, con acciones rapidas: ver detalle, asignar, escalar, cerrar.

Pestana 2 — **Analisis por motivo:** distribucion de causas, con tendencia. Permite click en cada motivo para ver detalle de tickets de ese tipo.

Pestana 3 — **Analisis por courier:** comparativa entre couriers normalizada por volumen. Util para argumentar mejoras o cambios de mix.

Pestana 4 — **Crear ticket manual:** formulario para que el cliente abra un ticket por iniciativa propia cuando detecta un problema que el sistema automatico no capto (requiere desarrollo de funcionalidad nueva).

**Interacciones disponibles:**
- Crear ticket manual desde cualquier envio en la Plataforma (es funcionalidad nueva que esta metrica implica).
- Asignar tickets a responsables especificos.
- Adjuntar notas y comunicaciones al ticket.
- Cerrar tickets con motivo de cierre estandarizado.
- Exportar carga de tickets para analisis externo.

**Estado vacio:**
"Aun no se procesaron suficientes envios en esta ventana para calcular carga normalizada. Minimo recomendado: 100 envios."

**Estados de alerta:**
- Si la tasa sube mas de 50% respecto al mes anterior, alerta critica con analisis automatico del posible motivo.
- Si hay tickets abiertos hace mas de 5 dias, alerta de "tickets estancados".
- Si un motivo especifico se dispara (ej: 30% de tickets son por la misma causa de golpe), alerta de patron emergente.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿El cron de rastreo esta creando tickets hoy con `motivo` informativo, o el campo esta vacio/generico?
- ¿Existe taxonomia definida de `motivo`? ¿O hay que crearla?
- ¿La capacidad de "crear ticket manual desde la Plataforma" existe ya en algun form? ¿O hay que disenarla?
- ¿Hay endpoint que devuelva conteos agregados por motivo, o hay que crearlo?
- ¿`AuditoriaSoporte` se esta usando para registrar acciones humanas sobre tickets? ¿Quien y cuando cierra?
- ¿La relacion `TicketSoporte` → `Envio` permite reconstruir contexto del envio cuando se abrio el ticket?

---

## 1.5 Velocidad de Resolucion de Tickets

### Categoria
Eficiencia del equipo de soporte · Tiempo de respuesta

### Definicion operativa
Mide cuanto tiempo tarda la operacion en resolver tickets de soporte una vez abiertos. Es la contraparte de la metrica anterior: "Carga de Soporte" mide cuantos tickets hay, "Velocidad de Resolucion" mide que tan rapido se atienden.

Se calcula como diferencia entre `TicketSoporte.fechaCreacion` y `TicketSoporte.fechaCierre`, expresada en horas. Se reportan tres estadisticos: mediana (caso tipico), promedio (incluye outliers que arrastran arriba), percentil 95 (peor caso razonable).

Adicionalmente, se desglosa por tipo de accion realizada (campo `AuditoriaSoporte.accion`) para ver que acciones son las que mas demoran.

### Por que importa para el cliente
La velocidad de resolucion es atencion al comprador en ultima instancia. Un ticket sobre un envio atrasado que tarda 5 dias en resolverse significa 5 dias de un comprador en silencio o, peor, escribiendo en redes sociales. La metrica permite al cliente entender la calidad real de su operacion de post-venta logistica.

Para Shipro internamente, tambien es indicador de carga de su propio equipo: si todos los tickets de un cliente tardan mucho, puede ser que el equipo del cliente este desbordado y eso es informacion comercial relevante.

Decisiones que habilita:
- ¿Mi equipo de soporte esta dimensionado correctamente?
- ¿Que tipo de tickets son los que mas se demoran y por que?
- ¿Hay ciertos couriers cuyos tickets demoran sistematicamente mas en cerrarse porque dependo de su respuesta?
- ¿Mi tiempo medio mejora o empeora?

### Diferencial competitivo
Convierte el dato interno de tickets en metrica de servicio observable. El cliente puede mostrar a sus propios stakeholders (jefes, duenos, inversores) que su operacion post-venta tiene SLA medible y mejorable. Pocas plataformas exponen esto con esta granularidad.

### Fuente de datos
- Modelo `TicketSoporte` (schema linea 503): `fechaCreacion`, `fechaCierre`, `estado`.
- Modelo `AuditoriaSoporte` (schema linea 521): `accion`, `usuarioEmail`, `fecha`. Permite reconstruir las acciones intermedias entre apertura y cierre.

### Formula de calculo
duracion_ticket = TicketSoporte.fechaCierre - TicketSoporte.fechaCreacion
(en horas, solo para tickets con estado = "CERRADO")
mediana = PERCENTILE(duracion_ticket, 50)
promedio = AVG(duracion_ticket)
peor_caso = PERCENTILE(duracion_ticket, 95)

Tasa de tickets cerrados en SLA configurado (ej: 24h):
en_sla = COUNT(tickets WHERE duracion <= 24h)
total = COUNT(tickets cerrados en ventana)
porcentaje_sla = (en_sla / total) × 100

### Cortes de analisis disponibles
- **Por motivo del ticket:** algunos motivos son intrinsecamente mas lentos (depende del courier) que otros (depende del cliente).
- **Por courier asociado al envio del ticket:** revela dependencias externas que afectan tiempo de resolucion.
- **Por usuario que cerro:** quien resuelve mas rapido en el equipo.
- **Por tipo de accion (de AuditoriaSoporte):** que acciones consumen mas tiempo en promedio.
- **Por horario y dia de la semana de apertura:** tickets abiertos un viernes tarde tienden a demorarse.
- **Tendencia temporal:** evolucion de la eficiencia del equipo mes a mes.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: mediana de tiempo de resolucion (ej: `8h 30min`).
- Indicador secundario: porcentaje en SLA configurado (ej: `78% resueltos en menos de 24h`).
- Mini-distribucion: histograma simplificado mostrando donde se concentran las resoluciones.
- CTA: "Ver analisis detallado".

**Vista expandida:**

Pestana 1 — **Distribucion de tiempos:** histograma completo con marcadores de mediana, promedio, P95.

Pestana 2 — **Analisis por motivo y courier:** matriz que muestra que combinacion de motivo + courier tiene mayor tiempo de resolucion. Util para identificar cuellos de botella estructurales.

Pestana 3 — **Performance del equipo:** desglose por usuario que cerro, ordenado por velocidad. Sin nombre real si el cliente lo prefiere, solo identificadores.

Pestana 4 — **Tickets que excedieron SLA:** lista de outliers para revision, con analisis del por que se demoraron.

**Interacciones disponibles:**
- Filtros por motivo, courier, usuario, rango temporal.
- Configurar SLA objetivo por motivo (no todos los motivos requieren la misma velocidad).
- Exportar reporte de performance.

**Estado vacio:**
"Necesitamos al menos 30 tickets cerrados en la ventana para calcular tiempos representativos."

**Estados de alerta:**
- Si la mediana sube mas de 30% respecto al mes anterior, alerta de degradacion.
- Si el percentil 95 supera N horas configuradas (default 72h), alerta critica.
- Si hay tickets abiertos hace mas de el doble del P95 actual, alerta de "ticket estancado".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿Todos los tickets cerrados tienen `fechaCierre` poblado correctamente?
- ¿Existe el estado `CERRADO` o se infiere de `fechaCierre IS NOT NULL`?
- ¿`AuditoriaSoporte` registra todas las acciones humanas o solo algunas?
- ¿Hay forma de capturar tiempo de primera respuesta (no solo tiempo de cierre)? Esto seria una metrica adicional util pero requiere instrumentacion especifica.
- ¿La query agregada de mediana/promedio/P95 es eficiente en el motor de BD actual (SQLite)? Postgres lo resuelve nativo, SQLite puede requerir calculo en aplicacion.

---

<a id="bloque-2"></a>
# Bloque 2 — Performance logistica

Este bloque reune las metricas que reflejan como se esta comportando la cadena logistica real. Mientras el Bloque 1 mide la calidad de Shipro hacia el cliente, este mide la calidad del courier y de la cadena completa hacia el comprador final. Son metricas de salud de la red, no de la plataforma.

---

## 2.1 Tiempos Colecta (Tiempo de Despacho)

### Categoria
Performance del deposito del cliente · Tiempo desde la creacion de la etiqueta hasta la posesion del courier

### Definicion operativa
Mide cuanto tiempo transcurre entre el momento en que se crea la etiqueta (`fechaImpresion`) y el momento en que el courier toma posesion efectiva del paquete (`fechaColecta`). Este intervalo es responsabilidad exclusiva del cliente y su operacion interna. Es el tiempo que el paquete pasa esperando en el deposito antes de salir.

No incluye correccion de datos postales: si la etiqueta tuvo que pasar por circuito de auditoria (Bloque 1.2), el reloj empieza una vez emitida la etiqueta corregida. La metrica aisla la operacion logistica del cliente, no su proceso de informacion.

### Por que importa para el cliente
Es la unica parte de la cadena logistica que el cliente controla directamente. Si su tiempo de despacho es 6 horas, la promesa al comprador puede ser agresiva. Si es 3 dias, esa promesa tiene que ser conservadora. Lo importante: este numero alimenta directamente el motor de "Promesa de Entrega Calibrada" (metrica 2.3), por lo tanto, mejorarlo permite prometer plazos mas cortos en el checkout, que se traduce en mayor conversion.

Decisiones que habilita:
- ¿Mi operacion de despacho esta dentro de estandares razonables o estoy regalando dias?
- ¿Hay dias de la semana donde el despacho se demora sistematicamente (lunes con backlog del fin de semana, viernes con anticipacion)?
- ¿Mi tiempo mejora cuando contrato mas personal en el deposito o no se mueve?
- ¿Cual es la diferencia entre mi mejor deposito y el peor si tengo varios?

### Diferencial competitivo
Las plataformas miden tiempo total de entrega, pero raramente aislan el componente que el cliente controla. Shipro hace la separacion explicita: "estos 1,8 dias son tuyos, estos 3,4 son del courier". Esto convierte la conversacion con el cliente en algo accionable. No le decis "tu envio tardo 5,2 dias" sino "tu paquete paso 1,8 dias en tu deposito antes de salir, el courier tardo 3,4 dias desde que lo recibio". El cliente ve donde puede mejorar.

### Fuente de datos
- Modelo `Envio` (schema linea 397): campos `fechaImpresion` y `fechaColecta`. Diferencia directa.

**Nota de naming aclarada durante implementacion (2026-06-04):** el campo `fechaImpresion` se llena automaticamente cuando se crea el `Envio` en BD (via Prisma `@default(now())`), NO cuando se imprime fisicamente el PDF. Es decir, mide desde "etiqueta creada en Shipro" hasta "paquete recolectado por el courier". El nombre es engañoso pero el comportamiento es el correcto para la metrica. Renombrar el campo se evita por costo de regresion en otros 3 endpoints que ya lo consumen; registrado como deuda menor de naming.
- Modelo `EventoTracking` (schema linea 475): puede dar granularidad sobre estados intermedios si el cliente loguea (por ej, "preparado", "en muelle", etc.) pero no es requisito.
- Modelo `Deposito` (schema linea 56): para cortes por deposito de origen.
- Modelo `Empresa` (schema linea 13): para cortes por cliente cuando se mira desde Shipro global.

### Formula de calculo
Tiempo individual por envio:
tiempo_despacho_horas = fechaColecta - fechaImpresion
(solo envios con ambas fechas pobladas)

Estadisticos relevantes (por ventana y por corte):
mediana_horas = PERCENTILE(tiempo_despacho_horas, 50)
promedio_horas = AVG(tiempo_despacho_horas)
p95_horas = PERCENTILE(tiempo_despacho_horas, 95)

La mediana es mas representativa que el promedio porque la distribucion suele tener cola larga (algunos envios quedan dias olvidados). El P95 sirve para entender el peor caso razonable.

### Cortes de analisis disponibles
- **Por deposito de origen:** comparativa entre depositos del mismo cliente.
- **Por dia de la semana de creacion de etiqueta:** revela patrones operativos (lunes lento por backlog, viernes anticipado). Implementacion actual usa `getDay()` con timezone del runtime del servidor; si el server corre UTC y la operacion es Argentina (UTC-3), envios creados muy temprano o muy tarde pueden quedar asignados al dia anterior/siguiente. Es imprecision aceptable para 1ra version; correccion via `Intl.DateTimeFormat` con `timeZone: 'America/Argentina/Buenos_Aires'` queda como deuda menor.
- **Por hora del dia de creacion:** etiquetas creadas tarde en el dia se despachan al dia siguiente, no en el mismo dia.
- **Por courier que recolecta:** algunos couriers son mas previsibles en sus visitas (siempre 10am martes y jueves), otros mas erraticos.
- **Por modalidad de entrega:** envios same-day vs. estandar deben tener tiempos de despacho radicalmente distintos.
- **Por volumen del dia:** correlacion entre cantidad de etiquetas creadas en un dia y tiempo de despacho. Si despachas 50 paquetes por dia, los dias con 200 tendran tiempos peores.
- **Tendencia temporal:** evolucion mes a mes. ¿Mejoramos o nos estancamos?

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: mediana en horas o dias (ej: `1,4 dias` o `34 horas`).
- Indicador secundario: comparacion con mes anterior (ej: `↓ 0,3 dias vs mes anterior`).
- Mini-distribucion mostrando donde se concentran los tiempos.
- CTA: "Ver analisis de despacho".

**Vista expandida:**

Pestana 1 — **Distribucion de tiempos:** histograma de horas de despacho con marcadores de mediana, promedio, P95. Permite ver si hay bimodalidad (dos grupos claramente separados, lo que indicaria procesos distintos).

Pestana 2 — **Analisis por deposito y dia:** matriz que cruza deposito vs. dia de la semana, con color de calor segun tiempo de despacho. Identifica rapido donde estan los cuellos de botella.

Pestana 3 — **Comparativa por courier:** algunos couriers visitan mas seguido que otros, lo que afecta indirectamente el tiempo de despacho. Util para decidir mix de couriers.

Pestana 4 — **Outliers identificados:** envios con tiempos de despacho anormalmente largos, con detalle para investigar.

**Interacciones disponibles:**
- Filtros por deposito, courier, rango temporal, modalidad.
- Configurar SLA interno objetivo (ej: "quiero despachar el 90% en menos de 24h").
- Exportar reporte para revision interna del equipo de operaciones del cliente.

**Estado vacio:**
"Necesitamos al menos 50 envios con fechas completas en la ventana."

**Estados de alerta:**
- Si la mediana sube mas de 25% respecto al mes anterior, alerta de degradacion operativa.
- Si el P95 supera N horas configurado, alerta de "paquetes olvidados en deposito".
- Si un deposito especifico se desvia mas de 50% del promedio del cliente, alerta de problema localizado.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`fechaColecta` se esta poblando consistentemente cuando el courier toma posesion? ¿De que evento del courier se infiere?
- ¿Hay envios donde `fechaColecta` queda null aunque el envio este en transito? ¿Como manejamos esos casos?
- ¿La relacion entre `Envio` y el deposito de origen es directa o se infiere de `OrdenExterna` o de `Empresa`?
- Para cortes por hora del dia, ¿`fechaImpresion` guarda timezone correctamente?
- ¿El calculo de percentiles es factible en SQLite, o requerira calculo en aplicacion?

---

## 2.2 Efectividad en Primera Visita

### Categoria
Performance del courier · Calidad de la entrega final

### Definicion operativa
Mide que porcentaje de envios entregados lo fueron en la primera visita del courier, sin necesidad de recoordinar, reagendar o reintentar. Para envios a sucursal o punto de pickup, mide el equivalente: primer intento de entrega exitoso al destinatario final.

Se reconstruye desde el historial de eventos de tracking. Un envio tiene "primera visita exitosa" si la cadena de estados Shipro es:
- Para entrega a domicilio: `EN_DISTRIBUCION → ENTREGADO`
- Para entrega a sucursal: `EN_SUCURSAL → RETIRADO`

Un envio tiene "visita fallida" si en algun momento aparece:
- `EN_DISTRIBUCION → AUSENTE` (o similar) → `EN_DISTRIBUCION → ENTREGADO`
- Cualquier ciclo de reagendar o reintentar antes de la entrega final.

### Por que importa para el cliente
Cada visita fallida es costo real: el courier vuelve a intentar (lo factura), el comprador se frustra, hay riesgo de devolucion completa. Tasas bajas de primera visita correlacionan directamente con: NPS bajo, costo logistico real mas alto que el contratado, mayor carga de soporte.

Tambien es metrica de calidad del courier que el cliente puede usar en negociaciones de tarifa o decisiones de mix.

Decisiones que habilita:
- ¿Que courier me da mejor efectividad en primera visita?
- ¿Hay zonas geograficas donde la efectividad cae sistematicamente?
- ¿La efectividad varia por modalidad (domicilio vs. sucursal vs. lockers)?
- ¿La efectividad se correlaciona con el horario de visita declarado por el courier?

### Diferencial competitivo
Pocas plataformas reconstruyen esto desde el tracking. La mayoria solo reporta "entregado" o "no entregado" sin medir el costo del proceso intermedio. Shipro convierte el historial de estados en una metrica de calidad operativa real. Esto es producto, no reporting.

### Fuente de datos
- Modelo `EventoTracking` (schema linea 475): la fuente principal. Secuencia completa de estados por envio con fechas.
- Modelo `Envio` (schema linea 397): para filtrar solo envios con `estadoActual = ENTREGADO`.
- Modelo `Nomenclador` (schema linea 488): para identificar que estados crudos corresponden a "intento fallido" en cada courier.
- Modelo `TramoEnvio` (schema linea 845): si hay multiples tramos, la primera visita se mide en el tramo final.

### Formula de calculo
Por cada envio entregado, se evalua la cadena de eventos:
PARA cada Envio donde estadoActual = "ENTREGADO":
eventos = EventoTracking ORDER BY fecha ASC
intentos_distribucion = COUNT(eventos donde estado = "EN_DISTRIBUCION")
SI intentos_distribucion = 1 Y siguiente_estado = "ENTREGADO":
clasificacion = "PRIMERA_VISITA_EXITOSA"
SI intentos_distribucion > 1:
clasificacion = "REQUIRIO_REINTENTO"
SI hay estado intermedio "AUSENTE", "VISITA_FALLIDA", etc:
clasificacion = "VISITA_FALLIDA_PREVIA"

Tasa principal:
exitosos_primera_visita = COUNT(envios donde clasificacion = "PRIMERA_VISITA_EXITOSA")
total_entregados = COUNT(envios donde estadoActual = "ENTREGADO")
porcentaje_primera_visita = (exitosos / total_entregados) × 100

### Cortes de analisis disponibles
- **Por courier:** la comparativa fundamental. Andreani vs. Mocis vs. cada nuevo.
- **Por modalidad de entrega:** domicilio vs. sucursal vs. punto de pickup vs. locker.
- **Por provincia o region:** algunas zonas tienen mas desafios (rural, edificios grandes, barrios cerrados).
- **Por dia de la semana de la visita:** sabados pueden tener mejor efectividad por compradores en casa.
- **Por horario declarado de visita del courier:** si el courier visita 9am-12pm, ¿cual es la efectividad?
- **Por monto del envio:** envios altos pueden tener mayor cuidado del comprador (estar en casa).
- **Tendencia temporal:** evolucion por courier mes a mes.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: porcentaje de primera visita (ej: `82,7%`).
- Distribucion apilada: primera visita / reintento / fallido pero entregado / nunca entregado.
- Mini-comparativa entre couriers en formato barra horizontal corta.
- CTA: "Ver analisis por courier" y "Ver patrones de fallo".

**Vista expandida:**

Pestana 1 — **Comparativa por courier:** ranking de couriers ordenado por efectividad. Con volumen de envios para que cada porcentaje tenga peso estadistico.

Pestana 2 — **Analisis geografico:** mapa de Argentina con calor segun efectividad por provincia. Permite identificar zonas problematicas.

Pestana 3 — **Cadenas de eventos:** muestra cuales son las secuencias mas frecuentes de estados antes de entrega. Permite identificar patrones de fallo especificos por courier.

Pestana 4 — **Recomendaciones automaticas:** "Tu efectividad cae 15 puntos en Misiones. Considera ofrecer entrega en sucursal como opcion primaria en esa provincia."

**Interacciones disponibles:**
- Filtros por courier, modalidad, provincia, rango temporal.
- Drill-down sobre envios especificos para ver cadena completa de eventos.
- Configurar umbral objetivo de efectividad y recibir alerta si se cae.
- Exportar analisis para mostrar al courier en reunion de gestion.

**Estado vacio:**
"Necesitamos al menos 100 envios entregados con tracking completo para esta metrica."

**Estados de alerta:**
- Si la efectividad cae mas de 10 puntos respecto al mes anterior, alerta de degradacion de servicio del courier.
- Si un courier especifico esta mas de 15 puntos por debajo del promedio del cliente, alerta de "courier subperformante".
- Si una zona geografica especifica muestra deterioro subito, alerta de "problema localizado" para investigar.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿El catalogo de Estados Shipro distingue claramente "EN_DISTRIBUCION", "AUSENTE", "REAGENDADO"? ¿O hay solo un generico?
- ¿Cuantos estados crudos por courier se mapean al generico de "intento fallido"? ¿Esta bien cubierto?
- ¿`EventoTracking` registra TODOS los eventos del courier o solo los relevantes? Si filtra, podemos estar perdiendo info de intentos.
- Para envios a sucursal, ¿como distinguimos "primera visita del destinatario" de "primera notificacion al destinatario de que el paquete esta disponible"?
- ¿La reconstruccion de cadenas se hace eficientemente o requiere indices nuevos en `EventoTracking`?

---

## 2.3 Promesa de Entrega Calibrada

### Categoria
Motor de promesa logistica · Calibracion continua de plazos al comprador

### Definicion operativa
Esta es la metrica mas ambiciosa del Bloque 2, porque no solo mide, tambien alimenta una capacidad del producto. Tiene tres dimensiones que se conectan en un circuito cerrado:

**Observacion (que tarda en realidad):**
Para cada combinacion de `(deposito de origen, courier, modalidad, provincia destino)`, se mide el tiempo real total de entrega desde `fechaImpresion` hasta `fechaEntrega`. Se calcula mediana movil de los ultimos 90 dias.

**Prediccion (que prometeriamos hoy):**
A partir de la observacion, se calcula la promesa que Shipro debe hacer al comprador en el checkout para tener alta confianza de cumplirla. No es el promedio (que cumple 50% del tiempo), sino el percentil 75 u 80 segun el nivel de seguridad configurado. Si el P75 es 5,2 dias, Shipro promete 6 dias con holgura de seguridad.

**Comparacion (que paso vs. que prometimos):**
Cada envio entregado se compara contra `Envio.diasPrometidosCheckout` (lo que el comprador vio al pagar). Se mide cumplimiento, sobre-cumplimiento (entregado antes de lo prometido) y sub-cumplimiento (entregado despues).

El circulo se cierra: la comparacion alimenta el ajuste de la prediccion futura.

### Por que importa para el cliente
Es la metrica que conecta logistica con conversion y experiencia del comprador. Una promesa creible en el checkout aumenta conversion. Una promesa incumplida deteriora confianza, NPS, recompra. Shipro no le promete al comprador lo que el courier dice en abstracto, le promete lo que la realidad de SU cadena especifica demuestra.

Y critico: cada cliente tiene su propia promesa calibrada. Un cliente cuyo deposito tarda 2 dias en despachar tiene una promesa diferente al de un cliente que despacha en 4 horas, aunque usen el mismo courier al mismo destino.

Decisiones que habilita:
- ¿Cual es la promesa correcta a poner en mi checkout para cada zona?
- ¿Estoy cumpliendo lo que prometo? ¿En que casos no?
- ¿Si mejoro mi tiempo de despacho (metrica 2.1) cuantos dias puedo descontar de la promesa?
- ¿Vale la pena agregar un courier mas rapido pero mas caro si me permite prometer plazos mas agresivos y aumentar conversion?
- ¿Por que un courier especifico me hace incumplir promesas mas que otros?

### Diferencial competitivo
Esto es el corazon de la propuesta de Shipro. Las plataformas estandar muestran al comprador la promesa nominal del courier ("Andreani: 3-5 dias habiles") sin observar si esa promesa se cumple en la cadena real del cliente. Shipro construye su propia promesa basada en evidencia y la mejora continuamente. Es ingenieria de confianza, no marketing.

Y va mas alla: si vos como cliente sabes que tu cadena con Andreani al sur tarda 6 dias pero el courier publica 4, Shipro te impide prometer 4 en tu checkout. Te obliga a la honestidad. Eso es un servicio que ninguna otra plataforma da.

### Fuente de datos
- Modelo `Envio` (schema linea 397): `fechaImpresion`, `fechaEntrega`, `diasPrometidosCheckout`, `estadoActual`.
- Modelo `MetricaSLA` (schema linea 677): ya pre-calculado por cron diario por `(courierId, provinciaDestino)`. Esta tabla es el motor base.
- Cron `/api/cron/metricas-sla` (mencionado en CRONS.md): el calculo nocturno que alimenta `MetricaSLA`.
- Modelo `SlaCourier` (schema linea 702): promesa nominal del courier por zona. Sirve para comparar realidad vs. promesa publicada por el courier.
- Modelo `Deposito` (schema linea 56): origen.
- Modelo `Feriado` (schema linea 695): para excluir dias no operativos del calculo.

### Formula de calculo
**Componente 1 — Observacion (tiempo real de cadena completa):**
tiempo_real_horas = Envio.fechaEntrega - Envio.fechaImpresion
(descontando feriados si se quiere "dias habiles")
PARA cada combinacion (deposito, courier, modalidad, provincia_destino):
mediana_90d = PERCENTILE(tiempo_real_horas, 50) en ultimos 90 dias
p75_90d = PERCENTILE(tiempo_real_horas, 75) en ultimos 90 dias
p90_90d = PERCENTILE(tiempo_real_horas, 90) en ultimos 90 dias

**Componente 2 — Prediccion (que prometeriamos hoy):**
SI cliente configurado en modo "agresivo" (50% cumplimiento):
promesa_dias = CEIL(mediana_90d / 24)
SI cliente configurado en modo "estandar" (75% cumplimiento):
promesa_dias = CEIL(p75_90d / 24)
SI cliente configurado en modo "conservador" (90% cumplimiento):
promesa_dias = CEIL(p90_90d / 24)

**Componente 3 — Cumplimiento historico:**
PARA cada envio entregado:
prometido = Envio.diasPrometidosCheckout
real = Envio.fechaEntrega - Envio.fechaImpresion (en dias)
SI real <= prometido: clasificacion = "CUMPLIDO"
SI real > prometido: clasificacion = "INCUMPLIDO" (con magnitud del incumplimiento)
tasa_cumplimiento = COUNT(cumplidos) / COUNT(total) × 100

### Cortes de analisis disponibles
- **Por combinacion (deposito, courier, provincia):** la unidad minima de analisis. Cada combinacion tiene su propia promesa calibrada.
- **Por modalidad:** domicilio vs. sucursal vs. same-day tienen modelos distintos.
- **Por provincia o region:** mapa de Argentina mostrando promesa vs. realidad por zona.
- **Por mes del ano:** estacionalidad (diciembre, fechas especiales tienen plazos peores).
- **Por nivel de cumplimiento historico:** combinaciones donde cumplimos 95% vs. donde cumplimos 60%.
- **Por componente del tiempo total:** cuanto del tiempo total es despacho del cliente, cuanto es transito del courier. Permite atribuir responsabilidad de incumplimientos.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: tasa de cumplimiento de promesa en ultima ventana (ej: `87,3% cumplidas`).
- Indicador secundario: cantidad de combinaciones (deposito × courier × destino) calibradas activamente (ej: `48 rutas activas, 12 calibradas en ultima semana`).
- Mini-mapa de Argentina con calor de cumplimiento por provincia.
- CTA: "Configurar promesas" y "Ver detalle de cadenas".

**Vista expandida:**

Pestana 1 — **Calibracion activa por ruta:** tabla que muestra cada combinacion (deposito × courier × provincia) con su promesa calibrada actual, mediana real, P75, P90, cantidad de envios en la ventana, tasa de cumplimiento historico. Cada fila clickeable para drill-down.

Pestana 2 — **Drill-down por ruta:** distribucion completa de tiempos para esa combinacion especifica, con marcadores de promesa actual y propuesta de mejora. Permite ajustar manualmente si el cliente quiere ser mas o menos conservador en esa ruta especifica.

Pestana 3 — **Comparacion promesa publicada por courier vs. realidad:** muestra donde la promesa nominal del courier (`SlaCourier`) esta alineada con la realidad y donde no. Es data para negociacion: "Andreani dice 4 dias al sur, en realidad tarda 6,2". Util para conversaciones con couriers.

Pestana 4 — **Analisis de incumplimientos:** envios que incumplieron promesa, con analisis automatico de causa (despacho lento del cliente, transito lento del courier, fallo de entrega y reintentos, etc.).

Pestana 5 — **Simulador what-if:** "Si mejoro mi tiempo de despacho a 12 horas, ¿que promesa puedo hacer en cada ruta?". El cliente ve el impacto comercial de mejoras operativas internas.

**Interacciones disponibles:**
- Configurar nivel de seguridad global (agresivo / estandar / conservador) o por ruta especifica.
- Ajustar promesa manualmente para rutas especificas si el cliente quiere ser mas conservador que la sugerencia del motor (ej: rutas nuevas con poca data).
- Recibir alertas cuando una ruta cambia de tendencia y la promesa debe recalibrarse.
- Exportar tabla de calibracion activa para integrar al checkout del e-commerce via API.
- Comparar performance entre rutas para tomar decisiones de mix.

**Estado vacio:**
"Necesitamos al menos 30 envios entregados por cada combinacion (deposito × courier × provincia) para calibrar con confianza. Las combinaciones con menos data usan promesa nominal del courier hasta tener historico propio."

**Estados de alerta:**
- Si una ruta cae bajo umbral de cumplimiento (default 80%), alerta de "promesa desalineada" con sugerencia de recalibracion.
- Si una ruta empeora mas de 30% respecto al periodo anterior, alerta de "degradacion de cadena".
- Si aparece una ruta nueva (deposito o provincia donde nunca se envio), se marca explicitamente como "sin calibrar, usando promesa nominal".
- Si hay tendencia clara de mejora (mas rapido que la promesa actual), sugerencia de "podes prometer 1 dia menos en esta ruta".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿La tabla `MetricaSLA` se esta actualizando correctamente por el cron `/api/cron/metricas-sla`? ¿Verificar ultima `fechaActualizacion`?
- ¿La granularidad actual de `MetricaSLA` es `(courierId, provinciaDestino)`. Necesitamos agregar `depositoOrigenId` y `modalidad` para tener calibracion real. Esto implica modificar el modelo y el cron.
- ¿`Envio.diasPrometidosCheckout` se esta poblando consistentemente en todos los envios? ¿Que default tiene si el e-commerce no lo envia?
- ¿Como se manejan los feriados hoy en el calculo? ¿Se descuentan o se incluyen? El modelo `Feriado` existe pero hay que verificar su uso.
- ¿El cliente puede configurar nivel de seguridad por ruta o solo global? Si solo global, hay que disenar el config.
- Para el simulador what-if, ¿podemos exponer una API simple que reciba "deposito + tiempo de despacho hipotetico" y devuelva nuevas promesas calibradas?
- ¿La integracion con checkout del cliente (via API) esta pensada? Si Shipro va a alimentar al e-commerce con la promesa calibrada en tiempo real, necesita endpoint especifico con rate-limiting.

---

<a id="bloque-3"></a>
# Bloque 3 — Inteligencia de negocio para el cliente

Este bloque reune las metricas que convierten datos operativos en decisiones de negocio para el cliente. No miden si Shipro esta bien (Bloque 1) ni si la cadena esta bien (Bloque 2). Miden plata, eficiencia economica, y comportamiento real de compradores. Son las metricas que el dueno del e-commerce mira cuando piensa en margenes y estrategia, no en operaciones.

---

## 3.1 Fuga por Ruteo

### Categoria
Inteligencia economica · Optimizacion de eleccion de courier

### Definicion operativa
Cuantifica el impacto economico de las elecciones de courier del cliente comparadas con todas las alternativas que Shipro le ofrecia en cada momento. Cada vez que se crea una etiqueta, la Plataforma cotizo multiples opciones (couriers, modalidades, servicios). El cliente eligio una. Esta metrica responde: ¿cuanto plata se esta dejando en la mesa al elegir como esta eligiendo?

No es una critica retroactiva ni una imposicion. Es informacion para que el cliente decida con conocimiento. A veces elegir el mas caro tiene razones legitimas (mejor SLA, modalidad especifica que un comprador necesita, decision estrategica de mantener un courier activo). La metrica muestra el costo de esas decisiones.

### Por que importa para el cliente
Es la metrica mas concreta del ROI de Shipro. Si un cliente esta pagando $500 por un envio que Shipro le mostro opciones desde $380, eso son $120 de oportunidad perdida por etiqueta. Multiplicado por 1.000 envios al mes, son $120.000 mensuales. Esto convierte a Shipro de "plataforma de gestion" en "asesor financiero de la operacion logistica".

Tambien permite identificar patrones: ¿hay usuarios del equipo que sistematicamente eligen opciones caras? ¿Hay momentos del dia donde se elige peor (apuro)? ¿Hay reglas de ruteo mal configuradas?

Decisiones que habilita:
- ¿Cuanta plata estoy dejando en la mesa por elegir como elijo?
- ¿Hay configuraciones automaticas de ruteo (`ReglaRuteo`) que me convienen activar?
- ¿Mi equipo esta eligiendo correctamente o necesita entrenamiento?
- ¿Vale la pena agregar un courier nuevo que vi en la cotizacion pero todavia no contrate?

### Diferencial competitivo
Las plataformas multicourier estandar muestran al cliente sus opciones al momento de cotizar, pero no le muestran retroactivamente cuanto le costo cada eleccion. Shipro guarda el snapshot completo de cada cotizacion (`CotizacionSnapshot.opcionesSnapshotJson`) y reconstruye la economia de cada decision. Esto es transparencia radical: el cliente ve exactamente donde sus decisiones le costaron mas de lo necesario, sin que ninguna otra herramienta pueda hacer lo mismo porque no guardan ese historico.

Es ingenieria de transparencia economica. Es la metrica que un comprador profesional mira para evaluar si vale la pena tener una plataforma multicourier vs. integrarse directo con un courier.

### Fuente de datos
- Modelo `FinanzasEnvio` (schema linea 324): los tres campos clave ya existen y se calculan al crear el envio: `fugaFinanciera` (diferencia economica), `courierSugerido` (que courier era el mas barato), `servicioSugerido` (que servicio era el mas barato). Esta metrica ya tiene backend.
- Modelo `CotizacionSnapshot` (schema linea 890): `opcionesSnapshotJson` guarda el snapshot completo de todas las alternativas al momento de cotizar. Permite reconstruccion exacta.
- Modelo `Envio` (schema linea 397): para cruzar con datos del envio (servicio elegido, courier elegido).
- Modelo `ReglaRuteo` (schema linea 650): para entender si la eleccion fue automatica (por regla configurada) o manual.

### Formula de calculo
Fuga individual por envio (ya calculada al crear etiqueta):
fuga_envio = FinanzasEnvio.fugaFinanciera
(= costo_real_pagado - costo_minimo_alternativa_disponible)

Si la fuga es positiva, el cliente pago mas que la alternativa mas barata. Si es cero, eligio la mas barata. Si es negativa, no deberia pasar (significaria que eligio algo mas barato que el minimo, lo cual indicaria un bug).

Fuga acumulada en ventana:
fuga_total_periodo = SUM(FinanzasEnvio.fugaFinanciera)
en ventana temporal

Fuga promedio por envio:
fuga_promedio = AVG(FinanzasEnvio.fugaFinanciera)
en envios del periodo

Fuga porcentual:
fuga_porcentual = (fuga_total / costo_total_pagado) × 100

### Cortes de analisis disponibles
- **Por courier elegido vs. courier sugerido:** matriz que muestra "elegi Andreani, lo mas barato era Mocis, fuga acumulada de $X". Identifica patrones de preferencia que cuestan.
- **Por usuario que creo la etiqueta:** quien en el equipo elige peor economicamente.
- **Por modalidad elegida vs. sugerida:** "elegi domicilio cuando la sucursal era mas barata".
- **Por origen del envio:** automatico (via API e-commerce con regla) vs. manual (operador eligio). Las diferencias revelan calidad de las reglas configuradas.
- **Por monto del envio:** si la fuga esta concentrada en envios altos (alto impacto) o bajos (volumen).
- **Por zona geografica:** algunas zonas tienen mas variabilidad de precios entre couriers que otras.
- **Por hora del dia / dia de la semana:** patrones de apuro que generan malas decisiones.
- **Tendencia temporal:** evolucion mes a mes. ¿La fuga se reduce con educacion o se mantiene constante?

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: fuga total acumulada del periodo en pesos (ej: `$87.430 en ultimos 30 dias`).
- Indicador secundario: fuga promedio por envio (ej: `$94 por envio en promedio`).
- Indicador comparativo: comparacion con periodo anterior (ej: `↓ 12% vs mes anterior`).
- Mini-distribucion mostrando cuantos envios tuvieron fuga y cuantos no.
- CTA: "Ver analisis de fuga" y "Configurar reglas de ruteo".

**Vista expandida:**

Pestana 1 — **Fuga por courier:** ranking de elecciones que mas fuga generan. Ejemplo: "Elegiste Andreani Domicilio en 340 envios; en 87 de esos, Mocis Sucursal era mas barato. Fuga acumulada: $34.200." Cada fila incluye CTA "Crear regla automatica para esos casos".

Pestana 2 — **Analisis por usuario y patron:** comparativa entre miembros del equipo o entre canales (e-commerce vs. manual). Identifica si el problema es de entrenamiento, de configuracion automatica, o sistemico.

Pestana 3 — **Drill-down por envio:** lista detallada con cada envio que tuvo fuga, el courier elegido, el courier sugerido, la diferencia economica, y el motivo si fue automatico (regla aplicada) o manual.

Pestana 4 — **Simulador de reglas:** "Si aplicaras la regla 'siempre elegir el mas barato cuando la diferencia sea mayor a $50', tu fuga historica habria sido $X menos". Permite probar reglas antes de activarlas.

Pestana 5 — **Reglas activas y su impacto:** muestra las `ReglaRuteo` activas y cuanto le ahorraron en el periodo. Convierte la configuracion en metrica.

**Interacciones disponibles:**
- Crear regla de ruteo directamente desde un patron identificado, sin ir a otro modulo.
- Configurar umbrales: "alertarme si la fuga acumulada mensual supera $X".
- Exportar analisis detallado para revision con contador o socio.
- Comparar fuga entre depositos si el cliente tiene varios.

**Estado vacio:**
"Necesitamos al menos 50 envios en la ventana con cotizaciones de multiples couriers para calcular fuga significativa."

**Estados de alerta:**
- Si la fuga acumulada supera el umbral configurado, alerta de "oportunidad economica significativa".
- Si un usuario especifico genera mas del 40% de la fuga total del equipo, sugerencia de revision de su criterio de eleccion.
- Si una regla automatica deja de aplicarse correctamente (fuga sube subitamente), alerta de "regla degradada".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`FinanzasEnvio.fugaFinanciera`, `courierSugerido` y `servicioSugerido` se estan poblando consistentemente en cada envio? ¿O hay casos donde quedan null?
- ¿`CotizacionSnapshot.opcionesSnapshotJson` se guarda con estructura consistente o varia por courier?
- ¿Hay cruce funcional entre `Envio` y `CotizacionSnapshot.usadaEnEnvioId` para reconstruir el contexto de cotizacion?
- ¿`ReglaRuteo` se aplica al cotizar o solo al despachar? Esto afecta como medir reglas activas.
- ¿Existe endpoint que ya calcule fuga agregada o hay que crearlo?
- Para el simulador de reglas, ¿podemos reconstruir hipoteticamente que habria pasado si una regla nueva hubiera estado activa? Esto requiere replay sobre `CotizacionSnapshot` historicos.

---

## 3.2 Desvio de Peso (Fuga por Aforo)

### Categoria
Inteligencia economica · Precision declarativa del cliente

### Definicion operativa
Cuantifica la diferencia entre el peso que el cliente declaro al crear la etiqueta (peso aforado declarado, base de la cotizacion) y el peso real que el courier midio al procesar el paquete (peso aforado facturado). El courier factura sobre el peso real, no sobre el declarado, asi que esta diferencia es costo extra que el cliente paga sin haberlo anticipado.

Critico: el objetivo de esta metrica no es la diferencia economica final (eso es contable), sino la precision declarativa del cliente. Un cliente que sistematicamente declara 2kg cuando envia 4kg tiene un problema en su proceso de packaging o en su sistema de informacion, no un problema con el courier.

### Por que importa para el cliente
La metrica revela un problema operativo upstream que el cliente probablemente no ve. Si tu peso declarado falla en 30% de los casos, no es un tema de courier: es un problema en como tu equipo packagea, mide, o carga datos. Eso afecta:
- Costo real vs. costo presupuestado.
- Promesas de precio al comprador (si vos vendes con envio incluido y calculaste con un peso, pero pagas otro, tu margen se erosiona).
- Capacidad de cotizar correctamente para futuros envios.

Decisiones que habilita:
- ¿Mi sistema de pesaje en el deposito esta bien calibrado?
- ¿Mis SKUs tienen pesos declarados correctos en mi e-commerce?
- ¿Hay categorias de productos donde el desvio es sistematico?
- ¿Vale la pena invertir en balanza certificada vs. seguir estimando?

### Diferencial competitivo
La fuga por peso es la perdida silenciosa mas grande en logistica de e-commerce. Casi ninguna plataforma la mide explicitamente. Shipro convierte un dato de liquidacion contable en un instrumento de gestion operativa. El cliente ve no solo cuanto le facturaron de mas, sino donde esta el problema en su propia operacion.

### Fuente de datos
- Modelo `FinanzasEnvio` (schema linea 324): `pesoCobrado` (peso aforado declarado al crear etiqueta) y `pesoAforado` (peso aforado real facturado por courier). Tambien `costoAforo` (diferencia economica).
- Modelo `Envio` (schema linea 397): `pesoReal`, `pesoVolumetrico`, `pesoFacturado`.
- Modelo `LiquidacionMensual` (schema linea 377): para asociar a periodo fiscal cuando se cargan las facturas del courier.

### Formula de calculo
Desvio individual por envio:
desvio_kg = FinanzasEnvio.pesoAforado - FinanzasEnvio.pesoCobrado
(kg de diferencia entre real y declarado)
desvio_porcentaje = (desvio_kg / pesoCobrado) × 100
(que tan lejos del declarado)
desvio_economico = FinanzasEnvio.costoAforo
(impacto en pesos)

Tasa de envios con desvio:
envios_con_desvio = COUNT(envios donde desvio_kg > umbral_tolerancia)
(umbral tipico: 200g o 5%)
total_envios = COUNT(envios con peso facturado conocido)
tasa_desvio = (envios_con_desvio / total_envios) × 100

Desvio acumulado en pesos:
desvio_acumulado = SUM(FinanzasEnvio.costoAforo)
en ventana

### Cortes de analisis disponibles
- **Por categoria de producto:** si el cliente tiene categorizacion en sus envios, que categorias tienen mas desvio sistematico.
- **Por SKU especifico:** ranking de SKUs con peor relacion entre peso declarado y real. Permite accion concreta: corregir el peso del SKU en el sistema.
- **Por usuario que cargo el envio:** si fue manual, quien declara peor.
- **Por courier:** algunos couriers pueden ser mas estrictos en la medicion que otros.
- **Por modalidad o servicio:** algunos servicios tienen aforo diferente (volumetrico vs. real).
- **Por rango de peso declarado:** si el desvio se concentra en envios chicos (donde la diferencia porcentual es alta) o grandes (donde la diferencia absoluta es alta).
- **Tendencia temporal:** ¿el equipo mejora con feedback o se mantiene constante?

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: porcentaje de envios con desvio significativo (ej: `34% de envios con desvio > 200g`).
- Indicador secundario: costo economico acumulado (ej: `$42.180 facturados de mas en el periodo`).
- Indicador de tendencia comparado con periodo anterior.
- CTA: "Ver analisis de pesaje".

**Vista expandida:**

Pestana 1 — **SKUs problematicos:** ranking de SKUs con peor desvio promedio. Cada fila muestra peso declarado promedio, peso real promedio, desvio, cantidad de envios. CTA "Actualizar peso en sistema" si esta integrado con el e-commerce del cliente.

Pestana 2 — **Analisis por usuario:** comparativa entre operadores que cargaron envios manualmente. Util para entrenamiento.

Pestana 3 — **Distribucion de desvios:** histograma mostrando donde se concentran los desvios. Permite distinguir si es problema sistemico (todos los envios un poco desviados) o concentrado (pocos envios muy desviados).

Pestana 4 — **Impacto economico proyectado:** simulador. "Si lograras reducir el desvio del SKU X de 1,2kg a 0,2kg, ahorrarias $X mensual". Convierte el problema en oportunidad cuantificada.

Pestana 5 — **Auditoria por liquidacion:** cruzar con `LiquidacionMensual` para verificar que el desvio facturado coincide con la liquidacion del courier. Permite detectar errores de facturacion del courier.

**Interacciones disponibles:**
- Marcar SKUs como "revisados" despues de actualizar peso en sistema.
- Configurar umbral de tolerancia personalizado (ej: "ignora desvios menores a 100g").
- Exportar reporte para revision con el equipo de packaging.
- Comparar desvio entre courier si tiene varios (revela si un courier afora mas estrictamente que otros).

**Estado vacio:**
"Esta metrica requiere que las liquidaciones del courier esten cargadas. Minimo recomendado: 1 mes con liquidacion completa."

**Estados de alerta:**
- Si el costo economico acumulado supera umbral configurado, alerta de "fuga significativa".
- Si aparece un SKU nuevo con desvio sistematico mayor al 50%, alerta de "SKU mal cargado".
- Si la tasa de desvio sube mas del 20% respecto al mes anterior, alerta de "deterioro de precision declarativa".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`FinanzasEnvio.pesoCobrado` y `pesoAforado` se estan poblando hoy? ¿En que momento del flujo se llenan?
- ¿La carga de liquidaciones del courier (probablemente via Excel mensual) esta implementada? ¿Como asocia cada fila de la liquidacion con el envio correcto?
- ¿`Envio.pesoReal`, `pesoVolumetrico`, `pesoFacturado` se llenan con datos del courier o se declaran al crear etiqueta?
- ¿Hay relacion entre `Envio` y la categoria/SKU del producto enviado? ¿O esa info esta solo en `OrdenExterna`?
- Para el analisis por SKU, ¿podemos extraer SKU desde `OrdenExterna` o desde algun campo de `Envio`?
- ¿`costoAforo` se calcula correctamente comparando lo cotizado vs. lo facturado? ¿Hay casos donde el courier no factura desvio por estar dentro de tolerancia?

---

## 3.3 Modalidades de Eleccion (Habitos del Comprador)

### Categoria
Inteligencia de comportamiento · Preferencias del consumidor final

### Definicion operativa
Mide como eligen los compradores entre las distintas modalidades de entrega que el cliente les ofrece en su checkout: envio a domicilio estandar, envio a domicilio same-day, retiro en sucursal, retiro en punto de pickup, retiro en e-locker, y futuras modalidades a desarrollar.

No es una metrica de que le conviene al cliente economicamente (eso es 3.1). Es una metrica de comportamiento del consumidor final: que eligen cuando tienen opciones. Sirve para entender preferencias regionales, sensibilidad al precio, sensibilidad al tiempo, y para disenar estrategias de checkout mas efectivas.

### Por que importa para el cliente
El cliente disena su checkout con suposiciones. "Mis compradores prefieren entrega a domicilio." "Solo el 10% usa sucursal." Esta metrica valida o refuta esas suposiciones con datos. Y permite tomar decisiones de producto: si descubris que el 40% de tus compradores eligen sucursal en CABA pero solo el 5% en interior, podes ajustar las opciones por region.

Tambien permite negociar con couriers: si la mitad de tus compradores eligen sucursal, podes exigir mejores tarifas en esa modalidad porque le das volumen.

Decisiones que habilita:
- ¿Que modalidades de entrega ofrezco en cada region?
- ¿Vale la pena agregar same-day como opcion si nadie lo elige?
- ¿La distribucion de modalidades cambio este ano vs. el anterior?
- ¿Hay correlacion entre monto del envio y modalidad elegida?
- ¿Deberia incentivar alguna modalidad (descuento) para reducir mi costo logistico?

### Diferencial competitivo
La mayoria de plataformas reportan envios por courier, no envios por modalidad de entrega. Shipro pone el comportamiento del comprador en el centro, no la eleccion operativa del cliente. Eso convierte la metrica en herramienta de producto: ayuda al cliente a disenar mejor su experiencia de compra, no solo a operar mas eficiente.

### Fuente de datos
- Modelo `Envio` (schema linea 397): campo `modalidad` y `servicioId`. La modalidad indica el tipo de entrega elegido.
- Modelo `ServicioCourier` (schema linea 206): catalogo de servicios por courier con sus capacidades tecnicas mapeadas (`capacidadTecnicaMapeada`).
- Modelo `CotizacionSnapshot` (schema linea 890): `opcionesSnapshotJson` permite ver que opciones se mostraron al comprador en el checkout para entender la "tasa de eleccion" de cada modalidad cuando estaba disponible.
- Modelo `Direccion` (schema linea 290): provincia y CP de destino para cortes geograficos.

### Formula de calculo
Distribucion basica:
PARA cada modalidad disponible:
envios_modalidad = COUNT(Envio WHERE modalidad = X)
total_envios = COUNT(Envio)
porcentaje_modalidad = (envios_modalidad / total_envios) × 100

Tasa de eleccion cuando estaba disponible:
PARA cada modalidad disponible:
cotizaciones_con_modalidad = COUNT(CotizacionSnapshot donde modalidad estaba en opciones)
envios_con_modalidad = COUNT(Envio donde se eligio esa modalidad)
tasa_eleccion = (envios / cotizaciones) × 100

Esta segunda formula es mas util que la primera porque controla por disponibilidad. Si "sucursal" solo esta disponible en algunas zonas, la distribucion total subestima su popularidad real.

### Cortes de analisis disponibles
- **Por provincia o region:** la distribucion varia dramaticamente por zona.
- **Por monto del envio:** envios de bajo valor pueden preferir sucursal (ahorro), envios altos pueden preferir domicilio (seguridad).
- **Por dia de la semana:** sucursales tienden a usarse mas en periodos donde el comprador sabe que no estara en casa.
- **Por demografia si se tiene:** edad del comprador, genero, recurrencia (cliente nuevo vs. recurrente).
- **Por categoria de producto:** ropa puede tener perfil distinto de electronica.
- **Tendencia temporal:** evolucion mensual. ¿Las modalidades de retiro crecen o decrecen?
- **Por horario del checkout:** compras nocturnas pueden tener perfil distinto de compras de mediodia.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Visualizacion principal: grafico de torta o donut con la distribucion de modalidades en ultima ventana.
- Indicador secundario: modalidad lider con porcentaje (ej: `Domicilio estandar: 67%`).
- Indicador comparativo: cambio significativo respecto al periodo anterior si lo hay (ej: `Sucursal +8 puntos vs mes anterior`).
- CTA: "Ver analisis de comportamiento".

**Vista expandida:**

Pestana 1 — **Distribucion por region:** mapa de Argentina con la modalidad dominante por provincia, con segundo lugar como detalle al pasar el cursor. Identifica patrones geograficos claros.

Pestana 2 — **Comparativa cuando hubo opciones:** la metrica mas rica. Muestra "cuando el comprador tenia 3 opciones, eligio X el Y% de las veces". Esto revela preferencias reales, no condicionadas por disponibilidad.

Pestana 3 — **Analisis economico de la eleccion:** cruce con monto del envio. ¿Los compradores eligen sucursal cuando es mas barata o cuando es lo unico disponible?

Pestana 4 — **Tendencia temporal:** evolucion de cada modalidad a lo largo del ano. Permite ver crecimiento de modalidades nuevas (e-lockers) o decadencia de otras.

Pestana 5 — **Simulador de impacto:** "Si lograras que 10% mas de compradores elijan sucursal en lugar de domicilio, ahorras $X mensual y mantenes NPS similar". Conecta la metrica con decision economica.

**Interacciones disponibles:**
- Filtros por modalidad especifica, region, rango temporal, monto.
- Configurar que modalidades ofrecer por region (a futuro, conectado con configuracion del checkout).
- Exportar reporte de comportamiento para analizar con equipo comercial.
- Comparar comportamiento entre diferentes canales (Tiendanube vs. Mercado Libre vs. otros) si el cliente tiene multicanal.

**Estado vacio:**
"Necesitamos al menos 200 envios en la ventana para analisis significativo de modalidades."

**Estados de alerta:**
- Si una modalidad nueva agregada (ej: e-lockers) muestra adopcion inesperadamente baja, alerta para investigar (UX del checkout, ubicacion de lockers, precio).
- Si una modalidad importante se desploma subitamente (ej: sucursal pasa de 30% a 15%), alerta de "cambio de comportamiento" para investigar causa (cierre de sucursales del courier, cambio de UX del checkout).
- Si una region muestra comportamiento divergente repentinamente, alerta de "patron regional emergente".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`Envio.modalidad` se llena consistentemente con valores estandarizados (enum o catalogo) o hay variantes de texto libre?
- ¿`ServicioCourier.capacidadTecnicaMapeada` permite agrupar servicios distintos de diferentes couriers bajo una misma "modalidad" logica (ej: "Andreani Sucursal" y "Mocis Punto Pickup" como "modalidad: retiro")?
- ¿`CotizacionSnapshot.opcionesSnapshotJson` guarda todas las opciones ofrecidas o solo algunas? Para calcular tasa de eleccion cuando estaba disponible necesitamos ver todas.
- ¿Como se obtiene la categoria de producto si se quiere cruzar? ¿Esta en `OrdenExterna` o en otro lado?
- Para el simulador de impacto, ¿podemos modelar el costo logistico por modalidad de manera confiable?

---

<a id="bloque-4"></a>
# Bloque 4 — Salud del ecosistema

Este bloque reune las metricas que miran la salud estructural de la operacion: dependencias, riesgos, oportunidades de expansion, y solidez financiera. Mientras los bloques anteriores miden eventos (envios, tickets, elecciones), este bloque mide condiciones estructurales que afectan la operacion entera. Son las metricas que un CEO o COO mira para entender la robustez del negocio, no su dia a dia.

---

## 4.1 Riesgo Courier (Concentracion y Dependencia)

### Categoria
Riesgo estructural · Diversificacion de la operacion logistica

### Definicion operativa
Mide el grado de concentracion o dependencia del cliente respecto a los couriers que utiliza. Responde la pregunta: "Si uno de mis couriers fallara manana, ¿que porcentaje de mi operacion queda paralizada?". Tambien responde lo inverso: "¿Estoy aprovechando la red multicourier que Shipro me ofrece o estoy comportandome como si tuviera un solo proveedor?"

La metrica no se queda en proporcion de envios por courier. Va mas profundo: combina cuatro dimensiones para evaluar riesgo real.

**Dimension 1 — Concentracion de volumen:** porcentaje de envios por courier en ventana. Un cliente con 95% de envios en Andreani tiene alta concentracion.

**Dimension 2 — Concentracion de dinero:** porcentaje del gasto logistico por courier. Puede diferir del volumen si un courier es usado para envios mas caros.

**Dimension 3 — Concentracion geografica:** si un courier es el unico disponible o usado en una zona critica, una falla ahi es bloqueante aunque el courier no represente mucho del total.

**Dimension 4 — Concentracion por tipo de servicio:** si una modalidad clave (ej: same-day) solo esta cubierta por un courier, ese courier es critico aunque sea pequeno en volumen.

### Por que importa para el cliente
Es la metrica que el dueno del e-commerce probablemente nunca miro pero que es central. La concentracion logistica es invisible hasta que un courier falla, y entonces es tarde. Esta metrica permite anticipar el riesgo.

Tambien sirve para tomar decisiones estrategicas:
- Si la concentracion es muy alta en un courier, conviene desarrollar otro para diversificar.
- Si la concentracion es baja pero la operacion funciona bien, hay oportunidad de negociar mejores tarifas con el courier dominante (concentracion estrategica voluntaria).

Decisiones que habilita:
- ¿Estoy demasiado expuesto a un courier?
- ¿Que pasaria con mi operacion si X courier falla manana?
- ¿En que zonas o servicios tengo dependencia unica?
- ¿Deberia invertir tiempo en levantar un courier adicional?
- ¿Mi concentracion aumenta o disminuye en el tiempo? ¿Por que?

### Diferencial competitivo
Las plataformas multicourier estandar fomentan el uso de multiples couriers pero no miden el riesgo de concentracion como metrica explicita. Shipro convierte el dato de uso en un instrumento de planificacion estrategica. Para un cliente con operacion seria, esta metrica es del mismo nivel que mirar concentracion de proveedores en cualquier industria: es disciplina de gestion, no curiosidad operativa.

### Fuente de datos
- Modelo `Envio` (schema linea 397): `courierId`, `servicioId`, `modalidad`, `pesoFacturado`, fechas. Base de todas las dimensiones.
- Modelo `FinanzasEnvio` (schema linea 324): `precioFactura`, `costoCourierFacturado`. Para dimension 2 (concentracion de dinero).
- Modelo `Direccion` (schema linea 290): provincia y CP del destino. Para dimension 3 (concentracion geografica).
- Modelo `Courier` (schema linea 134): capacidades por courier (`puedeEntregarDomicilio`, `puedeEntregarSucursal`, etc.). Para entender alternativas reales.
- Modelo `ServicioCourier` (schema linea 206): para dimension 4 (concentracion por servicio).
- Modelo `MetricaCourierLatencia` (schema linea 902): salud tecnica de cada courier en operaciones criticas. Util para enriquecer evaluacion de riesgo (un courier con alta latencia y errores es mas riesgoso aunque represente poco volumen).

### Formula de calculo
**Dimension 1 — Concentracion de volumen (indice Herfindahl-Hirschman adaptado):**
PARA cada courier i:
share_volumen_i = envios_courier_i / total_envios
HHI_volumen = SUM(share_volumen_i ^ 2) × 10.000
Interpretacion:
HHI < 1.500 = baja concentracion (diversificado)
1.500 < HHI < 2.500 = concentracion moderada
HHI > 2.500 = alta concentracion (riesgoso)

**Dimension 2 — Concentracion economica:**
share_dinero_i = costo_total_courier_i / costo_total_periodo
HHI_dinero = SUM(share_dinero_i ^ 2) × 10.000

**Dimension 3 — Concentracion geografica (cobertura unica):**
PARA cada provincia o zona:
couriers_disponibles = COUNT(DISTINCT courier que entrego alli en periodo)
couriers_usados = COUNT(DISTINCT courier elegido por el cliente)
SI couriers_usados = 1 EN una provincia con volumen significativo:
marcar como "dependencia geografica unica"
porcentaje_envios_en_dependencia_geografica = envios en zonas de dependencia unica / total

**Dimension 4 — Concentracion por servicio:**
PARA cada modalidad critica (same-day, sucursal, e-locker, etc.):
couriers_disponibles = COUNT(DISTINCT courier que ofrece esa modalidad)
couriers_usados = couriers efectivamente usados para esa modalidad
SI couriers_usados = 1 EN modalidad activa:
marcar como "dependencia de servicio unica"

**Indice de Riesgo Compuesto:**
riesgo_compuesto =
(HHI_volumen × 0.30) +
(HHI_dinero × 0.20) +
(penalty_dependencia_geografica × 0.30) +
(penalty_dependencia_servicio × 0.20)
Resultado escalado 0-100:
0-30 = Bajo riesgo (operacion diversificada y resiliente)
30-60 = Riesgo medio (atencion a puntos de concentracion)
60-100 = Alto riesgo (accion recomendada)

### Cortes de analisis disponibles
- **Por dimension:** ver cada uno de los cuatro componentes por separado.
- **Por evolucion temporal:** ¿el riesgo aumenta o disminuye mes a mes?
- **Por zona geografica:** mapa de Argentina identificando provincias con dependencia unica.
- **Por modalidad critica:** que modalidades tienen mayor exposicion.
- **Comparativa con benchmark del rubro:** si Shipro tiene varios clientes del mismo rubro, comparar concentracion promedio. (Esto requiere que Shipro acumule data multi-tenant, pero es factible).
- **Analisis what-if:** "Si pierdo Courier X, que porcentaje de envios quedan sin alternativa inmediata".

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: indice de riesgo compuesto 0-100 con color semaforo (verde / amarillo / rojo).
- Indicador secundario: identificacion del riesgo principal (ej: "Concentracion del 78% en Andreani" o "Dependencia unica en 3 provincias").
- Mini-distribucion apilada mostrando proporcion de envios por courier.
- CTA: "Ver analisis de riesgo".

**Vista expandida:**

Pestana 1 — **Composicion del riesgo:** las cuatro dimensiones desplegadas con sus valores individuales y peso en el indice compuesto. Permite entender que dimension esta empujando el riesgo arriba.

Pestana 2 — **Mapa de dependencias geograficas:** mapa de Argentina con codigo de color segun diversidad de couriers usados por provincia. Provincias con dependencia unica destacadas en rojo.

Pestana 3 — **Simulador de falla:** "Si Andreani falla hoy, ¿que pasa?". Muestra que porcentaje de envios quedan sin alternativa, en que zonas, para que modalidades. Permite probar escenarios de falla individuales o multiples (¿y si fallan Andreani y Mocis al mismo tiempo?).

Pestana 4 — **Recomendaciones automaticas:** "Activar OCA en provincia Misiones reduciria tu dependencia geografica unica en X%". El sistema sugiere acciones concretas basadas en el analisis.

Pestana 5 — **Evolucion temporal:** grafico del indice de riesgo mes a mes. Identifica si las decisiones de mix estan aumentando o reduciendo el riesgo a lo largo del tiempo.

**Interacciones disponibles:**
- Filtros por dimension, zona, modalidad, ventana temporal.
- Configurar umbrales personalizados de alerta.
- Exportar analisis de riesgo para presentaciones internas o conversaciones con socios.
- Marcar dependencias como "aceptadas estrategicamente" para que no generen alerta (decision consciente).

**Estado vacio:**
"Necesitamos al menos 500 envios en la ventana con distribucion de couriers para analisis significativo."

**Estados de alerta:**
- Si el indice compuesto supera 60, alerta de "alto riesgo de concentracion" con analisis de causas.
- Si aparece una nueva dependencia geografica unica que antes no existia, alerta proactiva.
- Si un courier critico muestra deterioro en `MetricaCourierLatencia` y representa mas del 50% del volumen del cliente, alerta combinada de "riesgo en proveedor critico".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`Envio.courierId` y `Envio.servicioId` se llenan consistentemente? Sin esto, las metricas son invalidas.
- ¿`FinanzasEnvio.costoCourierFacturado` se carga al ingresar liquidaciones o se infiere de la cotizacion inicial?
- ¿`MetricaCourierLatencia` se esta poblando hoy con datos reales del sistema? ¿Es confiable como input?
- ¿Hay forma de saber que couriers ofrecen cobertura en cada CP sin haber enviado alli? Esto es necesario para el simulador de falla. Posible via `SucursalCourierCp` o consultando capacidades de cobertura.
- Para el benchmark del rubro, ¿tenemos forma de clasificar clientes por rubro o industria? Si no, esta funcion queda pendiente hasta agregar esa instrumentacion.
- ¿El calculo de HHI es eficiente o requiere indices nuevos para queries por ventana movil?

---

## 4.2 Salud de Couriers (Latencia y Confiabilidad Tecnica)

### Categoria
Performance tecnica de proveedores · Monitoreo continuo de integraciones

### Definicion operativa
Mide la salud tecnica de cada courier integrado en Shipro a traves de cuatro operaciones criticas que ocurren contra sus APIs:

**1. Cotizar:** el cliente o el comprador piden una cotizacion, Shipro consulta al courier.
**2. Despachar:** se crea formalmente el envio en el sistema del courier.
**3. Tracking:** se consulta el estado del envio en curso.
**4. Etiqueta:** se solicita el PDF o imagen de la etiqueta para impresion.

Para cada operacion, la metrica observa: cantidad de requests, tiempo de respuesta promedio (latencia), tasa de exito, tasa de timeout, tasa de error. Estos numeros, agregados, dicen si un courier esta sano, degradado, o caido.

Critico: la metrica diferencia entre problemas del courier (su API esta caida) y problemas de la integracion (Shipro esta enviando mal los datos). Lo primero requiere reclamo al courier; lo segundo requiere fix interno.

### Por que importa para el cliente
Detecta problemas antes de que el cliente o el comprador los noten. Si la API de Andreani empieza a responder en 8 segundos en lugar de 800ms, el comprador siente lentitud en el checkout pero no sabe por que. Esta metrica le permite a Shipro y al cliente identificar el problema en su origen.

Para el equipo de Shipro internamente, es la metrica que permite tomar decisiones de cuando intervenir un courier en su mix automaticamente. Si Andreani esta fallando, Shipro puede empezar a sugerir alternativas en cotizaciones nuevas sin esperar a que el cliente lo note.

Decisiones que habilita:
- ¿Hay un courier mostrando deterioro tecnico que mis usuarios todavia no perciben?
- ¿Tengo que reclamar a un courier por degradacion de servicio?
- ¿Vale la pena rotar carga hacia couriers mas confiables temporalmente?
- ¿Mis problemas de despacho son del courier o de mi integracion?

### Diferencial competitivo
Esta metrica no la tiene casi ningun cliente porque no se mide. Cuando un courier falla, los e-commerces lo descubren por reclamos de compradores, no por monitoreo. Shipro convierte la observacion tecnica en un instrumento de decision operativa. Es como tener un equipo de monitoreo de infraestructura para tus couriers sin contratarlo.

### Fuente de datos
- Modelo `MetricaCourierLatencia` (schema linea 902): la fuente principal. Registra cada operacion con `operacion`, `latenciaMs`, `status` (success/timeout/error), `createdAt`. Indexado por `createdAt`.
- Modelo `Courier` (schema linea 134): `timeoutCotizacionMs` y otros umbrales configurados.
- Modelo `Envio` (schema linea 397): para cruzar performance tecnica con outcome real (envios creados, despachados).

### Formula de calculo
Tasa de exito por operacion y courier:
PARA cada (courier, operacion) en ventana:
total = COUNT(MetricaCourierLatencia)
exitos = COUNT(WHERE status = "success")
timeouts = COUNT(WHERE status = "timeout")
errores = COUNT(WHERE status = "error")
tasa_exito = (exitos / total) × 100
tasa_timeout = (timeouts / total) × 100
tasa_error = (errores / total) × 100

Latencia agregada por percentiles:
PARA cada (courier, operacion):
p50_ms = PERCENTILE(latenciaMs WHERE status = "success", 50)
p95_ms = PERCENTILE(latenciaMs WHERE status = "success", 95)
p99_ms = PERCENTILE(latenciaMs WHERE status = "success", 99)

Score de salud por courier (0-100):
salud_courier =
(tasa_exito_cotizar × 0.30) +
(tasa_exito_despachar × 0.30) +
(tasa_exito_tracking × 0.20) +
(tasa_exito_etiqueta × 0.20)
ajuste_por_latencia =
si p95_cotizar > 3000ms: -10 puntos
si p95_despachar > 5000ms: -15 puntos
(penalizaciones acumulativas por degradacion)
salud_final = MAX(0, salud_courier - ajustes_por_latencia)

### Cortes de analisis disponibles
- **Por courier:** comparativa entre todos los couriers integrados.
- **Por operacion:** un courier puede estar bien en cotizar y mal en tracking. Es informacion granular.
- **Por ventana temporal:** ¿el problema es de hoy o tendencia larga?
- **Por hora del dia:** algunos couriers tienen ventanas de menor performance (mantenimiento nocturno, picos de trafico).
- **Cross con outcome real:** ¿la degradacion tecnica afecta envios efectivamente despachados?

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: estado de salud general agregado de todos los couriers (ej: "2 sanos · 1 degradado · 0 caidos").
- Mini-grilla mostrando cada courier con su semaforo individual.
- Ultimo evento critico si lo hay (ej: "Andreani: degradacion detectada hace 12 min").
- CTA: "Ver detalle tecnico" y "Ver historial de incidentes".

**Vista expandida:**

Pestana 1 — **Dashboard por courier:** para cada courier integrado, panel completo con: tasa de exito por operacion, latencia P50/P95/P99, eventos recientes, comparacion con semana anterior.

Pestana 2 — **Linea de tiempo de incidentes:** lista cronologica de eventos relevantes detectados automaticamente: degradaciones, recuperaciones, picos de error. Permite reconstruir narrativa.

Pestana 3 — **Analisis cruzado:** "Cuando Andreani esta degradado, ¿que pasa con la fuga por ruteo del cliente?". Conecta esta metrica con metricas de otros bloques.

Pestana 4 — **Recomendaciones automaticas:** "Andreani Cotizar esta respondiendo en 4,2s promedio (umbral: 2s). Considera rotar volumen a Mocis durante las proximas 24h."

**Interacciones disponibles:**
- Filtros por courier, operacion, ventana.
- Configurar umbrales personalizados de alerta.
- Suscribirse a notificaciones especificas (mail / WhatsApp si esta disponible) cuando un courier critico se degrada.
- Exportar reporte de salud para presentar al courier en reuniones de gestion.

**Estado vacio:**
"Necesitamos al menos 100 operaciones por courier en la ventana para analisis confiable."

**Estados de alerta:**
- Si la tasa de exito de una operacion cae bajo 90%, alerta de "degradacion detectada".
- Si la tasa de error supera 10%, alerta critica de "courier inestable".
- Si la latencia P95 se duplica respecto a la semana anterior, alerta de "deterioro de performance".
- Si un courier critico (alto volumen del cliente) tiene cualquier degradacion, alerta inmediata con sugerencia de mitigacion.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`MetricaCourierLatencia` se esta poblando hoy con todas las operaciones contra couriers o solo algunas?
- ¿La instrumentacion esta en los adapters de cada courier o se hace centralizadamente?
- ¿`status` tiene los tres valores (`success`, `timeout`, `error`) bien definidos o hay variantes?
- ¿Como se distingue entre error del courier (su API responde 500) y error de la integracion Shipro (mal request)?
- ¿Hay rate-limit en las consultas a couriers que podrian generar falsos positivos en la metrica?
- Para el cross con `Envio`, ¿podemos correlacionar requests especificos con envios creados?

---

## 4.3 Cobertura Postal Activa

### Categoria
Inteligencia de expansion · Oportunidades comerciales perdidas

### Definicion operativa
Mide cuantos codigos postales le estan pidiendo cotizar al cliente que Shipro no puede cubrir con los couriers actualmente integrados o configurados. Cada uno de esos CPs es un comprador potencial perdido, una venta no concretada, una oportunidad comercial silenciosa.

Adicionalmente, cuantifica esos CPs no cubiertos por: frecuencia (cuantas veces piden cada uno), volumen estimado (peso y dimensiones), zona geografica, y antiguedad (¿desde cuando no podemos cubrirlos?).

### Por que importa para el cliente
Le da visibilidad al cliente sobre demanda real que no esta sirviendo. Si descubris que el 8% de las cotizaciones pedidas en tu e-commerce son hacia CPs que no podes cubrir, eso es:
- Conversion rate mas bajo del que podria ser.
- Compradores frustrados que se van.
- Reputacion que se erosiona ("no llegan a mi zona").

Esta metrica convierte un problema invisible (gente que se va sin comprar) en un dato accionable.

Decisiones que habilita:
- ¿Vale la pena integrar un courier nuevo que cubra estas zonas?
- ¿Hay zonas donde puedo negociar con un courier actual para agregar cobertura?
- ¿Cual es el potencial comercial de mejorar cobertura?
- ¿Las zonas no cubiertas son crecientes (interes geografico nuevo) o estables?

### Diferencial competitivo
Pocas plataformas le muestran al cliente lo que NO pueden cotizar, solo lo que si. Shipro convierte el silencio en informacion. Esto esta alineado con el Principio 1 declarado por el director: "Shipro es plataforma de datos. Endpoints, queries y logica de analitica no se borran aunque no tengan UI activa hoy".

`RegistroCoberturaVacia` ya esta siendo poblada por el cotizador desde DEUDA 32+37 Fase J justamente para esta funcion futura. Es backend listo, esperando UI.

### Fuente de datos
- Modelo `RegistroCoberturaVacia` (schema linea 961): registra cada cotizacion donde la respuesta fue vacia (cero couriers cotizaron). Campos: `cpDestino`, `pesoKg`, `dimensiones`, `origen`, `empresaId`, `fecha`. Indexado por `fecha`.
- Modelo `CotizacionSnapshot` (schema linea 890): para denominador (total de cotizaciones intentadas).
- Modelo `Localidad` y `Provincia` (schema lineas 570 y 563): para enriquecer CPs no cubiertos con su zona geografica.

### Formula de calculo
Tasa de cobertura vacia:
cotizaciones_sin_cobertura = COUNT(RegistroCoberturaVacia) en ventana
total_cotizaciones_intentadas = COUNT(CotizacionSnapshot) en ventana
tasa_cobertura_vacia = (sin_cobertura / total) × 100

Top CPs no cubiertos:
GROUP BY cpDestino
ORDER BY COUNT(*) DESC
LIMIT 20

Analisis geografico:
PARA cada provincia:
cps_no_cubiertos_provincia = COUNT(DISTINCT cpDestino en provincia)
intentos_provincia = COUNT(RegistroCoberturaVacia en provincia)

### Cortes de analisis disponibles
- **Top CPs no cubiertos por frecuencia:** los mas pedidos primero, para priorizar.
- **Por provincia y region:** mapa de zonas con menor cobertura.
- **Por caracteristicas del paquete:** algunos CPs pueden no estar cubiertos para pesos altos pero si para chicos (limitacion de courier especifico).
- **Tendencia temporal:** ¿aparecen CPs nuevos sistematicamente o se estabiliza?
- **Por origen del cliente:** si el cliente tiene multiples depositos, que cobertura tiene cada uno.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: porcentaje de cotizaciones sin cobertura (ej: `4,7% de las cotizaciones quedan sin opciones`).
- Indicador secundario: cantidad absoluta (ej: `342 cotizaciones perdidas en ultimos 30 dias`).
- Estimacion de impacto economico (basada en ticket promedio del cliente).
- CTA: "Ver mapa de cobertura" y "Analizar oportunidades".

**Vista expandida:**

Pestana 1 — **Top oportunidades:** ranking de CPs no cubiertos por frecuencia, con localidad, provincia, y volumen estimado. CTA por fila: "Ver couriers que cubren este CP" para sugerir integraciones.

Pestana 2 — **Mapa de cobertura:** mapa de Argentina con codigo de color: verde (bien cubierto), amarillo (cubierto pero con pocas opciones), rojo (sin cobertura). Identificacion inmediata de zonas problematicas.

Pestana 3 — **Analisis temporal:** ¿estos CPs no cubiertos son sostenidos o picos puntuales? Permite distinguir entre demanda estructural y eventual.

Pestana 4 — **Recomendacion de integracion:** "Si integraras Correo Argentino o OCA, cubririas el 73% de tus CPs no cubiertos actuales. Estimacion de impacto comercial: $X mensual." Esta pestana convierte la metrica en argumento de inversion.

**Interacciones disponibles:**
- Filtros por provincia, peso, rango temporal.
- Exportar listado de CPs no cubiertos para gestiones comerciales o de operaciones.
- Marcar CPs como "aceptados como no cubiertos" si es decision estrategica.

**Estado vacio:**
"Por ahora no se detectaron CPs sin cobertura en la ventana. Tu red de couriers cubre el 100% de la demanda actual."

**Estados de alerta:**
- Si aparece un CP nuevo no cubierto con alta frecuencia, alerta de "demanda emergente sin cobertura".
- Si una zona geografica completa pasa a no estar cubierta (todos los CPs de la zona fallan), alerta critica de "perdida de cobertura zonal" (probable falla de courier integrado).
- Si la tasa de cobertura vacia supera umbral configurado, alerta de "exposicion comercial".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`RegistroCoberturaVacia` se esta poblando consistentemente cada vez que el cotizador detecta cobertura vacia?
- ¿Hay duplicados (mismo CP, misma empresa, mismo periodo) o cada intento queda registrado?
- ¿El campo `origen` permite distinguir entre cotizaciones desde la Plataforma (cliente probando) y desde el e-commerce (comprador real)? El segundo caso es el comercialmente critico.
- Para la recomendacion de integracion, ¿podemos cruzar con cobertura conocida de couriers no integrados? Esto requiere datos externos (cobertura publicada por OCA, etc.) que probablemente no estan en el sistema.
- ¿La estimacion de impacto economico (basada en ticket promedio) es defendible o requiere modelo mas sofisticado?

---

## 4.4 Salud Financiera de la Operacion

### Categoria
Salud financiera del cliente · Riesgo de continuidad operativa

### Definicion operativa
Mide el estado financiero del cliente en relacion a su operacion logistica en Shipro. Especificamente, monitorea el saldo activo (en modalidad prepago), la velocidad de consumo, el tiempo proyectado hasta agotamiento, y la cercania a limites configurados (como `limiteDescubierto`).

No reemplaza la contabilidad del cliente. Es una metrica operativa: "¿Voy a quedarme sin saldo para emitir etiquetas en X dias?". Critica para clientes en modalidad PREPAGO; informativa para clientes POSTPAGO (donde sirve para entender consumo y proyectar facturacion).

### Por que importa para el cliente
Un cliente que se queda sin saldo entra en estado `BLOQUEADO_SALDO`: no puede emitir etiquetas nuevas, lo que paraliza su operacion. Esta metrica anticipa ese momento y permite recargar con tiempo. Para Shipro, tambien es metrica de salud comercial: clientes con consumo creciente son senal positiva, clientes con saldo bajo recurrente requieren conversacion comercial.

Decisiones que habilita:
- ¿Cuanto tiempo me queda con el saldo actual al ritmo actual?
- ¿Mi consumo se acelero o desacelero respecto al mes anterior?
- ¿Estoy cerca de mi `limiteDescubierto`? ¿Deberia recargar antes?
- (Para Shipro) ¿Que clientes estan en zona de riesgo financiero y requieren atencion?

### Diferencial competitivo
Esta metrica es estandar en plataformas SaaS pero rara en plataformas logisticas. Shipro la trae al frente como metrica de salud operativa, no como detalle escondido en facturacion. Refuerza la promesa de transparencia y de operacion sin sorpresas.

### Fuente de datos
- Modelo `Empresa` (schema linea 13): `saldoActivo`, `modalidadPago` (PREPAGO/POSTPAGO), `limiteDescubierto`.
- Modelo `MovimientoFinanciero` (schema linea 356): el ledger completo. `tipo`, `monto`, `saldoPosterior`, `fecha`. Cada debito o credito que afecto el saldo del cliente.
- Modelo `LiquidacionMensual` (schema linea 377): cierres mensuales para clientes POSTPAGO.

### Formula de calculo
Saldo actual (snapshot directo):
saldo_actual = Empresa.saldoActivo

Velocidad de consumo (por ventana):
consumo_ultimos_7d = SUM(MovimientoFinanciero.monto WHERE tipo IN ("DEBITO_ENVIO", "AJUSTE_AFORO"))
consumo_ultimos_30d = SUM(MovimientoFinanciero.monto en ultimos 30d)
consumo_diario_promedio = consumo_ultimos_30d / 30

Dias hasta agotamiento (proyeccion):
SI consumo_diario_promedio > 0:
dias_proyectados = saldo_actual / consumo_diario_promedio
SI consumo_diario_promedio = 0:
dias_proyectados = "indefinido"

Distancia al limite descubierto:
distancia_limite = saldo_actual - limiteDescubierto
(positivo: por encima del limite, negativo: ya en descubierto)

Variacion de consumo:
variacion_consumo = (consumo_ultimos_30d - consumo_anterior_30d) / consumo_anterior_30d × 100

### Cortes de analisis disponibles
- **Por tipo de movimiento:** distinguir debitos de envios, ajustes de aforo, recargas, creditos.
- **Por modalidad de pago:** PREPAGO vs. POSTPAGO tienen consideraciones distintas.
- **Tendencia mensual:** evolucion del saldo y consumo a lo largo de los meses.
- **Por proyeccion:** "Si seguis asi, en X dias te quedas sin saldo".
- **Distribucion del gasto:** que porcentaje del consumo va a que courier, modalidad, deposito.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central segun modalidad:
  - PREPAGO: saldo actual y dias estimados al ritmo actual (ej: `$45.320 · ~18 dias`).
  - POSTPAGO: consumo del mes en curso vs. mes anterior (ej: `$87.430 · ↑ 12% vs mes anterior`).
- Indicador secundario: variacion de consumo respecto a periodo comparable.
- Mini-grafico de evolucion del saldo o del consumo segun corresponda.
- CTA: "Ver detalle financiero" y "Recargar" (si PREPAGO).

**Vista expandida:**

Pestana 1 — **Ledger detallado:** lista cronologica de todos los movimientos (`MovimientoFinanciero`) con tipo, monto, descripcion, saldo posterior. Exportable. Es el extracto financiero.

Pestana 2 — **Analisis de consumo:** desglose de donde va el gasto. Por courier, modalidad, deposito, tipo de envio. Identifica patrones.

Pestana 3 — **Proyeccion y alertas:** simulador "Si mi consumo se mantiene/aumenta/disminuye X%, ¿cuando me quedo sin saldo?". Permite planificar recargas.

Pestana 4 — **Historico de liquidaciones (POSTPAGO):** lista de cierres mensuales pasados con sus facturas y proformas. Reconcilia consumo con facturacion real.

**Interacciones disponibles:**
- Recargar saldo desde la tarjeta misma (si esta integrado pago).
- Configurar alertas personalizadas: "Avisame cuando me queden menos de X dias" o "Cuando el saldo baje de $Y".
- Exportar ledger a formatos contables (CSV, Excel).
- Comparar consumo entre depositos si tiene varios.

**Estado vacio:**
"Necesitamos al menos 7 dias de operacion para calcular consumo promedio."

**Estados de alerta:**
- Si quedan menos de 7 dias proyectados al ritmo actual: alerta amarilla.
- Si quedan menos de 3 dias: alerta roja.
- Si el saldo esta por debajo del `limiteDescubierto`: alerta critica de "operacion en zona de bloqueo inminente".
- Si el consumo se duplica abruptamente respecto a la semana anterior: alerta de "consumo anomalo" para investigar.
- Si hay ajustes de aforo significativos (>10% del consumo del mes): alerta de "fuga de peso impactando consumo".

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿`Empresa.saldoActivo` se actualiza en tiempo real con cada movimiento o tiene latencia?
- ¿`MovimientoFinanciero` se esta poblando consistentemente con cada operacion financiera?
- ¿`saldoPosterior` se calcula al insertar el movimiento o se infiere? Esto afecta exactitud.
- ¿La integracion con sistema de pago para recargas existe o es manual hoy?
- ¿`limiteDescubierto` se esta respetando hoy? Si un cliente cae bajo el limite, ¿el sistema bloquea automaticamente nuevas etiquetas?
- ¿Hay reconciliacion entre `MovimientoFinanciero` y `LiquidacionMensual`? Idealmente la suma de debitos del mes coincide con el monto liquidado.

---

<a id="bloque-5"></a>
# Bloque 5 — Voz del comprador final

Este bloque cierra la Torre de Control con la unica metrica que pone al comprador final en el centro. Mientras los bloques anteriores miden lo que Shipro hace, lo que la cadena entrega, y lo que el cliente decide, este bloque mide lo que el comprador siente. Es la metrica que cierra el circulo: si todo lo anterior esta bien pero el comprador queda insatisfecho, hay algo invisible que estamos perdiendo.

---

## 5.1 Experiencia del Consumidor (NPS Transaccional)

### Categoria
Voz del comprador final · Percepcion de calidad de servicio post-entrega

### Definicion operativa
Mide la experiencia del comprador final despues de recibir su paquete, mediante una encuesta automatica enviada por mail desde `operaciones@shipro.pro`. El comprador puntua varias dimensiones de la experiencia con escalas estandarizadas; el procesamiento de esas respuestas alimenta un conjunto de indicadores que la Plataforma presenta en tiempo real.

La encuesta no es solo "Net Promoter Score" en sentido clasico (¿recomendarias esto a un amigo?). Es una encuesta enriquecida que captura multiples dimensiones porque el modelo de datos en `EncuestaNPS` ya las contempla:

**Score principal (NPS):** 0-10. Categoriza al comprador en Promotor (9-10), Pasivo (7-8), Detractor (0-6). Es la metrica reconocida internacionalmente.

**Experiencia de entrega:** especifica de la calidad del envio. ¿Recibio el paquete en buen estado? ¿En el tiempo prometido? ¿El courier fue cortes?

**Satisfaccion con el producto:** 1-5. Es informacion del cliente, no de Shipro, pero util porque correlaciona con la imagen general del e-commerce.

**Probabilidad de recompra:** 0-10. Mas predictiva del comportamiento futuro que NPS clasico.

**Sugerencia de mejora:** texto libre. La mina de oro cualitativa.

**SLA cumplido:** percepcion del comprador sobre si llego en tiempo. Util para cruzar con la metrica 2.3 (Promesa Calibrada): el cliente dice que cumplio, pero ¿que dijo el comprador?

### Por que importa para el cliente
NPS Transaccional es la metrica que conecta toda la operacion logistica con resultado comercial. Un cliente puede tener excelentes metricas tecnicas (cumplimiento de promesa alto, entrega en primera visita alta, fuga baja) pero NPS bajo. Eso revela algo invisible: la experiencia del comprador final tiene componentes que no se ven en metricas internas (calidad del packaging, comunicacion durante el envio, actitud del courier al entregar).

Inversamente, un cliente con NPS alto sostenido tiene activo comercial real: compradores que recompraran, que recomendaran, que toleraran imperfecciones puntuales. Es la metrica mas predictiva de crecimiento a largo plazo.

Decisiones que habilita:
- ¿Mi operacion esta generando compradores fieles o solo transacciones?
- ¿Que dimension especifica me esta bajando el NPS? ¿Tiempo? ¿Estado del paquete? ¿Trato del courier?
- ¿Cual de mis couriers genera mejor experiencia final?
- ¿Las sugerencias de mejora apuntan a un patron recurrente?
- ¿Tengo detractores que requieren accion de recuperacion inmediata?

### Diferencial competitivo
Aqui Shipro hace tres cosas que las plataformas estandar no:

**Primero, mide en el momento correcto.** El NPS transaccional se envia despues de la entrega, cuando la experiencia esta fresca. No es una encuesta anual generica.

**Segundo, captura multiples dimensiones, no solo un score.** El modelo `EncuestaNPS` ya tiene siete campos distintos. Esto convierte la encuesta en un instrumento de diagnostico, no solo de medicion.

**Tercero, presenta los datos en tiempo real al cliente.** No es un reporte mensual. Es informacion viva que el cliente puede actuar sobre ella inmediatamente, contactando a detractores para recuperacion, identificando patrones emergentes, ajustando operacion basado en feedback reciente.

Y critico: esta data Shipro puede compartirla en agregado con los couriers como herramienta de mejora. "Tu NPS promedio en entregas de Andreani al sur es 7,3; del resto es 8,8. Hay un problema". Eso es valor para todos los actores del ecosistema.

### Fuente de datos
- Modelo `EncuestaNPS` (schema linea 607): la fuente principal. Campos clave: `score` (0-10), `categoria` (Promotor/Pasivo/Detractor, derivado de score), `comentario` (texto libre del comprador), `experienciaEntrega` (1-5), `satisfaccionProducto` (1-5), `probabilidadRecompra` (0-10), `sugerenciaMejora` (texto), `slaCumplido` (boolean), `cpDestino`, `provincia`, `modalidad`, `fechaVoto`.
- Modelo `Envio` (schema linea 397): para cruzar con datos del envio (courier, modalidad, fecha de entrega).
- Modelo `Courier` (schema linea 134): para cortes por courier.
- Modelo `MetricaSLA` (schema linea 677): para cruzar NPS con cumplimiento real de SLA.

### Formula de calculo
**NPS clasico:**
PARA cada respuesta:
SI score >= 9: categoria = "Promotor"
SI score >= 7 Y score <= 8: categoria = "Pasivo"
SI score <= 6: categoria = "Detractor"
NPS = (% Promotores) - (% Detractores)

El resultado esta en escala -100 a +100. Por convencion de industria:
- NPS > 50: excelente
- NPS 0-50: bueno
- NPS < 0: requiere atencion

**Score promedio de experiencia de entrega:**
experiencia_entrega_promedio = AVG(EncuestaNPS.experienciaEntrega)
rango 1-5

**Probabilidad de recompra agregada:**
recompra_promedio = AVG(EncuestaNPS.probabilidadRecompra)
rango 0-10

**Tasa de respuesta a la encuesta:**
encuestas_enviadas = COUNT(Envio donde se envio encuesta)
encuestas_respondidas = COUNT(EncuestaNPS)
tasa_respuesta = (respondidas / enviadas) × 100

La tasa de respuesta es metrica de la metrica: si nadie responde, todos los demas numeros pierden validez estadistica.

**Discrepancia entre SLA real y SLA percibido:**
PARA cada envio con encuesta:
sla_real = MetricaSLA dice que cumplio o no
sla_percibido = EncuestaNPS.slaCumplido (lo que el comprador siente)
casos_discrepancia = COUNT donde sla_real != sla_percibido

Esta es la metrica mas rica del bloque. Cuando difiere, hay algo que aprender:
- Si el SLA real dice "cumplido" pero el comprador dice "no cumplido": comunicacion del envio fue mala.
- Si el SLA real dice "no cumplido" pero el comprador dice "cumplido": el comprador tenia expectativa mas laxa, oportunidad de prometer plazos mas agresivos.

### Cortes de analisis disponibles
- **Por courier:** ranking de couriers ordenado por NPS de los compradores que recibieron envios via cada uno.
- **Por modalidad de entrega:** domicilio vs. sucursal vs. otras. Algunas modalidades pueden tener NPS sistematicamente distinto.
- **Por provincia o region:** mapa de Argentina con NPS por zona.
- **Por rango de score:** analisis especifico de detractores (0-6), promotores (9-10) por separado.
- **Por dimension especifica:** ranking de envios peor evaluados en experiencia de entrega vs. peor evaluados en producto, etc.
- **Por tiempo entre entrega y respuesta:** ¿los compradores que responden rapido tienen NPS distinto que los que responden tarde?
- **Analisis de comentarios:** procesamiento de texto libre (`comentario` y `sugerenciaMejora`) para identificar temas recurrentes.
- **Tendencia temporal:** evolucion del NPS y sus componentes mes a mes.
- **Correlacion con SLA:** como varia NPS cuando el envio llego en tiempo vs. cuando se retraso.

### Experiencia del cliente (UI/UX)

**Vista principal (tarjeta en Torre de Control):**
- Indicador central: NPS actual del periodo (ej: `+47`).
- Distribucion visual de Promotores / Pasivos / Detractores (grafico de barras apilado).
- Indicador secundario: tasa de respuesta (ej: `34% de compradores respondieron`).
- Cambio respecto al periodo anterior (ej: `↑ 3 puntos vs mes anterior`).
- CTA: "Ver analisis completo" y "Atender detractores".

**Vista expandida:**

Pestana 1 — **Atencion a Detractores:** lista de respuestas con score 0-6 ordenadas por fecha. Cada una con datos del envio, score, comentario completo, sugerencia de mejora. Permite al cliente contactar al comprador para accion de recuperacion. CTA por fila: "Marcar como contactado" / "Enviar disculpa" / "Ofrecer compensacion" (si esta integrado con e-commerce del cliente).

Pestana 2 — **Analisis por courier:** comparativa de NPS por courier con volumen de muestras para validez. Tabla que cruza courier × provincia × NPS para identificar puntos debiles especificos.

Pestana 3 — **Analisis por dimension:** desglose del NPS general en sus componentes (experiencia de entrega, probabilidad de recompra). Si NPS general bajo, ¿es por experiencia de entrega o por algo del producto?

Pestana 4 — **Analisis cualitativo:** comentarios y sugerencias agrupados por tema (requerira procesamiento de texto, posiblemente con AI). Permite identificar patrones tipo "muchos compradores mencionan que el packaging llego danado" o "muchos mencionan que el courier no aviso".

Pestana 5 — **Discrepancia SLA real vs. percibido:** casos donde el sistema dice "cumplido" pero el comprador percibio que no, y viceversa. Mina de informacion sobre como se comunica el envio al comprador.

Pestana 6 — **Tendencia y comparativa:** evolucion temporal del NPS y sus componentes. Comparativa con benchmark del rubro si Shipro lo tiene.

**Interacciones disponibles:**
- Filtros por rango de score, courier, modalidad, provincia, rango temporal.
- Accion de recuperacion sobre detractores directamente desde la lista.
- Configurar respuestas automaticas a Promotores (mail de agradecimiento, descuento de fidelidad).
- Exportar analisis para informes ejecutivos.
- Configurar alertas: "Avisame si el NPS cae bajo X" o "Avisame cuando llegue una respuesta de Detractor severo (score 0-3)".

**Estado vacio:**
"Aun no hay suficientes respuestas a la encuesta. Minimo recomendado: 30 respuestas para analisis significativo."

**Estados de alerta:**
- Si el NPS cae mas de 10 puntos respecto al periodo anterior, alerta critica.
- Si llega una respuesta con score 0-3, alerta inmediata para accion de recuperacion.
- Si la tasa de respuesta cae bajo umbral (tipicamente menos de 15-20% indica problema), alerta para investigar (¿el mail llega? ¿el formulario esta roto?).
- Si una dimension especifica baja sostenidamente (ej: experiencia de entrega < 3 promedio), alerta para investigar causa.
- Si un courier especifico muestra deterioro de NPS sostenido, alerta para conversacion con el courier.

### Verificacion tecnica pendiente
Antes de implementar, consultar a Claude Code:
- ¿El sistema de envio automatico de encuestas esta implementado hoy? ¿`/api/cron/rastreo` dispara el mail cuando detecta entrega?
- ¿Cual es el momento exacto del envio? Idealmente entre 24 y 72h despues de la entrega para tener experiencia fresca pero no inmediata.
- ¿`EncuestaNPS` se esta poblando hoy con respuestas reales o el modelo esta creado pero sin uso?
- ¿La pagina de respuesta de la encuesta (donde el comprador completa) existe? ¿Cual es la UX?
- ¿`Envio` tiene flag explicito de "encuesta enviada" para no enviar duplicados?
- ¿Hay forma de re-enviar encuestas a compradores que no respondieron? Esto puede aumentar tasa de respuesta significativamente.
- Para el analisis cualitativo de comentarios, ¿se planea integracion con LLM (ej: clasificacion automatica de temas) o se hace manualmente al inicio?
- ¿La tasa de respuesta historica esta siendo medida? Es importante para validar estadisticamente todas las otras metricas del bloque.

---

<a id="deudas"></a>
# Deudas y refinamientos pendientes

Durante el diseno de la Torre de Control se identificaron dos lineas de trabajo que requieren desarrollo posterior. No bloquean la implementacion de las 16 metricas pero, una vez resueltas, las potencian significativamente.

## Deuda A — Verificacion jerarquica de direcciones en e-commerce con sensibilidad configurable

**Relacionada a:** Metrica 1.2 (Auditar Checkouts).

**Contexto:** La auditoria de Google Maps fue disenada con tres niveles (validacion dura / correccion silenciosa / solicitud al comprador) para evitar mandar mails de correccion al comprador cuando la Plataforma puede resolver la inconsistencia internamente. Esto es critico porque, sin el nivel 2 (correccion silenciosa), un porcentaje muy alto de etiquetas creadas desde e-commerces que no validan direcciones en su propio checkout terminarian forzando friccion al comprador.

**Trabajo pendiente:**
- Implementar la logica de tres niveles si solo existe nivel 1 y nivel 3 hoy.
- Implementar el sistema de sensibilidad configurable por cliente con tres perfiles (laxo / estandar / estricto).
- Disenar el flujo de decision: si la triada (calle + localidad + provincia) es resolvible por Google Maps, aplicar la correccion automatica; solo si no se puede resolver, escalar al comprador.
- Documentar en `lib/geo/geocodificar-direccion.ts` la nueva logica jerarquica.

**Prioridad:** Media-alta. Sin esto, el costo de friccion sobre el comprador puede ser alto en e-commerces con baja calidad de checkout propio.

## Deuda B — Modelo de estacionalidad operativa

**Relacionada a:** Metricas 2.1 (Tiempos Colecta) y 2.3 (Promesa de Entrega Calibrada).

**Contexto:** Eventos comerciales de alta demanda en Argentina (Hot Sale, Cyber Monday, Black Friday, Navidad, Dia del Padre/Madre, Dia del Nino, eventos de cada e-commerce) agregan entre 1 y 2 dias al despacho del cliente y entre 1 y 2 dias al transito del courier. Si la Torre de Control no contempla esta estacionalidad, ocurren dos problemas:

1. La metrica 2.1 muestra degradacion operativa cuando en realidad es saturacion estacional esperable.
2. La metrica 2.3 calibra mal la promesa al comprador: durante Hot Sale, la promesa basada en mediana de 90 dias sera optimista; despues del evento, sera pesimista por arrastre.

**Trabajo pendiente:**
- Modelar un calendario de eventos comerciales argentinos relevantes y permitir que el cliente lo edite.
- Aplicar correcciones de estacionalidad en el motor de promesa calibrada: durante ventanas de evento, usar percentiles especificos del evento previo (Hot Sale 2025 vs. Hot Sale 2026) en lugar del rolling 90d general.
- En la metrica de Tiempos Colecta, distinguir visualmente los periodos de evento para evitar lecturas falsas de degradacion.
- Generar alertas pre-evento: "Hot Sale arranca en 14 dias. Tu promesa actual sera optimista en este periodo. Considera ajustar el nivel de seguridad a 'conservador' temporalmente."

**Prioridad:** Alta para clientes con fuerte estacionalidad comercial (mayoria de e-commerces argentinos). La promesa al comprador durante eventos es donde se gana o se pierde conversion y NPS.

---

<a id="apendices"></a>
# Apendices

## A1 — Glosario tecnico

**NPS (Net Promoter Score):** indice estandar de la industria que mide propension a recomendar. Escala -100 a +100. Categorias: Promotor (9-10), Pasivo (7-8), Detractor (0-6). Formula: % Promotores - % Detractores.

**P50, P75, P95, P99 (Percentiles):** estadisticos de distribucion. P50 es la mediana (50% de los casos por debajo). P95 significa que el 95% de los casos esta por debajo de ese valor. Util para entender "el caso tipico" vs. "el peor caso razonable".

**HHI (Herfindahl-Hirschman Index):** indice de concentracion de mercado adaptado en esta Torre para medir concentracion de couriers. Resultado 0-10.000. HHI bajo significa diversificacion; HHI alto significa concentracion.

**SLA (Service Level Agreement):** acuerdo de nivel de servicio. En logistica, plazo prometido de entrega del courier al cliente y del cliente al comprador.

**Cobertura postal:** capacidad de la red de couriers integrada de cubrir un codigo postal especifico. Cobertura vacia: ningun courier integrado cotiza para ese destino.

**Calibracion:** ajuste continuo de una promesa o umbral basado en evidencia observada. La Torre de Control calibra promesas de entrega, umbrales del auditor de checkout, alertas, entre otros elementos.

**Aforo (peso aforado):** peso facturable que aplica el courier, calculado como el mayor entre peso real y peso volumetrico. La diferencia entre peso declarado al crear etiqueta y peso aforado real es la base de la metrica de Desvio de Peso.

**Cadena logistica completa:** suma del tiempo de despacho del cliente (deposito) mas el tiempo de transito del courier hasta entrega. Compone la promesa al comprador.

**Estado vacio:** estado de una metrica cuando no hay suficientes datos para calcularla con validez estadistica. La Torre de Control comunica honestamente el estado vacio en lugar de mostrar numeros engañosos.

## A2 — Roadmap de implementacion sugerido

El orden propuesto considera tres factores: dependencias entre metricas, complejidad tecnica, e impacto inmediato al cliente.

**Fase 1 — Metricas con backend listo o cuasi-listo:**
- 1.1 Resolver Nomenclador (modelo `Nomenclador` existe)
- 1.2 Auditar Checkouts (modelo `AuditoriaCheckout` existe, requiere implementar nivel 2 — Deuda A)
- 2.3 Promesa de Entrega Calibrada (cron `metricas-sla` ya corre, requiere ampliar granularidad)
- 3.1 Fuga por Ruteo (`FinanzasEnvio.fugaFinanciera` ya se calcula)
- 4.4 Salud Financiera (`Empresa.saldoActivo` + `MovimientoFinanciero` existen)

**Fase 2 — Metricas que requieren agregacion sobre datos existentes:**
- 1.4 Carga de Soporte
- 1.5 Velocidad de Resolucion de Tickets
- 2.1 Tiempos Colecta
- 4.2 Salud de Couriers (`MetricaCourierLatencia` existe pero verificar uso)
- 4.3 Cobertura Postal Activa (`RegistroCoberturaVacia` ya se pobla)

**Fase 3 — Metricas que requieren reconstruccion sobre tracking:**
- 2.2 Efectividad en Primera Visita
- 3.3 Modalidades de Eleccion
- 4.1 Riesgo Courier
- 5.1 NPS Transaccional (requiere verificar si el flow de encuesta esta activo)

**Fase 4 — Metricas que dependen de carga de liquidaciones:**
- 3.2 Desvio de Peso

**Fase 5 — Metricas que dependen de calibracion sobre las anteriores:**
- 1.3 Eficiencia del Auditor de Checkout (requiere outcome real de envios, depende de 2.2 y 5.1)

Cada fase requiere su propia sesion dedicada. La primera metrica a atacar deberia ser 1.1 (Resolver Nomenclador) por simplicidad y porque rapidamente entrega valor visible al cliente.

## A3 — Principios de implementacion

Cuando se implementen las metricas, mantener:

**Endpoints separados por metrica.** No mezclar logica de calculo en un solo endpoint masivo. Cada metrica tiene su propio endpoint bajo `/api/torre-de-control/{nombre-metrica}`. Esto facilita testing, performance, y caching.

**Caching agresivo donde corresponda.** Metricas que no cambian en tiempo real (NPS mensual, tendencias, distribuciones por ventana) pueden cachearse con TTL apropiado.

**Datos como producto, no como reporting.** Antes de codear cada metrica, validar que cada visualizacion sirve para tomar una decision concreta. Si no, se replantea.

**Pruebas E2E del flujo end-to-end.** Cada metrica debe tener al menos un test que valide: query devuelve numero -> endpoint expone numero -> UI lo muestra correctamente -> CTA lleva a accion accionable.

**Documentacion en el codigo.** Cada endpoint de Torre de Control debe tener header comment referenciando a este documento maestro como fuente unica de verdad.

**Supuesto operativo: mapeo de estados como disciplina de onboarding.** Durante el onboarding de cada courier nuevo, mapear todos sus estados crudos a Estados Shipro canonicos es parte del procedimiento operativo de Shipro. Las metricas de la Torre de Control asumen este supuesto. Si un estado crudo aparece sin mapear (ej: por un estado nuevo que el courier agrego despues del onboarding), el cron de rastreo publica el raw string del courier en `Envio.estadoActual` y la metrica 1.1 lo detecta inmediatamente. Esta es feature, no bug: fuerza la accion correctiva. Las metricas downstream (especialmente 2.2 Efectividad en Primera Visita) no requieren consideraciones especiales para envios con estados sin mapear, porque la disciplina de mapeo durante onboarding garantiza que los estados canonicos esten poblados antes de que las metricas se utilicen en operacion real.

---

**Fin del documento.**

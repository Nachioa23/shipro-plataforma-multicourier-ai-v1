# Crons de Shipro — Guía de configuración y deploy

## 1. Introducción

Los **crons** son endpoints HTTP que ejecutan tareas programadas de la plataforma (rastreo automático de envíos, cálculo de métricas SLA). En Shipro están bajo el prefijo `/api/cron/*`.

**Cómo funciona la protección:** la validación está implementada en `proxy.ts` (Next.js 16; antes era `middleware.ts`) — **se ejecuta antes que cualquier handler**. Cualquier request a `/api/cron/*` que no traiga el header `Authorization: Bearer ${CRON_SECRET}` con valor exacto recibe `401 {"error":"Cron secret inválido"}` y nunca llega al handler. Si la variable de entorno `CRON_SECRET` no está definida, **todas** las llamadas reciben 401 (no hay "modo dev sin secret").

Como la protección vive en el proxy, **no requiere ningún cambio adicional al deploy** — basta con tener `CRON_SECRET` en las variables de entorno del servidor de producción.

## 2. Inventario de crons

| Endpoint | Qué hace | Frecuencia recomendada | Timeout esperado |
|---|---|---|---|
| `GET /api/cron/rastreo` | Rastrea hasta 200 envíos activos por ronda. Por cada uno: consulta el courier real, mapea estado vía `Nomenclador`, actualiza `Envio` + crea `EventoTracking`, manda mails (colecta / NPS según transición), genera `TicketSoporte` automático si el envío lleva ≥36hs sin moverse. | Cada **30 minutos** en horario operativo (8-22hs ART). Lote 200 alcanza para volúmenes altos. | Variable según número de envíos activos y latencia de los couriers. Estimado < 60 segundos en operación normal. **No declara `maxDuration` interno** — si en el futuro se nota timeout en algún hosting, ajustar. |
| `GET /api/cron/metricas-sla` | Lee envíos `ENTREGADO` de los últimos 90 días con fechas completas (colecta + entrega). Calcula promedio de horas en tránsito agrupando por `(courierId, provinciaDestino)`. Hace upsert en tabla `MetricaSLA`. | Una vez por día, **horario nocturno** (recomendado 02:00 ART). El comentario en código lo llama "Motor Nocturno de SLA". | < 5 segundos para volúmenes esperados. Idempotente (re-ejecución no rompe nada). |
| `GET /api/cron/sincronizar-couriers` | Sincroniza catálogos de sucursales/servicios de couriers (Andreani, Mocis, futuros) contra sus APIs externas. Mantiene actualizada la red de puntos de retiro y servicios disponibles por courier. También accesible manualmente desde la UI admin en `/api/admin/couriers/[id]/sincronizar`. | Una vez por día, **horario low-traffic** (recomendado 03:00 ART). Catálogos no cambian frecuentemente — diario es suficiente. | < 30 segundos típico. Variable según cantidad de sucursales por courier (Andreani tiene ~500 sucursales activas). Idempotente (upsert por trackingExterno + cp). |

## 3. Configuración para deploy en Linode

### Variables de entorno requeridas en producción

Las siguientes deben estar definidas en el `.env` del servidor (o vía systemd unit / docker secrets, según deploy):

| Variable | Para qué sirve |
|---|---|
| `CRON_SECRET` | Bearer token que valida el proxy. **Distinto al de staging.** |
| `APP_URL` | URL pública de la app (`https://shipro.tu-dominio.com`). Usada por el cron de rastreo para construir links de tracking en los mails. Si no está, hay un fallback a `localhost:3000` (ver DEUDA 14) que rompería los mails. |
| `DATABASE_URL` | Conexión a Postgres / SQLite. |
| `NEXTAUTH_SECRET` | Para sesiones del dashboard. |
| Credenciales de couriers | `ANDREANI_USER`, `ANDREANI_PASS`, `MOCIS_USER`, `MOCIS_PASS`, etc. (Migrarán a BD cuando se haga DEUDA 12.) |

### Opción A — `crontab` del sistema con wrapper script

Esta opción evita que `CRON_SECRET` aparezca en `ps`/`/proc` (riesgo de leak en hosts compartidos).

**Paso 1 — crear el wrapper:** en el servidor, crear `/usr/local/bin/shipro-cron.sh` con permisos `750`, owner del usuario que corre el cron (no root):

```sh
#!/usr/bin/env bash
set -euo pipefail

# Leer secrets desde un archivo fuera del repo, root:600
source /etc/shipro/cron.env  # define CRON_SECRET y APP_URL

# Argumentos: $1 = nombre del endpoint (rastreo | metricas-sla)
ENDPOINT="$1"

curl -fsS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -m 120 \
  "${APP_URL}/api/cron/${ENDPOINT}" \
  >> "/var/log/shipro/cron-${ENDPOINT}.log" 2>&1
```

**Paso 2 — crear `/etc/shipro/cron.env`** (root:600):

```sh
CRON_SECRET=[TU_CRON_SECRET]
APP_URL=https://shipro.tu-dominio.com
```

**Paso 3 — agregar al crontab del usuario que corre la app** (`crontab -e`):

```cron
# Rastreo: cada 30 min, 8-22hs (ART = UTC-3)
*/30 8-22 * * * /usr/local/bin/shipro-cron.sh rastreo

# Métricas SLA: 02:00 ART todos los días
0 5 * * * /usr/local/bin/shipro-cron.sh metricas-sla
```

> **Nota de zona horaria:** si el server corre en UTC (default Linode), `02:00 ART` = `05:00 UTC`. Si configuraste el server en `America/Argentina/Buenos_Aires`, usar `0 2 * * *` directo.

**Paso 4 — preparar el directorio de logs** (una sola vez):

```sh
sudo mkdir -p /var/log/shipro
sudo chown shipro-user:shipro-user /var/log/shipro
sudo touch /var/log/shipro/cron-rastreo.log /var/log/shipro/cron-metricas-sla.log
```

(Reemplazar `shipro-user` por el usuario real que corre la app.)

### Opción B — `cron-job.org` externo

Servicio externo gratuito (hasta 50 jobs / 30s mínimos). Útil si **no** querés mantener crontab en el servidor (ej: deploys en contenedores donde el cron del host no aplica).

**Pasos:**

1. Crear cuenta en https://cron-job.org y agregar el dominio de la app.
2. Crear un **Cronjob nuevo** por cada cron (2 en total).
3. Configurar:
   - **Title:** `Shipro Rastreo`
   - **URL:** `https://shipro.tu-dominio.com/api/cron/rastreo`
   - **Schedule:** Custom → `*/30 8-22 * * *`
   - **Request method:** GET
   - **Advanced → HTTP Headers:**
     - Name: `Authorization`
     - Value: `Bearer [TU_CRON_SECRET]`
   - **Save responses:** activar (te permite ver el JSON de respuesta y debuggear si falla).
   - **Notifications on failure:** activar mail.
4. Repetir para `Shipro Métricas SLA`:
   - **URL:** `https://shipro.tu-dominio.com/api/cron/metricas-sla`
   - **Schedule:** `0 5 * * *` (02:00 ART = 05:00 UTC)

**Limitación a tener en cuenta:** el secret queda almacenado en cron-job.org. Si la cuenta del servicio se compromete, el atacante puede ejecutar los crons (no hay riesgo de data exfiltration directa porque los crons no devuelven datos sensibles, pero sí podrían generar carga sobre los couriers o spamear mails de NPS si se ejecutan repetidamente). Mitigar usando un secret distinto al del crontab del sistema y rotando si hay sospecha de leak.

## 4. Configuración para deploy en Vercel (alternativa)

Si en el futuro la plataforma migra a Vercel, la configuración nativa es vía `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/rastreo",
      "schedule": "*/30 8-22 * * *"
    },
    {
      "path": "/api/cron/metricas-sla",
      "schedule": "0 5 * * *"
    }
  ]
}
```

**Cómo Vercel maneja el secret:**

Vercel inyecta automáticamente el header `Authorization: Bearer ${CRON_SECRET}` en las requests que dispara contra los endpoints listados en `crons`. Solo hay que:

1. Definir `CRON_SECRET` en **Project Settings → Environment Variables** (production environment).
2. Hacer redeploy para que Vercel lea la variable.

No hay que crear wrappers ni servicios externos. **Limitaciones del plan free:** schedule mínimo es diario (no cada 30 min). Para nuestro `rastreo` cada 30 min hace falta plan **Pro** (USD 20/mes/miembro). Si se va a Vercel free, hay que combinar con cron-job.org externo o aceptar `rastreo` 1x/día (UX peor).

**Limitación adicional Vercel:** función serverless tiene timeout 10s en free, 60s en Pro, 300s en Enterprise. El cron de `rastreo` con 200 envíos puede acercarse al límite Pro si los couriers están lentos — monitorear post-migración.

## 5. Verificación post-deploy

Estos 3 tests fueron corridos contra `localhost:3000` el 2026-04-29 con el dev server activo. Replicarlos contra la URL de producción cambia solo el host.

### Test 1 — Sin header `Authorization` → debe ser 401

```sh
curl -i https://shipro.tu-dominio.com/api/cron/metricas-sla
```

**Output esperado (verificado):**

```
HTTP/1.1 401 Unauthorized
content-type: application/json
...
{"error":"Cron secret inválido"}
```

### Test 2 — Bearer incorrecto → debe ser 401

```sh
curl -i -H "Authorization: Bearer secret-mal-a-proposito" \
  https://shipro.tu-dominio.com/api/cron/metricas-sla
```

**Output esperado (verificado):**

```
HTTP/1.1 401 Unauthorized
content-type: application/json
...
{"error":"Cron secret inválido"}
```

### Test 3 — Bearer correcto → debe ser 200 con JSON del cron

```sh
curl -i -H "Authorization: Bearer [TU_CRON_SECRET]" \
  https://shipro.tu-dominio.com/api/cron/metricas-sla
```

**Output esperado (verificado contra dev):**

```
HTTP/1.1 200 OK
content-type: application/json
...
{"mensaje":"Sin datos suficientes para procesar métricas."}
```

> En staging/producción con datos reales el body cambia a algo como `{"mensaje":"Métricas SLA actualizadas exitosamente","rutasProcesadas":N,"totalEnviosAnalizados":M}`. Lo importante es el **status 200** (= proxy dejó pasar y el handler ejecutó).

### Troubleshooting

| Síntoma | Causa probable | Cómo verificar |
|---|---|---|
| Test 1 da 200 en lugar de 401 | `CRON_SECRET` no está definido en el env del servidor (el proxy bloquea, pero quizás otro layer está respondiendo 200 — improbable, revisar logs). | `curl -i` y mirar `x-vercel-id` u otros headers de capa intermedia. Confirmar `printenv CRON_SECRET` en el servidor. |
| Test 3 da 401 con bearer correcto | El valor de `CRON_SECRET` en el servidor no coincide con el que pasaste. Atención a espacios/saltos de línea al copiar. | Comparar exactamente: `echo -n "$CRON_SECRET" \| md5sum` en server y local. |
| Test 3 da 200 pero el cron no hace nada | Comportamiento esperado del cron `metricas-sla` cuando no hay envíos `ENTREGADO` con fechas completas en los últimos 90 días. | Body devuelve `"Sin datos suficientes..."`. Esperar tener envíos reales antes de re-testear. |
| Test 3 da 500 | Error en el handler (ej: BD caída, credencial de courier inválida). | Revisar logs del servidor: `tail -f /var/log/shipro/cron-rastreo.log` (Linode) o **Vercel → Logs** (si Vercel). |
| Cron no se dispara automáticamente | Crontab del sistema no levantó / cron-job.org pausado / vercel.json no commiteado al deploy. | Linode: `grep CRON /var/log/syslog`. cron-job.org: dashboard del job → "Last execution". Vercel: tab "Crons" del project. |

## 6. Notas importantes

- **`APP_URL` debe estar configurada en producción.** Si se olvida, los mails de colecta y NPS que dispara el cron de rastreo van con links a `http://localhost:3000/s/...` (fallback hardcodeado, ver DEUDA 14 en `DEUDAS.md`). Es un riesgo silencioso: el cron responde 200 OK pero los clientes reciben mails con links rotos.
- **`CRON_SECRET` debe ser DISTINTO en staging y producción.** Generar con `openssl rand -hex 32` por entorno. Si se filtra el de producción, rotar inmediatamente y actualizar el cronjob (crontab del server, cron-job.org, o Vercel env).
- **Nunca commitear `.env.local`** ni ningún archivo con secrets a git. Si se filtró por accidente: rotar todos los secrets afectados, hacer history rewrite con `git filter-repo` (o BFG), force push, y considerar el repo entero comprometido (revisar si fue público).
- **Rotación periódica** recomendada: cada 90 días o ante sospecha de leak. Procedimiento: generar nuevo secret → actualizar `.env` del servidor → reiniciar app → actualizar cron-job/crontab/Vercel env → verificar Test 3 con el nuevo bearer.
- **Logs:** los crons no escriben logs estructurados hoy (solo el body de respuesta). Si los volúmenes crecen, considerar agregar un logger por cron — deuda futura, no bloqueante.
- **Idempotencia:** `metricas-sla` es 100% idempotente (upsert). `rastreo` es **casi** idempotente — si se dispara dos veces consecutivas, la segunda no hace nada nuevo (los envíos ya se actualizaron), pero podría reenviar mails si el `EventoTracking` se duplicara (no debería pasar en condiciones normales). No correr crons manualmente en producción salvo para debugging.

## 7. Flujo del Nomenclador (mapeo de estados crudos del courier)

El **Nomenclador** es la tabla en BD (`prisma.nomenclador`) que traduce estados raw de couriers (Andreani, Mocis, futuros) al **catálogo canónico Shipro F1** definido en `lib/utils/estados.ts` (`ESTADOS_COURIER` con 11 entries).

### Cómo se puebla

1. **Auto-creación por el cron `rastreo`:** cuando el cron consulta el estado de un envío via `motorCourier.rastrear(tracking)` y recibe un `estadoCrudo` nuevo (no presente en la tabla), crea automáticamente una entry con `estadoShipro: null` en `Nomenclador`. El envío queda con el `estadoCrudo` raw mientras el mapeo no se complete.
2. **Mapeo manual por admin Shipro:** desde la UI `/nomenclador` (admin only), el `usuario_Shipro` asigna progresivamente cada `estadoCrudo` a una key canónica del catálogo F1 (e.g., `EN_TRANSITO_A_DESTINO`, `VISITA_FALLIDA`, `INCIDENCIA`).
3. **Observabilidad via Métrica 1.1:** la Torre de Control expone "Resolver Nomenclador" (card 1) que muestra % de cobertura simple + ponderada por frecuencia + top N estados sin mapear ordenados por impacto. Sirve de checklist priorizado para el admin.

### Por qué no se completa anticipadamente

- **El catálogo de estados crudos varía por courier y evoluciona.** Andreani y Mocis tienen subconjuntos distintos; futuros couriers traen los suyos.
- **No requiere mapeo masivo upfront.** Cada estado crudo nuevo que aparece se mapea cuando se ve. El cron registra y la métrica reporta — no bloquea operación.
- **Decisión arquitectónica (F5, 2026-06-09):** los adapters de courier (`AndreaniAdapter`, `MocisAdapter`) ahora retornan canónicas F1 directamente desde `traducirEstado()`. El Nomenclador queda como **mapeo de referencia y para casos legacy / imports externos** (e.g., importación de envíos desde Excel del cliente con strings de estado arbitrarios).

### Validación que NO se hace hoy

- El POST `/api/nomenclador` **no valida** que el `estadoShipro` asignado sea una key canónica F1. Acepta cualquier string. Es responsabilidad del admin elegir desde el dropdown del UI (que sí está conectado al catálogo F1 desde F4.1).
- Si un admin futuro escribe el POST a mano con `estadoShipro: "lalala"`, queda persistido. Mitigación: el helper F1 `normalizarEstadoCourier` retorna `null` para strings desconocidos, y los consumidores caen al fallback. No es bloqueante operativamente.

### Estado actual de la BD (al 2026-06-09)

Producción todavía no operativa. En dev local, `Nomenclador` tiene ~1 entry de seed (`"Robo a mano armada" / SIN_ROB_01 / null`). Se irá poblando organicamente cuando los crons corran contra envíos reales con tracking activo en producción.

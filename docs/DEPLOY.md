# DEPLOY.md — Runbook de deploy a producción (Shipro 2.0)

> **Documento operativo.** Materializa el runbook que el `APRENDIZAJE DE DEPLOY` de `DEUDAS.md:2553-2578` pidió explícitamente ("Añadir al runbook de deploy cuando se materialice como documento propio").
> **Primera versión**: 2026-10-14, verificada contra el deploy del batch FASE 2 motor de reglas (16 commits + 2 migraciones de schema).
> **Fuente del rebuild limpio**: `DEUDAS.md:2553-2578` (registrado 2026-08-04 por DEUDA 106 pieza 2).

---

## Conexión al server

- **Hostname público**: `pm.shipro.pro`.
- **IP**: `172.233.20.199`.
- **Hosting**: Linode.
- **Ruta de la app**: `/var/www/shipro`.
- **`.env` de producción**: `/var/www/shipro/.env` (incluye `SECRET_ENCRYPTION_KEY`, `CRON_SECRET`, `MERCADOLIBRE_CLIENT_ID/_SECRET`, etc.).
- **Conexión**: `ssh <usuario>@172.233.20.199` (o `ssh <usuario>@pm.shipro.pro`).

**Credenciales SSH**: el usuario + key viven en la Mac de Nacho. **NO se documentan acá** por política de seguridad — el runbook es público en el repo.

**Process manager**: `pm2`, process name **`shipro`** (id típico 0 pero varía). `pm2` identifica por nombre, **no por id** — los números `#80 / #84 / #86` que aparecen en comments históricos de DEUDAS.md son el contador incremental de `pm2` y cambian cada restart.

---

## Flujo de deploy (8 pasos verificados)

### Paso 1 — (Local) Push a GitHub

```bash
git push
```

Sube los commits a `origin/main`. **No cambia prod**: prod se despliega desde el server haciendo pull en el paso 4.

### Paso 2 — (Server) Conectarse y validar directorio

```bash
ssh <usuario>@172.233.20.199
cd /var/www/shipro
pwd && git status
```

Confirmar que `pwd` dice `/var/www/shipro` y `git status` muestra la rama `main` sin working-tree dirty (si hay archivos modificados sin commitear en prod, **PARAR** y diagnosticar — alguien editó algo a mano).

### Paso 3 — (Server) Fetch + ver commits pendientes

```bash
git fetch && git log --oneline HEAD..origin/main | cat
```

**Por qué `fetch` + diff explícito**: `git status` puede mostrar "up to date" con info vieja (del último fetch); `git fetch` refresca y el `log HEAD..origin/main` lista exactamente qué commits traerá el pull. **Verificar**:
- Que los commits son los que esperás (match con `git log --oneline -N` en tu Mac post-push).
- Que ningún commit es de otro chat con trabajo a medias (ej. un `WIP` o un commit solitario de un side-chat).
- Que `HEAD..origin/main` **NO está vacío** — si está vacío, el push no llegó o ya se deployó antes.

### Paso 4 — (Server) Pull

```bash
git pull
```

Debe ser **Fast-forward** sin `CONFLICT`. Si tira conflict (prod divergió del origin — alguien editó en el server), **PARAR** y diagnosticar con `git log --oneline -10` + `git diff` antes de proceder.

### Paso 5 — (Server, SOLO si cambió el schema) Aplicar migraciones

```bash
npx prisma migrate deploy
```

**Reglas duras**:
- **NUNCA `prisma migrate dev` en prod**. `migrate deploy` es la variante prod-safe: aplica solo migraciones ya generadas, no genera nuevas, no pide input, no permite reset.
- **NUNCA aceptar un reset**. Si Prisma pregunta algo tipo "do you want to reset the database?" **PARAR** inmediatamente — es señal de drift (schema en prod divergió del schema de las migraciones) y requiere diagnóstico profundo antes de tocar nada.
- **Esperar el mensaje final**: `"All migrations have been successfully applied"` (o `"No pending migrations to apply"` si ya estaban).

**Cómo saber si el schema cambió**: antes de deployar, mirar `git log --oneline --stat HEAD..origin/main` o `git diff HEAD..origin/main --stat` localmente — si aparece `prisma/schema.prisma` o `prisma/migrations/`, el paso 5 corre; si no, se puede saltar.

### Paso 6 — (Server, SOLO si cambió el schema) Regenerar cliente Prisma

```bash
npx prisma generate
```

Regenera `node_modules/@prisma/client` contra el schema actualizado. **Si se omite** después de un `migrate deploy`, el build siguiente puede tirar `Property 'X' does not exist on type 'YWhereInput'` (confirmado en el aprendizaje de DEUDA 106 pieza 2, `DEUDAS.md:2559`).

### Paso 7 — (Server) Rebuild

**Decisión binaria según qué tocó el deploy**:

#### 7A — REBUILD LIMPIO (obligatorio si tocó `proxy.ts` O el schema Prisma)

```bash
rm -rf .next
npm run build
```

El `rm -rf .next` fuerza a Next a recompilar middleware + rutas desde cero. Sin él, el `proxy.ts` compilado puede quedar cacheado con la lista vieja de rutas públicas (confirmado DEUDA 106 pieza 2, `DEUDAS.md:2558`) o los tipos del cliente Prisma pueden quedar viejos. Toma 2-3 minutos más que el incremental, pero es la diferencia entre "deploy limpio" y "deploy con regresiones sutiles que se descubren probando el flujo en prod".

#### 7B — Rebuild incremental (si NO tocó `proxy.ts` NI schema)

```bash
npm run build
```

Reusa el `.next/` existente. Más rápido. Válido solo cuando el deploy es puramente TypeScript/TSX de app code sin cambios de infra.

**Fuente de la regla 7A vs 7B**: `DEUDAS.md:2572` — *"Para deploys que NO tocan `proxy.ts` NI el schema el flujo incremental sigue sirviendo; el rebuild limpio es específicamente para los dos triggers de arriba."*

### Paso 8 — (Server) Restart pm2

```bash
pm2 restart shipro
```

**Agregar `--update-env` SOLO si cambiaron env vars** en `/var/www/shipro/.env`:
```bash
pm2 restart shipro --update-env
```

Sin `--update-env`, pm2 reusa las env vars del proceso viejo — rápido pero no refresca nada nuevo del `.env`.

**Confirmar status**:
```bash
pm2 status shipro
```

Debe mostrar `status: online`. Si muestra `errored` o `stopped`, **PARAR** y ver los logs (siguiente sección).

---

## Verificación post-deploy

### Logs del arranque

```bash
pm2 logs shipro --lines 40 --nostream
```

**Qué buscar y qué significa**:
- `PrismaClientValidationError` o `"Unknown argument"` → señal de cliente Prisma desincronizado. **No debería aparecer** si el paso 6 (`prisma generate`) corrió. Si aparece, repetir pasos 6-8.
- `Error: ECONNREFUSED` al Postgres → chequear que el `.env` tiene la `DATABASE_URL` correcta.
- Errores de env vars faltantes (`throw new Error("Falta MERCADOLIBRE_CLIENT_ID")` etc.) → cargar la env var en `/var/www/shipro/.env` y reiniciar con `--update-env`.

### Smoke test manual

Abrir `https://pm.shipro.pro` en el navegador (modo incógnito recomendado para evitar cache de sesión vieja) y ejercitar la feature deployada:
- **Deploys que tocan el motor de reglas / cotizador**: ir a `/admin-couriers` → crear/editar una regla → verificar que persiste.
- **Deploys que tocan `/corregir` o el flow de cliente**: hacer un envío de prueba desde dashboard admin.
- **Deploys que tocan plugins TN/ML**: coordinar con Chat C/D para prueba e2e.

### Verificación de que las migraciones aplicaron

Opcional pero recomendado para deploys con schema change:
```bash
npx prisma migrate status
```

Debe decir `Database schema is up to date!`. Si dice `Following migrations have not yet been applied`, el paso 5 no corrió o falló silenciosamente.

---

## Errores benignos conocidos (NO son del deploy)

Estos aparecen en logs pero **no indican un problema del deploy en sí** — son estado del sistema o ruido post-restart esperable:

### `[cotizador] courier falló: Falló la autenticación con Andreani`
- **Causa**: credenciales Intralog↔Andreani en gestión con Intralog (relación comercial, no técnica).
- **Impacto**: el cotizador cae al fallback de tarifa de respaldo per courier — el cliente sigue vendiendo.
- **Acción**: ninguna del lado del deploy; se resuelve cuando Nacho reciba credenciales nuevas. Ver DEUDA 147.

### `Failed to find Server Action ... older or newer deployment`
- **Causa**: usuarios con pestañas abiertas desde antes del restart tienen el bundle viejo; al disparar una Server Action, el server (ya con bundle nuevo) no encuentra el id correspondiente.
- **Impacto**: cosmético — el usuario recarga la página y vuelve a funcionar.
- **Acción**: ninguna. Desaparece a los pocos minutos conforme los usuarios refrescan.

---

## Señales de ALERTA (parar y diagnosticar)

Estos sí son señales reales de que algo salió mal durante el deploy. **PARAR** y diagnosticar antes de seguir:

- **`migrate deploy` tira `error`, `failed`, `P3009` (migración abandonada), `drift detected` o pregunta por un reset**: el schema de prod divergió del repo. **NUNCA aceptar reset** sin diagnosticar la divergencia primero (puede implicar pérdida de data).
- **`npm run build` tira `Failed to compile`**: el deploy abortó, la app vieja sigue viva (porque no se restartió pm2). Mejor que una app rota, pero hay que fixear el error de compile antes de reintentar. No hacer `pm2 restart` con un `.next/` corrupto.
- **`pm2 status` muestra `errored` o `stopped`** en vez de `online`: la app arrancó pero se cayó, o directamente no arrancó. Ver `pm2 logs shipro --lines 100 --nostream` para la stack trace del crash.
- **El smoke test manual falla en producción pero funcionaba en localhost**: podría ser cache de CDN (si hubiera uno), env var faltante en prod, o drift post-deploy. Diagnosticar antes de rollback.

### Si hay que rollbackear

**No hay runbook formal de rollback todavía** (ver sección "Gaps" abajo). El procedimiento manual improvisado:

1. `git log --oneline -5` para ver los commits.
2. `git reset --hard <hash-del-commit-anterior-al-deploy>` (destructivo — pierde los commits del deploy local; el repo origin no se toca).
3. Si hubo migraciones aplicadas, **NO existe `prisma migrate down`** — habría que escribir un SQL manual que revierta los `ADD COLUMN` / `CREATE TABLE`. Para migraciones aditivas puras (como las de este deploy) el rollback es "dejar la columna/tabla sin uso" + reset del código — las columnas nullable no rompen nada estando ahí.
4. Rebuild + restart.

**Prefereible**: fix forward (nuevo commit que corrige el problema) en vez de rollback. Las migraciones aditivas raramente ameritan rollback destructivo.

---

## Gaps conocidos (mejoras futuras del runbook)

- **No hay script `scripts/deploy.sh`** que automatice los 8 pasos. Todo manual, con riesgo de olvidar un paso bajo presión. Candidato para una pieza futura.
- **No hay runbook de rollback formal** si una migración falla a medio aplicar. La improvisación de la sección anterior cubre el 80% de los casos; falta documentar los casos borde.
- **No hay backup pre-migración documentado**. Práctica recomendada para deploys con schema change: snapshot de Postgres antes del paso 5. Linode tiene snapshots manuales — no está automatizado ni documentado.
- **El comando `ssh` exacto (usuario + ruta de key) vive solo en la Mac de Nacho**. Si Nacho no está disponible y hay que deployar urgente, falta el handoff. Mitigación provisoria: compartir el acceso con un segundo humano del equipo.
- **No hay health check automatizado post-deploy** (ej. `curl -f https://pm.shipro.pro/api/health` o similar). El endpoint de health check tampoco existe hoy. Candidato para una obra chica.
- **No hay registro automatizado de qué se deployó cuándo**. Hoy la trazabilidad es `git log` + los commits + los números `#NN` de pm2 en comments viejos de DEUDAS.md. Un `DEPLOY_LOG.md` con entrada por deploy sería incremental.

---

## Fuentes del repo

- `DEUDAS.md:2553-2578` — APRENDIZAJE DE DEPLOY original (rebuild limpio obligatorio, triggers proxy.ts/schema).
- `DEUDAS.md:4474, 4495` — ejemplos de deploys reales con comandos verbatim.
- `DEUDAS-RESUELTAS.md:2072` — rebuild limpio para DEUDA 132 (3 migraciones).
- `DEUDAS.md:2730` — IP del server + hostname.
- `DEUDAS.md:4475, 4530, 4554` — ruta `/var/www/shipro` + `.env` de prod.
- `docs/POLITICAS-TECNICAS.md` — política de `prisma migrate dev` para DEV (NO para prod — este archivo complementa esa guía con el flujo prod-safe).

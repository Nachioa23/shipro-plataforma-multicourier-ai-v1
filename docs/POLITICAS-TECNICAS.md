# Políticas técnicas de la plataforma Shipro

Este documento concentra las decisiones de arquitectura y seguridad que aplican
transversalmente al código de Shipro. Cuando se introduce una política nueva,
se documenta acá; cuando se cambia, se actualiza la sección correspondiente
con la fecha del cambio.

---

## Política: Defense-in-depth en endpoints con permisos

**OBLIGATORIO:** cualquier endpoint que tenga lógica de permisos diferenciados por rol **DEBE** validar el rol en el backend, incluso si la UI ya filtra/esconde el campo.

### Razón

La UI puede ser bypaseada — DevTools, `curl`, scripts maliciosos, integraciones API directas. El backend es la única capa de seguridad real. Confiar en el frontend para filtrar acciones sensibles es equivalente a no tener seguridad.

### Patrón establecido

1. **UI** esconde o deshabilita campos según rol del usuario logueado.
2. **Backend** lee `x-rol` del header (inyectado por `proxy.ts` desde el JWT) y valida antes de aplicar el cambio.
3. Si el rol no tiene permiso: **ignorar silenciosamente** el campo (no devolver error 403). Razones:
   - No exponer la lógica de permisos a un atacante que está sondeando el endpoint.
   - Permitir requests con campos extra sin romper compatibilidad (clientes legacy, tests, etc.).
   - Mantener la respuesta exitosa para que el flow del usuario no se interrumpa.

### Casos donde aplicar

- Cambios que solo `admin_shipro` puede hacer (ej: `tipoCuenta` en `/api/configuracion/couriers`, ver DEUDA 16).
- Endpoints de configuración sensible: credenciales de courier, saldo, reglas de ruteo, modalidad de pago, configuración de billetera.
- Cualquier acción con impacto financiero (recargas, débitos, ajustes de saldo) o de seguridad (rotación de API Keys, cambio de roles).
- Endpoints administrativos (`/api/admin/*`) — siempre validar `x-rol` aunque el proxy los proteja por sesión, porque el proxy autentica que es un usuario válido pero no que tenga el rol específico.

### Cómo NO aplicar la política (anti-patrones)

- ❌ Confiar solo en `if (user.rol === 'admin') showField()` en frontend sin validación backend.
- ❌ Usar el rol del **body** de la request (es manipulable). Siempre del header `x-rol` inyectado por proxy.
- ❌ Devolver 403 detallado que diga "necesitás rol admin_shipro" — ignorar el campo silenciosamente es preferible.
- ❌ Hacer la validación al final del handler (después de cargar data o ejecutar queries) — validar al inicio para no desperdiciar trabajo.

### Ejemplo de implementación

Ver `app/api/configuracion/couriers/route.ts` (introducido en DEUDA 16):

```ts
export async function POST(request: Request) {
  const body = await request.json();

  // Defense-in-depth: tipoCuenta solo lo modifica admin_shipro.
  // Para otros roles se ignora silenciosamente — el frontend tampoco
  // lo muestra/edita para esos roles.
  const rol = request.headers.get("x-rol") || "";
  const puedeEditarTipoCuenta = rol === "admin_shipro";

  // ...
  const tipoCuentaPatch = puedeEditarTipoCuenta
    ? { tipoCuenta: body.courier.tipoCuenta || null }
    : {};

  await prisma.credencialCourier.upsert({
    // ...
    update: { /* otros campos */, ...tipoCuentaPatch },
    create: { /* otros campos */, ...tipoCuentaPatch },
  });
}
```

Si llega un POST con `tipoCuenta: "PREPAGO"` y el rol no es `admin_shipro`, el campo se omite del upsert sin que el cliente reciba error. La UI ve "guardado exitoso" pero `tipoCuenta` no se modificó en BD.

### Auditoría futura (DEUDA 19)

Cuando se implemente el sistema de auditoría de cambios sensibles (DEUDA 19), todo callsite que aplique esta política debe registrar también:
- Quién hizo el cambio (usuario, rol)
- Qué intentó cambiar y qué se aplicó realmente
- Si hubo intento de bypass (rol incorrecto que mandó campo restringido) — flagear para revisión

Mientras DEUDA 19 no está implementada, los intentos de bypass se ignoran sin registro. Aceptable mientras el equipo de Shipro sea chico; revisitar antes de onboarding masivo de clientes.

---

## Política: Reiniciar dev server después de `prisma migrate dev`

**OBLIGATORIO:** después de correr `npx prisma migrate dev` (o cualquier comando que cambie el schema y regenere `@prisma/client`), **reiniciar el dev server** (`npm run dev`) antes de probar la funcionalidad nueva.

### Razón

Next.js 16 con Turbopack cachea agresivamente los módulos compilados — incluyendo el cliente Prisma generado en `node_modules/@prisma/client`. Si la migración cambió el schema (columnas nuevas, nullability, etc.) pero el dev server sigue corriendo con el cliente viejo en memoria:

- Las queries Prisma pueden fallar con errores tipo `PrismaClientValidationError: Argument <X> is missing` o `Unknown argument <Y>`.
- Los handlers reportan errores 500 con stack traces que **no corresponden al código actual del archivo**.
- El error es indistinguible de un bug real de código — perdés tiempo buscando un bug que no existe.

Documentado el 2026-04-30 (DEUDA 16): un error "Falla al guardar la red" en `/mis-transportes` se atribuyó inicialmente a bug de código. La inspección del SELECT post-restart mostró que la persistencia funcionaba — el error era cache de Turbopack pre-restart con el cliente Prisma anterior.

### Procedimiento estándar después de una migration

```sh
# 1. Detener el dev server con Ctrl+C
# 2. Aplicar la migration
npx prisma migrate dev --skip-seed

# 3. (Implícito en migrate dev): regeneración del cliente
# ✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client

# 4. Reiniciar el dev server
npm run dev

# 5. Recién ahora, probar la funcionalidad nueva
```

### Cómo NO aplicar

- ❌ Correr `prisma migrate dev` con el dev server activo y suponer que va a recargar solo. Turbopack mantiene módulos en memoria; la regeneración del cliente Prisma no invalida ese cache automáticamente.
- ❌ Solo guardar archivos `.ts` para forzar HMR — el cliente Prisma generado vive fuera del watched paths estándar.

### Cuándo NO hace falta

- Cambios en código TypeScript/TSX que no toquen schema: HMR funciona normal.
- Cambios en data via SQL directo (`sqlite3 prisma/dev.db < script.sql`) sin tocar schema: el cliente sigue válido.
- Cambios solo en `seed.ts` corridos manualmente: no afectan al cliente generado.

### Síntomas de que olvidaste reiniciar

Si después de una migration ves alguno de estos síntomas, primer paso es **siempre** reiniciar dev server antes de buscar bugs:

- `PrismaClientValidationError` con campos que sí existen en `schema.prisma`.
- 500 al guardar/leer datos en endpoints que tocan tablas modificadas.
- Tipos TS aceptan campos nuevos (porque el editor lee el schema fresh) pero runtime los rechaza (porque el server tiene el cliente viejo).
- Los `console.log` que agregás no aparecen en terminal — el server está sirviendo build cacheado, no el código actual.

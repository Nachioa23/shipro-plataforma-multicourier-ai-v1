// ============================================================================
// HELPER — REVERSIBLE SECRET ENCRYPTION (AES-256-GCM)
//
// Encripta y desencripta secretos que Shipro debe RECUPERAR después (a
// diferencia de las apiKeys del cliente, que se hashean one-way con HMAC-SHA256
// en apikey-hash.ts). Caso de uso primario: el accessToken permanente que
// Tiendanube nos entrega tras el OAuth de instalación — hay que guardarlo para
// hablarle a la tienda en el futuro (crear etiquetas, mandar tracking events).
//
// TIPO: distinta herramienta que apikey-hash. Ese es one-way (verificación por
// re-hash). Este es reversible (necesitamos el plaintext para llamar a Tiendanube).
// Ambas viven en lib/utils/ pero cubren usos ortogonales.
//
// ALGORITMO: AES-256-GCM (authenticated encryption). GCM adjunta un auth tag
// que se verifica al desencriptar — si el ciphertext o el IV fueron alterados,
// crypto.decipher.final() lanza excepción. Detección de tampering gratis.
//
// KEY: viene de process.env.SECRET_ENCRYPTION_KEY, un hex de 64 chars = 32 bytes
// (=256 bits). Se genera con: openssl rand -hex 32
//
// FORMATO DEL PAYLOAD ENCRIPTADO (string único, portable en columnas TEXT):
//   "<iv_hex>:<ciphertext_hex>:<auth_tag_hex>"
//   - iv:         12 bytes (24 chars hex) — 96-bit IV recomendado por NIST para GCM.
//                 Aleatorio por llamada → mismo plaintext produce ciphertext distinto.
//   - ciphertext: N chars hex (variable, sin padding en GCM).
//   - auth_tag:   16 bytes (32 chars hex) — auth tag GCM estándar.
//
// USO TÍPICO:
//
//   import { encryptSecret, decryptSecret } from "@/lib/utils/secret-crypto";
//
//   // Al guardar (post OAuth de Tiendanube):
//   const accessTokenPlain = respuestaOAuth.access_token;
//   await prisma.tiendaTiendanube.upsert({
//     where: { storeId },
//     update: { accessToken: encryptSecret(accessTokenPlain), estado: "instalada" },
//     create: { storeId, empresaId, accessToken: encryptSecret(accessTokenPlain) },
//   });
//
//   // Al leer (para llamar a Tiendanube):
//   const tienda = await prisma.tiendaTiendanube.findUnique({ where: { storeId } });
//   const token = decryptSecret(tienda!.accessToken!);
//   fetch(url, { headers: { Authorization: `Bearer ${token}` } });
//
// SEGURIDAD OPERATIVA:
// - Si la SECRET_ENCRYPTION_KEY se compromete, todos los tokens encriptados son
//   recuperables por el atacante. Rotar la key implica re-encriptar toda la BD.
// - Nunca loguear el plaintext ni el payload encriptado.
// - Nunca commitear la key. Va en .env.local (dev) / env del server (prod).
// ============================================================================

import crypto from "crypto";

function getKey(): Buffer {
  const hex = process.env.SECRET_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY no configurado en .env.local. Generar con: openssl rand -hex 32"
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY debe ser 32 bytes (64 chars hex). Generar con: openssl rand -hex 32"
    );
  }
  return key;
}

/**
 * Encripta un secreto en texto plano para guardarlo en la BD.
 *
 * Cada llamada usa un IV aleatorio nuevo → el mismo plaintext produce
 * ciphertexts distintos. El auth tag GCM permite detectar tampering al
 * desencriptar (decryptSecret lanza si el payload fue alterado).
 *
 * @param plain - Secreto en UTF-8 (ej. accessToken de Tiendanube).
 * @returns String "iv:ciphertext:authtag" (todo hex), listo para columna TEXT.
 * @throws Error si SECRET_ENCRYPTION_KEY no está configurado o tiene tamaño inválido.
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), ct.toString("hex"), tag.toString("hex")].join(":");
}

/**
 * Desencripta un payload producido por encryptSecret. Verifica el auth tag GCM:
 * si el ciphertext, IV o tag fueron alterados, lanza excepción (no hay
 * degradación silenciosa a plaintext corrupto).
 *
 * @param payload - String "iv:ciphertext:authtag" (todo hex) que produjo encryptSecret.
 * @returns Plaintext original en UTF-8.
 * @throws Error si el payload es inválido, el tag no verifica, o la key falta/es incorrecta.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("payload inválido: se esperaban 3 partes 'iv:ciphertext:authtag'");
  }
  const [ivHex, ctHex, tagHex] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return plain.toString("utf8");
}

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import fs from "fs";

// Parse .env.local manually (no dotenv installed).
const envFile = fs.readFileSync(".env.local", "utf-8");
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const prisma = new PrismaClient();

const secret = process.env.APIKEY_HMAC_SECRET;
if (!secret) {
  console.error("❌ APIKEY_HMAC_SECRET not set");
  process.exit(1);
}
console.log("Secret loaded (length):", secret.length, "chars");

const random = crypto.randomBytes(16).toString("hex");
const plain = "shipro_live_" + random;
const hash = crypto.createHmac("sha256", secret).update(plain).digest("hex");
const ultimos4 = plain.slice(-4);

console.log("");
console.log("=== Generated for Cliente Demo (id=2) ===");
console.log("Plain (only shown HERE, never stored):", plain);
console.log("Hash:", hash);
console.log("Ultimos4:", ultimos4);

const empresa = await prisma.empresa.update({
  where: { id: 2 },
  data: {
    apiKeyHash: hash,
    apiKeyUltimos4: ultimos4,
    apiKeyCreadaEn: new Date(),
    apiKeyActiva: true,
  },
  select: { id: true, nombre: true, apiKeyHash: true, apiKeyUltimos4: true, apiKeyActiva: true }
});

console.log("");
console.log("=== Updated in BD ===");
console.log(empresa);

const found = await prisma.empresa.findUnique({
  where: { apiKeyHash: hash },
  select: { id: true, nombre: true }
});
console.log("");
console.log("=== Lookup by hash test ===");
console.log("Found:", found?.id === 2 ? "✅ Cliente Demo" : "❌ FAILED");

const fakeHash = crypto.createHmac("sha256", secret).update("shipro_live_fakekey").digest("hex");
const notFound = await prisma.empresa.findUnique({
  where: { apiKeyHash: fakeHash },
  select: { id: true }
});
console.log("Fake-hash lookup (should be NULL):", notFound === null ? "✅ NULL" : "❌ UNEXPECTED MATCH");

await prisma.$disconnect();

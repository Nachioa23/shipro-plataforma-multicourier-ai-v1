// Dev-only: reset a user's password to a known plaintext. bcryptjs cost=10.
// Usage: node scripts/reset-password-dev.mjs <email> <plainPassword>
// Defaults: ventas@shipro.pro / ShiproUser123!
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";

// Parse .env.local manually (no dotenv installed) — same pattern as tech1-rotate.mjs.
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

const email = process.argv[2] || "ventas@shipro.pro";
const plainPassword = process.argv[3] || "ShiproUser123!";

const hash = await bcrypt.hash(plainPassword, 10);
await prisma.usuario.update({
  where: { email },
  data: { password: hash },
});
console.log(`OK: password reset for ${email}`);
await prisma.$disconnect();

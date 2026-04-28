import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BCRYPT_REGEX = /^\$2[aby]\$\d{2}\$/;
const ROUNDS = 10;

async function main() {
  const usuarios = await prisma.usuario.findMany();
  let migrados = 0;

  for (const u of usuarios) {
    if (BCRYPT_REGEX.test(u.password)) {
      console.log(`- ${u.email}: ya estaba hasheado, skip`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, ROUNDS);
    await prisma.usuario.update({ where: { id: u.id }, data: { password: hash } });
    migrados++;
    console.log(`✓ ${u.email}: hash aplicado`);
  }

  console.log(`\nListo. ${migrados} contraseña(s) migrada(s) de ${usuarios.length} total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

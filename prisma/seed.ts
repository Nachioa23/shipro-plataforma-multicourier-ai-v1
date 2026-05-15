import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Iniciando el sembrado de la base de datos...');

  // ==========================================
  // PARTE 1: USUARIO ADMIN SHIPRO Y COURIERS
  // Los usuarios shipro (admin_shipro / operador_shipro) no pertenecen a ninguna empresa.
  // empresaId=null => Modo Dios (operan por cuenta y orden de cualquier cliente).
  // ==========================================
  const adminPassword = await bcrypt.hash('admin', 10);
  await prisma.usuario.upsert({
    where: { email: 'admin@shipro.pro' },
    update: {},
    create: {
      email: 'admin@shipro.pro',
      password: adminPassword,
      nombre: 'Nacho (Director)',
      rol: 'admin_shipro',
      empresaId: null
    },
  });
  
  const couriersExistentes = await prisma.courier.count();
  if (couriersExistentes === 0) {
    await prisma.courier.createMany({
      data: [{ nombre: 'Andreani' }, { nombre: "Moci's" }, { nombre: 'Moova' }, { nombre: 'Javit' }]
    });
  }

  // DEUDA 29 Sub-fase 6.D.1: setear cpDepositoConsolidador en couriers consolidadores.
  // Usa upsert idempotente: si el courier ya existe (caso productivo), actualiza el campo.
  // Si el courier no existe todavía, lo crea con el valor. Cuando se integre un nuevo
  // courier consolidador en el futuro, agregar su entrada al array.
  const couriersConCpConsolidador = [
    { nombre: "Moci's", cpDepositoConsolidador: '1702' },
  ];
  for (const c of couriersConCpConsolidador) {
    await prisma.courier.upsert({
      where: { nombre: c.nombre },
      update: { cpDepositoConsolidador: c.cpDepositoConsolidador },
      create: { nombre: c.nombre, cpDepositoConsolidador: c.cpDepositoConsolidador },
    });
  }

  console.log('✅ Empresa, Usuario Admin y Couriers listos.');


  // ==========================================
  // PARTE 2: DATOS GEOGRÁFICOS (El archivo CSV)
  // ==========================================
  const rutaCSV = path.join(__dirname, 'data', 'codigos.csv');
  
  if (!fs.existsSync(rutaCSV)) {
    console.log('⚠️ No se encontró el archivo codigos.csv en prisma/data/. Saltando carga geográfica.');
    return;
  }

  console.log('🌱 Leyendo archivo CSV de Códigos Postales...');
  const resultados: any[] = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(rutaCSV)
      .pipe(csv())
      .on('data', (data) => resultados.push(data))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`📊 Se encontraron ${resultados.length} filas. Procesando...`);

  let contador = 0;
  for (const row of resultados) {
    contador++;
    if (contador % 500 === 0) console.log(`⏳ Procesadas ${contador} filas...`);

    // LEEMOS TUS COLUMNAS EXACTAS
    const nombreProvincia = row.provincia?.trim();
    const nombreLocalidad = row.localidad_o_barrio?.trim();
    const codigoPostal = row.cod_postal_4?.toString().trim();

    if (!nombreProvincia || !nombreLocalidad || !codigoPostal) continue;

    // A. Provincia
    const provincia = await prisma.provincia.upsert({
      where: { nombre: nombreProvincia },
      update: {},
      create: { nombre: nombreProvincia },
    });

    // B. Localidad
    let localidad = await prisma.localidad.findFirst({
      where: { nombre: nombreLocalidad, provinciaId: provincia.id }
    });

    if (!localidad) {
      localidad = await prisma.localidad.create({
        data: { nombre: nombreLocalidad, provinciaId: provincia.id }
      });
    }

    // C. Código Postal
    await prisma.codigoPostal.upsert({
      where: { codigo: codigoPostal },
      update: { localidades: { connect: { id: localidad.id } } },
      create: {
        codigo: codigoPostal,
        localidades: { connect: { id: localidad.id } }
      },
    });
  }

  console.log('✅ ¡Base de datos reconstruida y sembrada al 100%!');
}

main()
  .catch((e) => {
    console.error('❌ Error durante el sembrado:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
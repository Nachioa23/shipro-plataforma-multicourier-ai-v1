import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import bcrypt from 'bcryptjs';
import { capacidadTecnica } from '../lib/couriers/serviciosSoportados';

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
      data: [{ nombre: 'Andreani' }, { nombre: "Moci's" }]
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
      update: {
        cpDepositoConsolidador: c.cpDepositoConsolidador,
        cpDepositoConsolidadorCp: c.cpDepositoConsolidador,
      },
      create: {
        nombre: c.nombre,
        cpDepositoConsolidador: c.cpDepositoConsolidador,
        cpDepositoConsolidadorCp: c.cpDepositoConsolidador,
      },
    });
  }

  // DEUDA 32+37: seed de servicios comerciales por courier.
  // El estado activo es la intencion comercial del director. La capacidad
  // tecnica se lee del registry (serviciosSoportados). REGLA: si la capacidad
  // es null (el adapter no lo soporta), se fuerza activo=false — un servicio
  // no soportado nunca puede quedar activo. Ver docs/DISENO-DEUDA-32-37.md.
  const serviciosPorCourier: Record<string, { codigo: string; grupo: string; orden: number; activo: boolean }[]> = {
    "Andreani": [
      { codigo: "entrega_domicilio_estandar", grupo: "entrega", orden: 1, activo: true },
      { codigo: "entrega_domicilio_express", grupo: "entrega", orden: 2, activo: false },
      { codigo: "entrega_sucursal", grupo: "entrega", orden: 3, activo: true },
      { codigo: "entrega_punto_retiro", grupo: "entrega", orden: 4, activo: false },
      { codigo: "entrega_elocker", grupo: "entrega", orden: 5, activo: false },
      { codigo: "inversa_cambio", grupo: "logistica_inversa", orden: 6, activo: true },
      { codigo: "inversa_devolucion_retiro_domicilio", grupo: "logistica_inversa", orden: 7, activo: true },
      { codigo: "inversa_devolucion_dropoff_sucursal", grupo: "logistica_inversa", orden: 8, activo: true },
    ],
    "Moci's": [
      { codigo: "entrega_domicilio_estandar", grupo: "entrega", orden: 1, activo: true },
      { codigo: "entrega_domicilio_express", grupo: "entrega", orden: 2, activo: false },
      { codigo: "entrega_sucursal", grupo: "entrega", orden: 3, activo: false },
      { codigo: "entrega_punto_retiro", grupo: "entrega", orden: 4, activo: false },
      { codigo: "entrega_elocker", grupo: "entrega", orden: 5, activo: false },
      { codigo: "inversa_cambio", grupo: "logistica_inversa", orden: 6, activo: true },
      { codigo: "inversa_devolucion_retiro_domicilio", grupo: "logistica_inversa", orden: 7, activo: true },
      { codigo: "inversa_devolucion_dropoff_sucursal", grupo: "logistica_inversa", orden: 8, activo: false },
    ],
  };
  for (const [nombreCourier, servicios] of Object.entries(serviciosPorCourier)) {
    const courier = await prisma.courier.findUnique({ where: { nombre: nombreCourier } });
    if (!courier) continue;
    for (const s of servicios) {
      // REGLA: capacidad null => activo forzado a false.
      const capacidad = capacidadTecnica(nombreCourier, s.codigo);
      const activoEfectivo = capacidad !== null && s.activo;
      await prisma.servicioCourier.upsert({
        where: { courierId_codigoServicio: { courierId: courier.id, codigoServicio: s.codigo } },
        update: { grupo: s.grupo, ordenVisual: s.orden, activo: activoEfectivo, capacidadTecnicaMapeada: capacidad },
        create: {
          courierId: courier.id,
          codigoServicio: s.codigo,
          grupo: s.grupo,
          ordenVisual: s.orden,
          activo: activoEfectivo,
          capacidadTecnicaMapeada: capacidad,
        },
      });
    }
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
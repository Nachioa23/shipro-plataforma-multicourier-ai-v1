import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import bcrypt from 'bcryptjs';
import { capacidadTecnica } from '../lib/couriers/serviciosSoportados';
import { normalizarProvincia } from '../lib/constants/normalizar-provincia';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Iniciando el sembrado de la base de datos...');

  // Modo del seed: por defecto PRODUCCION (solo esenciales — admin + couriers
  // + servicios + geografia). Con SEED_MODE=staging se agrega la data demo
  // (Empresa Demo + gerente cliente@demo.com + movimientos ficticios).
  // Regla: la BD productiva NUNCA debe recibir la demo, por eso el default es
  // el subset seguro. Ver docs/DEUDA-66 seed split.
  const seedDemo = process.env.SEED_MODE === "staging";
  console.log(seedDemo ? "  modo: STAGING (incluye datos demo)" : "  modo: PRODUCCION (solo esenciales)");

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
  console.warn("⚠️  Admin sembrado con password por defecto. CAMBIALA de inmediato en produccion.");

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
  // PARTE 1.5 (DEUDA 81): EMPRESA DEMO + GERENTE CLIENTE + MOVIMIENTOS DEMO
  //
  // GATE: SOLO corre en modo staging (SEED_MODE=staging). En produccion se
  // saltea entero — no queremos que la BD publica en Linode reciba una
  // "Comercio Demo S.A." ficticia ni un usuario cliente@demo.com con password
  // 'demo' (credencial debil hardcodeada, riesgo de seguridad si aterriza en
  // un servidor real). Ver docs/DEUDA-66 seed split.
  //
  // Objetivo: post-DEUDA-66 la BD Postgres arranca vacia. Este bloque crea
  // un entorno minimo login-able + con ledger visible en /facturacion.
  //
  // Idempotencia:
  //   - Empresa: upsert por cuit (unico). Update {} preserva saldo si ya
  //     existe (no pisa la data del dev que este trabajando).
  //   - Usuario: upsert por email (unico).
  //   - Movimientos: se insertan solo si la empresa no tiene ninguno todavia
  //     (evita duplicar el ledger en re-runs). Si el dev quiere resetear los
  //     movimientos: DELETE FROM "MovimientoFinanciero" WHERE "empresaId" = X.
  // ==========================================
  if (seedDemo) {
  const CUIT_DEMO = '30-70000000-0';
  const empresaDemo = await prisma.empresa.upsert({
    where: { cuit: CUIT_DEMO },
    update: {},
    create: {
      nombre: 'Comercio Demo S.A.',
      cuit: CUIT_DEMO,
      activo: true,
      modalidadPago: 'PREPAGO',
      onboardingCompletado: true,
      saldoActivo: new Prisma.Decimal('0'),
      limiteDescubierto: new Prisma.Decimal('50000.00'),
      tarifaPlanaRespaldo: new Prisma.Decimal('11858.00'),
    },
  });

  const gerentePassword = await bcrypt.hash('demo', 10);
  await prisma.usuario.upsert({
    where: { email: 'cliente@demo.com' },
    update: {},
    create: {
      email: 'cliente@demo.com',
      password: gerentePassword,
      nombre: 'Gerente Comercio Demo',
      rol: 'gerente_cliente',
      activo: true,
      empresaId: empresaDemo.id,
    },
  });

  // Ledger demo: 12 movimientos cronologicos.
  // Formula fee: monto envio, fee pre-IVA fijo $1.600, IVA = $1.600 * 0.21 = $336,
  // fee c/IVA = $1.600 * new Prisma.Decimal("1.21") = $1.936 (mismo pattern que
  // calcularFeeOperacion). Todas las cifras son cents exactos (Decimal(12,2)).
  //
  // Running saldoPosterior verificado con calculadora:
  //   +100000 -8347.50 -1936 -9112 -1936 -10480.25 -1936 -11925.75 -1936
  //   +50000 -12500 -1936 = 87954.50  ← saldo final positivo (PREPAGO valido).
  const movimientosPrevios = await prisma.movimientoFinanciero.count({
    where: { empresaId: empresaDemo.id },
  });
  if (movimientosPrevios === 0) {
    const now = Date.now();
    const diasAtras = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

    const ledger: Array<{
      tipo: string;
      monto: string;
      saldoPosterior: string;
      descripcion: string;
      referencia: string;
      fecha: Date;
    }> = [
      { tipo: 'CREDITO_RECARGA',      monto:  '100000.00', saldoPosterior: '100000.00', descripcion: 'Recarga inicial (transferencia bancaria)',              referencia: 'Transf. MP #001', fecha: diasAtras(13) },
      { tipo: 'DEBITO_ENVIO',         monto:   '-8347.50', saldoPosterior:  '91652.50', descripcion: 'Envio SHP-100001 — Andreani',                            referencia: 'SHP-100001',      fecha: diasAtras(11) },
      { tipo: 'DEBITO_OPERACION_FEE', monto:   '-1936.00', saldoPosterior:  '89716.50', descripcion: 'Fee de operacion Shipro — SHP-100001',                   referencia: 'SHP-100001',      fecha: diasAtras(11) },
      { tipo: 'DEBITO_ENVIO',         monto:   '-9112.00', saldoPosterior:  '80604.50', descripcion: 'Envio SHP-100002 — Correo Argentino',                    referencia: 'SHP-100002',      fecha: diasAtras(9)  },
      { tipo: 'DEBITO_OPERACION_FEE', monto:   '-1936.00', saldoPosterior:  '78668.50', descripcion: 'Fee de operacion Shipro — SHP-100002',                   referencia: 'SHP-100002',      fecha: diasAtras(9)  },
      { tipo: 'DEBITO_ENVIO',         monto:  '-10480.25', saldoPosterior:  '68188.25', descripcion: 'Envio SHP-100003 — OCASA',                               referencia: 'SHP-100003',      fecha: diasAtras(7)  },
      { tipo: 'DEBITO_OPERACION_FEE', monto:   '-1936.00', saldoPosterior:  '66252.25', descripcion: 'Fee de operacion Shipro — SHP-100003',                   referencia: 'SHP-100003',      fecha: diasAtras(7)  },
      { tipo: 'DEBITO_ENVIO',         monto:  '-11925.75', saldoPosterior:  '54326.50', descripcion: "Envio SHP-100004 — Moci's",                              referencia: 'SHP-100004',      fecha: diasAtras(5)  },
      { tipo: 'DEBITO_OPERACION_FEE', monto:   '-1936.00', saldoPosterior:  '52390.50', descripcion: 'Fee de operacion Shipro — SHP-100004',                   referencia: 'SHP-100004',      fecha: diasAtras(5)  },
      { tipo: 'CREDITO_RECARGA',      monto:   '50000.00', saldoPosterior: '102390.50', descripcion: 'Recarga adicional (transferencia bancaria)',             referencia: 'Transf. MP #002', fecha: diasAtras(4)  },
      { tipo: 'DEBITO_ENVIO',         monto:  '-12500.00', saldoPosterior:  '89890.50', descripcion: 'Envio SHP-100005 — Andreani',                            referencia: 'SHP-100005',      fecha: diasAtras(2)  },
      { tipo: 'DEBITO_OPERACION_FEE', monto:   '-1936.00', saldoPosterior:  '87954.50', descripcion: 'Fee de operacion Shipro — SHP-100005',                   referencia: 'SHP-100005',      fecha: diasAtras(2)  },
    ];

    for (const m of ledger) {
      await prisma.movimientoFinanciero.create({
        data: {
          empresaId: empresaDemo.id,
          tipo: m.tipo,
          monto: new Prisma.Decimal(m.monto),
          saldoPosterior: new Prisma.Decimal(m.saldoPosterior),
          descripcion: m.descripcion,
          referencia: m.referencia,
          fecha: m.fecha,
        },
      });
    }

    // saldoActivo de la empresa DEBE igualar el ultimo saldoPosterior del ledger.
    await prisma.empresa.update({
      where: { id: empresaDemo.id },
      data: { saldoActivo: new Prisma.Decimal('87954.50') },
    });

    console.log(`✅ Ledger demo cargado: ${ledger.length} movimientos, saldo final $87.954,50.`);
  } else {
    console.log(`ℹ️  Empresa demo ya tiene ${movimientosPrevios} movimientos — se preserva el ledger existente.`);
  }

  console.log('✅ Empresa Demo (Comercio Demo S.A.) + gerente cliente@demo.com listos.');
  } // end if (seedDemo) — fin PARTE 1.5


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

    // DEUDA 26 (2026-06-03): rechazar filas con provincia no canonica.
    // normalizarProvincia() retorna null si el nombre no esta en PROVINCIAS_AR
    // (lista de las 24 provincias argentinas reales). Esto filtra basura
    // generada por filas del CSV mal parseadas (comas decimales sin escapar
    // en nombres rurales tipo "RUTA 8 KILOMETRO 19,500 AL 22").
    // Mantenemos nombreProvincia raw (mayusculas, sin acentos) en el upsert
    // para preservar consistencia con la BD ya cargada.
    if (!normalizarProvincia(nombreProvincia)) {
      console.warn(
        `[seed] Provincia rechazada: "${nombreProvincia}" en CP ${codigoPostal}, localidad "${nombreLocalidad}". Fila saltada por DEUDA 26.`
      );
      continue;
    }

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
// ============================================================================
// Load test setup — crea/encuentra la empresa LOADTEST completamente configurada
// para cotizar. Idempotente: se puede correr N veces, el estado converge.
//
// Qué crea/garantiza:
//   - Empresa "LOADTEST" (CUIT fijo; upsert).
//   - API Key nueva en cada corrida (rotación) → la imprime en stdout UNA VEZ.
//   - Depósito predeterminado activo con dirección válida.
//   - Para los 5+ couriers del harness: fila Courier (upsert por nombre),
//     ServicioCourier para entrega_domicilio_estandar + entrega_sucursal
//     con capacidadTecnicaMapeada del registry serviciosSoportados.ts,
//     y CredencialCourier activa con ofreceDomicilio + ofreceSucursal.
//
// Con el factory-mock activo (LOAD_TEST_MOCK_COURIERS=true) los valores de
// credenciales no se usan (el MockCourierAdapter cortocircuita el switch);
// solo importa que las filas existan y estén activas.
//
// Uso:
//   npx tsx scripts/loadtest-setup.ts
//   (requiere Postgres dev arriba en DATABASE_URL + APIKEY_HMAC_SECRET)
// ============================================================================

// tsx standalone no carga .env/.env.local (Next sí). Parser mínimo in-line
// para no agregar dep. `.env.local` pisa `.env` (patrón Next).
import { readFileSync, existsSync } from 'fs';
for (const envPath of ['.env', '.env.local']) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}

import { PrismaClient, Prisma } from '@prisma/client';
import { capacidadTecnica } from '../lib/couriers/serviciosSoportados';
import { generateApiKey } from '../lib/utils/apikey-hash';

const prisma = new PrismaClient();

// Nombres como aparecen en Courier.nombre (display). El cotizador normaliza
// con normalizarParaComparacion para matchear contra el registry.
const COURIERS_HARNESS = [
  'Andreani',
  "Moci's",
  'OCA',
  'Correo Argentino',
  'Hop Envíos',
] as const;

const CUIT_LOADTEST = '30-70000000-9';

async function main() {
  console.log('▶ loadtest-setup: configurando empresa LOADTEST...');

  // 1) Empresa + API Key fresca.
  const apiKey = generateApiKey();
  const empresa = await prisma.empresa.upsert({
    where: { cuit: CUIT_LOADTEST },
    create: {
      nombre: 'LOADTEST',
      cuit: CUIT_LOADTEST,
      activo: true,
      modalidadPago: 'POSTPAGO',
      onboardingCompletado: true,
      saldoActivo: new Prisma.Decimal('0'),
      limiteDescubierto: new Prisma.Decimal('10000000'),
      apiKeyHash: apiKey.hash,
      apiKeyUltimos4: apiKey.ultimos4,
      apiKeyActiva: true,
      apiKeyCreadaEn: new Date(),
    },
    update: {
      activo: true,
      apiKeyHash: apiKey.hash,
      apiKeyUltimos4: apiKey.ultimos4,
      apiKeyActiva: true,
      apiKeyCreadaEn: new Date(),
    },
  });

  // 2) Depósito predeterminado activo.
  const depositoExistente = await prisma.deposito.findFirst({
    where: { empresaId: empresa.id, nombre: 'LOADTEST-DEPO' },
  });
  if (depositoExistente) {
    await prisma.deposito.update({
      where: { id: depositoExistente.id },
      data: {
        activo: true,
        eliminado: false,
        esPredeterminado: true,
      },
    });
  } else {
    // Apagar cualquier otro predeterminado antes de crear este.
    await prisma.deposito.updateMany({
      where: { empresaId: empresa.id, esPredeterminado: true },
      data: { esPredeterminado: false },
    });
    await prisma.deposito.create({
      data: {
        empresaId: empresa.id,
        nombre: 'LOADTEST-DEPO',
        esPredeterminado: true,
        activo: true,
        contactoNombre: 'Load Test',
        contactoTelefono: '1100000000',
        contactoEmail: 'loadtest@shipro.local',
        direccionCalle: 'Av. Libertador',
        direccionAltura: '1000',
        codigoPostal: '1425',
        localidad: 'CABA',
        provincia: 'CABA',
        pais: 'Argentina',
        horarios: JSON.stringify({}),
      },
    });
  }

  // 3) Por cada courier del harness: Courier + ServicioCourier + CredencialCourier.
  for (const nombreCourier of COURIERS_HARNESS) {
    const courier = await prisma.courier.upsert({
      where: { nombre: nombreCourier },
      create: { nombre: nombreCourier, activo: true },
      update: { activo: true },
    });

    // Dos servicios base por courier: domicilio + sucursal.
    const servicios = [
      { codigo: 'entrega_domicilio_estandar', grupo: 'entrega', orden: 1 },
      { codigo: 'entrega_sucursal', grupo: 'entrega', orden: 2 },
    ];
    for (const s of servicios) {
      const capacidad = capacidadTecnica(nombreCourier, s.codigo);
      // Si el adapter real no declara la capacidad (null), lo seteamos manualmente
      // al valor correspondiente — esto es harness, no prod. Garantiza que al
      // menos un servicio activo mapee a cada modalidad para que el cotizador
      // dispare el path hot de cotizar().
      const capacidadForzada = capacidad ?? (s.codigo === 'entrega_domicilio_estandar' ? 'domicilio' : 'sucursal');
      await prisma.servicioCourier.upsert({
        where: {
          courierId_codigoServicio: { courierId: courier.id, codigoServicio: s.codigo },
        },
        create: {
          courierId: courier.id,
          codigoServicio: s.codigo,
          grupo: s.grupo,
          ordenVisual: s.orden,
          activo: true,
          capacidadTecnicaMapeada: capacidadForzada,
        },
        update: {
          activo: true,
          grupo: s.grupo,
          ordenVisual: s.orden,
          capacidadTecnicaMapeada: capacidadForzada,
        },
      });
    }

    // Credencial del cliente (se usa un JSON placeholder — el mock ignora
    // el contenido). ofreceDomicilio/ofreceSucursal true explícito.
    await prisma.credencialCourier.upsert({
      where: {
        empresaId_nombreCourier: { empresaId: empresa.id, nombreCourier },
      },
      create: {
        empresaId: empresa.id,
        nombreCourier,
        activo: true,
        usaCredencialesPropias: false,
        credencialesJson: null,
        ofreceDomicilio: true,
        ofreceSucursal: true,
      },
      update: {
        activo: true,
        usaCredencialesPropias: false,
        ofreceDomicilio: true,
        ofreceSucursal: true,
      },
    });
  }

  console.log('✅ loadtest-setup listo.');
  console.log('   empresaId:', empresa.id);
  console.log('   apiKey:   ', apiKey.plain, '  <-- USÁ ESTA, se muestra UNA SOLA VEZ');
  console.log('   couriers: ', COURIERS_HARNESS.join(', '));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ loadtest-setup falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });

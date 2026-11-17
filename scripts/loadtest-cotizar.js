// ============================================================================
// Load test harness para POST /api/cotizar — rampa 10→50→100→200→400 VUs.
//
// Usa autocannon via `npx -y autocannon` (shell out), por 30s por escalón.
// Cero deps nuevas en el repo. La primera invocación baja autocannon y queda
// cacheado para las siguientes.
//
// Uso:
//   LOAD_TEST_API_KEY=shipro_live_xxxx node scripts/loadtest-cotizar.js
//
// (El dev server tiene que estar corriendo con LOAD_TEST_MOCK_COURIERS=true
// para que el MockCourierAdapter corte el path real. Sin el flag, las VUs
// van a saturar red externa contra couriers reales — abort inmediato.)
//
// Thresholds (fallan la corrida con exit 1 si se violan):
//   - error rate (non2xx + errors + timeouts) < 5%  por escalón
//   - p95 < 2000ms                                   por escalón
// ============================================================================

const { execFileSync } = require('child_process');

const URL_DEFAULT = 'http://localhost:3000/api/cotizar';
const URL = process.env.LOAD_TEST_URL || URL_DEFAULT;
const API_KEY = process.env.LOAD_TEST_API_KEY;
if (!API_KEY) {
  console.error('❌ Falta LOAD_TEST_API_KEY. Correr loadtest-setup.ts y exportá la API Key.');
  process.exit(2);
}

// Escalones (connections = VUs concurrentes; duration en segundos).
const STAGES = [
  { label: 'calentamiento',  connections: 10,  duration: 20 },
  { label: 'carga_liviana',  connections: 50,  duration: 30 },
  { label: 'carga_media',    connections: 100, duration: 30 },
  { label: 'carga_pesada',   connections: 200, duration: 30 },
  { label: 'punto_quiebre',  connections: 400, duration: 30 },
];

const THRESHOLD_ERROR_RATE = 0.05; // 5 %
const THRESHOLD_P95_MS     = 2000;

const BODY = JSON.stringify({
  cpOrigen: '1425',
  cpDestino: '1900',
  paquetes: [
    { pesoKg: 2, largoCm: 20, anchoCm: 20, altoCm: 15, valorDeclarado: 5000, requiereSeguro: false },
  ],
});

function runStage(stage) {
  const bodyFile = `/tmp/loadtest-body.json`;
  require('fs').writeFileSync(bodyFile, BODY);

  const args = [
    '-y', 'autocannon',
    '-m', 'POST',
    '-c', String(stage.connections),
    '-d', String(stage.duration),
    '-H', `Authorization=Bearer ${API_KEY}`,
    '-H', `Content-Type=application/json`,
    '-b', BODY,
    '-j', // JSON output
    URL,
  ];

  console.log(`\n▶ Escalón ${stage.label} — ${stage.connections} VUs × ${stage.duration}s`);
  let stdout;
  try {
    stdout = execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (e) {
    console.error(`❌ Autocannon falló en ${stage.label}:`, e.message);
    throw e;
  }

  const r = JSON.parse(stdout);
  const total      = r.requests?.total ?? 0;
  const errorsTot  = (r.errors ?? 0) + (r.timeouts ?? 0) + (r.non2xx ?? 0);
  const errorRate  = total > 0 ? errorsTot / total : 1;
  const rps        = r.requests?.average ?? 0;
  const p50        = r.latency?.p50 ?? 0;
  const p95        = r.latency?.p97_5 ?? r.latency?.p95 ?? 0; // autocannon no emite p95 exacto, usa p97_5 como aproximación
  const p99        = r.latency?.p99 ?? 0;

  return {
    stage: stage.label,
    vus: stage.connections,
    seconds: stage.duration,
    total,
    rps: Number(rps.toFixed(2)),
    p50_ms: p50,
    p95_ms: p95,
    p99_ms: p99,
    non2xx: r.non2xx ?? 0,
    errors: r.errors ?? 0,
    timeouts: r.timeouts ?? 0,
    errorRate: Number(errorRate.toFixed(4)),
  };
}

function printSummary(results) {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('RESUMEN LOAD TEST — POST /api/cotizar');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(
    'escalón'.padEnd(18) +
    'VUs'.padStart(6) +
    'total'.padStart(10) +
    'rps'.padStart(10) +
    'p50'.padStart(8) +
    'p95'.padStart(8) +
    'p99'.padStart(8) +
    'err%'.padStart(10)
  );
  console.log('-'.repeat(79));
  for (const r of results) {
    console.log(
      r.stage.padEnd(18) +
      String(r.vus).padStart(6) +
      String(r.total).padStart(10) +
      String(r.rps).padStart(10) +
      String(r.p50_ms).padStart(8) +
      String(r.p95_ms).padStart(8) +
      String(r.p99_ms).padStart(8) +
      String((r.errorRate * 100).toFixed(2) + '%').padStart(10)
    );
  }
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

(async () => {
  const results = [];
  let failed = false;

  for (const stage of STAGES) {
    const r = runStage(stage);
    results.push(r);

    if (r.errorRate > THRESHOLD_ERROR_RATE) {
      console.warn(`⚠️ THRESHOLD: error rate ${(r.errorRate * 100).toFixed(2)}% > ${THRESHOLD_ERROR_RATE * 100}% en ${r.stage}`);
      failed = true;
    }
    if (r.p95_ms > THRESHOLD_P95_MS) {
      console.warn(`⚠️ THRESHOLD: p95 ${r.p95_ms}ms > ${THRESHOLD_P95_MS}ms en ${r.stage}`);
      failed = true;
    }
  }

  printSummary(results);

  // Ruta explícita del quiebre: primer escalón donde los dos thresholds no
  // sobreviven. Si todos sobreviven, el harness termina OK aunque haya warnings.
  const primerBreakdown = results.find((r) => r.errorRate > THRESHOLD_ERROR_RATE || r.p95_ms > THRESHOLD_P95_MS);
  if (primerBreakdown) {
    console.log(`\n🚨 Punto de quiebre: ${primerBreakdown.stage} (${primerBreakdown.vus} VUs)`);
  } else {
    console.log('\n✅ Todos los escalones pasaron los thresholds.');
  }

  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('Harness falló:', e);
  process.exit(1);
});

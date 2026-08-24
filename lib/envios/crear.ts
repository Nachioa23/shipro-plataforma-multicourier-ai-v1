import prisma from "@/lib/prisma";
import { randomBytes } from "crypto";
import {
  evaluarSuspension,
  suspenderEmpresa,
} from "@/lib/utils/suspension-cuenta";
import { enviarMailCreacion } from "@/lib/mailer";
import { obtenerCourier } from "@/lib/couriers/normalizar";
import { despacharCourier } from "@/lib/envios/dispatch";
import { cotizar } from "@/lib/cotizador";
import { calcularPromesaCalibrada } from "@/lib/utils/promesa-calibrada";
import { inferirModalidad } from "@/lib/utils/modalidades";
import { validarOperatividadPar } from "@/lib/depositos/operatividad";
import { getAppUrl } from "@/lib/utils/app-url";
import { resolverPrecioFallback } from "@/lib/utils/precio-fallback";
import { calcularFeeOperacion } from "@/lib/utils/operacion-fee";
import { validarDireccionEnvio } from "@/lib/geo/validar-direccion";
import {
  resolverMarkupShiproPorcentaje,
  resolverSmoNeto,
  resolverIntermediarioMarkupPorcentaje,
} from "@/lib/utils/resolvers-tarifa";
// DEUDA 123 mov 2 (2026-08-03): imports para instanciar el adapter del courier
// en el path de fallback Rama A y leer su tarifaApiIncluyeIva sin depender del
// flag legacy en CredencialCourier.
import { CourierFactory } from "@/lib/couriers/CourierFactory";
import { obtenerCredencialesShipro } from "@/lib/couriers/credenciales";
import { normalizarParaComparacion } from "@/lib/couriers/normalizar";
import type { ResultadoBulto } from "@/lib/couriers/CourierInterface";
import { Prisma, EstadoLiquidacion, type DepositoCourierConfig } from "@prisma/client";

export interface CrearEnvioInput {
  empresaId: number;
  // DEUDA 4: depósito de origen.
  // - Opcional: si no viene, usa el predeterminado activo de la empresa.
  // - Si viene un id que no pertenece a la empresa o está inactivo: throw.
  // - E-commerces (POST /api/envios) nunca pasan depositoId → siempre predeterminado.
  // - Dashboard (/nuevo-envio) puede pasar uno del dropdown si hay >1 depósito.
  depositoId?: number;
  // DEUDA 4 + visión DEUDA 27: si la empresa NO tiene depósito predeterminado:
  // - false (default): throw DepositoRequerido (rechazo claro, dashboard).
  // - true: crear envío con SHP-* + estado BLOQUEADO_DEPOSITO. La etiqueta se
  //   destraba automáticamente cuando el cliente configure su depósito predeterminado
  //   (procesarEnviosBloqueadosPorDeposito disparado desde /api/depositos).
  // E-commerces (POST /api/envios) pasan true para no romper la venta.
  permitirBloqueoPorDeposito?: boolean;
  destinatarioNombre: string;
  cpDestino: string | number;
  pesoReal: number | string;
  // DEUDA 132 (fix 2026-08-07): dimensiones del paquete. Se threadean end-to-end
  // igual que pesoReal para que la re-cotización interna + la etiqueta al courier
  // usen las medidas reales (no el 10×10×10 hardcoded que causaba descalce
  // cotizado ≠ despachado ≠ facturado). Opcionales por backward-compat: si un
  // caller legacy no las manda, el synthetic paquetes[] cae al fallback 10.
  largoCm?: number | null;
  anchoCm?: number | null;
  altoCm?: number | null;
  nombreCourier: string;
  calle?: string;
  altura?: string;
  piso?: string;
  dpto?: string;
  dni?: string;
  email?: string;
  telefono?: string;
  localidad?: string;
  modalidad?: string;
  valorDeclarado?: number | string;
  costoEnvio?: number | string;
  costoProveedor?: number | string;
  provinciaDestino?: string;
  numeroOrden?: string | null;

  // DEUDA 128: clave de idempotencia. La produce el plugin (Idempotency-Key header),
  // se persiste en Envio.idempotencyKey. El check de duplicados vive en la ruta
  // (POST /api/envios); acá sólo se almacena. Null → creación sin clave (dashboard
  // manual, no plugin).
  idempotencyKey?: string | null;

  // === DEUDA 29 Sub-fase 1.C.2 ===
  // Cómo arrancó el envío. Default "recoleccion_courier".
  // - "recoleccion_courier": el courier (mismo o consolidador) retira del depósito.
  // - "drop_off_cliente": el cliente lleva el paquete a una sucursal del Last-Mile.
  tipoOrigen?: "recoleccion_courier" | "drop_off_cliente";
  // Sucursales opcionales (pass-through; UI las pobla en Sub-fase 6).
  sucursalOrigenId?: number | null;
  sucursalDestinoId?: number | null;
}

export async function crearEnvio(input: CrearEnvioInput) {
  // Política de negocio: crear envío requiere una empresa específica.
  // Modo Dios "TODAS" no aplica acá. Defensivo runtime check (TS ya garantiza
  // empresaId: number, pero si en el futuro se cambia el tipo este guard atrapa).
  if (input.empresaId === null || input.empresaId === undefined) {
    throw new Error('EmpresaRequerida: crear envío requiere una empresa específica. Modo Dios sin filtro no aplica acá.');
  }

  const {
    empresaId, depositoId: depositoIdInput, permitirBloqueoPorDeposito, destinatarioNombre, cpDestino, pesoReal, largoCm, anchoCm, altoCm, nombreCourier,
    calle, altura, piso, dpto, dni, email, telefono, localidad, modalidad,
    valorDeclarado, costoEnvio, costoProveedor, provinciaDestino, numeroOrden,
    idempotencyKey,
    tipoOrigen, sucursalOrigenId, sucursalDestinoId
  } = input;

  let trackingOficial = "SHP-" + Math.floor(Math.random() * 900000 + 100000);
  let urlEtiquetaFinal: string | null = null;
  let estadoInicialEnvio = "Pendiente";
  let falloPorPeaje = false;
  let motivoRetencion = "";

  // DEUDA 29 Sub-fase 1.C.2: si despacho parcial/total falla → BLOQUEADO_PARCIAL.
  // dispatchTramos contiene los snapshots de los tramos efectivamente despachados
  // (puede ser 0 si todo falló, 1 si A/B exitoso o C con tramo 1 OK + 2 falla, 2 si C OK).
  let bloqueadoPorTramoFallido = false;
  let errorTramo: string | null = null;
  let dispatchTramos: {
    orden: number;
    courierId: number;
    tipo: "recoleccion" | "entrega" | "ciclo_completo";
    trackingExterno: string | null;
    sucursalOrigenId?: number | null;
    sucursalDestinoId?: number | null;
  }[] = [];
  // Molde multi-bulto paso 1b: carrier de bultos despachados hacia la tx (mismo
  // patrón que dispatchTramos). dispatchResult es block-local al gate del despacho,
  // así que hay que caché'ar los bultos acá para que estén en scope de la tx.
  let dispatchBultos: ResultadoBulto[] = [];

  // =========================================================
  // RESOLVER COURIER CANÓNICO
  // obtenerCourier tolera variantes ("moci", "Moci's", "MOCIS") y
  // devuelve el registro de BD con el nombre canónico correcto.
  // Si no existe, lo crea con el nombre tal como vino (legacy:
  // antes el diccionario manual hardcodeaba "Andreani"/"Mocis";
  // ahora confiamos en obtenerCourier — si el caller manda algo
  // raro queda como debt para DEUDA 12 / ABM).
  // =========================================================
  let courierReal = await obtenerCourier(nombreCourier);

  if (!courierReal) {
    // Fase K (DEUDA 32+37): el create necesita include servicios para mantener
    // el shape Courier & CourierConServicios que obtenerCourier devuelve.
    courierReal = await prisma.courier.create({
      data: { nombre: nombreCourier, activo: true },
      include: {
        servicios: {
          where: { codigoServicio: "entrega_sucursal" },
          select: { codigoServicio: true, capacidadTecnicaMapeada: true },
        },
      },
    });
  }
  const courierIdReal = courierReal.id;

  // DIRECTORIO Y ABM: Actualizar o crear contacto
  const direccionExistente = await prisma.direccion.findFirst({ where: { email: email } });
  let direccionId: number;
  if (direccionExistente) {
    const dirActualizada = await prisma.direccion.update({
      where: { id: direccionExistente.id },
      data: { nombre: destinatarioNombre, documento: dni, telefono: telefono, calle: calle, altura: altura, piso: piso, dpto: dpto, cp: String(cpDestino), localidad: localidad, provincia: provinciaDestino }
    });
    direccionId = dirActualizada.id;
  } else {
    const nuevaDir = await prisma.direccion.create({
      data: { nombre: destinatarioNombre, documento: dni, email: email, telefono: telefono, calle: calle, altura: altura, piso: piso, dpto: dpto, cp: String(cpDestino), localidad: localidad, provincia: provinciaDestino, pais: "Argentina" }
    });
    direccionId = nuevaDir.id;
  }

  // ==============================================================
  // DEPÓSITO DE ORIGEN (DEUDA 4)
  // Cargamos la empresa con sus depósitos activos no eliminados en una sola query.
  // Esto reemplaza la lógica vieja que creaba una Direccion fake hardcoded
  // ("Depósito Central - Empresa N" con CP 1000 / Av. Libertador).
  //
  // Reglas:
  // - Si caller pasó depositoId → buscar en los depósitos de SU empresa. Si no
  //   matchea: 404 genérico (no expone que el depósito existe en otra empresa).
  // - Si depositoId apunta a inactivo o eliminado: error claro.
  //   (Visión completa con BLOQUEADO_DEPOSITO + recuperación automática post
  //   configuración: ver DEUDA 27 — pendiente.)
  // - Sin depositoId: usar el predeterminado.
  // - Sin predeterminado: throw DepositoRequerido (handler retorna 400).
  // ==============================================================
  const empresaConData = await prisma.empresa.findUnique({
    where: { id: empresaId },
    include: {
      depositos: {
        where: { eliminado: false, activo: true },
        orderBy: [{ esPredeterminado: 'desc' }, { id: 'asc' }],
      },
    },
  });

  if (!empresaConData) {
    throw new Error(`EmpresaNoEncontrada: empresa id=${empresaId} no existe.`);
  }

  // DEUDA 22 (2026-06-18): pre-creation gate.
  // Si la empresa esta suspendida (saldoActivo cruzo -limiteDescubierto * 1.5),
  // se rechaza la creacion completa con CUENTA_SUSPENDIDA. El cliente debe
  // recargar saldo. La reactivacion es automatica via procesarEnviosBloqueados.
  if (empresaConData.suspendida) {
    throw new Error(
      `CUENTA_SUSPENDIDA: la empresa ${empresaConData.nombre} esta suspendida ` +
      `por exceso de descubierto. Recarga saldo para reactivar.`
    );
  }

  let deposito: typeof empresaConData.depositos[0] | undefined;
  let bloqueadoPorDeposito = false;

  if (depositoIdInput) {
    deposito = empresaConData.depositos.find(d => d.id === depositoIdInput);
    if (!deposito) {
      // 404 genérico — no enumeration: no exponemos si el depósito existe en otra empresa.
      throw new Error('DepositoNoEncontrado: depósito no encontrado.');
    }
    // El where de la query ya filtra eliminado=false y activo=true, entonces si
    // matcheamos significa que está usable. Defense extra:
    if (deposito.eliminado || !deposito.activo) {
      throw new Error('DepositoInactivo: el depósito está inactivo o eliminado y no puede usarse para crear envíos.');
    }
  } else {
    deposito = empresaConData.depositos.find(d => d.esPredeterminado);
    if (!deposito) {
      // Sin predeterminado: branch según permitirBloqueoPorDeposito.
      // - true (e-commerce): crear con BLOQUEADO_DEPOSITO. Se destraba cuando el
      //   cliente configure su depósito predeterminado (procesarEnviosBloqueadosPorDeposito).
      // - false (dashboard): rechazar con error claro.
      if (permitirBloqueoPorDeposito) {
        bloqueadoPorDeposito = true;
        estadoInicialEnvio = "BLOQUEADO_DEPOSITO";
      } else {
        throw new Error('DepositoRequerido: la empresa no tiene depósito predeterminado activo. Configurá uno en /configuracion/depositos.');
      }
    }
  }

  // Snapshot de la dirección al momento del envío. La FK origenId apunta a esto;
  // depositoId apunta al registro vivo. Si el cliente edita el depósito en el
  // futuro, los envíos viejos mantienen la dirección de origen del momento.
  // Si bloqueadoPorDeposito: NO creamos snapshot (no hay datos del depósito).
  // origenId y depositoId quedan en null en el envío hasta que se destrabe.
  const direccionOrigen = deposito ? await prisma.direccion.create({
    data: {
      nombre: deposito.nombre,
      calle: deposito.direccionCalle,
      altura: deposito.direccionAltura,
      piso: deposito.direccionPiso,
      dpto: deposito.direccionDpto,
      cp: deposito.codigoPostal,
      localidad: deposito.localidad,
      provincia: deposito.provincia,
      pais: deposito.pais,
      telefono: deposito.contactoTelefono,
      email: deposito.contactoEmail,
    },
  }) : null;

  // ==============================================================
  // REGLA DEL PEAJE (Google Maps) — validación delegada al helper.
  // Lógica extraída a lib/geo/validar-direccion.ts (DEUDA 106 pieza 2 mov 3,
  // refactor 2026-08-04). Reproduce los 5 checks (calle vacía / altura sin
  // keyword / Google ZERO_RESULTS / no-street-level / CP mismatch) con las
  // mismas motivo strings y el mismo fallback ante fallo de Google.
  // El helper también sirve al path de corrección del comprador (mov 4).
  // ==============================================================
  const resultadoValidacion = await validarDireccionEnvio({
    calle,
    altura,
    cp: cpDestino,
    localidad,
    provincia: provinciaDestino,
  });
  if (!resultadoValidacion.valida) {
    estadoInicialEnvio = "RETENIDO";
    falloPorPeaje = true;
    motivoRetencion = resultadoValidacion.motivo;
  }

  // ==============================================================
  // CARGAR CREDENCIAL Y EMPRESA (necesarios para validación de saldo)
  // courierReal.nombre es la capitalización canónica de BD (ya resuelto por
  // obtenerCourier arriba). NO refactorear a obtenerCredencialCourier aquí:
  // courierReal ya está en memoria; usar el helper agregaría una query
  // innecesaria (re-resolvería el courier que ya tenemos).
  // ==============================================================
  const credencialMain = await prisma.credencialCourier.findUnique({
    where: { empresaId_nombreCourier: { empresaId, nombreCourier: courierReal.nombre } }
  });

  // ==============================================================
  // FASE 2 pieza 1, sub 3 (2026-07-30): guard de PROPIEDAD de credenciales.
  // Una credencial Rama A (usaCredencialesPropias=false) sin dueño
  // configurado (propietarioTipo == null) no puede despacharse — el motor de
  // plata en sub-piece 4 va a resolver el markup del dueño. Si no hay dueño,
  // no hay markup, no hay cálculo autoritativo.
  //
  // Dual-mode (mirror de operatividad):
  //   - dashboard (permitirBloqueoPorDeposito=false): throw claro.
  //   - e-commerce (true): crear en BLOQUEADO_CREDENCIAL. Se destraba solo
  //     cuando admin_shipro configura el dueño en /configuracion/transportes
  //     (procesarEnviosBloqueadosPorCredencial).
  //
  // Precedencia: DEPOSITO > CREDENCIAL > OPERATIVIDAD > SALDO. Gateado por
  // !bloqueadoPorDeposito para no pisar el estado más fundamental (sin
  // depósito no importa el dueño). Rama B (usaCredencialesPropias=true)
  // implica CLIENTE por construcción (backend coerce en configuracion/couriers
  // POST) — nunca dispara este guard.
  // ==============================================================
  let bloqueadoPorCredencial = false;
  if (
    !bloqueadoPorDeposito &&
    credencialMain &&
    credencialMain.usaCredencialesPropias === false &&
    !credencialMain.propietarioTipo
  ) {
    if (permitirBloqueoPorDeposito) {
      bloqueadoPorCredencial = true;
      estadoInicialEnvio = "BLOQUEADO_CREDENCIAL";
    } else {
      throw new Error(
        `CredencialSinPropietario: la credencial de ${courierReal.nombre} es Rama A pero no tiene dueño configurado. Configuralo en /configuracion/transportes.`
      );
    }
  }

  // ==============================================================
  // VALIDACIÓN DE OPERATIVIDAD DEL PAR (DEUDA 29 Sub-fase 6.D.5)
  // ==============================================================
  // Lookup de DepositoCourierConfig + validación pre-despacho. Si el par
  // no es operativo, branch según permitirBloqueoPorDeposito:
  //   - true (e-commerce): crear envío en BLOQUEADO_OPERATIVIDAD sin
  //     despachar ni debitar saldo (paridad con BLOQUEADO_DEPOSITO).
  //   - false (dashboard): throw OperatividadInvalida con motivos.
  // Skip si bloqueadoPorDeposito (no hay depósito para validar) o
  // falloPorPeaje (dirección destino inválida, RETENIDO tiene prioridad).
  // TODO 6.D.6+ (DEUDA 34): destrabe automático al configurar el par.
  const depositoCourierConfig: DepositoCourierConfig | null = deposito
    ? await prisma.depositoCourierConfig.findUnique({
        where: {
          depositoId_courierId: {
            depositoId: deposito.id,
            courierId: courierReal.id,
          },
        },
      })
    : null;

  let bloqueadoPorOperatividad = false;
  let motivosOperatividad: string[] = [];
  let detalleOperatividad: string[] = [];

  if (deposito && credencialMain && !bloqueadoPorDeposito && !bloqueadoPorCredencial && !falloPorPeaje) {
    const operatividad = await validarOperatividadPar({
      prisma,
      deposito,
      courier: courierReal,
    });
    if (!operatividad.operativo) {
      if (permitirBloqueoPorDeposito) {
        bloqueadoPorOperatividad = true;
        estadoInicialEnvio = "BLOQUEADO_OPERATIVIDAD";
        motivosOperatividad = operatividad.motivos;
        detalleOperatividad = operatividad.detalle;
      } else {
        throw new Error(
          `OperatividadInvalida: el par (depósito=${deposito.nombre}, courier=${courierReal.nombre}) no es operativo. Motivos: ${operatividad.motivos.join(", ")}. Detalle: ${operatividad.detalle.join("; ")}.`
        );
      }
    }
  }

  // ==============================================================
  // VALIDACIÓN DE SALDO POR tipoCuenta (DEUDA 16)
  // Reusamos `empresaConData` cargada arriba para resolución del depósito;
  // tiene los campos saldoActivo/limiteDescubierto/modalidadPago necesarios.
  // Si no alcanza, NO se rebota la creación: el envío se crea con
  // tracking SHP-* + estado BLOQUEADO_SALDO. No se llama al courier,
  // no se debita saldo, no se manda mail. Se desbloquea cuando el
  // cliente recargue saldo (procesarEnviosBloqueados).
  // ==============================================================
  // costoEnvio del caller es SOLO buyer-facing (lo que vio el comprador,
  // puede incluir markup/descuento del cliente hacia su comprador).
  // El débito autoritativo lo recomputa Shipro más abajo (montoDebito).
  const costoEnvioComprador: Prisma.Decimal = new Prisma.Decimal(parseFloat(String(costoEnvio)) || 0);
  const tipoCuentaEfectivo = credencialMain?.tipoCuenta || empresaConData.modalidadPago || "POSTPAGO";
  let bloqueadoPorSaldo = false;
  // DEUDA 22: si el debit cruza umbral, se programa suspension fuera de la tx.
  let suspensionPendiente: { saldoFinal: Prisma.Decimal; limiteAfectado: Prisma.Decimal } | null = null;
  const montoProveedor: Prisma.Decimal = new Prisma.Decimal(parseFloat(String(costoProveedor)) || 0);
  let empresaNombreParaMail = "la Tienda";

  // ==============================================================
  // COTIZACIÓN INTERNA + montoDebito RAMA-AWARE (FASE 1, DEUDA 73/107)
  // El débito autoritativo lo recomputa Shipro:
  //   - Rama A (usaCredencialesPropias=false): tarifa publicada completa
  //     (precioFinal de la opción del courier elegido; cascada + SMO +
  //     Fee + IVA ya aplicados dentro de aplicarMarkup).
  //   - Rama B (usaCredencialesPropias=true): solo el Fee de plataforma
  //     (el flete lo factura el courier al cliente directamente).
  // Se computa ANTES del saldo gate para que el bloqueo evalúe contra el
  // importe real y NO contra costoEnvio (que puede llevar el markup/descuento
  // del cliente y no representa el receivable de Shipro).
  // Además, se persiste en FinanzasEnvio SIEMPRE (incluso si el envío arranca
  // BLOQUEADO_*), para que los procesar-bloqueados* debiten el monto correcto
  // al desbloquear sin necesidad de recotizar ni conocer la rama.
  // ==============================================================
  let dataCotizacion: Awaited<ReturnType<typeof cotizar>> | null = null;
  try {
    // DEUDA 4 follow-up: usar CP real del depósito. Si deposito es null
    // (flujo BLOQUEADO_DEPOSITO), cpOrigen=undefined y cotizar usa fallback interno.
    dataCotizacion = await cotizar({
      empresaId,
      cpOrigen: deposito?.codigoPostal,
      cpDestino: String(cpDestino),
      provinciaDestino,
      paquetes: [{
        pesoKg: parseFloat(String(pesoReal)) || 1,
        // DEUDA 132: usar las dims reales si vienen del caller; fallback a 10
        // por backward-compat con callers legacy que sólo mandan pesoReal.
        largoCm: largoCm ?? 10,
        anchoCm: anchoCm ?? 10,
        altoCm: altoCm ?? 10,
        valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
        requiereSeguro: false
      }]
    });
  } catch (errCotizar) {
    console.warn("[FASE1] cotizar() fallo en crear.ts:", errCotizar);
  }

  // Torre de Control Metrica 3.3 + DEUDA 47: inferir modalidad canonica.
  // Necesario ANTES del rama-aware compute (Rama A matchea por courier +
  // familia de modalidad). Robusto a dataCotizacion null.
  const opcionesParaInferir = [
    ...(dataCotizacion?.domicilio || []),
    ...(dataCotizacion?.sucursal || []),
  ].map(o => ({ ...o, precioFinal: o.precioFinal.toNumber() }));
  const resultadoModalidad = inferirModalidad(
    opcionesParaInferir,
    nombreCourier,
    costoEnvio,
    modalidad
  );
  const modalidadCanonica = resultadoModalidad.modalidad;

  // Tarifa publicada del courier elegido (cotizada). Se puebla desde el match
  // de Rama A abajo; para Rama B se puebla despues dentro del bloque de fuga
  // (no afecta montoDebito). Si el match no encuentra opcion (fallback o
  // cotizacion vacia), queda null y la fuga se salta.
  let tarifaPublicadaElegida: Prisma.Decimal | null = null;

  // STEP 1 (dos-vías-liquidación): congelamos rama al alta + persistimos el
  // breakdown fee/logística/IVA. Invariante (rows no-fallback):
  //   feeNetoFacturado + logisticaNetaFacturada + ivaFacturado == precioFactura
  // Fallback Rama A: los 3 quedan NULL y ambos estados van a OBSERVADO (revisión manual).
  const ramaCongelada = credencialMain?.usaCredencialesPropias === true;
  let feeNetoFacturado: Prisma.Decimal | null = null;
  let logisticaNetaFacturada: Prisma.Decimal | null = null;
  let ivaFacturado: Prisma.Decimal | null = null;
  let estadoLiqFee: EstadoLiquidacion = EstadoLiquidacion.PENDIENTE;
  let estadoLiqLog: EstadoLiquidacion = EstadoLiquidacion.PENDIENTE;

  let montoDebito: Prisma.Decimal;
  if (credencialMain?.usaCredencialesPropias === true) {
    // Rama B: el flete lo factura el courier directo al cliente; Shipro solo cobra Fee.
    const feeB = await calcularFeeOperacion(empresaId, new Prisma.Decimal(0));
    montoDebito = feeB?.feeConIva ?? new Prisma.Decimal(0);
    // STEP 1: breakdown Rama B. Logística NO_APLICA por definición.
    if (feeB) {
      feeNetoFacturado = feeB.feePreIva;
      logisticaNetaFacturada = new Prisma.Decimal(0);
      ivaFacturado = feeB.feeConIva.sub(feeB.feePreIva);
    } else {
      // Sin OperacionFee vigente: montoDebito=0, breakdown todo cero (invariante 0=0).
      feeNetoFacturado = new Prisma.Decimal(0);
      logisticaNetaFacturada = new Prisma.Decimal(0);
      ivaFacturado = new Prisma.Decimal(0);
    }
    estadoLiqLog = EstadoLiquidacion.NO_APLICA;
  } else {
    // Rama A: tarifa publicada completa del courier elegido.
    const canonLowerA = modalidadCanonica.toLowerCase();
    const listaCanonicaA = (canonLowerA.includes("sucursal") || canonLowerA.includes("retiro"))
      ? (dataCotizacion?.sucursal || [])
      : (dataCotizacion?.domicilio || []);
    const courierLowerA = courierReal.nombre.toLowerCase();
    const opcionesDelCourierA = listaCanonicaA.filter(o => o.courier.toLowerCase() === courierLowerA);
    let matchedA: typeof listaCanonicaA[number] | undefined;
    if (opcionesDelCourierA.length === 1) {
      matchedA = opcionesDelCourierA[0];
    } else if (opcionesDelCourierA.length > 1) {
      // Multiples servicios del mismo courier: precio mas cercano a costoEnvioComprador
      // (mismo criterio que inferirModalidad para desambiguar servicio).
      matchedA = opcionesDelCourierA.reduce((prev, curr) =>
        prev.precioFinal.sub(costoEnvioComprador).abs().lt(curr.precioFinal.sub(costoEnvioComprador).abs()) ? prev : curr
      );
    }

    if (matchedA) {
      montoDebito = matchedA.precioFinal;
      // Propagar el match de Rama A al metric de fuga (evita re-matching / divergencia).
      tarifaPublicadaElegida = matchedA.precioFinal;
      // STEP 1 Rama A OK: breakdown desde el desglose ya propagado por cotizador
      // (Option A). Fuente única de verdad — no recomputamos.
      if (matchedA.desglose) {
        feeNetoFacturado = matchedA.desglose.feeNeto;
        logisticaNetaFacturada = matchedA.desglose.cascadaNeto.add(matchedA.desglose.smoNeto);
        ivaFacturado = matchedA.precioFinal.sub(matchedA.desglose.netoAcumulado);
      } else {
        // Defensive: post-Option A el desglose siempre viene. Si no, marcar OBSERVADO.
        estadoLiqFee = EstadoLiquidacion.OBSERVADO;
        estadoLiqLog = EstadoLiquidacion.OBSERVADO;
      }
    } else {
      // ============================================================
      // FALLBACK Rama A: red de seguridad de precio cuando no hay
      // cotización o el courier elegido no aparece en las opciones.
      //
      // FASE 2 motor mov 2 (2026-08-03): reconstruye la cascada completa
      // igual que cotización (intermediario owner-keyed + SMO por courier +
      // markup Shipro global con override + Fee). Cierra el GAP FASE 1 que
      // hacía UNDERCHARGE cuando el courier tenía intermediario vigente.
      //
      // CONTRATO STEP 1 (dos-vías-de-liquidación): cuando este fallback
      // dispara, resolverPrecioFallback devuelve solo {precio, fuente,
      // detalle} — sin desglose. Por lo tanto los campos de breakdown
      // (feeNetoFacturado / logisticaNetaFacturada / ivaFacturado) se
      // persisten como NULL y estadoLiquidacionFee se setea en OBSERVADO
      // para que la fila caiga a revisión manual en la proforma.
      // ============================================================
      montoDebito = new Prisma.Decimal(0);
      // STEP 1 Rama A FALLBACK: breakdown irrecuperable → NULLs + OBSERVADO en ambos tracks.
      // Estos envíos quedan excluidos de las proformas hasta revisión manual.
      estadoLiqFee = EstadoLiquidacion.OBSERVADO;
      estadoLiqLog = EstadoLiquidacion.OBSERVADO;
      if (deposito && credencialMain) {
        const modalidadSimpleA = (canonLowerA.includes("sucursal") || canonLowerA.includes("retiro"))
          ? "sucursal"
          : "domicilio";
        try {
          // FASE 2 motor mov 2: resolver los 4 términos de la cascada
          // (intermediario, markup Shipro, SMO, Fee) igual que cotización.
          const markupShiproPorcentajeFB = await resolverMarkupShiproPorcentaje(
            credencialMain.ajusteTarifaPorcentaje
          );
          const smoNetoFB = await resolverSmoNeto(courierIdReal);
          const intermediarioMarkupPorcentajeFB = await resolverIntermediarioMarkupPorcentaje(
            credencialMain,
            courierIdReal
          );
          const feeResFB = await calcularFeeOperacion(empresaId, new Prisma.Decimal(0));
          const feeShiproNetoFB = feeResFB?.feePreIva ?? new Prisma.Decimal(0);

          // DEUDA 123 mov 2 (2026-08-03): instanciamos el adapter para leer su
          // tarifaApiIncluyeIva estática (la bandera es propiedad del adapter,
          // no de la credencial). El fallback de crear.ts vive dentro del else
          // de Rama A → siempre usaCredencialesPropias=false → se puede usar
          // obtenerCredencialesShipro sin parsear un JSON. El flag no depende
          // de las credenciales concretas — mismo adapter, mismo valor.
          const nombreNormalizadoFB = normalizarParaComparacion(courierReal.nombre);
          const credencialesFB = obtenerCredencialesShipro(nombreNormalizadoFB);
          const motorCourierFB = CourierFactory.crear(nombreNormalizadoFB, credencialesFB);

          const fallbackA = await resolverPrecioFallback({
            courierId: courierIdReal,
            cpOrigen: deposito.codigoPostal,
            cpDestino: String(cpDestino),
            pesoKg: parseFloat(String(pesoReal)) || 1,
            modalidad: modalidadSimpleA,
            tarifaPlanaRespaldo: empresaConData.tarifaPlanaRespaldo,
            configMarkup: {
              usaCredencialesPropias: credencialMain.usaCredencialesPropias,
              ajusteTarifaPorcentaje: markupShiproPorcentajeFB,
              markupFijo: credencialMain.markupFijo,
              tarifaIncluyeIva: motorCourierFB.tarifaApiIncluyeIva,
              intermediarioMarkupPorcentaje: intermediarioMarkupPorcentajeFB,
              smoNeto: smoNetoFB,
              feeShiproNeto: feeShiproNetoFB,
            },
          });
          if (fallbackA.precio != null && fallbackA.precio.gt(0)) {
            montoDebito = fallbackA.precio;
            console.warn(`[FASE2] Rama A fallback aplicado: $${fallbackA.precio.toFixed(2)} (fuente: ${fallbackA.fuente}). Cascada completa reconstruida. ${fallbackA.detalle}`);
          }
        } catch (err) {
          console.warn("[FASE2] No se pudo resolver precio de fallback Rama A:", err);
        }
      }
    }
  }

  // FUGA financiera (AMBAS ramas): mide oportunidad de routing.
  // Compara el TOTAL COST del envío elegido (tarifa publicada del courier
  // elegido: para Rama A incluye cascada + SMO + Fee + IVA; para Rama B es
  // flete-del-courier + Fee + IVA) contra el TOTAL COST más barato cotizado
  // a esta empresa, uniendo domicilio ∪ sucursal Y AMBAS ramas.
  // Excluye reverse (cambio, devolucion): no son comparables con un envío
  // forward. NO usa montoDebito: en Rama B el débito es solo el Fee y la
  // comparación sería sin sentido (fee << cualquier tarifa completa → fuga
  // siempre 0). Fuente única del match Rama A: tarifaPublicadaElegida ya
  // sembrada arriba desde matchedA (evita re-match / divergencia con montoDebito).
  let fugaCalculada: Prisma.Decimal = new Prisma.Decimal(0);
  let courierSugeridoStr: string | null = null;
  let servicioSugeridoStr: string | null = null;
  if (dataCotizacion) {
    try {
      // Rama B: matchea el courier elegido SOLO para la métrica (no afecta
      // montoDebito, que ya es el Fee). Mismo criterio de match que Rama A:
      // courier + familia de modalidad canonica, precio cercano si hay varios servicios.
      if (tarifaPublicadaElegida == null && credencialMain?.usaCredencialesPropias === true) {
        const canonLowerB = modalidadCanonica.toLowerCase();
        const listaCanonicaB = (canonLowerB.includes("sucursal") || canonLowerB.includes("retiro"))
          ? (dataCotizacion.sucursal || [])
          : (dataCotizacion.domicilio || []);
        const courierLowerB = courierReal.nombre.toLowerCase();
        const opcionesDelCourierB = listaCanonicaB.filter(o => o.courier.toLowerCase() === courierLowerB);
        let matchedB: typeof listaCanonicaB[number] | undefined;
        if (opcionesDelCourierB.length === 1) {
          matchedB = opcionesDelCourierB[0];
        } else if (opcionesDelCourierB.length > 1) {
          matchedB = opcionesDelCourierB.reduce((prev, curr) =>
            prev.precioFinal.sub(costoEnvioComprador).abs().lt(curr.precioFinal.sub(costoEnvioComprador).abs()) ? prev : curr
          );
        }
        if (matchedB) {
          tarifaPublicadaElegida = matchedB.precioFinal;
        }
      }

      const universoFuga = [
        ...(dataCotizacion.domicilio || []),
        ...(dataCotizacion.sucursal || []),
      ];
      if (tarifaPublicadaElegida != null && universoFuga.length > 0) {
        const masBarata = universoFuga.reduce((prev, curr) => prev.precioFinal.lt(curr.precioFinal) ? prev : curr);
        if (masBarata.precioFinal.lt(tarifaPublicadaElegida)) {
          fugaCalculada = tarifaPublicadaElegida.sub(masBarata.precioFinal);
          courierSugeridoStr = masBarata.courier;
          servicioSugeridoStr = masBarata.modalidad;
        }
      }
    } catch (errorFuga) {}
  }

  // ==============================================================
  // VALIDACIÓN DE SALDO POR tipoCuenta (DEUDA 16)
  // Reusa `empresaConData` cargada arriba. La modalidad (PREPAGO/POSTPAGO)
  // afecta SOLO el timing, no el monto (montoDebito autoritativo ya está
  // rama-aware). Si no alcanza, NO se rebota la creación: el envío se crea
  // con SHP-* + BLOQUEADO_SALDO y se destraba al recargar saldo.
  // ==============================================================
  if (tipoCuentaEfectivo === "PREPAGO") {
    if ((empresaConData.saldoActivo ?? new Prisma.Decimal(0)).lt(montoDebito)) {
      bloqueadoPorSaldo = true;
    }
  } else { // POSTPAGO
    if ((empresaConData.saldoActivo ?? new Prisma.Decimal(0)).add(empresaConData.limiteDescubierto ?? new Prisma.Decimal(0)).lt(montoDebito)) {
      bloqueadoPorSaldo = true;
    }
  }

  // Prioridad de estados: DEPOSITO > CREDENCIAL > OPERATIVIDAD > SALDO.
  // Si aplican varios, el envío arranca en el más "fundamental" y cascadea
  // en los reintentos: cada procesar-bloqueados-* revalida saldo y transiciona
  // a BLOQUEADO_SALDO si no alcanza. FASE 2 pieza 1 sub 3 agregó CREDENCIAL
  // entre DEPOSITO y OPERATIVIDAD.
  if (bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorCredencial && !bloqueadoPorOperatividad) {
    estadoInicialEnvio = "BLOQUEADO_SALDO";
  }

  // DESPACHO AL COURIER (solo si NO falló el peaje, NO está bloqueado por saldo
  // ni por depósito, y hay credencial + depósito disponibles).
  if (!falloPorPeaje && !bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorCredencial && !bloqueadoPorOperatividad && credencialMain && credencialMain.activo && deposito) {
    const dispatchResult = await despacharCourier({
      credencial: credencialMain,
      courierNombreCanonico: courierReal.nombre,
      // DEUDA 29 Sub-fase 1.C.2: courierIdMain + tipoOrigen + sucursales (pass-through).
      courierIdMain: courierReal.id,
      tipoOrigen: tipoOrigen ?? "recoleccion_courier",
      sucursalOrigenId: sucursalOrigenId ?? null,
      sucursalDestinoId: sucursalDestinoId ?? null,
      // DEUDA 29 Sub-fase 2.D.despachar: depositoId para que dispatch.ts resuelva
      // la sucursal de imposición preferida del cliente (DepositoSucursalPreferida).
      depositoId: deposito.id,
      // DEUDA 29 Sub-fase 6.D.5: pasar deposito y config pre-cargados para que
      // dispatch.ts use el modelo nuevo (recogeViaConsolidador + courierRecolectorId)
      // y evite lookups internos duplicados.
      deposito,
      config: depositoCourierConfig,
      destinatarioNombre,
      calle: calle || "",
      altura: altura || "",
      piso, dpto,
      localidad: localidad || "",
      provincia: provinciaDestino,
      cp: String(cpDestino),
      dni: dni || "",
      email: email || "",
      telefono: telefono || "",
      pesoReal: parseFloat(String(pesoReal)) || 1,
      valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
      modalidad,
      numeroOrden,
      // DEUDA 4: pasar el origen real del depósito al courier (resuelve bug latente
      // donde los adapters imprimían etiquetas con "Av. Libertador 1234" hardcoded).
      origen: {
        calle: deposito.direccionCalle,
        altura: deposito.direccionAltura,
        cp: deposito.codigoPostal,
        localidad: deposito.localidad,
        provincia: deposito.provincia,
        pais: deposito.pais,
        telefono: deposito.contactoTelefono,
        email: deposito.contactoEmail || undefined,
      },
    });

    // DEUDA 29 Sub-fase 1.C.2: capturar snapshots de tramos para persistirlos en la tx.
    dispatchTramos = dispatchResult.tramos;
    // Molde multi-bulto paso 1b: capturar bultos del despacho (fase 1a.1 los propaga
    // desde el adapter a través de dispatch.ts). Hoy 1 bulto → 1 fila en EnvioBulto.
    dispatchBultos = dispatchResult.bultos ?? [];

    if (dispatchResult.tracking) {
      // Despacho exitoso (caso A, B o C con todos los tramos OK).
      trackingOficial = dispatchResult.tracking;
      urlEtiquetaFinal = dispatchResult.etiquetaUrl;
    } else {
      // PARTIAL FAILURE: BLOQUEADO_PARCIAL.
      // - tracking visible queda como SHP-XXXXXX (etiqueta diferida).
      // - Se persisten los tramos que sí se despacharon (puede ser 0 o más, ej. caso C
      //   con tramo 1 OK + tramo 2 falla → dispatchTramos.length === 1).
      // - Operador debe resolver la falla manualmente (Sub-fase 3 agregará reintento auto).
      bloqueadoPorTramoFallido = true;
      estadoInicialEnvio = "BLOQUEADO_PARCIAL";
      errorTramo = dispatchResult.error || "Error desconocido en despacho";
    }
  }

  // DEUDA 106 pieza 2 mov 2 (2026-08-04): token de corrección para el comprador.
  // Se genera SÓLO si el envío nace RETENIDO (falloPorPeaje === true); expira
  // en 48h. Se persiste en Envio.correccionToken/correccionTokenExpira dentro
  // de la tx (línea ~795) y viaja al comprador en el mail de retenido más
  // abajo (línea ~955). NADA VALIDA el token todavía — la validación se
  // conecta en el movimiento 4 (endpoints buscar + corregir aceptan
  // token OR session). 192 bits de entropía via randomBytes(24) → base64url
  // = 32 chars URL-safe unguessable.
  const correccionToken = falloPorPeaje ? randomBytes(24).toString("base64url") : null;
  const correccionTokenExpira = falloPorPeaje ? new Date(Date.now() + 48 * 60 * 60 * 1000) : null;

  const resultadoTransaccion = await prisma.$transaction(async (tx) => {
    const empresaData = await tx.empresa.findUnique({ where: { id: empresaId } });
    if (empresaData) empresaNombreParaMail = empresaData.nombre;

    let nuevoSaldo: Prisma.Decimal = (empresaData?.saldoActivo ?? new Prisma.Decimal(0)).sub(montoDebito);

    // Decision de producto: las etiquetas genericas/bloqueadas NO debitan
    // nada; el cobro espera a que haya etiqueta real (en el alta, o en el
    // desbloqueo posterior via procesar-bloqueados*). El monto autoritativo
    // ya se persiste en FinanzasEnvio.precioFactura mas abajo, para que los
    // desbloqueos debiten el importe correcto sin recotizar.

    // Torre de Control Metrica 2.3 (DEUDA 39, 2026-06-05):
    // Calcular promesa calibrada al crear envio para medir cumplimiento
    // historico estable. Es la mejor estimacion de Shipro de lo que habria
    // prometido al comprador en este momento (P75 calibrado actual).
    // Una vez persistido, el cumplimiento futuro se mide contra este valor
    // fijo, no contra el calibrado vigente al momento de la entrega.
    const promesaCalibrada = await calcularPromesaCalibrada(
      courierIdReal,
      deposito?.id ?? null,
      provinciaDestino,
      courierReal.nombre
    );
    const diasPrometidosCalculados = Math.ceil(promesaCalibrada.slaHoras / 24);

    const envioCreado = await tx.envio.create({
      data: {
        trackingNumber: trackingOficial,
        diasPrometidosCheckout: diasPrometidosCalculados,
        // TODO DEUDA 29 Sub-fase 3: tracking del first-mile ahora vive en TramoEnvio.trackingExterno.
        numeroOrden: numeroOrden || null,
        // DEUDA 128: persistir la clave del plugin para que la ruta pueda
        // detectar reintentos y devolver la etiqueta existente sin re-crear.
        idempotencyKey: idempotencyKey ?? null,
        etiquetaUrl: urlEtiquetaFinal,
        pesoReal: parseFloat(String(pesoReal)) || 1.0,
        // DEUDA 132 (2026-08-24): dims gemelas de pesoReal. Se persisten al crear
        // (incluso si el envío nace bloqueado) para que sobrevivan al re-despacho.
        // Threading al courier queda en Paso 2; guardarail en Paso 3.
        largoCm: largoCm ?? null,
        anchoCm: anchoCm ?? null,
        altoCm: altoCm ?? null,
        estadoActual: estadoInicialEnvio,
        modalidad: modalidadCanonica,
        // DEUDA 106 pieza 2 mov 2: token de corrección (RETENIDO only). null si
        // el envío no nace RETENIDO. Ver bloque de generación arriba.
        correccionToken,
        correccionTokenExpira,
        // === DEUDA 35: persistir tipoOrigen del input ===
        // Sin esto el schema default ("recoleccion_courier") siempre se aplicaba,
        // aunque dispatch ramificara bien por el valor del input.
        tipoOrigen: tipoOrigen ?? "recoleccion_courier",
        empresa: { connect: { id: empresaId } },
        courier: { connect: { id: courierIdReal } },
        // Si bloqueadoPorDeposito: origen y deposito quedan en null hasta que
        // procesarEnviosBloqueadosPorDeposito() los pueble post-configuración.
        ...(direccionOrigen ? { origen: { connect: { id: direccionOrigen.id } } } : {}),
        ...(deposito ? { deposito: { connect: { id: deposito.id } } } : {}),
        destino: { connect: { id: direccionId } },
        finanzas: {
          create: {
            precioProveedor: montoProveedor,
            precioFactura: montoDebito,          // FASE 1: autoritativo (recomputado, rama-aware)
            precioMostrado: costoEnvioComprador, // FASE 1: buyer-facing (puede tener markup/descuento del cliente)
            valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
            pesoCobrado: parseFloat(String(pesoReal)) || 1.0,
            fugaFinanciera: fugaCalculada,
            courierSugerido: courierSugeridoStr,
            servicioSugerido: servicioSugeridoStr,
            // STEP 1: rama congelada + breakdown para las dos proformas.
            ramaCongelada,
            feeNetoFacturado,
            logisticaNetaFacturada,
            ivaFacturado,
            estadoLiquidacionFee: estadoLiqFee,
            estadoLiquidacionLogistica: estadoLiqLog,
          }
        }
      },
      include: { courier: true, destino: true, finanzas: true }
    });

    // DEUDA 29 Sub-fase 1.C.2: persistir los TramoEnvio que dispatch.ts ejecutó.
    // Pueden ser 0 (todo falló o flujo bloqueado pre-despacho), 1 (caso A/B exitoso
    // o caso C con tramo 1 OK + tramo 2 falla), o 2 (caso C completo).
    if (dispatchTramos.length > 0) {
      await tx.tramoEnvio.createMany({
        data: dispatchTramos.map(t => ({
          envioId: envioCreado.id,
          orden: t.orden,
          courierId: t.courierId,
          tipo: t.tipo,
          trackingExterno: t.trackingExterno,
          sucursalOrigenId: t.sucursalOrigenId ?? null,
          sucursalDestinoId: t.sucursalDestinoId ?? null,
        })),
      });
    }

    // Molde multi-bulto paso 1b: persistir los bultos despachados en EnvioBulto.
    // Hoy 1 bulto → 1 fila. Predicción (peso/dims) a nivel envío (único bulto);
    // cuando el motor de empaquetado genere N, cada bulto traerá sus propios dims.
    // Solo en despacho exitoso (dispatchBultos poblado); paths bloqueados lo crean
    // cuando se destraban (procesar-bloqueados*, fase futura).
    if (dispatchBultos.length > 0) {
      await tx.envioBulto.createMany({
        data: dispatchBultos.map((b, i) => ({
          envioId: envioCreado.id,
          orden: i + 1,
          pesoKg: parseFloat(String(pesoReal)) || 1.0,
          largoCm: largoCm ?? null,
          anchoCm: anchoCm ?? null,
          altoCm: altoCm ?? null,
          valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
          trackingExterno: b.tracking ?? null,
          etiquetaUrl: b.etiquetaUrl ?? null,
          numeroBulto: b.numeroBulto ?? null,
          totalizador: b.totalizador ?? null,
        })),
      });
    }

    // Si BLOQUEADO_SALDO, BLOQUEADO_DEPOSITO, BLOQUEADO_OPERATIVIDAD o
    // BLOQUEADO_PARCIAL: NO crear MovimientoFinanciero ni actualizar saldo.
    // El débito se aplica al desbloquear (procesar-bloqueados*), que lee
    // FinanzasEnvio.precioFactura (autoritativo, rama-aware, ya persistido arriba).
    if (!bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorCredencial && !bloqueadoPorOperatividad && !bloqueadoPorTramoFallido) {
      // FASE 1 (DEUDA 73/107): montoDebito ya incluye Fee (Rama B: solo Fee;
      // Rama A: tarifa completa con Fee ya adentro via aplicarMarkup). Un solo
      // MovimientoFinanciero cubre todo. Rama-aware descripcion para que el
      // extracto del cliente sea legible.
      const descripcionRama = credencialMain?.usaCredencialesPropias === true
        ? `Fee Shipro ${trackingOficial} — ${courierReal.nombre} (flete facturado por el courier al cliente)`
        : `Envío ${trackingOficial} — ${courierReal.nombre}`;

      await tx.movimientoFinanciero.create({
        data: {
          empresaId,
          tipo: "DEBITO_ENVIO",
          monto: montoDebito.neg(),
          saldoPosterior: nuevoSaldo,
          referencia: trackingOficial,
          descripcion: descripcionRama,
          envioId: envioCreado.id
        }
      });

      await tx.empresa.update({
        where: { id: empresaId },
        data: { saldoActivo: nuevoSaldo }
      });

      // DEUDA 22 (2026-06-18): evaluar suspension post-debit.
      // Si saldo cruzo umbral -(limite * 1.5), marcar Empresa.suspendida=true.
      // El helper suspenderEmpresa actualiza BD + audit log + mail admin.
      // NOTA: corre fuera de la tx (la tx ya cerro este update). Si suspenderEmpresa
      // falla, el debit queda commited (intencional: no queremos rollbackear envios
      // legitimos por fallas en notificaciones).
      const { debeSuspender } = evaluarSuspension(
        nuevoSaldo,
        empresaConData.limiteDescubierto ?? new Prisma.Decimal(0),
        false  // suspendidaActual = false porque si fuera true, el pre-check lo hubiera bloqueado
      );
      if (debeSuspender) {
        // Schedule post-tx (no await dentro de la tx).
        suspensionPendiente = {
          saldoFinal: nuevoSaldo,
          limiteAfectado: empresaConData.limiteDescubierto ?? new Prisma.Decimal(0),
        };
      }
    }

    if (bloqueadoPorTramoFallido) {
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_PARCIAL", observacion: `Bloqueado por falla en despacho del courier: ${errorTramo}. Tramos persistidos: ${dispatchTramos.length}. El operador debe resolver la falla manualmente.`, envioId: envioCreado.id } });
    } else if (bloqueadoPorDeposito) {
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_DEPOSITO", observacion: `Bloqueado: la empresa no tiene depósito predeterminado configurado. Se desbloqueará automáticamente cuando se configure uno en /configuracion/depositos.`, envioId: envioCreado.id } });
    } else if (bloqueadoPorCredencial) {
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_CREDENCIAL", observacion: `Credencial de ${courierReal.nombre} es Rama A pero no tiene dueño configurado. Se desbloqueará automáticamente cuando admin_shipro asigne el dueño en /configuracion/transportes.`, envioId: envioCreado.id } });
    } else if (bloqueadoPorOperatividad) {
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_OPERATIVIDAD", observacion: `Par (depósito × courier) no operativo. Motivos: ${motivosOperatividad.join(", ")}. Detalle: ${detalleOperatividad.join("; ")}. Configurá el par en /configuracion/depositos.`, envioId: envioCreado.id } });
    } else if (bloqueadoPorSaldo) {
      const saldoDisponible = (empresaData?.saldoActivo ?? new Prisma.Decimal(0)).add(tipoCuentaEfectivo === "POSTPAGO" ? (empresaData?.limiteDescubierto ?? new Prisma.Decimal(0)) : new Prisma.Decimal(0));
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_SALDO", observacion: `Bloqueado por saldo insuficiente. Costo $${montoDebito.toFixed(2)}, disponible $${saldoDisponible.toFixed(2)} (${tipoCuentaEfectivo}). Se desbloqueará al recargar saldo.`, envioId: envioCreado.id } });
    } else if (falloPorPeaje) {
      await tx.eventoTracking.create({ data: { estado: "RETENIDO", observacion: `Retenido en Peaje: ${motivoRetencion}`, envioId: envioCreado.id } });
    } else {
      await tx.eventoTracking.create({ data: { estado: "Pendiente", observacion: "Envío registrado en plataforma y etiqueta generada.", envioId: envioCreado.id } });
    }

    // DEUDA 22: si el debit cruzo umbral, marcar suspensionPendiente fuera de tx.
    // Esto se ejecuta DENTRO de la tx solo para validacion logica (no escritura).

    return envioCreado;
  });

  // DEUDA 22 (post-tx): si el debit cruzo umbral, ejecutar suspension ahora.
  // Pasamos request=null porque crearEnvio no recibe Request — audit log
  // queda con rolUsuario="system". El envio del cruce ya quedo creado en
  // BD (no rollbackeamos por fallas en notificaciones).
  //
  // TS narrowing nota: TS no puede trackear asignaciones dentro del closure
  // async de prisma.$transaction, por eso narrowa a `never`. Cast explicito
  // bypasea la limitacion. Patron estandar para state-via-closure.
  if (suspensionPendiente) {
    const pending = suspensionPendiente as { saldoFinal: Prisma.Decimal; limiteAfectado: Prisma.Decimal };
    try {
      await suspenderEmpresa(
        empresaId,
        null,
        pending.saldoFinal,
        pending.limiteAfectado
      );
    } catch (suspendErr) {
      console.error("[DEUDA 22] suspenderEmpresa fallo post-tx (envio OK igual):", suspendErr);
    }
  }

  // Mails: NO mandar si está bloqueado por saldo, depósito o partial failure
  // (el destinatario no debe recibir notificación hasta que el envío se destrabe
  // y tenga tracking real).
  if (email && !bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorCredencial && !bloqueadoPorOperatividad && !bloqueadoPorTramoFallido) {
    // DEUDA 14: si APP_URL no esta configurada, NO mandamos mail con link
    // a localhost. El envio se creo en BD — no rompemos el flujo por mail.
    // Principio operativo: que la venta no se pierda.
    const baseUrl = getAppUrl();
    if (baseUrl) {
      if (falloPorPeaje) {
        const { enviarMailRetenido } = await import("@/lib/mailer");
        // DEUDA 106 pieza 2 mov 2: URL lleva el token generado arriba (~línea 760).
        // falloPorPeaje=true acá → correccionToken es non-null por construcción.
        await enviarMailRetenido(email, trackingOficial, destinatarioNombre, `${baseUrl}/corregir/${trackingOficial}?token=${correccionToken}`, empresaNombreParaMail);
      } else {
        // QW#5 (2026-06-02): path /s/ es el canonico, /seguimiento es redirect deprecado.
        enviarMailCreacion(email, trackingOficial, destinatarioNombre, courierReal.nombre, `${baseUrl}/s/${trackingOficial}`);
      }
    }
  }

  return {
    ...resultadoTransaccion,
    trackingNumber: trackingOficial,
    bloqueadoPorSaldo,
    bloqueadoPorDeposito,
    bloqueadoPorTramoFallido,
    bloqueadoPorOperatividad,
    bloqueadoPorCredencial,
    estado: estadoInicialEnvio
  };
}

import prisma from "@/lib/prisma";
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
import { calcularFeeOperacion, type ResultadoFeeOperacion } from "@/lib/utils/operacion-fee";
import type { DepositoCourierConfig } from "@prisma/client";

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
    empresaId, depositoId: depositoIdInput, permitirBloqueoPorDeposito, destinatarioNombre, cpDestino, pesoReal, nombreCourier,
    calle, altura, piso, dpto, dni, email, telefono, localidad, modalidad,
    valorDeclarado, costoEnvio, costoProveedor, provinciaDestino, numeroOrden,
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
  // REGLA DEL PEAJE (Google Maps)
  // ==============================================================
  const calleLower = calle?.toLowerCase() || "";
  const alturaStr = altura?.toString().trim() || "";

  const keywordsTolerancia = ["lote", "ruta", "km", "barrio", "manzana", "country", "s/n", "sin numero", "parcela"];
  const tienePalabraClave = keywordsTolerancia.some(kw => calleLower.includes(kw));

  if (!calle || calle.trim() === "") {
    estadoInicialEnvio = "RETENIDO";
    falloPorPeaje = true;
    motivoRetencion = "El nombre de la calle está vacío.";
  } else if (!alturaStr && !tienePalabraClave) {
    estadoInicialEnvio = "RETENIDO";
    falloPorPeaje = true;
    motivoRetencion = "Falta altura y no posee palabras clave de excepción.";
  }

  if (!falloPorPeaje) {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (apiKey) {
      try {
        const direccionQuery = `${calle} ${alturaStr}, ${localidad}, ${provinciaDestino}, Argentina`;
        const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccionQuery)}&key=${apiKey}`);
        const geoData = await geoRes.json();

        if (geoData.status === "ZERO_RESULTS") {
          estadoInicialEnvio = "RETENIDO";
          falloPorPeaje = true;
          motivoRetencion = "Google Maps no pudo ubicar esta dirección en el mapa.";
        } else if (geoData.status === "OK" && geoData.results.length > 0) {
          const primerResultado = geoData.results[0];

          const isStreetLevel = primerResultado.types.includes("street_address") ||
                                primerResultado.types.includes("route") ||
                                primerResultado.types.includes("premise") ||
                                primerResultado.types.includes("intersection");

          if (!isStreetLevel && !tienePalabraClave) {
            estadoInicialEnvio = "RETENIDO";
            falloPorPeaje = true;
            motivoRetencion = `La calle no parece ser válida. Google solo encontró la zona o localidad.`;
          } else {
            let cpGoogle = "";
            for (const comp of primerResultado.address_components) {
              if (comp.types.includes("postal_code")) {
                cpGoogle = comp.long_name.replace(/\D/g, '');
              }
            }

            const cpUserLimpio = String(cpDestino).replace(/\D/g, '');
            if (cpGoogle && cpUserLimpio && cpGoogle.substring(0, 2) !== cpUserLimpio.substring(0, 2)) {
              estadoInicialEnvio = "RETENIDO";
              falloPorPeaje = true;
              motivoRetencion = `Discrepancia geográfica: El CP ingresado difiere de la zona real.`;
            }
          }
        }
      } catch (geoErr) {
        console.warn("Error en Geocoding API.");
      }
    }
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

  if (deposito && credencialMain && !bloqueadoPorDeposito && !falloPorPeaje) {
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
  let montoDebito = parseFloat(String(costoEnvio)) || 0;
  const tipoCuentaEfectivo = credencialMain?.tipoCuenta || empresaConData.modalidadPago || "POSTPAGO";
  let bloqueadoPorSaldo = false;
  // DEUDA 22: si el debit cruza umbral, se programa suspension fuera de la tx.
  let suspensionPendiente: { saldoFinal: number; limiteAfectado: number } | null = null;

  if (tipoCuentaEfectivo === "PREPAGO") {
    if ((empresaConData.saldoActivo || 0) < montoDebito) {
      bloqueadoPorSaldo = true;
    }
  } else { // POSTPAGO
    if ((empresaConData.saldoActivo || 0) + (empresaConData.limiteDescubierto || 0) < montoDebito) {
      bloqueadoPorSaldo = true;
    }
  }

  // Prioridad de estados: BLOQUEADO_DEPOSITO > BLOQUEADO_SALDO. Si ambos
  // aplican, el envío arranca como BLOQUEADO_DEPOSITO; cuando se configure
  // depósito, la función procesarEnviosBloqueadosPorDeposito() valida saldo
  // y transiciona a BLOQUEADO_SALDO si no alcanza.
  if (bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorOperatividad) {
    estadoInicialEnvio = "BLOQUEADO_SALDO";
  }

  // DESPACHO AL COURIER (solo si NO falló el peaje, NO está bloqueado por saldo
  // ni por depósito, y hay credencial + depósito disponibles).
  if (!falloPorPeaje && !bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorOperatividad && credencialMain && credencialMain.activo && deposito) {
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

  // montoDebito ya fue calculado arriba para la validación de saldo.
  const montoProveedor = parseFloat(String(costoProveedor)) || 0;
  let empresaNombreParaMail = "la Tienda";

  let fugaCalculada = 0;
  let courierSugeridoStr: string | null = null;
  let servicioSugeridoStr: string | null = null;

  // dataCotizacion declarado en function-scope: el bloque de inferencia de
  // modalidad (Metrica 3.3 / DEUDA 47) tambien lo consume mas abajo, fuera
  // del try-catch de fuga financiera.
  let dataCotizacion: Awaited<ReturnType<typeof cotizar>> | null = null;
  try {
    // DEUDA 4 follow-up (cierre del "1050" hardcoded latente): usar CP real del
    // depósito de origen para el cálculo de fugaFinanciera. Si deposito es null
    // (flujo BLOQUEADO_DEPOSITO), pasamos undefined y el cotizador interno usa
    // su fallback al predeterminado de la empresa.
    dataCotizacion = await cotizar({
      empresaId,
      cpOrigen: deposito?.codigoPostal,
      cpDestino: String(cpDestino),
      provinciaDestino,
      paquetes: [{
        pesoKg: parseFloat(String(pesoReal)) || 1,
        largoCm: 10, anchoCm: 10, altoCm: 10,
        valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
        requiereSeguro: false
      }]
    });

    const mod = modalidad?.toLowerCase() || "";
    let opcionesParaComparar: any[] = [];

    if (mod.includes('sucursal')) opcionesParaComparar = dataCotizacion.sucursal || [];
    else if (mod.includes('domicilio') || mod.includes('estándar') || mod.includes('sameday') || mod.includes('same-day')) opcionesParaComparar = dataCotizacion.domicilio || [];

    if (opcionesParaComparar.length > 0) {
      const opcionMasBarata = opcionesParaComparar.reduce((prev, curr) => prev.precioFinal < curr.precioFinal ? prev : curr);
      if (opcionMasBarata.precioFinal < montoDebito) {
        fugaCalculada = montoDebito - opcionMasBarata.precioFinal;
        courierSugeridoStr = opcionMasBarata.courier;
        servicioSugeridoStr = opcionMasBarata.modalidad;
      }
    }
  } catch (errorFuga) {}

  // Torre de Control Metrica 3.3 + DEUDA 47 (2026-06-09):
  // Inferir modalidad canonica usando el helper compartido. Estrategia
  // β+δ defensa en capas:
  // 1. Si el e-commerce mando body.modalidad y es normalizable → usar.
  // 2. Si no, matchear contra opciones del cotizador (curr + precio).
  // 3. Si no, fallback al primer match del courier.
  // 4. Si nada matchea, "Entrega a Domicilio (Estandar)" default.
  // El bloque va FUERA de la transaccion: no requiere tx ni queries
  // adicionales, es logica pura sobre el resultado ya obtenido del
  // cotizador (dataCotizacion).
  const opcionesParaInferir = [
    ...(dataCotizacion?.domicilio || []),
    ...(dataCotizacion?.sucursal || []),
  ];
  const resultadoModalidad = inferirModalidad(
    opcionesParaInferir,
    nombreCourier,
    costoEnvio,
    modalidad
  );
  const modalidadCanonica = resultadoModalidad.modalidad;

  // DEUDA 10 Paso 4a (D-10-FALLBACK-PRICE, Opcion A): red de seguridad de precio.
  // Si el courier fallo al despachar (BLOQUEADO_PARCIAL) Y el e-commerce NO mando
  // un costoEnvio valido, publicamos un precio de fallback para que la venta no se
  // caiga (siempre haya tarifa en el checkout). NO pisa un precio ya aceptado por
  // el comprador (solo entra si montoDebito <= 0). NO debita saldo ni fee (eso es Paso 4b).
  if (bloqueadoPorTramoFallido && montoDebito <= 0 && deposito && credencialMain) {
    // D-10-MODALIDAD-MAP: traducir modalidad canonica (8-value) -> vocabulario
    // simple del courier ("domicilio"/"sucursal") que usa HistoricoCotizaciones.
    const modalidadSimple = modalidadCanonica.toLowerCase().includes("sucursal") ||
      modalidadCanonica.toLowerCase().includes("retiro")
      ? "sucursal"
      : "domicilio";

    try {
      const fallback = await resolverPrecioFallback({
        courierId: courierIdReal,
        cpOrigen: deposito.codigoPostal,
        cpDestino: String(cpDestino),
        pesoKg: parseFloat(String(pesoReal)) || 1,
        modalidad: modalidadSimple,
        tarifaPlanaRespaldo: empresaConData.tarifaPlanaRespaldo,
        configMarkup: {
          usaCredencialesPropias: credencialMain.usaCredencialesPropias,
          ajusteTarifaPorcentaje: credencialMain.ajusteTarifaPorcentaje,
          markupFijo: credencialMain.markupFijo,
          tarifaIncluyeIva: credencialMain.tarifaIncluyeIva,
        },
      });
      if (fallback.precio != null && fallback.precio > 0) {
        montoDebito = fallback.precio;
        console.log(`[DEUDA 10] Precio de fallback aplicado a envio bloqueado: $${fallback.precio} (fuente: ${fallback.fuente}). ${fallback.detalle}`);
      }
    } catch (err) {
      console.warn("[DEUDA 10] No se pudo resolver precio de fallback:", err);
    }
  }

  const resultadoTransaccion = await prisma.$transaction(async (tx) => {
    const empresaData = await tx.empresa.findUnique({ where: { id: empresaId } });
    if (empresaData) empresaNombreParaMail = empresaData.nombre;

    let nuevoSaldo = (empresaData?.saldoActivo || 0) - montoDebito;

    // DEUDA 10 Paso 4b (D-10-FEE-CHARGE): el fee por operacion se calcula y debita
    // ABAJO, DENTRO del gate de debito de envio (solo cuando se emite etiqueta REAL
    // del courier, es decir cuando el envio NO esta bloqueado). Decision de producto:
    // las etiquetas genericas/bloqueadas NO debitan nada; el cobro espera a que haya
    // etiqueta real (en el alta, o en el desbloqueo posterior — ese ultimo es DEUDA 79).
    let feeOperacion: ResultadoFeeOperacion | null = null;

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
        etiquetaUrl: urlEtiquetaFinal,
        pesoReal: parseFloat(String(pesoReal)) || 1.0,
        estadoActual: estadoInicialEnvio,
        modalidad: modalidadCanonica,
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
            precioFactura: montoDebito,
            precioMostrado: montoDebito,
            valorDeclarado: parseFloat(String(valorDeclarado)) || 0,
            pesoCobrado: parseFloat(String(pesoReal)) || 1.0,
            fugaFinanciera: fugaCalculada,
            courierSugerido: courierSugeridoStr,
            servicioSugerido: servicioSugeridoStr
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

    // Si BLOQUEADO_SALDO, BLOQUEADO_DEPOSITO o BLOQUEADO_PARCIAL: NO crear
    // MovimientoFinanciero ni actualizar saldo. El débito se aplica recién
    // cuando se desbloquee.
    if (!bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorOperatividad && !bloqueadoPorTramoFallido) {
      // DEUDA 10 Paso 4b (D-10-FEE-CHARGE): fee por operacion para PREPAGO (Modelo B).
      // Se cobra SOLO aca (etiqueta real, envio no bloqueado). Detector: eje comercial
      // tipoCuentaEfectivo === "PREPAGO", NO el eje credenciales. Lectura atomica via tx.
      // El costo courier (montoDebito) ya esta restado de nuevoSaldo arriba; aca se le
      // resta ademas el fee, y se persiste un movimiento separado por claridad.
      if (tipoCuentaEfectivo === "PREPAGO") {
        feeOperacion = await calcularFeeOperacion(empresaId, montoDebito, tx);
        if (feeOperacion) {
          nuevoSaldo = nuevoSaldo - feeOperacion.feeConIva;
        }
      }

      await tx.movimientoFinanciero.create({
        data: {
          empresaId,
          tipo: "DEBITO_ENVIO",
          monto: -montoDebito,
          saldoPosterior: feeOperacion ? nuevoSaldo + feeOperacion.feeConIva : nuevoSaldo,
          referencia: trackingOficial,
          descripcion: `Envío ${trackingOficial} — ${courierReal.nombre}`,
          envioId: envioCreado.id
        }
      });

      // Movimiento separado para el fee (solo PREPAGO con fee vigente).
      if (feeOperacion) {
        await tx.movimientoFinanciero.create({
          data: {
            empresaId,
            tipo: "DEBITO_OPERACION_FEE",
            monto: -feeOperacion.feeConIva,
            saldoPosterior: nuevoSaldo,
            referencia: trackingOficial,
            descripcion: `Fee de operación Shipro ${trackingOficial}`,
            envioId: envioCreado.id
          }
        });
      }

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
        empresaConData.limiteDescubierto || 0,
        false  // suspendidaActual = false porque si fuera true, el pre-check lo hubiera bloqueado
      );
      if (debeSuspender) {
        // Schedule post-tx (no await dentro de la tx).
        suspensionPendiente = {
          saldoFinal: nuevoSaldo,
          limiteAfectado: empresaConData.limiteDescubierto || 0,
        };
      }
    }

    if (bloqueadoPorTramoFallido) {
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_PARCIAL", observacion: `Bloqueado por falla en despacho del courier: ${errorTramo}. Tramos persistidos: ${dispatchTramos.length}. El operador debe resolver la falla manualmente.`, envioId: envioCreado.id } });
    } else if (bloqueadoPorDeposito) {
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_DEPOSITO", observacion: `Bloqueado: la empresa no tiene depósito predeterminado configurado. Se desbloqueará automáticamente cuando se configure uno en /configuracion/depositos.`, envioId: envioCreado.id } });
    } else if (bloqueadoPorOperatividad) {
      await tx.eventoTracking.create({ data: { estado: "BLOQUEADO_OPERATIVIDAD", observacion: `Par (depósito × courier) no operativo. Motivos: ${motivosOperatividad.join(", ")}. Detalle: ${detalleOperatividad.join("; ")}. Configurá el par en /configuracion/depositos.`, envioId: envioCreado.id } });
    } else if (bloqueadoPorSaldo) {
      const saldoDisponible = (empresaData?.saldoActivo || 0) + (tipoCuentaEfectivo === "POSTPAGO" ? (empresaData?.limiteDescubierto || 0) : 0);
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
    const pending = suspensionPendiente as { saldoFinal: number; limiteAfectado: number };
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
  if (email && !bloqueadoPorSaldo && !bloqueadoPorDeposito && !bloqueadoPorOperatividad && !bloqueadoPorTramoFallido) {
    // DEUDA 14: si APP_URL no esta configurada, NO mandamos mail con link
    // a localhost. El envio se creo en BD — no rompemos el flujo por mail.
    // Principio operativo: que la venta no se pierda.
    const baseUrl = getAppUrl();
    if (baseUrl) {
      if (falloPorPeaje) {
        const { enviarMailRetenido } = await import("@/lib/mailer");
        await enviarMailRetenido(email, trackingOficial, destinatarioNombre, `${baseUrl}/corregir/${trackingOficial}`, empresaNombreParaMail);
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
    estado: estadoInicialEnvio
  };
}

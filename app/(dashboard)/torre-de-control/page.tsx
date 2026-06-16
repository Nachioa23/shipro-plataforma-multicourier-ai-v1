"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { AlertCircle, Clock, Map, ArrowRightLeft, Target, Building2, Activity, Box, SlidersHorizontal, PackageCheck, Headset, TrendingDown, Truck, Store, MapPin, ZoomIn, X, BarChart, PieChart, HeartHandshake, ShieldAlert, Loader2, Check, ShieldCheck, MapPinned, SearchCode, DollarSign, TrendingUp, Lightbulb, Calendar, CheckCircle2, Scale, Undo2, LifeBuoy, ListChecks, Timer, Wallet, Warehouse } from 'lucide-react';
import Link from "next/link"; 

export default function TorreDeControl() {
  const { data: session } = useSession();
  const [showFiltros, setShowFiltros] = useState(false);
  const [metricaAnalisis, setMetricaAnalisis] = useState<string | null>(null);
  const [zonaSlaSeleccionada, setZonaSlaSeleccionada] = useState<any | null>(null);

  const [metricas, setMetricas] = useState<any>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);

  // Torre de Control Metrica 1.1 (2026-06-04): endurecido el chequeo de rol Shipro.
  // Antes: includes('admin') || includes('shipro') — permitia false positives en roles
  // futuros tipo admin_cliente o admin_finanzas. Ahora: solo los dos roles canonicos
  // de equipo Shipro pasan. Alineado con resolverContext del server-side y con la
  // politica declarada: clientes NO entran a Torre de Control (tienen Panel de Control).
  const rolUsuario = session?.user?.rol || '';
  const esEquipoShipro = rolUsuario.startsWith('admin_shipro') || rolUsuario.startsWith('operador_shipro');
  const [listaClientes, setListaClientes] = useState<any[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<string>("TODAS");

  const [filtroRuteoDesde, setFiltroRuteoDesde] = useState("");
  const [filtroRuteoHasta, setFiltroRuteoHasta] = useState("");
  const [filtroRuteoCourier, setFiltroRuteoCourier] = useState("TODOS");

  // Contadores globales de envíos bloqueados (DEUDA 16 saldo + DEUDA 27 depósito). Modo Dios.
  // Cards independientes: cada métrica tiene valor diagnóstico por separado.
  const [bloqueadosSaldoCount, setBloqueadosSaldoCount] = useState(0);
  const [bloqueadosDepositoCount, setBloqueadosDepositoCount] = useState(0);

  // Torre de Control Metrica 1.1 "Resolver Nomenclador" (DEUDA 39, 2026-06-04).
  // Datos del endpoint /api/torre-de-control/resolver-nomenclador. Sin scope
  // por empresa: el nomenclador es global a la plataforma.
  const [nomencladorMetrica, setNomencladorMetrica] = useState<any>(null);
  const [cargandoNomenclador, setCargandoNomenclador] = useState(true);

  // Torre de Control Metrica 2.1 "Tiempos Colecta" (DEUDA 39, 2026-06-04).
  // Datos del endpoint /api/torre-de-control/tiempos-colecta. Mide tiempo
  // entre creacion de etiqueta y recoleccion fisica por el courier.
  const [tiemposColectaMetrica, setTiemposColectaMetrica] = useState<any>(null);
  const [cargandoTiemposColecta, setCargandoTiemposColecta] = useState(true);

  // Torre de Control Metrica 2.3 "Promesa Calibrada" (DEUDA 39, 2026-06-08).
  // Datos del endpoint /api/torre-de-control/promesa-calibrada. Mide promesa
  // de entrega calibrada (P75) por combinacion (deposito, courier, provincia)
  // y tasa de cumplimiento historico.
  const [promesaCalibradaMetrica, setPromesaCalibradaMetrica] = useState<any>(null);
  const [cargandoPromesaCalibrada, setCargandoPromesaCalibrada] = useState(true);

  // Torre de Control Metrica 3.3 "Modalidades" (DEUDA 39 + DEUDA 47, 2026-06-09).
  // Datos del endpoint /api/torre-de-control/modalidades. Mide la distribucion
  // de modalidades canonicas elegidas por compradores en checkout.
  const [modalidadesMetrica, setModalidadesMetrica] = useState<any>(null);
  const [cargandoModalidades, setCargandoModalidades] = useState(true);

  // Metrica 2.2 "Efectividad de Primera Visita" (DEUDA 39, 2026-06-09).
  // Datos del endpoint /api/torre-de-control/efectividad-primera-visita.
  // Scope global (sin filtro empresa, igual que las otras 4 metricas nuevas).
  const [efectividadMetrica, setEfectividadMetrica] = useState<any>(null);
  const [cargandoEfectividad, setCargandoEfectividad] = useState(true);

  // Metrica 2.5 "Anatomia de la Devolucion" (DEUDA 39, 2026-06-09).
  // Datos del endpoint /api/torre-de-control/anatomia-devolucion.
  // Scope global. Universo: solo envios DEVUELTO_AL_REMITENTE.
  const [anatomiaDevolucionMetrica, setAnatomiaDevolucionMetrica] = useState<any>(null);
  const [cargandoAnatomiaDevolucion, setCargandoAnatomiaDevolucion] = useState(true);

  // Metrica 2.4 "Tasa de Tickets de Mesa de Ayuda" (DEUDA 39, 2026-06-09).
  // Datos del endpoint /api/torre-de-control/tickets-mesa-ayuda.
  // Scope global. Universo: tickets creados en ventana 90 dias.
  const [ticketsMesaAyudaMetrica, setTicketsMesaAyudaMetrica] = useState<any>(null);
  const [cargandoTicketsMesaAyuda, setCargandoTicketsMesaAyuda] = useState(true);

  // Metrica 2.6 "Concentracion Courier" (DEUDA 39, 2026-06-10).
  // Datos del endpoint /api/torre-de-control/concentracion-courier.
  // Scope global. Universo: envios en ventana 90 dias. Param opcional empresaId
  // permite filtrar por empresa.
  const [concentracionCourierMetrica, setConcentracionCourierMetrica] = useState<any>(null);
  const [cargandoConcentracionCourier, setCargandoConcentracionCourier] = useState(true);
  const [empresaFiltroConcentracion, setEmpresaFiltroConcentracion] = useState<number | null>(null);

  // Metrica 3.1 "Auditoria de Direcciones" (DEUDA 39, 2026-06-10).
  // Datos del endpoint /api/torre-de-control/auditoria-direcciones.
  // Scope global. Universo: direcciones destino de envios en ventana 90 dias.
  const [auditoriaDireccionesMetrica, setAuditoriaDireccionesMetrica] = useState<any>(null);
  const [cargandoAuditoriaDirecciones, setCargandoAuditoriaDirecciones] = useState(true);

  // Metrica 3.2 "Fuga por Ruteo Ineficiente" (DEUDA 39, 2026-06-10).
  // Datos del endpoint /api/torre-de-control/fuga-ruteo.
  // Scope global. Universo: envios con FinanzasEnvio.fugaFinanciera > 0 en ventana 90 dias.
  const [fugaRuteoMetrica, setFugaRuteoMetrica] = useState<any>(null);
  const [cargandoFugaRuteo, setCargandoFugaRuteo] = useState(true);

  // Metrica 3.4 "Desvio Financiero por Peso Volumetrico" (DEUDA 39, 2026-06-11).
  // Datos del endpoint /api/torre-de-control/desvio-peso.
  // Scope global. Universo: envios en ventana 90 dias con FinanzasEnvio.pesoAforado > 0.
  const [desvioPesoMetrica, setDesvioPesoMetrica] = useState<any>(null);
  const [cargandoDesvioPeso, setCargandoDesvioPeso] = useState(true);

  // Metrica 1.2 "NPS Comprador" (DEUDA 39, 2026-06-11).
  // Datos del endpoint /api/torre-de-control/nps-comprador.
  // Scope global. Universo: encuestas en ventana 90 dias.
  const [npsCompradorMetrica, setNpsCompradorMetrica] = useState<any>(null);
  const [cargandoNpsComprador, setCargandoNpsComprador] = useState(true);

  // Metrica 1.3 "NPS Cliente Empresa" (DEUDA 39, 2026-06-11).
  // Datos del endpoint /api/torre-de-control/nps-cliente-empresa.
  // Scope global. Universo: encuestas trimestrales (ventana 365 dias).
  const [npsClienteEmpresaMetrica, setNpsClienteEmpresaMetrica] = useState<any>(null);
  const [cargandoNpsClienteEmpresa, setCargandoNpsClienteEmpresa] = useState(true);

  // Metrica 12 "Mapa SLA (Real)" (DEUDA 39, 2026-06-12).
  // Datos del endpoint /api/torre-de-control/mapa-sla (migracion de legacy).
  // Scope global. Universo: envios ENTREGADO ventana 90 dias.
  const [mapaSlaMetrica, setMapaSlaMetrica] = useState<any>(null);
  const [cargandoMapaSla, setCargandoMapaSla] = useState(true);

  useEffect(() => {
    if (!filtroEmpresaId) return;
    const baseParams = { filtroEmpresa: filtroEmpresaId, page: "1", limit: "1" };
    const paramsSaldo = new URLSearchParams({ ...baseParams, estado: "BloqueadosSaldo" });
    const paramsDeposito = new URLSearchParams({ ...baseParams, estado: "BloqueadosDeposito" });

    Promise.all([
      fetch(`/api/envios?${paramsSaldo}`).then(res => res.ok ? res.json() : { meta: { total: 0 } }),
      fetch(`/api/envios?${paramsDeposito}`).then(res => res.ok ? res.json() : { meta: { total: 0 } }),
    ])
      .then(([saldoData, depositoData]) => {
        setBloqueadosSaldoCount(saldoData.meta?.total || 0);
        setBloqueadosDepositoCount(depositoData.meta?.total || 0);
      })
      .catch(() => {
        setBloqueadosSaldoCount(0);
        setBloqueadosDepositoCount(0);
      });
  }, [filtroEmpresaId]);

  useEffect(() => {
    if (esEquipoShipro) {
      fetch("/api/clientes").then(res => res.json()).then(data => setListaClientes(data));
      setFiltroEmpresaId("TODAS");
    } else {
      setFiltroEmpresaId(session?.user?.empresaId?.toString() || "");
    }
  }, [esEquipoShipro, session]);

  useEffect(() => {
    const fetchMetricas = async () => {
      if (!filtroEmpresaId) return;
      setCargandoDatos(true);
      try {
        const params = new URLSearchParams();
        params.append("filtroEmpresa", filtroEmpresaId);
        if (filtroRuteoDesde) params.append("desde", filtroRuteoDesde);
        if (filtroRuteoHasta) params.append("hasta", filtroRuteoHasta);

        const res = await fetch(`/api/metricas?${params.toString()}`);
        const data = await res.json();
        setMetricas(data);
      } catch (err) {
        console.error("Error al cargar datos");
      } finally {
        setCargandoDatos(false);
      }
    };
    fetchMetricas();
  }, [filtroEmpresaId, filtroRuteoDesde, filtroRuteoHasta]);

  // Torre de Control Metrica 1.1: fetch del endpoint dedicado.
  // Sin dependencia de filtroEmpresaId porque el nomenclador es global.
  // El guard esEquipoShipro garantiza que solo Shipro haga la llamada
  // (igual el endpoint server-side rechaza no-Shipro con 403).
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoNomenclador(true);
    fetch("/api/torre-de-control/resolver-nomenclador")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setNomencladorMetrica(data);
        setCargandoNomenclador(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching resolver-nomenclador:", err);
        setCargandoNomenclador(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 2.1: fetch del endpoint dedicado.
  // Sin dependencia de filtroEmpresaId en esta version (la metrica es
  // global a la plataforma Shipro). Cuando se construya el Panel de Control
  // con vista por empresa, se agregara el parametro empresaId.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoTiemposColecta(true);
    fetch("/api/torre-de-control/tiempos-colecta")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setTiemposColectaMetrica(data);
        setCargandoTiemposColecta(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching tiempos-colecta:", err);
        setCargandoTiemposColecta(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 2.3: fetch del endpoint de promesa calibrada.
  // Ventana 90 dias hardcoded en v1 (P: hardcoded). Cuando se implemente
  // selector temporal en UI, se agrega parametro a la query.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoPromesaCalibrada(true);
    fetch("/api/torre-de-control/promesa-calibrada")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setPromesaCalibradaMetrica(data);
        setCargandoPromesaCalibrada(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching promesa-calibrada:", err);
        setCargandoPromesaCalibrada(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 3.3: fetch del endpoint de modalidades.
  // Ventana 90 dias hardcoded en v1.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoModalidades(true);
    fetch("/api/torre-de-control/modalidades")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setModalidadesMetrica(data);
        setCargandoModalidades(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching modalidades:", err);
        setCargandoModalidades(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 2.2: fetch del endpoint de efectividad de primera visita.
  // Ventana 90 dias hardcoded en v1. Scope Shipro-only.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoEfectividad(true);
    fetch("/api/torre-de-control/efectividad-primera-visita")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setEfectividadMetrica(data);
        setCargandoEfectividad(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching efectividad-primera-visita:", err);
        setCargandoEfectividad(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 2.5: fetch del endpoint de anatomia de la devolucion.
  // Ventana 90 dias hardcoded en v1. Scope Shipro-only.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoAnatomiaDevolucion(true);
    fetch("/api/torre-de-control/anatomia-devolucion")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setAnatomiaDevolucionMetrica(data);
        setCargandoAnatomiaDevolucion(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching anatomia-devolucion:", err);
        setCargandoAnatomiaDevolucion(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 2.4: fetch del endpoint de tickets-mesa-ayuda.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoTicketsMesaAyuda(true);
    fetch("/api/torre-de-control/tickets-mesa-ayuda")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setTicketsMesaAyudaMetrica(data);
        setCargandoTicketsMesaAyuda(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching tickets-mesa-ayuda:", err);
        setCargandoTicketsMesaAyuda(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 2.6: fetch del endpoint de concentracion-courier.
  // Re-fetch cuando cambia empresaFiltroConcentracion.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoConcentracionCourier(true);
    const url = empresaFiltroConcentracion !== null
      ? `/api/torre-de-control/concentracion-courier?filtroEmpresa=${empresaFiltroConcentracion}`
      : "/api/torre-de-control/concentracion-courier";
    fetch(url)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setConcentracionCourierMetrica(data);
        setCargandoConcentracionCourier(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching concentracion-courier:", err);
        setCargandoConcentracionCourier(false);
      });
  }, [esEquipoShipro, empresaFiltroConcentracion]);

  // Torre de Control Metrica 3.1: fetch del endpoint de auditoria-direcciones.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoAuditoriaDirecciones(true);
    fetch("/api/torre-de-control/auditoria-direcciones")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setAuditoriaDireccionesMetrica(data);
        setCargandoAuditoriaDirecciones(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching auditoria-direcciones:", err);
        setCargandoAuditoriaDirecciones(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 3.2: fetch del endpoint de fuga-ruteo.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoFugaRuteo(true);
    fetch("/api/torre-de-control/fuga-ruteo")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setFugaRuteoMetrica(data);
        setCargandoFugaRuteo(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching fuga-ruteo:", err);
        setCargandoFugaRuteo(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 3.4: fetch del endpoint de desvio-peso.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoDesvioPeso(true);
    fetch("/api/torre-de-control/desvio-peso")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setDesvioPesoMetrica(data);
        setCargandoDesvioPeso(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching desvio-peso:", err);
        setCargandoDesvioPeso(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 1.2: fetch del endpoint de nps-comprador.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoNpsComprador(true);
    fetch("/api/torre-de-control/nps-comprador")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setNpsCompradorMetrica(data);
        setCargandoNpsComprador(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching nps-comprador:", err);
        setCargandoNpsComprador(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 1.3: fetch del endpoint de nps-cliente-empresa.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoNpsClienteEmpresa(true);
    fetch("/api/torre-de-control/nps-cliente-empresa")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setNpsClienteEmpresaMetrica(data);
        setCargandoNpsClienteEmpresa(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching nps-cliente-empresa:", err);
        setCargandoNpsClienteEmpresa(false);
      });
  }, [esEquipoShipro]);

  // Torre de Control Metrica 12: fetch del endpoint de mapa-sla.
  useEffect(() => {
    if (!esEquipoShipro) return;
    setCargandoMapaSla(true);
    fetch("/api/torre-de-control/mapa-sla")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setMapaSlaMetrica(data);
        setCargandoMapaSla(false);
      })
      .catch(err => {
        console.error("[Torre de Control] error fetching mapa-sla:", err);
        setCargandoMapaSla(false);
      });
  }, [esEquipoShipro]);

  const totalEnvios = metricas?.totalEnvios || 1;
  // Torre de Control Metrica 2.1 (2026-06-04): cambio de fuente.
  // Antes: metricas?.tiempoColectaPromedioDias (campo aspiracional, nunca
  // poblado por el endpoint generico /api/metricas).
  // Ahora: tiemposColectaMetrica?.estadisticosGlobales?.p50 (en horas) del
  // endpoint dedicado /api/torre-de-control/tiempos-colecta.
  const tiempoColectaHoras = tiemposColectaMetrica?.estadisticosGlobales?.p50 ?? null;

  // Torre de Control Metrica 2.3 (DEUDA 39, 2026-06-08).
  // Promesa media de la plataforma (P75 calibrado, en dias) + tasa de cumplimiento.
  const promesaCalibradaDias = promesaCalibradaMetrica?.estadisticosGlobales?.p75Dias ?? null;
  const tasaCumplimientoGlobal = promesaCalibradaMetrica?.tasaCumplimientoGlobal ?? null;
  const cantidadEnviosCalibrados = promesaCalibradaMetrica?.cantidadEnviosValidos ?? 0;

  // Torre de Control Metrica 3.3 (DEUDA 39 + DEUDA 47, 2026-06-09).
  // Top 3 modalidades por cantidad + split forward/reverse.
  const distribucionModalidades = modalidadesMetrica?.distribucionGlobal ?? [];
  const top3Modalidades = distribucionModalidades.slice(0, 3);
  const splitForwardReverse = modalidadesMetrica?.splitForwardReverse ?? {
    forward: { cantidad: 0, porcentaje: 0 },
    reverse: { cantidad: 0, porcentaje: 0 },
  };
  const cantidadEnviosModalidades = modalidadesMetrica?.cantidadEnviosTotal ?? 0;
  // Torre de Control Metrica 1.1 (2026-06-04): cambio de fuente.
  // Antes: metricas?.estadosSinMapear ?? 0 (endpoint generico /api/metricas).
  // Ahora: nomencladorMetrica?.cantidadNoMapeados ?? 0 (endpoint dedicado
  // /api/torre-de-control/resolver-nomenclador, ver useEffect arriba).
  const estadosHuerfanos = nomencladorMetrica?.cantidadNoMapeados ?? 0;
  const tasaSoporte = metricas?.tasaSoporte ?? 0;
  
  // Metrica 1.2 (2026-06-11): nps legacy removido en Sub-step E.
  // Card 12 + modal ahora consumen npsCompradorMetrica del endpoint nuevo.
  let couriersLista: string[] = [];
  if (metricas && metricas.nombresCouriers) {
    couriersLista = metricas.nombresCouriers.map((c:any) => c.nombre);
  }

  let pctSameDay = 0; let pctSucursal = 0; let pctEstandar = 0;
  if (metricas && metricas.modalidades) {
    const countSameDay = metricas.modalidades.find((x:any) => x.modalidad === 'Same-Day' || x.modalidad?.includes('Same'))?._count?.modalidad || 0;
    const countSucursal = metricas.modalidades.find((x:any) => x.modalidad === 'Sucursal' || x.modalidad?.includes('Sucursal'))?._count?.modalidad || 0;
    const countEstandar = metricas.modalidades.find((x:any) => x.modalidad === 'Estándar' || x.modalidad?.includes('Estándar') || x.modalidad?.includes('domicilio'))?._count?.modalidad || 0;

    pctSameDay = Math.round((countSameDay / totalEnvios) * 100);
    pctSucursal = Math.round((countSucursal / totalEnvios) * 100);
    pctEstandar = Math.round((countEstandar / totalEnvios) * 100);
  }

  const coloresRiesgo = ['bg-yellow-400', 'bg-red-500', 'bg-purple-500'];

  if (!esEquipoShipro) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 text-center animate-in zoom-in-95 duration-300">
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-8 border-red-100 shadow-sm">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-3xl font-black text-gray-800 tracking-tight">Acceso Denegado</h2>
        <p className="text-gray-500 mt-3 max-w-md text-sm font-medium leading-relaxed">
          La Torre de Control Analítica es una herramienta exclusiva para el equipo directivo de Shipro.
        </p>
      </div>
    );
  }

  const abrirAnalisis = (titulo: string) => {
    setMetricaAnalisis(titulo);
    if (titulo !== "Mapa de Calor SLA") setZonaSlaSeleccionada(null); 
  };

  // Metrica 3.1 (2026-06-10): auditoriaStats legacy removido en Sub-step F.
  // Card 2 + modal ahora consumen auditoriaDireccionesMetrica del endpoint nuevo.
  // El concepto antiguo "envios retenidos por checkout" queda como DEUDA 54.
  // Metrica 3.2 (2026-06-10): ruteoStats legacy removido en Sub-step D.
  // Card 3 + modal ahora consumen fugaRuteoMetrica del endpoint nuevo.
  // Metrica 3.4 (2026-06-11): aforoStats legacy removido en Sub-step E.
  // Card 4 + modal ahora consumen desvioPesoMetrica del endpoint nuevo.
  // Metrica 2.2 (2026-06-09): efectividadStats legacy removido en Sub-step G.
  // Card 5 + modal ahora consumen efectividadMetrica del endpoint nuevo
  // /api/torre-de-control/efectividad-primera-visita (ver useEffect en lineas ~195-210).
  // Metrica 2.4 (2026-06-09): soporteStats legacy removido en Sub-step D.
  // Card 7 + modal ahora consumen ticketsMesaAyudaMetrica del endpoint nuevo.

  // Card 5: fuente cambiada al endpoint nuevo de Metrica 2.2 (Sub-step E.2).
  // Fallback a 0 si el endpoint no respondio aun (loading) o si universo es 0.
  const efectividadGlobal = efectividadMetrica?.resumen?.porcentajePrimeraVisita ?? 0;
  // tasaSoporteGlobal removido — Card 7 lee directamente de ticketsMesaAyudaMetrica.
  const formatPesos = (valor: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(valor);

  // Metrica 3.2 (2026-06-10): helpers de insight de ruteo legacy removidos
  // en Sub-step D. El modal nuevo genera su propio insight inline.

  return (
    <div className="flex flex-col h-full relative bg-gray-50 overflow-y-auto pb-20 font-sans">
      
      {/* ============================================================== */}
      {/* MODAL DE ANÁLISIS PROFUNDO (DRILL-DOWN) COMPLETO */}
      {/* ============================================================== */}
      {metricaAnalisis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="bg-slate-900 p-6 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-2"><ZoomIn className="w-4 h-4" /> Análisis Profundo (Drill-Down)</h3>
                <h2 className="text-2xl font-black text-white">{metricaAnalisis}</h2>
              </div>
              <button onClick={() => {setMetricaAnalisis(null); setZonaSlaSeleccionada(null);}} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>

            {/* Wrapper para scroll vertical compartido entre todas las branches del modal. */}
            <div className="flex-1 overflow-y-auto">
            {metricaAnalisis === "Resolucion de Nomenclador" ? (
              <div className="p-8 space-y-6">
                {cargandoNomenclador ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" /> Cargando metrica...
                  </div>
                ) : !nomencladorMetrica ? (
                  <div className="text-gray-500">No se pudo cargar la metrica. Reintenta en unos segundos.</div>
                ) : (
                  <>
                    {/* RESUMEN AGREGADO */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Cobertura simple</p>
                        <p className="text-2xl font-black text-gray-900">
                          {nomencladorMetrica.porcentajeCoberturaSimple?.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {nomencladorMetrica.totalEstadosCrudos - nomencladorMetrica.cantidadNoMapeados} de {nomencladorMetrica.totalEstadosCrudos} estados mapeados
                        </p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Cobertura ponderada (ult. {nomencladorMetrica.ventanaDias} dias)</p>
                        {nomencladorMetrica.eventosConDato && nomencladorMetrica.porcentajeCoberturaPonderada !== null ? (
                          <>
                            <p className="text-2xl font-black text-gray-900">
                              {nomencladorMetrica.porcentajeCoberturaPonderada.toFixed(1)}%
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">
                              {nomencladorMetrica.totalEventos - nomencladorMetrica.eventosSinMapeo} de {nomencladorMetrica.totalEventos} eventos cubiertos
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-400 mt-2">Aun sin datos suficientes.</p>
                            <p className="text-[10px] text-gray-400 mt-1">El campo se llenara con eventos nuevos del cron rastreo.</p>
                          </>
                        )}
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Estados sin mapear</p>
                        <p className="text-2xl font-black text-red-600">
                          {nomencladorMetrica.cantidadNoMapeados}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          Total catalogo: {nomencladorMetrica.totalEstadosCrudos}
                        </p>
                      </div>
                    </div>

                    {/* TOP ESTADOS SIN MAPEAR */}
                    {nomencladorMetrica.topEstadosSinMapear?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2"><ListChecks className="w-4 h-4" /> Top estados sin mapear</h3>
                          <Link href="/nomenclador" className="text-xs font-black text-blue-600">Ir a mapear &rarr;</Link>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="text-left p-3 font-semibold">Estado crudo</th>
                              <th className="text-left p-3 font-semibold">Courier</th>
                              <th className="text-right p-3 font-semibold">Frecuencia (ult. {nomencladorMetrica.ventanaDias}d)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {nomencladorMetrica.topEstadosSinMapear.map((item: any, idx: number) => (
                              <tr key={`${item.courierId}-${item.estadoCrudo}-${idx}`} className="border-t border-gray-100">
                                <td className="p-3 font-mono text-xs text-gray-700">{item.estadoCrudo}</td>
                                <td className="p-3 text-gray-700">{item.courierNombre}</td>
                                <td className="p-3 text-right font-bold text-gray-900">{item.frecuenciaEnVentana}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* DESGLOSE POR COURIER */}
                    {nomencladorMetrica.desglosePorCourier?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2"><SearchCode className="w-4 h-4" /> Cobertura por courier</h3>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="text-left p-3 font-semibold">Courier</th>
                              <th className="text-right p-3 font-semibold">Total estados</th>
                              <th className="text-right p-3 font-semibold">Sin mapear</th>
                              <th className="text-right p-3 font-semibold">Cobertura</th>
                            </tr>
                          </thead>
                          <tbody>
                            {nomencladorMetrica.desglosePorCourier.map((d: any) => (
                              <tr key={d.courierId} className="border-t border-gray-100">
                                <td className="p-3 font-semibold text-gray-900">{d.courierNombre}</td>
                                <td className="p-3 text-right text-gray-700">{d.totalEstadosCrudos}</td>
                                <td className={`p-3 text-right font-bold ${d.estadosNoMapeados > 0 ? 'text-red-600' : 'text-gray-400'}`}>{d.estadosNoMapeados}</td>
                                <td className="p-3 text-right text-gray-900">{d.porcentajeCobertura.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : metricaAnalisis === "Tiempos Colecta" ? (
              <div className="p-8 space-y-6">
                {cargandoTiemposColecta ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" /> Cargando metrica...
                  </div>
                ) : !tiemposColectaMetrica || tiemposColectaMetrica.cantidadEnviosValidos === 0 ? (
                  <div className="text-gray-500">
                    Sin envios con fecha de colecta en la ventana de {tiemposColectaMetrica?.ventanaDias || 30} dias.
                    {tiemposColectaMetrica?.cantidadEnviosSinFechaColecta > 0 && (
                      <p className="text-xs text-gray-400 mt-2">
                        Hay {tiemposColectaMetrica.cantidadEnviosSinFechaColecta} envios sin fecha de colecta poblada todavia.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* RESUMEN GLOBAL — 3 tiles */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Mediana (P50)</p>
                        <p className="text-2xl font-black text-gray-900">
                          {tiemposColectaMetrica.estadisticosGlobales.p50 < 48
                            ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.p50)}h`
                            : `${(tiemposColectaMetrica.estadisticosGlobales.p50 / 24).toFixed(1)} dias`}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">Caso tipico</p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Promedio</p>
                        <p className="text-2xl font-black text-gray-900">
                          {tiemposColectaMetrica.estadisticosGlobales.promedio < 48
                            ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.promedio)}h`
                            : `${(tiemposColectaMetrica.estadisticosGlobales.promedio / 24).toFixed(1)} dias`}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">Media aritmetica</p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">P95 (peor caso razonable)</p>
                        <p className="text-2xl font-black text-gray-900">
                          {tiemposColectaMetrica.estadisticosGlobales.p95 < 48
                            ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.p95)}h`
                            : `${(tiemposColectaMetrica.estadisticosGlobales.p95 / 24).toFixed(1)} dias`}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">95% de envios despachados por debajo</p>
                      </div>
                    </div>

                    {/* CALIDAD DE DATOS */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        <span className="font-bold text-gray-900">{tiemposColectaMetrica.cantidadEnviosValidos}</span> envios validos
                        {" "}de <span className="font-bold text-gray-900">{tiemposColectaMetrica.cantidadEnviosTotal}</span> en ventana de {tiemposColectaMetrica.ventanaDias} dias.
                      </div>
                      {tiemposColectaMetrica.cantidadEnviosSinFechaColecta > 0 && (
                        <div className="text-xs text-orange-600 font-bold">
                          {tiemposColectaMetrica.cantidadEnviosSinFechaColecta} sin fecha de colecta
                        </div>
                      )}
                    </div>

                    {/* POR DEPOSITO */}
                    {tiemposColectaMetrica.porDeposito?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Warehouse className="w-4 h-4" /> Por deposito</h3>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="text-left p-3 font-semibold">Deposito</th>
                              <th className="text-right p-3 font-semibold">Mediana</th>
                              <th className="text-right p-3 font-semibold">Promedio</th>
                              <th className="text-right p-3 font-semibold">P95</th>
                              <th className="text-right p-3 font-semibold">Envios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tiemposColectaMetrica.porDeposito.map((d: any) => (
                              <tr key={d.depositoId} className="border-t border-gray-100">
                                <td className="p-3 font-semibold text-gray-900">{d.depositoNombre}</td>
                                <td className="p-3 text-right text-gray-700">
                                  {d.medianaHoras < 48 ? `${Math.round(d.medianaHoras)}h` : `${(d.medianaHoras / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right text-gray-700">
                                  {d.promedioHoras < 48 ? `${Math.round(d.promedioHoras)}h` : `${(d.promedioHoras / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right text-gray-700">
                                  {d.p95Horas < 48 ? `${Math.round(d.p95Horas)}h` : `${(d.p95Horas / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right font-bold text-gray-900">{d.cantidad}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* POR COURIER */}
                    {tiemposColectaMetrica.porCourier?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Truck className="w-4 h-4" /> Por courier que recolecta</h3>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="text-left p-3 font-semibold">Courier</th>
                              <th className="text-right p-3 font-semibold">Mediana</th>
                              <th className="text-right p-3 font-semibold">Promedio</th>
                              <th className="text-right p-3 font-semibold">P95</th>
                              <th className="text-right p-3 font-semibold">Envios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tiemposColectaMetrica.porCourier.map((c: any) => (
                              <tr key={c.courierId} className="border-t border-gray-100">
                                <td className="p-3 font-semibold text-gray-900">{c.courierNombre}</td>
                                <td className="p-3 text-right text-gray-700">
                                  {c.medianaHoras < 48 ? `${Math.round(c.medianaHoras)}h` : `${(c.medianaHoras / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right text-gray-700">
                                  {c.promedioHoras < 48 ? `${Math.round(c.promedioHoras)}h` : `${(c.promedioHoras / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right text-gray-700">
                                  {c.p95Horas < 48 ? `${Math.round(c.p95Horas)}h` : `${(c.p95Horas / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right font-bold text-gray-900">{c.cantidad}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* POR DIA DE LA SEMANA */}
                    {tiemposColectaMetrica.porDiaSemana?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Calendar className="w-4 h-4" /> Por dia de la semana (de creacion de etiqueta)</h3>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                              <th className="text-left p-3 font-semibold">Dia</th>
                              <th className="text-right p-3 font-semibold">Mediana</th>
                              <th className="text-right p-3 font-semibold">Promedio</th>
                              <th className="text-right p-3 font-semibold">P95</th>
                              <th className="text-right p-3 font-semibold">Envios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tiemposColectaMetrica.porDiaSemana.map((d: any) => (
                              <tr key={d.diaSemana} className="border-t border-gray-100">
                                <td className="p-3 font-semibold text-gray-900">{d.diaSemanaNombre}</td>
                                <td className="p-3 text-right text-gray-700">
                                  {d.medianaHoras < 48 ? `${Math.round(d.medianaHoras)}h` : `${(d.medianaHoras / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right text-gray-700">
                                  {d.promedioHoras < 48 ? `${Math.round(d.promedioHoras)}h` : `${(d.promedioHoras / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right text-gray-700">
                                  {d.p95Horas < 48 ? `${Math.round(d.p95Horas)}h` : `${(d.p95Horas / 24).toFixed(1)} dias`}
                                </td>
                                <td className="p-3 text-right font-bold text-gray-900">{d.cantidad}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : metricaAnalisis === "Promesa Calibrada" ? (
              <div className="p-8 space-y-6">
                {cargandoPromesaCalibrada ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" /> Cargando metrica...
                  </div>
                ) : !promesaCalibradaMetrica || promesaCalibradaMetrica.cantidadEnviosValidos === 0 ? (
                  <div className="text-gray-500">
                    Sin envios entregados en la ventana de {promesaCalibradaMetrica?.ventanaDias || 90} dias.
                    {promesaCalibradaMetrica?.cantidadEnviosSinDatos > 0 && (
                      <p className="text-xs text-gray-400 mt-2">
                        Hay {promesaCalibradaMetrica.cantidadEnviosSinDatos} envios sin datos completos en la ventana.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* RESUMEN GLOBAL — Estadisticos + cumplimiento */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Mediana (P50)</p>
                        <p className="text-2xl font-black text-gray-900">
                          {promesaCalibradaMetrica.estadisticosGlobales.p50Dias} dias
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.p50Horas}h · caso tipico
                        </p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Promesa Calibrada (P75)</p>
                        <p className="text-2xl font-black text-gray-900">
                          {promesaCalibradaMetrica.estadisticosGlobales.p75Dias ?? "--"} dias
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.p75Horas !== null
                            ? `${promesaCalibradaMetrica.estadisticosGlobales.p75Horas}h · lo que prometemos`
                            : "lo que prometemos hoy"}
                        </p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Promedio</p>
                        <p className="text-2xl font-black text-gray-900">
                          {promesaCalibradaMetrica.estadisticosGlobales.promedioDias} dias
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.promedioHoras}h
                        </p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">P95 (peor caso)</p>
                        <p className="text-2xl font-black text-gray-900">
                          {promesaCalibradaMetrica.estadisticosGlobales.p95Dias} dias
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {promesaCalibradaMetrica.estadisticosGlobales.p95Horas}h · 95% por debajo
                        </p>
                      </div>
                    </div>

                    {/* CUMPLIMIENTO HISTORICO */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5">
                      <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        Cumplimiento Historico
                      </h3>
                      {promesaCalibradaMetrica.tasaCumplimientoGlobal !== null ? (
                        <div className="flex items-center gap-6">
                          <div>
                            <p className="text-3xl font-black text-gray-900">
                              {(promesaCalibradaMetrica.tasaCumplimientoGlobal * 100).toFixed(1)}%
                            </p>
                            <p className="text-xs text-gray-500">de envios cumplidos en la promesa</p>
                          </div>
                          <div className="text-xs text-gray-500 border-l border-gray-200 pl-6">
                            <p>{promesaCalibradaMetrica.cantidadEnviosConPromesa} envios evaluados</p>
                            <p className="text-gray-400">(de {promesaCalibradaMetrica.cantidadEnviosValidos} entregados)</p>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-500">
                          <p className="text-sm">Sin datos de cumplimiento aun.</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Esta metrica se calcula sobre envios entregados que tenian promesa registrada al crearse. La promesa empezo a registrarse el 2026-06-08; los datos se acumulan a partir de envios nuevos.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* CALIDAD DE DATOS */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        <span className="font-bold text-gray-900">{promesaCalibradaMetrica.cantidadEnviosValidos}</span> envios entregados validos
                        {" "}de <span className="font-bold text-gray-900">{promesaCalibradaMetrica.cantidadEnviosTotal}</span> en ventana de {promesaCalibradaMetrica.ventanaDias} dias.
                      </div>
                      <div className="text-xs text-gray-400">
                        Umbral muestra confiable: {promesaCalibradaMetrica.umbralMuestraMinima} envios
                      </div>
                    </div>

                    {/* TABLA POR COMBINACION */}
                    {promesaCalibradaMetrica.combinaciones?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2">
                            <Truck className="w-4 h-4" /> Por ruta (Deposito x Courier x Provincia)
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-500 text-xs">
                              <tr>
                                <th className="text-left p-3 font-semibold">Deposito</th>
                                <th className="text-left p-3 font-semibold">Courier</th>
                                <th className="text-left p-3 font-semibold">Provincia</th>
                                <th className="text-right p-3 font-semibold">P75 (Promesa)</th>
                                <th className="text-right p-3 font-semibold">P50</th>
                                <th className="text-right p-3 font-semibold">P90</th>
                                <th className="text-right p-3 font-semibold">Envios</th>
                                <th className="text-right p-3 font-semibold">Cumplim.</th>
                                <th className="text-center p-3 font-semibold">Confiable</th>
                              </tr>
                            </thead>
                            <tbody>
                              {promesaCalibradaMetrica.combinaciones.map((c: any, idx: number) => (
                                <tr key={`${c.depositoId}-${c.courierId}-${c.provinciaDestino}-${idx}`} className="border-t border-gray-100">
                                  <td className="p-3 font-semibold text-gray-900">{c.depositoNombre}</td>
                                  <td className="p-3 text-gray-700">{c.courierNombre}</td>
                                  <td className="p-3 text-gray-700 capitalize">{c.provinciaDestino}</td>
                                  <td className="p-3 text-right font-bold text-gray-900">{c.p75Dias} d</td>
                                  <td className="p-3 text-right text-gray-700">{c.p50Dias} d</td>
                                  <td className="p-3 text-right text-gray-700">{c.p90Dias} d</td>
                                  <td className="p-3 text-right font-bold text-gray-900">{c.cantidad}</td>
                                  <td className="p-3 text-right text-gray-700">
                                    {c.tasaCumplimiento !== null
                                      ? `${(c.tasaCumplimiento * 100).toFixed(0)}%`
                                      : <span className="text-gray-400">--</span>
                                    }
                                  </td>
                                  <td className="p-3 text-center">
                                    {c.muestraConfiable
                                      ? <span className="text-green-600 text-xs font-bold">SI</span>
                                      : <span className="text-orange-500 text-xs font-bold">NO</span>
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : metricaAnalisis === "Auditoría de Direcciones" ? (
              // Metrica 3.1 (DEUDA 39, 2026-06-10): refactor del modal a
              // p-8 space-y-6. Consume /api/torre-de-control/auditoria-direcciones.
              <div className="p-8 space-y-6">
                {cargandoAuditoriaDirecciones ? (
                  <div className="text-center py-12 text-gray-500">Cargando auditoria de direcciones...</div>
                ) : !auditoriaDireccionesMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : auditoriaDireccionesMetrica.resumen.totalDirecciones === 0 ? (
                  <div className="text-center py-12 text-gray-500">No hay direcciones en la ventana de {auditoriaDireccionesMetrica.calidadDatos.ventanaDias} dias.</div>
                ) : (
                  <>
                    {(() => {
                      const ETIQUETAS_PROBLEMAS: Record<string, string> = {
                        CALLE_VACIA: "Calle sin datos",
                        ALTURA_VACIA: "Altura sin datos",
                        LOCALIDAD_VACIA: "Localidad sin datos",
                        PROVINCIA_VACIA: "Provincia sin datos",
                        CP_NO_NORMALIZADO: "CP no encontrado",
                        INCONSISTENCIA_CP_PROVINCIA: "CP no coincide con provincia",
                        INCONSISTENCIA_CP_LOCALIDAD: "CP no coincide con localidad",
                        PROVINCIA_NO_NORMALIZABLE: "Provincia no reconocida",
                      };
                      const resumen = auditoriaDireccionesMetrica.resumen;
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                          {/* COLUMNA IZQUIERDA */}
                          <div className="lg:col-span-5 space-y-6">

                            {/* Hero tile */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tasa de Auditoria</h4>
                              <p className={`text-6xl font-black tracking-tighter ${resumen.tasaAuditoria > 10 ? 'text-orange-600' : 'text-green-700'}`}>
                                {resumen.tasaAuditoria}%
                              </p>
                              <p className="text-sm text-gray-600 mt-2">
                                {resumen.totalConProblemas} direcciones con problemas sobre {resumen.totalDirecciones} totales
                              </p>
                              <p className="text-xs text-gray-400 mt-1">
                                Score promedio: {resumen.scorePromedio}/100
                              </p>
                              <p className="text-xs text-gray-400 mt-1">
                                Ventana: {auditoriaDireccionesMetrica.calidadDatos.ventanaDias} dias
                              </p>
                            </div>

                            {/* Distribucion de categorias */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Distribucion por Calidad</h4>
                              <div className="space-y-3">
                                {[
                                  { key: 'limpia', label: 'Limpia', color: 'bg-green-500', desc: '90-100 pts' },
                                  { key: 'aceptable', label: 'Aceptable', color: 'bg-blue-500', desc: '70-89 pts' },
                                  { key: 'problematica', label: 'Problematica', color: 'bg-orange-500', desc: '50-69 pts' },
                                  { key: 'critica', label: 'Critica', color: 'bg-red-500', desc: '<50 pts' },
                                ].map((cat) => {
                                  const cantidad = resumen.distribucionCategorias[cat.key as keyof typeof resumen.distribucionCategorias];
                                  const pct = resumen.totalDirecciones > 0
                                    ? Math.round((cantidad / resumen.totalDirecciones) * 100)
                                    : 0;
                                  return (
                                    <div key={cat.key}>
                                      <div className="flex justify-between text-sm font-bold mb-1">
                                        <span className="text-gray-700">{cat.label} <span className="text-xs text-gray-400">({cat.desc})</span></span>
                                        <span className="text-gray-700">{cantidad} ({pct}%)</span>
                                      </div>
                                      <div className="w-full bg-gray-100 rounded-full h-2">
                                        <div className={`${cat.color} h-2 rounded-full`} style={{ width: `${pct}%` }}></div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Top problemas */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top Tipos de Problemas</h4>
                              {resumen.topProblemas.length === 0 ? (
                                <p className="text-sm text-gray-400">Sin problemas detectados.</p>
                              ) : (
                                <div className="space-y-2">
                                  {resumen.topProblemas.map((p: any, idx: number) => (
                                    <div key={idx} className="flex items-center gap-3">
                                      <span className="text-xs font-black text-gray-400 w-6">{idx + 1}.</span>
                                      <span className="text-sm text-gray-700 flex-1">{ETIQUETAS_PROBLEMAS[p.tipo] || p.tipo}</span>
                                      <span className="text-sm font-bold text-gray-800">{p.cantidad}</span>
                                      <span className="text-xs text-gray-500 w-12 text-right">({p.porcentaje}%)</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>

                          {/* COLUMNA DERECHA */}
                          <div className="lg:col-span-7 space-y-6">

                            {/* Top direcciones problematicas */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top Direcciones Problematicas (max 20)</h4>
                              {auditoriaDireccionesMetrica.topDireccionesProblematicas.length === 0 ? (
                                <p className="text-sm text-gray-400">Sin direcciones problematicas en la ventana.</p>
                              ) : (
                                <div className="space-y-3 max-h-96 overflow-y-auto">
                                  {auditoriaDireccionesMetrica.topDireccionesProblematicas.map((d: any) => {
                                    const colorBorde =
                                      d.categoria === 'critica' ? 'border-red-300' :
                                      d.categoria === 'problematica' ? 'border-orange-300' :
                                      d.categoria === 'aceptable' ? 'border-blue-200' : 'border-gray-200';
                                    const colorScore =
                                      d.categoria === 'critica' ? 'text-red-600' :
                                      d.categoria === 'problematica' ? 'text-orange-600' :
                                      d.categoria === 'aceptable' ? 'text-blue-600' : 'text-green-700';
                                    return (
                                      <div key={d.direccionId} className={`border ${colorBorde} rounded-lg p-3`}>
                                        <div className="flex justify-between items-start mb-2">
                                          <div className="flex-1">
                                            <p className="text-sm font-bold text-gray-800">
                                              {d.detalle.calle || '-'} {d.detalle.altura || ''}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                              CP {d.detalle.cp} | {d.detalle.localidad || 'sin localidad'} | {d.detalle.provincia || 'sin provincia'}
                                            </p>
                                          </div>
                                          <div className="text-right ml-3">
                                            <p className={`text-2xl font-black ${colorScore}`}>{d.score}</p>
                                            <p className="text-xs text-gray-400 uppercase">{d.categoria}</p>
                                          </div>
                                        </div>
                                        <div className="flex flex-wrap gap-1 mb-1">
                                          {d.problemas.map((p: string, i: number) => (
                                            <span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full">
                                              {ETIQUETAS_PROBLEMAS[p] || p}
                                            </span>
                                          ))}
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">
                                          {d.cantidadEnvios} envio{d.cantidadEnvios !== 1 ? 's' : ''} | Empresas: {d.empresasAfectadas.join(', ')}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Por empresa */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Por Empresa</h4>
                              {auditoriaDireccionesMetrica.porEmpresa.length === 0 ? (
                                <p className="text-sm text-gray-400">Sin datos por empresa.</p>
                              ) : (
                                <div className="space-y-3">
                                  {auditoriaDireccionesMetrica.porEmpresa.map((e: any) => (
                                    <div key={e.empresaId}>
                                      <div className="flex justify-between text-sm mb-1">
                                        <span className="font-bold text-gray-700">{e.nombre}</span>
                                        <span className="text-gray-500">
                                          {e.direccionesTotal} dirs | {e.direccionesConProblemas} con problemas | <span className="font-bold">Score: {e.scorePromedio}</span>
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Por mes */}
                            <div className="bg-white border border-gray-200 rounded-xl p-6">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion Mensual</h4>
                              {auditoriaDireccionesMetrica.porMes.length === 0 ? (
                                <p className="text-sm text-gray-400">Sin datos por mes.</p>
                              ) : (
                                <div className="space-y-2">
                                  {auditoriaDireccionesMetrica.porMes.map((m: any) => (
                                    <div key={m.mes} className="flex items-center gap-3">
                                      <span className="text-xs font-bold text-gray-500 w-16">{m.mes}</span>
                                      <span className="text-xs text-gray-700 flex-1">{m.direccionesTotal} dirs, {m.direccionesConProblemas} con problemas</span>
                                      <span className="text-xs text-orange-600 font-bold">{m.tasaAuditoria}%</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>

            ) : metricaAnalisis === "Fuga por Ruteo Ineficiente" ? (
              // Metrica 3.2 (DEUDA 39, 2026-06-10): refactor del modal a
              // p-8 space-y-6. Consume /api/torre-de-control/fuga-ruteo.
              // NIVEL 1: fuga dentro del mix activo del cliente.
              // NIVEL 2 (DEUDA 56): fuga vs red completa de Shipro.
              <div className="p-8 space-y-6">
                {cargandoFugaRuteo ? (
                  <div className="text-center py-12 text-gray-500">Cargando datos de ruteo...</div>
                ) : !fugaRuteoMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : fugaRuteoMetrica.resumen.totalEnviosEvaluados === 0 ? (
                  <div className="text-center py-12 text-gray-500">No hay envios en la ventana de {fugaRuteoMetrica.calidadDatos.ventanaDias} dias.</div>
                ) : (
                  <>
                    {/* GRID PRINCIPAL */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* COLUMNA IZQUIERDA */}
                      <div className="lg:col-span-5 space-y-6">

                        {/* Hero tile */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Costo de Oportunidad (90 dias)</h4>
                          <p className="text-5xl font-black text-purple-700 tracking-tighter">{formatPesos(fugaRuteoMetrica.resumen.fugaTotal)}</p>
                          <p className="text-sm text-gray-600 mt-2">
                            <span className="font-bold">{fugaRuteoMetrica.resumen.enviosConFuga}</span> de {fugaRuteoMetrica.resumen.totalEnviosEvaluados} envios sub-optimizados
                          </p>
                          <p className={`text-sm font-bold mt-1 ${fugaRuteoMetrica.resumen.tasaIneficiencia > 50 ? 'text-red-600' : 'text-orange-600'}`}>
                            Tasa de ineficiencia: {fugaRuteoMetrica.resumen.tasaIneficiencia}%
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            Ahorro proyectado anual: <span className="font-bold text-green-700">{formatPesos(fugaRuteoMetrica.resumen.ahorroProyectadoAnual)}</span>
                          </p>
                        </div>

                        {/* Metricas compactas */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Magnitud por Envio</h4>
                          <div className="grid grid-cols-2 gap-3 text-center">
                            <div className="border-r border-gray-200">
                              <p className="text-xl font-black text-gray-800">{formatPesos(fugaRuteoMetrica.resumen.fugaPromedio)}</p>
                              <p className="text-xs text-gray-500 uppercase">Fuga promedio</p>
                            </div>
                            <div>
                              <p className="text-xl font-black text-gray-800">{formatPesos(fugaRuteoMetrica.resumen.fugaMax)}</p>
                              <p className="text-xs text-gray-500 uppercase">Fuga maxima</p>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-3 text-center">
                            Promedio: cada envio sub-optimizado le cuesta este monto extra.
                          </p>
                        </div>

                        {/* Aviso Nivel 2 */}
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-blue-700 uppercase tracking-widest mb-2">Alcance Actual</h4>
                          <p className="text-sm text-blue-900">
                            Este analisis mide fuga <span className="font-bold">dentro del mix de couriers activos del cliente</span>.
                          </p>
                          <p className="text-xs text-blue-700 mt-2">
                            Una version futura medira tambien fuga vs la red completa de couriers integrados a Shipro (incluso los no activados aun para esta empresa).
                          </p>
                        </div>

                      </div>

                      {/* COLUMNA DERECHA */}
                      <div className="lg:col-span-7 space-y-6">

                        {/* Top Desvios */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top Desvios (Elegido vs Sugerido)</h4>
                          {fugaRuteoMetrica.topDesviosPorCombo.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin desvios registrados.</p>
                          ) : (
                            <div className="space-y-3">
                              {fugaRuteoMetrica.topDesviosPorCombo.map((d: any, idx: number) => (
                                <div key={idx} className="border-l-4 border-purple-300 pl-3 py-1">
                                  <div className="flex justify-between items-start mb-1">
                                    <div className="flex-1">
                                      <p className="text-sm text-gray-700">
                                        <span className="font-bold text-red-600">{d.courierElegido}</span> →
                                        <span className="font-bold text-green-700"> {d.courierSugerido}</span>
                                      </p>
                                      <p className="text-xs text-gray-500">{d.servicioSugerido}</p>
                                    </div>
                                    <div className="text-right ml-3">
                                      <p className="text-lg font-black text-purple-700">{formatPesos(d.fugaTotal)}</p>
                                      <p className="text-xs text-gray-400">{d.cantidad} envio{d.cantidad !== 1 ? 's' : ''} | prom. {formatPesos(d.fugaPromedio)}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Por Empresa */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Por Empresa</h4>
                          {fugaRuteoMetrica.porEmpresa.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por empresa.</p>
                          ) : (
                            <div className="space-y-3">
                              {fugaRuteoMetrica.porEmpresa.map((e: any) => (
                                <div key={e.empresaId}>
                                  <div className="flex justify-between text-sm mb-1">
                                    <span className="font-bold text-gray-700">{e.nombre}</span>
                                    <span className="text-gray-500">
                                      {e.cantidadConFuga} envios | <span className="font-bold text-purple-700">{formatPesos(e.fugaTotal)}</span> | prom. {formatPesos(e.fugaPromedio)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Por Mes */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion Mensual</h4>
                          {fugaRuteoMetrica.porMes.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por mes.</p>
                          ) : (
                            <div className="space-y-2">
                              {fugaRuteoMetrica.porMes.map((m: any) => (
                                <div key={m.mes} className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-500 w-16">{m.mes}</span>
                                  <span className="text-xs text-gray-700 flex-1">{m.cantidadConFuga} envios con fuga</span>
                                  <span className="text-xs text-purple-700 font-bold">{formatPesos(m.fugaTotal)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Top Envios Individuales */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top 10 Envios con Mas Fuga</h4>
                          {fugaRuteoMetrica.topEnvios.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin envios para mostrar.</p>
                          ) : (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                              {fugaRuteoMetrica.topEnvios.slice(0, 10).map((e: any) => (
                                <div key={e.envioId} className="border border-gray-200 rounded-lg p-3">
                                  <div className="flex justify-between items-start mb-1">
                                    <div className="flex-1">
                                      <p className="text-xs font-bold text-gray-800">Envio #{e.envioId} — {e.empresaNombre}</p>
                                      <p className="text-xs text-gray-500">
                                        <span className="text-red-600">{e.courierElegido}</span> en vez de
                                        <span className="text-green-700"> {e.courierSugerido} ({e.servicioSugerido})</span>
                                      </p>
                                    </div>
                                    <p className="text-sm font-black text-purple-700 ml-3">{formatPesos(e.fugaFinanciera)}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  </>
                )}
              </div>

            ) : metricaAnalisis === "Desvío Financiero por Peso Volumétrico" ? (
              // Metrica 3.4 (DEUDA 39, 2026-06-11): refactor del modal a
              // p-8 space-y-6. Consume /api/torre-de-control/desvio-peso.
              <div className="p-8 space-y-6">
                {cargandoDesvioPeso ? (
                  <div className="text-center py-12 text-gray-500">Cargando datos de aforo...</div>
                ) : !desvioPesoMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : desvioPesoMetrica.resumen.totalEnvios === 0 ? (
                  <div className="text-center py-12 text-gray-500">No hay envios en la ventana de {desvioPesoMetrica.calidadDatos.ventanaDias} dias.</div>
                ) : desvioPesoMetrica.resumen.enviosConAforo === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p className="mb-2">Aun no hay liquidaciones procesadas.</p>
                    <p className="text-xs text-gray-400">Los aforos llegan post-cierre mensual al subir el Excel del courier via /api/conciliacion.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* COLUMNA IZQUIERDA */}
                    <div className="lg:col-span-5 space-y-6">

                      {/* Hero tile */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Fuga por Aforo (90 dias)</h4>
                        <p className="text-5xl font-black text-red-600 tracking-tighter">{formatPesos(desvioPesoMetrica.resumen.fugaTotal)}</p>
                        <p className="text-sm text-gray-600 mt-2">
                          <span className="font-bold">{desvioPesoMetrica.resumen.enviosConDesvio}</span> de {desvioPesoMetrica.resumen.enviosConAforo} envios con aforo procesado
                        </p>
                        <p className={`text-sm font-bold mt-1 ${desvioPesoMetrica.resumen.tasaSobreAforados > 50 ? 'text-red-600' : 'text-orange-600'}`}>
                          Tasa de desvio: {desvioPesoMetrica.resumen.tasaSobreAforados}% (sobre aforados)
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {desvioPesoMetrica.resumen.tasaSobreTotal}% sobre total de envios ({desvioPesoMetrica.resumen.totalEnvios})
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                          Ahorro proyectado anual: <span className="font-bold text-green-700">{formatPesos(desvioPesoMetrica.resumen.ahorroProyectadoAnual)}</span>
                        </p>
                      </div>

                      {/* Magnitud por envio */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Magnitud por Envio</h4>
                        <div className="grid grid-cols-2 gap-3 text-center">
                          <div className="border-r border-gray-200 pr-2">
                            <p className="text-xl font-black text-gray-800">{formatPesos(desvioPesoMetrica.resumen.fugaPromedio)}</p>
                            <p className="text-xs text-gray-500 uppercase">Fuga promedio</p>
                          </div>
                          <div className="pl-2">
                            <p className="text-xl font-black text-gray-800">{formatPesos(desvioPesoMetrica.resumen.fugaMax)}</p>
                            <p className="text-xs text-gray-500 uppercase">Fuga maxima</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-center mt-4 pt-4 border-t border-gray-100">
                          <div className="border-r border-gray-200 pr-2">
                            <p className="text-xl font-black text-orange-600">+{desvioPesoMetrica.resumen.desvioPromedioKg} kg</p>
                            <p className="text-xs text-gray-500 uppercase">Desvio prom.</p>
                          </div>
                          <div className="pl-2">
                            <p className="text-xl font-black text-orange-600">+{desvioPesoMetrica.resumen.desvioMaxKg} kg</p>
                            <p className="text-xs text-gray-500 uppercase">Desvio max.</p>
                          </div>
                        </div>
                      </div>

                      {/* Distribucion por severidad */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Distribucion por Severidad</h4>
                        <div className="space-y-3">
                          {[
                            { key: 'leve', label: 'Leve (≤1 kg)', color: 'bg-yellow-400' },
                            { key: 'moderado', label: 'Moderado (1-3 kg)', color: 'bg-orange-500' },
                            { key: 'grave', label: 'Grave (>3 kg)', color: 'bg-red-500' },
                          ].map((sev) => {
                            const cantidad = desvioPesoMetrica.resumen.distribucionSeveridad[sev.key];
                            const pct = desvioPesoMetrica.resumen.distribucionSeveridadPct[sev.key];
                            return (
                              <div key={sev.key}>
                                <div className="flex justify-between text-sm font-bold mb-1">
                                  <span className="text-gray-700">{sev.label}</span>
                                  <span className="text-gray-700">{cantidad} ({pct}%)</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2">
                                  <div className={`${sev.color} h-2 rounded-full`} style={{ width: `${pct}%` }}></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    </div>

                    {/* COLUMNA DERECHA */}
                    <div className="lg:col-span-7 space-y-6">

                      {/* Por Courier */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Rigurosidad por Courier</h4>
                        {desvioPesoMetrica.porCourier.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos por courier.</p>
                        ) : (
                          <div className="space-y-3">
                            {desvioPesoMetrica.porCourier.map((c: any) => (
                              <div key={c.courierId} className="border-l-4 border-orange-300 pl-3 py-1">
                                <div className="flex justify-between items-start">
                                  <div className="flex-1">
                                    <p className="text-sm font-bold text-gray-800">{c.nombre}</p>
                                    <p className="text-xs text-gray-500">
                                      {c.enviosConDesvio} de {c.enviosConAforo} aforados | Desvio prom. {c.desvioPromedioKg} kg
                                    </p>
                                  </div>
                                  <div className="text-right ml-3">
                                    <p className="text-lg font-black text-red-600">{c.porcentajeDesvio}%</p>
                                    <p className="text-xs text-gray-500">{formatPesos(c.fugaTotal)}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Por Empresa */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Por Empresa</h4>
                        {desvioPesoMetrica.porEmpresa.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos por empresa.</p>
                        ) : (
                          <div className="space-y-3">
                            {desvioPesoMetrica.porEmpresa.map((e: any) => (
                              <div key={e.empresaId}>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="font-bold text-gray-700">{e.nombre}</span>
                                  <span className="text-gray-500">
                                    {e.enviosConDesvio} de {e.enviosTotal} envios | <span className="font-bold text-red-600">{formatPesos(e.fugaTotal)}</span> | desvio prom. {e.desvioPromedioKg} kg
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Por Mes */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion Mensual</h4>
                        {desvioPesoMetrica.porMes.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos por mes.</p>
                        ) : (
                          <div className="space-y-2">
                            {desvioPesoMetrica.porMes.map((m: any) => (
                              <div key={m.mes} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-gray-500 w-16">{m.mes}</span>
                                <span className="text-xs text-gray-700 flex-1">{m.enviosConDesvio} envios con desvio</span>
                                <span className="text-xs text-red-600 font-bold">{formatPesos(m.fugaTotal)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Top envios */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top 10 Envios con Mas Fuga</h4>
                        {desvioPesoMetrica.topEnvios.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin envios para mostrar.</p>
                        ) : (
                          <div className="space-y-2 max-h-96 overflow-y-auto">
                            {desvioPesoMetrica.topEnvios.slice(0, 10).map((e: any) => {
                              const sevColor =
                                e.severidad === 'GRAVE' ? 'text-red-600' :
                                e.severidad === 'MODERADO' ? 'text-orange-600' : 'text-yellow-600';
                              return (
                                <div key={e.envioId} className="border border-gray-200 rounded-lg p-3">
                                  <div className="flex justify-between items-start mb-1">
                                    <div className="flex-1">
                                      <p className="text-xs font-bold text-gray-800">Envio #{e.envioId} — {e.empresaNombre}</p>
                                      <p className="text-xs text-gray-500">
                                        {e.courierNombre} | {e.pesoCobrado} kg declarado → <span className={sevColor}>{e.pesoAforado} kg facturado (+{e.diffKg} kg)</span>
                                      </p>
                                    </div>
                                    <p className="text-sm font-black text-red-600 ml-3">{formatPesos(e.fugaPesos)}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}
              </div>

            ) : metricaAnalisis === "Efectividad de Entregas en 1ra Visita" ? (
              // Metrica 2.2 (DEUDA 39, 2026-06-09): refactor a consumir endpoint
              // /api/torre-de-control/efectividad-primera-visita. Layout consistente
              // con las 4 metricas nuevas (p-8 space-y-6).
              <div className="p-8 space-y-6">
                {cargandoEfectividad ? (
                  <div className="text-center py-12 text-gray-500">Cargando datos de efectividad...</div>
                ) : !efectividadMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : (
                  <>
                    {/* GRID PRINCIPAL */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* COLUMNA IZQUIERDA */}
                      <div className="lg:col-span-5 space-y-6">

                        {/* Hero tile */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Efectividad 1ra Visita</h4>
                          <p className="text-6xl font-black text-gray-800 tracking-tighter">{efectividadMetrica.resumen.porcentajePrimeraVisita}%</p>
                          <p className="text-xs text-gray-500 mt-2">Ventana: ultimos {efectividadMetrica.calidadDatos.ventanaDias} dias</p>
                        </div>

                        {/* Stats compactos */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Composicion del Universo</h4>
                          <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="border-r border-gray-200">
                              <p className="text-2xl font-black text-gray-800">{efectividadMetrica.resumen.totalEntregados}</p>
                              <p className="text-xs text-gray-500 uppercase">Entregados</p>
                            </div>
                            <div className="border-r border-gray-200">
                              <p className="text-2xl font-black text-gray-800">{efectividadMetrica.resumen.totalDevueltos}</p>
                              <p className="text-xs text-gray-500 uppercase">Devueltos</p>
                            </div>
                            <div>
                              <p className="text-2xl font-black text-gray-800">{efectividadMetrica.resumen.totalUniverso}</p>
                              <p className="text-xs text-gray-500 uppercase">Universo</p>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-3 text-center">De {efectividadMetrica.resumen.totalEnvios} envios totales en la ventana</p>
                        </div>

                        {/* Funnel */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Funnel de Ultima Milla</h4>
                          <div className="space-y-4">
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-2">
                                <span className="text-green-700 flex items-center gap-2"><Check className="w-4 h-4"/> 1ra Visita Exitosa</span>
                                <span className="text-green-700">{efectividadMetrica.funnel.primeraVisitaExitosa.cantidad} ({efectividadMetrica.funnel.primeraVisitaExitosa.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadMetrica.funnel.primeraVisitaExitosa.porcentaje}%` }}></div></div>
                            </div>
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-2">
                                <span className="text-orange-600 flex items-center gap-2"><Clock className="w-4 h-4"/> Visitas Forzadas (2+)</span>
                                <span className="text-orange-600">{efectividadMetrica.funnel.visitasForzadas.cantidad} ({efectividadMetrica.funnel.visitasForzadas.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-orange-500 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadMetrica.funnel.visitasForzadas.porcentaje}%` }}></div></div>
                            </div>
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-2">
                                <span className="text-red-600 flex items-center gap-2"><Undo2 className="w-4 h-4"/> Devoluciones al Remitente</span>
                                <span className="text-red-600">{efectividadMetrica.funnel.devoluciones.cantidad} ({efectividadMetrica.funnel.devoluciones.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-600 h-3 rounded-full transition-all duration-1000" style={{ width: `${efectividadMetrica.funnel.devoluciones.porcentaje}%` }}></div></div>
                            </div>
                          </div>
                        </div>

                      </div>

                      {/* COLUMNA DERECHA */}
                      <div className="lg:col-span-7 space-y-6">

                        {/* Top Motivos de Falla */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top 5 Motivos de Falla</h4>
                          {efectividadMetrica.topMotivosFalla.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin motivos registrados en la ventana.</p>
                          ) : (
                            <div className="space-y-2">
                              {efectividadMetrica.topMotivosFalla.map((motivo: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-3">
                                  <span className="text-xs font-black text-gray-400 w-6">{idx + 1}.</span>
                                  <span className="text-sm text-gray-700 flex-1 truncate">{motivo.motivo}</span>
                                  <span className="text-sm font-bold text-gray-800">{motivo.cantidad}</span>
                                  <span className="text-xs text-gray-500 w-12 text-right">({motivo.porcentaje}%)</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Por Courier */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Por Courier</h4>
                          {efectividadMetrica.porCourier.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por courier.</p>
                          ) : (
                            <div className="space-y-3">
                              {efectividadMetrica.porCourier.map((c: any) => (
                                <div key={c.courierId}>
                                  <div className="flex justify-between text-sm mb-1">
                                    <span className="font-bold text-gray-700">{c.nombre}</span>
                                    <span className="text-gray-500">{c.universo} envios | <span className="text-green-700 font-bold">{c.porcentajePrimeraVisita}%</span></span>
                                  </div>
                                  <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full" style={{ width: `${c.porcentajePrimeraVisita}%` }}></div></div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Por Mes */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion por Mes</h4>
                          {efectividadMetrica.porMes.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por mes.</p>
                          ) : (
                            <div className="space-y-2">
                              {efectividadMetrica.porMes.map((m: any) => (
                                <div key={m.mes} className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-500 w-16">{m.mes}</span>
                                  <div className="flex-1 bg-gray-100 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${m.porcentajePrimeraVisita}%` }}></div></div>
                                  <span className="text-xs font-bold text-gray-700 w-12 text-right">{m.porcentajePrimeraVisita}%</span>
                                  <span className="text-xs text-gray-400 w-16 text-right">{m.universo} env.</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Top 10 Provincias */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top 10 Provincias</h4>
                          {efectividadMetrica.porProvincia.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por provincia.</p>
                          ) : (
                            <div className="space-y-2">
                              {efectividadMetrica.porProvincia.map((p: any) => (
                                <div key={p.provincia} className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-700 capitalize flex-1 truncate">{p.provincia}</span>
                                  <span className="text-xs text-gray-500">{p.universo} env.</span>
                                  <span className="text-xs font-bold text-green-700 w-12 text-right">{p.porcentajePrimeraVisita}%</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  </>
                )}
              </div>

            ) : metricaAnalisis === "Tasa de Tickets de Mesa de Ayuda" ? (
              // Metrica 2.4 (DEUDA 39, 2026-06-09): refactor a consumir endpoint
              // /api/torre-de-control/tickets-mesa-ayuda. Layout consistente
              // con metricas 2.2, 2.5 (p-8 space-y-6).
              <div className="p-8 space-y-6">
                {cargandoTicketsMesaAyuda ? (
                  <div className="text-center py-12 text-gray-500">Cargando datos de tickets de soporte...</div>
                ) : !ticketsMesaAyudaMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : ticketsMesaAyudaMetrica.resumen.totalTickets === 0 ? (
                  <div className="text-center py-12 text-gray-500">No hay tickets en la ventana de {ticketsMesaAyudaMetrica.calidadDatos.ventanaDias} dias.</div>
                ) : (
                  <>
                    {/* GRID PRINCIPAL */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* COLUMNA IZQUIERDA */}
                      <div className="lg:col-span-5 space-y-6">

                        {/* Hero tile */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tasa de Soporte</h4>
                          <p className="text-6xl font-black text-gray-800 tracking-tighter">{ticketsMesaAyudaMetrica.resumen.tasaSoporte}%</p>
                          <p className="text-xs text-gray-500 mt-2">{ticketsMesaAyudaMetrica.resumen.totalTickets} tickets sobre {ticketsMesaAyudaMetrica.resumen.totalEnviosEnVentana} envios</p>
                          <p className="text-xs text-gray-400 mt-1">Ventana: ultimos {ticketsMesaAyudaMetrica.calidadDatos.ventanaDias} dias</p>
                        </div>

                        {/* Stats compactos */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Estado del Volumen</h4>
                          <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="border-r border-gray-200">
                              <p className="text-2xl font-black text-red-600">{ticketsMesaAyudaMetrica.resumen.totalActivos}</p>
                              <p className="text-xs text-gray-500 uppercase">Activos</p>
                            </div>
                            <div className="border-r border-gray-200">
                              <p className="text-2xl font-black text-green-700">{ticketsMesaAyudaMetrica.resumen.totalCerrados}</p>
                              <p className="text-xs text-gray-500 uppercase">Cerrados</p>
                            </div>
                            <div>
                              <p className="text-2xl font-black text-gray-800">{ticketsMesaAyudaMetrica.resumen.tiempoMedianoResolucion ?? '—'}</p>
                              <p className="text-xs text-gray-500 uppercase">Dias mediana</p>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-3 text-center">Tiempo mediano de resolucion calculado sobre tickets cerrados.</p>
                        </div>

                        {/* Distribucion de estados */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Distribucion de Estados</h4>
                          <div className="space-y-3">
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-1">
                                <span className="text-red-600">Abierto</span>
                                <span className="text-red-600">{ticketsMesaAyudaMetrica.distribucionEstados.abierto.cantidad} ({ticketsMesaAyudaMetrica.distribucionEstados.abierto.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-red-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.distribucionEstados.abierto.porcentaje}%` }}></div></div>
                            </div>
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-1">
                                <span className="text-orange-600">En Progreso</span>
                                <span className="text-orange-600">{ticketsMesaAyudaMetrica.distribucionEstados.enProgreso.cantidad} ({ticketsMesaAyudaMetrica.distribucionEstados.enProgreso.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-orange-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.distribucionEstados.enProgreso.porcentaje}%` }}></div></div>
                            </div>
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-1">
                                <span className="text-green-700">Cerrado</span>
                                <span className="text-green-700">{ticketsMesaAyudaMetrica.distribucionEstados.cerrado.cantidad} ({ticketsMesaAyudaMetrica.distribucionEstados.cerrado.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.distribucionEstados.cerrado.porcentaje}%` }}></div></div>
                            </div>
                          </div>
                        </div>

                        {/* Origen */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Origen del Ticket</h4>
                          <div className="space-y-3">
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-1">
                                <span className="text-blue-600">Radar Shipro (auto)</span>
                                <span className="text-blue-600">{ticketsMesaAyudaMetrica.origen.radarShipro.cantidad} ({ticketsMesaAyudaMetrica.origen.radarShipro.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.origen.radarShipro.porcentaje}%` }}></div></div>
                            </div>
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-1">
                                <span className="text-purple-600">Cliente / Manual</span>
                                <span className="text-purple-600">{ticketsMesaAyudaMetrica.origen.cliente.cantidad} ({ticketsMesaAyudaMetrica.origen.cliente.porcentaje}%)</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-purple-500 h-2 rounded-full" style={{ width: `${ticketsMesaAyudaMetrica.origen.cliente.porcentaje}%` }}></div></div>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-3">Radar Shipro: ticket auto-creado por cron (envio sin movimiento). Cliente: ticket creado manualmente.</p>
                        </div>

                      </div>

                      {/* COLUMNA DERECHA */}
                      <div className="lg:col-span-7 space-y-6">

                        {/* Top motivos */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top 5 Motivos de Intervencion</h4>
                          {ticketsMesaAyudaMetrica.topMotivos.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin motivos registrados.</p>
                          ) : (
                            <div className="space-y-2">
                              {ticketsMesaAyudaMetrica.topMotivos.map((m: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-3">
                                  <span className="text-xs font-black text-gray-400 w-6">{idx + 1}.</span>
                                  <span className="text-sm text-gray-700 flex-1 truncate">{m.motivo}</span>
                                  <span className="text-sm font-bold text-gray-800">{m.cantidad}</span>
                                  <span className="text-xs text-gray-500 w-12 text-right">({m.porcentaje}%)</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Por Courier */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Por Courier</h4>
                          {ticketsMesaAyudaMetrica.porCourier.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por courier.</p>
                          ) : (
                            <div className="space-y-3">
                              {ticketsMesaAyudaMetrica.porCourier.map((c: any) => (
                                <div key={c.courierId}>
                                  <div className="flex justify-between text-sm mb-1">
                                    <span className="font-bold text-gray-700">{c.nombre}</span>
                                    <span className="text-gray-500">{c.cantidad} tickets | {c.enviosTotales} envios | <span className="text-orange-600 font-bold">{c.tasaSoporte}%</span></span>
                                  </div>
                                  <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-orange-500 h-2 rounded-full" style={{ width: `${Math.min(c.tasaSoporte * 10, 100)}%` }}></div></div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Por Mes */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion por Mes</h4>
                          {ticketsMesaAyudaMetrica.porMes.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por mes.</p>
                          ) : (
                            <div className="space-y-2">
                              {ticketsMesaAyudaMetrica.porMes.map((m: any) => (
                                <div key={m.mes} className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-500 w-16">{m.mes}</span>
                                  <span className="text-sm text-gray-700 flex-1">{m.cantidad} tickets</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  </>
                )}
              </div>

            ) : metricaAnalisis === "Adopción de Modalidades" ? (
              <div className="p-8 space-y-6">
                {cargandoModalidades ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" /> Cargando metrica...
                  </div>
                ) : !modalidadesMetrica || modalidadesMetrica.cantidadEnviosTotal === 0 ? (
                  <div className="text-gray-500">
                    Sin envios en la ventana de {modalidadesMetrica?.ventanaDias || 90} dias.
                  </div>
                ) : (
                  <>
                    {/* RESUMEN */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Volumen Analizado</p>
                        <p className="text-2xl font-black text-gray-900">
                          {modalidadesMetrica.cantidadEnviosTotal}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">envios en {modalidadesMetrica.ventanaDias} dias</p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Forward (Entregas)</p>
                        <p className="text-2xl font-black text-emerald-600">
                          {modalidadesMetrica.splitForwardReverse.forward.porcentaje}%
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">{modalidadesMetrica.splitForwardReverse.forward.cantidad} envios</p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <p className="text-xs text-gray-500 mb-1">Reverse (Devoluciones + Cambios)</p>
                        <p className="text-2xl font-black text-orange-500">
                          {modalidadesMetrica.splitForwardReverse.reverse.porcentaje}%
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">{modalidadesMetrica.splitForwardReverse.reverse.cantidad} envios</p>
                      </div>
                    </div>

                    {/* DISTRIBUCION POR CATEGORIA */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5">
                      <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <Store className="w-4 h-4 text-[#233b6b]" /> Distribucion por Modalidad
                      </h3>
                      {modalidadesMetrica.distribucionGlobal.map((item: any) => (
                        <div key={item.modalidad} className="mb-3">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold text-gray-700">{item.modalidad}</span>
                            <span className="font-bold text-gray-900">{item.porcentaje}% · {item.cantidad}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className="bg-[#233b6b] h-2 rounded-full" style={{ width: `${item.porcentaje}%` }}></div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* POR COURIER */}
                    {modalidadesMetrica.porCourier?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2">
                            <Truck className="w-4 h-4" /> Modalidades por Courier
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-500 text-xs">
                              <tr>
                                <th className="text-left p-3 font-semibold">Courier</th>
                                <th className="text-right p-3 font-semibold">Envios</th>
                                <th className="text-left p-3 font-semibold">Modalidad dominante</th>
                                <th className="text-right p-3 font-semibold">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalidadesMetrica.porCourier.map((c: any) => {
                                const dominante = c.distribucion[0];
                                return (
                                  <tr key={c.courierId} className="border-t border-gray-100">
                                    <td className="p-3 font-semibold text-gray-900">{c.courierNombre}</td>
                                    <td className="p-3 text-right">{c.cantidad}</td>
                                    <td className="p-3 text-gray-700">{dominante?.modalidad || "--"}</td>
                                    <td className="p-3 text-right font-bold">{dominante?.porcentaje || 0}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* POR PROVINCIA (TOP 10) */}
                    {modalidadesMetrica.porProvincia?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-bold text-gray-900 flex items-center gap-2">
                            <MapPin className="w-4 h-4" /> Modalidades por Provincia (Top 10)
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-500 text-xs">
                              <tr>
                                <th className="text-left p-3 font-semibold">Provincia</th>
                                <th className="text-right p-3 font-semibold">Envios</th>
                                <th className="text-left p-3 font-semibold">Modalidad dominante</th>
                                <th className="text-right p-3 font-semibold">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalidadesMetrica.porProvincia.slice(0, 10).map((p: any, idx: number) => {
                                const dominante = p.distribucion[0];
                                return (
                                  <tr key={`${p.provincia}-${idx}`} className="border-t border-gray-100">
                                    <td className="p-3 font-semibold text-gray-900 capitalize">{p.provincia}</td>
                                    <td className="p-3 text-right">{p.cantidad}</td>
                                    <td className="p-3 text-gray-700">{dominante?.modalidad || "--"}</td>
                                    <td className="p-3 text-right font-bold">{dominante?.porcentaje || 0}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* EVOLUCION MENSUAL — BARRAS STACKED */}
                    {modalidadesMetrica.porMes?.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-xl p-5">
                        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                          <Calendar className="w-4 h-4" /> Evolucion Mensual
                        </h3>
                        <div className="space-y-3">
                          {modalidadesMetrica.porMes.map((m: any) => (
                            <div key={m.mes}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="font-semibold text-gray-700">{m.mes}</span>
                                <span className="text-gray-500">{m.cantidad} envios</span>
                              </div>
                              <div className="w-full flex rounded-full h-3 overflow-hidden bg-gray-100">
                                {m.distribucion.map((item: any, idx: number) => {
                                  const colors = ["bg-slate-700", "bg-purple-500", "bg-blue-500", "bg-emerald-500", "bg-orange-500", "bg-pink-500", "bg-amber-500", "bg-cyan-500"];
                                  return (
                                    <div
                                      key={item.modalidad}
                                      className={colors[idx % colors.length]}
                                      style={{ width: `${item.porcentaje}%` }}
                                      title={`${item.modalidad}: ${item.porcentaje}%`}
                                    ></div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-3">
                          Hover sobre cada segmento para ver detalle. Colores corresponden al orden de la distribucion mensual.
                        </p>
                      </div>
                    )}

                    {/* CALIDAD DE DATOS */}
                    {modalidadesMetrica.cantidadEnviosDesconocida > 0 && (
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-xs text-orange-800">
                        <strong>{modalidadesMetrica.cantidadEnviosDesconocida}</strong> envios no pudieron clasificarse en el catalogo canonico (modalidad legacy o no reconocida). Excluidos de los porcentajes.
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : metricaAnalisis === "Anatomia de la Devolucion" ? (
              // Metrica 2.5 (DEUDA 39, 2026-06-09): Anatomia detallada de envios
              // DEVUELTO_AL_REMITENTE en ventana 90 dias. Layout consistente con
              // las otras metricas nuevas (p-8 space-y-6).
              <div className="p-8 space-y-6">
                {cargandoAnatomiaDevolucion ? (
                  <div className="text-center py-12 text-gray-500">Cargando datos de devoluciones...</div>
                ) : !anatomiaDevolucionMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : anatomiaDevolucionMetrica.resumen.cantidadTotal === 0 ? (
                  <div className="text-center py-12 text-gray-500">No hay devoluciones en la ventana de {anatomiaDevolucionMetrica.calidadDatos.ventanaDias} dias.</div>
                ) : (
                  <>
                    {/* GRID PRINCIPAL */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* COLUMNA IZQUIERDA */}
                      <div className="lg:col-span-5 space-y-6">

                        {/* Hero tile */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Devoluciones al Remitente</h4>
                          <p className="text-6xl font-black text-gray-800 tracking-tighter">{anatomiaDevolucionMetrica.resumen.cantidadTotal}</p>
                          <p className="text-sm text-red-600 font-bold mt-2">
                            ${Math.round(anatomiaDevolucionMetrica.resumen.costoTotalFacturado).toLocaleString('es-AR')} facturados
                          </p>
                          <p className="text-xs text-gray-500 mt-1">Ventana: ultimos {anatomiaDevolucionMetrica.calidadDatos.ventanaDias} dias</p>
                        </div>

                        {/* Stats inmovilizacion */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Magnitud del Impacto</h4>
                          <div className="grid grid-cols-2 gap-3 text-center">
                            <div className="border-r border-gray-200">
                              <p className="text-2xl font-black text-gray-800">
                                {anatomiaDevolucionMetrica.resumen.diasInmovilizacionPromedio ?? '—'}
                              </p>
                              <p className="text-xs text-gray-500 uppercase">Dias promedio</p>
                              <p className="text-xs text-gray-400 mt-1">{anatomiaDevolucionMetrica.resumen.diasInmovilizacionTotal} dias totales</p>
                            </div>
                            <div>
                              <p className="text-2xl font-black text-gray-800">{anatomiaDevolucionMetrica.resumen.touchpointsPromedio}</p>
                              <p className="text-xs text-gray-500 uppercase">Touchpoints prom.</p>
                              <p className="text-xs text-gray-400 mt-1">{anatomiaDevolucionMetrica.resumen.touchpointsTotal} totales</p>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-3 text-center">Stock inmovilizado: tiempo desde impresion hasta devolucion. Touchpoints incluyen ida + vuelta.</p>
                        </div>

                        {/* Distribucion de visitas previas */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Visitas Previas a Devolucion</h4>
                          <div className="space-y-2">
                            {[
                              { label: '0 visitas', value: anatomiaDevolucionMetrica.resumen.distribucionVisitas.cero, color: 'bg-gray-400' },
                              { label: '1 visita', value: anatomiaDevolucionMetrica.resumen.distribucionVisitas.una, color: 'bg-blue-400' },
                              { label: '2 visitas', value: anatomiaDevolucionMetrica.resumen.distribucionVisitas.dos, color: 'bg-orange-400' },
                              { label: '3+ visitas', value: anatomiaDevolucionMetrica.resumen.distribucionVisitas.tresOmas, color: 'bg-red-500' },
                            ].map((item, idx) => {
                              const total = anatomiaDevolucionMetrica.resumen.cantidadTotal;
                              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                              return (
                                <div key={idx} className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-700 w-20">{item.label}</span>
                                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                                    <div className={`${item.color} h-2 rounded-full`} style={{ width: `${pct}%` }}></div>
                                  </div>
                                  <span className="text-xs font-bold text-gray-700 w-8 text-right">{item.value}</span>
                                  <span className="text-xs text-gray-400 w-10 text-right">({pct}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Distribucion de puntos de perdida */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Punto del Flujo donde se Perdio</h4>
                          <div className="space-y-2">
                            {[
                              { key: 'EN_DISTRIBUCION', label: 'En distribucion', color: 'bg-blue-400' },
                              { key: 'VISITA_FALLIDA', label: 'Visita fallida', color: 'bg-orange-400' },
                              { key: 'INCIDENCIA', label: 'Incidencia', color: 'bg-red-500' },
                              { key: 'otro', label: 'Otro (sin courier previo)', color: 'bg-gray-400' },
                            ].map((item, idx) => {
                              const value = anatomiaDevolucionMetrica.resumen.distribucionPuntosPerdida[item.key];
                              const total = anatomiaDevolucionMetrica.resumen.cantidadTotal;
                              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                              return (
                                <div key={idx} className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-700 w-32 truncate">{item.label}</span>
                                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                                    <div className={`${item.color} h-2 rounded-full`} style={{ width: `${pct}%` }}></div>
                                  </div>
                                  <span className="text-xs font-bold text-gray-700 w-8 text-right">{value}</span>
                                  <span className="text-xs text-gray-400 w-10 text-right">({pct}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>

                      {/* COLUMNA DERECHA */}
                      <div className="lg:col-span-7 space-y-6">

                        {/* Top motivos */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top 5 Motivos de Devolucion</h4>
                          {anatomiaDevolucionMetrica.topMotivos.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin motivos registrados.</p>
                          ) : (
                            <div className="space-y-2">
                              {anatomiaDevolucionMetrica.topMotivos.map((m: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-3">
                                  <span className="text-xs font-black text-gray-400 w-6">{idx + 1}.</span>
                                  <span className="text-sm text-gray-700 flex-1 truncate">{m.motivo}</span>
                                  <span className="text-sm font-bold text-gray-800">{m.cantidad}</span>
                                  <span className="text-xs text-gray-500 w-12 text-right">({m.porcentaje}%)</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Por Courier */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Por Courier</h4>
                          <div className="space-y-3">
                            {anatomiaDevolucionMetrica.porCourier.map((c: any) => (
                              <div key={c.courierId}>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="font-bold text-gray-700">{c.nombre}</span>
                                  <span className="text-gray-500">
                                    {c.cantidad} devs | ${Math.round(c.costoTotal).toLocaleString('es-AR')} | {c.diasPromedio ?? '—'} dias prom.
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Por Modalidad */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Por Modalidad</h4>
                          <div className="space-y-2">
                            {anatomiaDevolucionMetrica.porModalidad.map((m: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-gray-700 flex-1 truncate">{m.modalidad}</span>
                                <span className="text-xs text-gray-500">{m.cantidad} devs</span>
                                <span className="text-xs text-red-600 font-bold">${Math.round(m.costoTotal).toLocaleString('es-AR')}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Por Mes */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion por Mes</h4>
                          <div className="space-y-2">
                            {anatomiaDevolucionMetrica.porMes.map((m: any) => (
                              <div key={m.mes} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-gray-500 w-16">{m.mes}</span>
                                <span className="text-xs text-gray-700 flex-1">{m.cantidad} devoluciones</span>
                                <span className="text-xs text-red-600 font-bold">${Math.round(m.costoTotal).toLocaleString('es-AR')}</span>
                                <span className="text-xs text-gray-400 w-16 text-right">{m.diasPromedio ?? '—'} dias prom.</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Por Provincia */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Top 10 Provincias</h4>
                          {anatomiaDevolucionMetrica.porProvincia.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por provincia.</p>
                          ) : (
                            <div className="space-y-2">
                              {anatomiaDevolucionMetrica.porProvincia.map((p: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-gray-700 capitalize flex-1 truncate">{p.provincia}</span>
                                  <span className="text-xs text-gray-500">{p.cantidad} devs</span>
                                  <span className="text-xs text-red-600 font-bold">${Math.round(p.costoTotal).toLocaleString('es-AR')}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Casos destacados */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Casos Destacados (top 5)</h4>
                          {anatomiaDevolucionMetrica.detalles.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin casos para destacar.</p>
                          ) : (
                            <div className="space-y-3">
                              {anatomiaDevolucionMetrica.detalles.slice(0, 5).map((d: any) => (
                                <div key={d.envioId} className="border-l-2 border-red-300 pl-3">
                                  <p className="text-xs font-bold text-gray-700">Envio #{d.envioId} — {d.courierNombre} — {d.modalidad}</p>
                                  <p className="text-xs text-gray-500 truncate">{d.motivo || 'Sin motivo'}</p>
                                  <p className="text-xs text-gray-400 mt-1">
                                    ${d.precioFactura?.toLocaleString('es-AR') ?? 'N/D'} | {d.diasInmovilizacion ?? '—'} dias | {d.touchpoints} touchpoints | {d.provincia}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : metricaAnalisis === "Concentración Courier" ? (
              // Metrica 2.6 (DEUDA 39, 2026-06-10): refactor del modal a
              // p-8 space-y-6. Consume /api/torre-de-control/concentracion-courier.
              // Toggle Global / Por Empresa (default Global).
              <div className="p-8 space-y-6">
                {cargandoConcentracionCourier ? (
                  <div className="text-center py-12 text-gray-500">Cargando datos de concentracion...</div>
                ) : !concentracionCourierMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : concentracionCourierMetrica.resumen.totalEnvios === 0 ? (
                  <div className="text-center py-12 text-gray-500">No hay envios en la ventana de {concentracionCourierMetrica.calidadDatos.ventanaDias} dias.</div>
                ) : (
                  <>
                    {/* TOGGLE GLOBAL / POR EMPRESA */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 flex-wrap">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Vista:</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEmpresaFiltroConcentracion(null)}
                          className={`px-4 py-2 text-xs font-bold rounded-lg border transition ${empresaFiltroConcentracion === null ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-blue-50'}`}
                        >Global Shipro</button>
                        <button
                          onClick={() => setEmpresaFiltroConcentracion(2)}
                          className={`px-4 py-2 text-xs font-bold rounded-lg border transition ${empresaFiltroConcentracion !== null ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-purple-50'}`}
                        >Por Empresa</button>
                      </div>
                      {empresaFiltroConcentracion !== null && (
                        <div className="flex items-center gap-2 ml-2">
                          <span className="text-xs text-gray-500">Empresa:</span>
                          <select
                            value={empresaFiltroConcentracion}
                            onChange={(e) => setEmpresaFiltroConcentracion(parseInt(e.target.value, 10))}
                            className="text-xs font-bold border border-gray-200 rounded-lg px-3 py-2 bg-white"
                          >
                            <option value="2">Cliente Demo</option>
                          </select>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 ml-auto">
                        Ventana: {concentracionCourierMetrica.calidadDatos.ventanaDias} dias
                      </p>
                    </div>

                    {/* GRID PRINCIPAL */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* COLUMNA IZQUIERDA */}
                      <div className="lg:col-span-5 space-y-6">

                        {/* Hero tile */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">
                            {concentracionCourierMetrica.resumen.vista === "global"
                              ? "Concentracion Global de Shipro"
                              : `Concentracion: ${concentracionCourierMetrica.resumen.empresaNombre}`}
                          </h4>
                          <p className={`text-6xl font-black tracking-tighter ${concentracionCourierMetrica.resumen.esRiesgoAlto ? 'text-red-600' : 'text-green-700'}`}>
                            {concentracionCourierMetrica.resumen.topShare}%
                          </p>
                          <p className="text-sm font-bold mt-2">
                            {concentracionCourierMetrica.resumen.esRiesgoAlto ? (
                              <span className="text-red-600">Alta Dependencia (SPOF)</span>
                            ) : (
                              <span className="text-green-700">Ecosistema Diversificado</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 mt-2">
                            Concentracion del courier lider sobre {concentracionCourierMetrica.resumen.totalEnvios} envios totales.
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            Umbral SPOF: {concentracionCourierMetrica.resumen.thresholdSPOF}%
                          </p>
                        </div>

                        {/* HHI */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Indice HHI</h4>
                          <p className="text-3xl font-black text-gray-800">{concentracionCourierMetrica.resumen.hhi}</p>
                          <p className={`text-xs font-bold uppercase mt-1 ${concentracionCourierMetrica.resumen.nivelConcentracion === 'alto' ? 'text-red-600' : concentracionCourierMetrica.resumen.nivelConcentracion === 'moderado' ? 'text-orange-600' : 'text-green-700'}`}>
                            Nivel {concentracionCourierMetrica.resumen.nivelConcentracion}
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            Herfindahl-Hirschman Index. Escala 0-10000.
                            Bajo: &lt;1500. Moderado: 1500-2500. Alto: &gt;2500.
                          </p>
                        </div>

                        {/* Insight */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Insight de Continuidad</h4>
                          {concentracionCourierMetrica.resumen.esRiesgoAlto ? (
                            <div className="space-y-2">
                              <p className="text-sm text-gray-700">
                                Hay un courier que concentra {concentracionCourierMetrica.resumen.topShare}% del volumen.
                                Si ese courier tiene un problema operativo (caida de sistemas, paro, conflicto comercial),
                                impacta directamente la mayor parte de los envios.
                              </p>
                              <p className="text-sm font-bold text-red-600">
                                Recomendacion: diversificar mix incorporando un courier alternativo
                                que pueda absorber al menos 20-30% del volumen.
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-700">
                              El mix de couriers esta diversificado. No hay riesgo operativo significativo
                              ante problemas de un proveedor individual.
                            </p>
                          )}
                        </div>

                      </div>

                      {/* COLUMNA DERECHA */}
                      <div className="lg:col-span-7 space-y-6">

                        {/* Share of Wallet */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Share of Wallet (Participacion)</h4>
                          <div className="space-y-4">
                            {concentracionCourierMetrica.shareByCourier.map((c: any, idx: number) => (
                              <div key={c.courierId}>
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="font-bold text-gray-700 flex items-center gap-2">
                                    {c.nombre}
                                    {c.esLider && (
                                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Lider</span>
                                    )}
                                  </span>
                                  <span className={`font-bold ${c.esLider && concentracionCourierMetrica.resumen.esRiesgoAlto ? 'text-red-600' : 'text-gray-700'}`}>
                                    {c.cantidad} envios | {c.porcentaje}%
                                  </span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-3">
                                  <div
                                    className={`h-3 rounded-full ${c.esLider && concentracionCourierMetrica.resumen.esRiesgoAlto ? 'bg-red-500' : c.esLider ? 'bg-blue-500' : 'bg-gray-400'}`}
                                    style={{ width: `${c.porcentaje}%` }}
                                  ></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Evolucion por Mes */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion Mensual</h4>
                          {concentracionCourierMetrica.porMes.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin datos por mes.</p>
                          ) : (
                            <div className="space-y-3">
                              {concentracionCourierMetrica.porMes.map((m: any) => (
                                <div key={m.mes}>
                                  <p className="text-xs font-bold text-gray-500 mb-1">{m.mes}</p>
                                  <div className="space-y-1">
                                    {m.distribuciones.map((d: any) => (
                                      <div key={d.courierId} className="flex items-center gap-3">
                                        <span className="text-xs text-gray-600 w-20">{d.nombre}</span>
                                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                                          <div className="bg-blue-400 h-2 rounded-full" style={{ width: `${d.porcentaje}%` }}></div>
                                        </div>
                                        <span className="text-xs text-gray-500 w-20 text-right">{d.cantidad} ({d.porcentaje}%)</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  </>
                )}
              </div>

            ) : metricaAnalisis === "Mapa de Calor SLA" ? (
              // Metrica 12 (DEUDA 39, 2026-06-12): modal Mapa SLA migrado del legacy /api/metricas.
              // Consume /api/torre-de-control/mapa-sla. Patron p-8 space-y-6.
              <div className="p-8 space-y-6">
                {cargandoMapaSla ? (
                  <div className="text-center py-12 text-gray-500">Cargando Mapa SLA...</div>
                ) : !mapaSlaMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* COLUMNA IZQUIERDA */}
                    <div className="lg:col-span-5 space-y-6">

                      {/* Header dinamico zona / global */}
                      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
                          {zonaSlaSeleccionada ? `Zona: ${zonaSlaSeleccionada.zona}` : 'Promedio Ecosistema'}
                        </h4>
                        {zonaSlaSeleccionada && (
                          <button onClick={() => setZonaSlaSeleccionada(null)} className="text-xs text-blue-600 hover:underline">Ver Global</button>
                        )}
                      </div>

                      {/* Hero 1: SLA Health Index */}
                      <div className={`border-2 rounded-xl p-6 ${
                        (zonaSlaSeleccionada?.indice ?? mapaSlaMetrica.resumen.slaHealthIndex) <= 1
                          ? 'bg-green-50 border-green-200'
                          : 'bg-red-50 border-red-200'
                      }`}>
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Courier Health Index</h4>
                        <div className="flex items-center justify-center">
                          <p className={`text-6xl font-black ${
                            (zonaSlaSeleccionada?.indice ?? mapaSlaMetrica.resumen.slaHealthIndex) <= 1
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}>
                            {zonaSlaSeleccionada ? zonaSlaSeleccionada.indice : mapaSlaMetrica.resumen.slaHealthIndex}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500 text-center mt-2">
                          Index ≤ 1: courier cumple SLA pactado · &gt; 1: lento
                        </p>
                      </div>

                      {/* Hero 2: Cumplimiento Shipro E2E */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Cumplimiento Shipro (E2E)</h4>
                        <div className="flex items-center gap-3">
                          <p className="text-4xl font-black text-gray-800">{mapaSlaMetrica.resumen.cumplimientoE2E}%</p>
                          <p className="text-xs text-gray-500">de envios cumplen promesa<br />impresion → entrega</p>
                        </div>
                      </div>

                      {/* Hero 3: Demora Preparacion */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Demora de Preparacion</h4>
                        <div className="flex items-center gap-3">
                          <Clock className="w-8 h-8 text-blue-500" />
                          <div>
                            <p className="text-2xl font-black text-gray-700">{mapaSlaMetrica.resumen.promedioPreparacion} dias</p>
                            <p className="text-xs text-gray-500">promedio impresion → colecta</p>
                          </div>
                        </div>
                      </div>

                      {/* NUEVO: Realidad Operativa (3 metricas) */}
                      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-amber-700 uppercase tracking-widest mb-3">Realidad Operativa</h4>
                        <p className="text-xs text-gray-600 mb-4">
                          Friccion operativa real medida sobre envios ENTREGADO. Detecta couriers que actualizan estados virtualmente sin distribuir.
                        </p>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="border-r border-amber-200 pr-2">
                            <p className="text-2xl font-black text-amber-700">{mapaSlaMetrica.resumen.totalEnviosConIncidencia}</p>
                            <p className="text-xs text-gray-500 uppercase mt-1">Envios con incidencia</p>
                          </div>
                          <div className="border-r border-amber-200 px-2">
                            <p className="text-2xl font-black text-amber-700">{mapaSlaMetrica.resumen.porcentajeEnviosConIncidencia}%</p>
                            <p className="text-xs text-gray-500 uppercase mt-1">% del total</p>
                          </div>
                          <div className="pl-2">
                            <p className="text-2xl font-black text-amber-700">{mapaSlaMetrica.resumen.promedioIntentosEntrega}</p>
                            <p className="text-xs text-gray-500 uppercase mt-1">Intentos promedio</p>
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* COLUMNA DERECHA */}
                    <div className="lg:col-span-7 space-y-6">

                      {/* Rendimiento Geografico */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <MapPinned className="w-4 h-4 text-[#233b6b]" /> Rendimiento Geografico
                        </h4>
                        {mapaSlaMetrica.mapaZonas.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos de zonas en la ventana de {mapaSlaMetrica.calidadDatos.ventanaDias} dias.</p>
                        ) : (
                          <div className="space-y-2 max-h-96 overflow-y-auto">
                            {mapaSlaMetrica.mapaZonas.map((z: any, i: number) => (
                              <div
                                key={i}
                                onClick={() => setZonaSlaSeleccionada(z)}
                                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-gray-50 ${
                                  zonaSlaSeleccionada?.zona === z.zona ? 'bg-blue-50 border border-blue-200' : 'border border-gray-100'
                                }`}
                              >
                                <div className="flex-1">
                                  <p className="text-sm font-bold text-gray-700">{z.zona}</p>
                                  <p className="text-xs text-gray-500">{z.volumen} envios · transito real {z.transitoReal}d · meta {z.metaPactada}d</p>
                                </div>
                                <span className={`text-lg font-black ${z.indice <= 1 ? 'text-green-700' : 'text-red-600'}`}>
                                  {z.indice}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Calidad Datos */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Calidad de Datos</h4>
                        <p className="text-xs text-gray-600">
                          Ventana: {mapaSlaMetrica.calidadDatos.ventanaDias} dias · {mapaSlaMetrica.calidadDatos.totalEnviosE2E} envios E2E · {mapaSlaMetrica.calidadDatos.totalEnviosTransito} envios transito · {mapaSlaMetrica.calidadDatos.totalEnviosPrep} envios preparacion
                        </p>
                        <p className="text-xs text-gray-400 mt-1">{mapaSlaMetrica.calidadDatos.nivelImplementado}</p>
                      </div>

                    </div>
                  </div>
                )}
              </div>

            ) : metricaAnalisis === "NPS Comprador" ? (
              // Metrica 1.2 (DEUDA 39, 2026-06-11): modal de NPS Comprador.
              // Consume /api/torre-de-control/nps-comprador.
              <div className="p-8 space-y-6">
                {cargandoNpsComprador ? (
                  <div className="text-center py-12 text-gray-500">Cargando NPS del comprador...</div>
                ) : !npsCompradorMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : npsCompradorMetrica.resumen.totalEncuestas === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p className="mb-2">Sin encuestas en la ventana de {npsCompradorMetrica.calidadDatos.ventanaDias} dias.</p>
                    <p className="text-xs text-gray-400">El email post-entrega aun no se dispara automaticamente (DEUDA 59). Cuando se active, las encuestas llegaran solas.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* COLUMNA IZQUIERDA */}
                    <div className="lg:col-span-5 space-y-6">

                      {/* Hero tile */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">NPS Comprador</h4>
                        <div className="flex items-center justify-center mb-3">
                          <div className={`w-36 h-36 rounded-full border-8 flex items-center justify-center bg-white shadow-inner ${
                            npsCompradorMetrica.resumen.npsScore >= 50 ? 'border-green-500' :
                            npsCompradorMetrica.resumen.npsScore >= 0 ? 'border-yellow-500' :
                            'border-red-500'
                          }`}>
                            <span className="text-5xl font-black text-gray-800">
                              {npsCompradorMetrica.resumen.npsScore > 0 ? `+${npsCompradorMetrica.resumen.npsScore}` : npsCompradorMetrica.resumen.npsScore}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 text-center">
                          Escala -100 a +100. Score promedio: <span className="font-bold">{npsCompradorMetrica.resumen.scorePromedio}/10</span>
                        </p>
                        <p className="text-xs text-gray-400 text-center mt-2">
                          {npsCompradorMetrica.resumen.totalEncuestas} encuestas · tasa respuesta {npsCompradorMetrica.resumen.tasaRespuesta ?? '-'}% sobre {npsCompradorMetrica.calidadDatos.totalEntregados} entregas
                        </p>
                      </div>

                      {/* Distribucion */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Distribucion de Votos</h4>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-green-700 flex items-center gap-2">Promotores (9-10)</span>
                              <span className="text-green-700">{npsCompradorMetrica.resumen.promotores} ({npsCompradorMetrica.resumen.promotoresPct}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full" style={{ width: `${npsCompradorMetrica.resumen.promotoresPct}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-yellow-600 flex items-center gap-2">Pasivos (7-8)</span>
                              <span className="text-yellow-600">{npsCompradorMetrica.resumen.pasivos} ({npsCompradorMetrica.resumen.pasivosPct}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-yellow-400 h-3 rounded-full" style={{ width: `${npsCompradorMetrica.resumen.pasivosPct}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-red-600 flex items-center gap-2">Detractores (0-6)</span>
                              <span className="text-red-600">{npsCompradorMetrica.resumen.detractores} ({npsCompradorMetrica.resumen.detractoresPct}%)</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-500 h-3 rounded-full" style={{ width: `${npsCompradorMetrica.resumen.detractoresPct}%` }}></div></div>
                          </div>
                        </div>
                      </div>

                      {/* Cruce SLA */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">SLA vs Satisfaccion</h4>
                        <div className="grid grid-cols-2 gap-3 text-center">
                          <div className="border-r border-gray-200 pr-2">
                            <p className={`text-2xl font-black ${npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore >= 50 ? 'text-green-700' : npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore > 0 ? `+${npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore}` : npsCompradorMetrica.cruceSLA.conSlaCumplido.npsScore}
                            </p>
                            <p className="text-xs text-gray-500 uppercase mt-1">Con SLA cumplido</p>
                            <p className="text-xs text-gray-400">{npsCompradorMetrica.cruceSLA.conSlaCumplido.totalEncuestas} encuestas</p>
                          </div>
                          <div className="pl-2">
                            <p className={`text-2xl font-black ${npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore >= 50 ? 'text-green-700' : npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                              {npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore > 0 ? `+${npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore}` : npsCompradorMetrica.cruceSLA.sinSlaCumplido.npsScore}
                            </p>
                            <p className="text-xs text-gray-500 uppercase mt-1">Sin SLA cumplido</p>
                            <p className="text-xs text-gray-400">{npsCompradorMetrica.cruceSLA.sinSlaCumplido.totalEncuestas} encuestas</p>
                          </div>
                        </div>
                        {npsCompradorMetrica.cruceSLA.sinDatoSLA > 0 && (
                          <p className="text-xs text-gray-400 mt-3 text-center">{npsCompradorMetrica.cruceSLA.sinDatoSLA} encuestas sin dato de SLA</p>
                        )}
                      </div>

                    </div>

                    {/* COLUMNA DERECHA */}
                    <div className="lg:col-span-7 space-y-6">

                      {/* Top Promotores */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Voces Promotoras</h4>
                        {npsCompradorMetrica.topPromotores.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin promotores con comentario.</p>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {npsCompradorMetrica.topPromotores.map((p: any) => (
                              <div key={p.envioId} className="border-l-4 border-green-400 pl-3 py-1">
                                <p className="text-xs text-gray-700 italic">"{p.comentario}"</p>
                                <p className="text-xs text-gray-400 mt-1">Envio #{p.envioId} · {p.courierNombre} · score {p.score}/10</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Top Detractores */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Voces Criticas</h4>
                        {npsCompradorMetrica.topDetractores.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin detractores con comentario.</p>
                        ) : (
                          <div className="space-y-3">
                            {npsCompradorMetrica.topDetractores.map((d: any) => (
                              <div key={d.envioId} className="border-l-4 border-red-400 pl-3 py-1">
                                <p className="text-xs text-gray-700 italic">"{d.comentario}"</p>
                                {d.sugerenciaMejora && (
                                  <p className="text-xs text-blue-600 mt-1">💡 {d.sugerenciaMejora}</p>
                                )}
                                <p className="text-xs text-gray-400 mt-1">Envio #{d.envioId} · {d.courierNombre} · score {d.score}/10 · {d.experienciaEntrega}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* NPS por Courier */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">NPS por Courier</h4>
                        {npsCompradorMetrica.porCourier.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos por courier.</p>
                        ) : (
                          <div className="space-y-2">
                            {npsCompradorMetrica.porCourier.map((c: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between">
                                <span className="text-sm font-bold text-gray-700">{c.nombre}</span>
                                <span className="text-xs text-gray-500 flex-1 mx-3">{c.totalEncuestas} encuestas · score prom. {c.scorePromedio}/10</span>
                                <span className={`text-lg font-black ${c.npsScore >= 50 ? 'text-green-700' : c.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                  {c.npsScore > 0 ? `+${c.npsScore}` : c.npsScore}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* NPS por Provincia */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">NPS por Provincia</h4>
                        {npsCompradorMetrica.porProvincia.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos por provincia.</p>
                        ) : (
                          <div className="space-y-2">
                            {npsCompradorMetrica.porProvincia.map((p: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between">
                                <span className="text-sm font-bold text-gray-700">{p.nombre}</span>
                                <span className="text-xs text-gray-500 flex-1 mx-3">{p.totalEncuestas} encuestas</span>
                                <span className={`text-lg font-black ${p.npsScore >= 50 ? 'text-green-700' : p.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                  {p.npsScore > 0 ? `+${p.npsScore}` : p.npsScore}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Friccion */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Friccion de Entrega</h4>
                        {npsCompradorMetrica.friccionEntrega.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos.</p>
                        ) : (
                          <div className="space-y-2">
                            {npsCompradorMetrica.friccionEntrega.map((f: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-gray-500 flex-1">{f.motivo}</span>
                                <span className="text-xs text-gray-700">{f.cantidad}</span>
                                <span className="text-xs text-gray-400 w-12 text-right">({f.porcentaje}%)</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Evolucion mensual */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion Mensual</h4>
                        {npsCompradorMetrica.porMes.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos.</p>
                        ) : (
                          <div className="space-y-2">
                            {npsCompradorMetrica.porMes.map((m: any) => (
                              <div key={m.mes} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-gray-500 w-16">{m.mes}</span>
                                <span className="text-xs text-gray-700 flex-1">{m.totalEncuestas} encuestas</span>
                                <span className={`text-sm font-bold ${m.npsScore >= 50 ? 'text-green-700' : m.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                  {m.npsScore > 0 ? `+${m.npsScore}` : m.npsScore}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}
              </div>

            ) : metricaAnalisis === "NPS Cliente Empresa" ? (
              // Metrica 1.3 (DEUDA 39, 2026-06-11): modal NPS Cliente Empresa.
              // Consume /api/torre-de-control/nps-cliente-empresa.
              <div className="p-8 space-y-6">
                {cargandoNpsClienteEmpresa ? (
                  <div className="text-center py-12 text-gray-500">Cargando NPS del cliente empresa...</div>
                ) : !npsClienteEmpresaMetrica ? (
                  <div className="text-center py-12 text-red-600">Error cargando datos. Reintentar.</div>
                ) : npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p className="mb-2">Sin votos en la ventana de {npsClienteEmpresaMetrica.calidadDatos.ventanaDias} dias (4 trimestres).</p>
                    <p className="text-xs text-gray-400">El cron trimestral aun no se dispara automaticamente (DEUDA 60). Cuando se active, las encuestas llegaran solas a los gerentes/operadores cada trimestre.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* COLUMNA IZQUIERDA */}
                    <div className="lg:col-span-5 space-y-6">

                      {/* Hero tile */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">NPS Cliente Empresa</h4>
                        <p className="text-xs text-gray-500 mb-3">{npsClienteEmpresaMetrica.calidadDatos.periodoActual} (ventana 4 trimestres)</p>
                        <div className="flex items-center justify-center mb-3">
                          <div className={`w-36 h-36 rounded-full border-8 flex items-center justify-center bg-white shadow-inner ${
                            npsClienteEmpresaMetrica.resumen.npsScorePonderado >= 50 ? 'border-green-500' :
                            npsClienteEmpresaMetrica.resumen.npsScorePonderado >= 0 ? 'border-yellow-500' :
                            'border-red-500'
                          }`}>
                            <span className="text-5xl font-black text-gray-800">
                              {npsClienteEmpresaMetrica.resumen.npsScorePonderado > 0 ? `+${npsClienteEmpresaMetrica.resumen.npsScorePonderado}` : npsClienteEmpresaMetrica.resumen.npsScorePonderado}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 text-center">
                          NPS Ponderado por empresa. Escala -100 a +100.
                        </p>
                        <p className="text-xs text-gray-400 text-center mt-2">
                          NPS Raw (sin ponderar): <span className="font-bold">{npsClienteEmpresaMetrica.resumen.npsScoreRaw > 0 ? `+${npsClienteEmpresaMetrica.resumen.npsScoreRaw}` : npsClienteEmpresaMetrica.resumen.npsScoreRaw}</span> · Score promedio: <span className="font-bold">{npsClienteEmpresaMetrica.resumen.scorePromedioRaw}/10</span>
                        </p>
                        <p className="text-xs text-gray-400 text-center mt-2">
                          {npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas} de {npsClienteEmpresaMetrica.resumen.totalEncuestasEnviadas} respondidas · {npsClienteEmpresaMetrica.resumen.totalEmpresasConVoto} empresa{npsClienteEmpresaMetrica.resumen.totalEmpresasConVoto === 1 ? '' : 's'} · tasa respuesta {npsClienteEmpresaMetrica.resumen.tasaRespuesta}%
                        </p>
                      </div>

                      {/* Distribucion */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Distribucion de Votos</h4>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-green-700">Promotores (9-10)</span>
                              <span className="text-green-700">{npsClienteEmpresaMetrica.resumen.totalPromotores}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-green-500 h-3 rounded-full" style={{ width: `${npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas > 0 ? (npsClienteEmpresaMetrica.resumen.totalPromotores / npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas) * 100 : 0}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-yellow-600">Pasivos (7-8)</span>
                              <span className="text-yellow-600">{npsClienteEmpresaMetrica.resumen.totalPasivos}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-yellow-400 h-3 rounded-full" style={{ width: `${npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas > 0 ? (npsClienteEmpresaMetrica.resumen.totalPasivos / npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas) * 100 : 0}%` }}></div></div>
                          </div>
                          <div>
                            <div className="flex justify-between text-sm font-bold mb-1">
                              <span className="text-red-600">Detractores (0-6)</span>
                              <span className="text-red-600">{npsClienteEmpresaMetrica.resumen.totalDetractores}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3"><div className="bg-red-500 h-3 rounded-full" style={{ width: `${npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas > 0 ? (npsClienteEmpresaMetrica.resumen.totalDetractores / npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas) * 100 : 0}%` }}></div></div>
                          </div>
                        </div>
                      </div>

                      {/* Satisfacciones complementarias */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Satisfacciones Complementarias</h4>
                        <div className="grid grid-cols-2 gap-3 text-center">
                          <div className="border-r border-gray-200 pr-2">
                            <p className="text-3xl font-black text-indigo-700">
                              {npsClienteEmpresaMetrica.resumen.satisfaccionPlataformaPromedio ?? '—'}
                            </p>
                            <p className="text-xs text-gray-500 uppercase mt-1">Satisfaccion Plataforma</p>
                            <p className="text-xs text-gray-400">Escala 1-5</p>
                          </div>
                          <div className="pl-2">
                            <p className="text-3xl font-black text-indigo-700">
                              {npsClienteEmpresaMetrica.resumen.calidadSoportePromedio ?? '—'}
                            </p>
                            <p className="text-xs text-gray-500 uppercase mt-1">Calidad Soporte</p>
                            <p className="text-xs text-gray-400">Escala 1-5</p>
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* COLUMNA DERECHA */}
                    <div className="lg:col-span-7 space-y-6">

                      {/* NPS por Empresa */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">NPS por Empresa</h4>
                        {npsClienteEmpresaMetrica.porEmpresa.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos por empresa.</p>
                        ) : (
                          <div className="space-y-2">
                            {npsClienteEmpresaMetrica.porEmpresa.map((e: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between">
                                <span className="text-sm font-bold text-gray-700">{e.empresaNombre}</span>
                                <span className="text-xs text-gray-500 flex-1 mx-3">{e.totalVotos} voto{e.totalVotos === 1 ? '' : 's'} · score prom. {e.scorePromedio}/10 · {e.promotores}P/{e.pasivos}Pas/{e.detractores}D</span>
                                <span className={`text-lg font-black ${e.npsScore >= 50 ? 'text-green-700' : e.npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                  {e.npsScore > 0 ? `+${e.npsScore}` : e.npsScore}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Evolucion por Periodo */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Evolucion por Trimestre</h4>
                        {npsClienteEmpresaMetrica.porPeriodo.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin datos por periodo.</p>
                        ) : (
                          <div className="space-y-2">
                            {npsClienteEmpresaMetrica.porPeriodo.map((p: any) => (
                              <div key={p.periodo} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-gray-500 w-20">{p.periodo}</span>
                                <span className="text-xs text-gray-700 flex-1">{p.totalVotos} voto{p.totalVotos === 1 ? '' : 's'} · score {p.scorePromedio}/10</span>
                                <span className={`text-sm font-bold ${p.npsScorePonderado >= 50 ? 'text-green-700' : p.npsScorePonderado >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                  {p.npsScorePonderado > 0 ? `+${p.npsScorePonderado}` : p.npsScorePonderado}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Voces Promotoras */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Voces Promotoras</h4>
                        {npsClienteEmpresaMetrica.topPromotores.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin promotores con comentario.</p>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {npsClienteEmpresaMetrica.topPromotores.map((p: any, idx: number) => (
                              <div key={idx} className="border-l-4 border-green-400 pl-3 py-1">
                                <p className="text-xs text-gray-700 italic">"{p.fortaleza}"</p>
                                <p className="text-xs text-gray-400 mt-1">{p.empresaNombre} · {p.usuarioNombre} · score {p.score}/10 · {p.periodo}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Voces Criticas */}
                      <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Voces Criticas</h4>
                        {npsClienteEmpresaMetrica.topDetractores.length === 0 ? (
                          <p className="text-sm text-gray-400">Sin detractores con sugerencia.</p>
                        ) : (
                          <div className="space-y-3">
                            {npsClienteEmpresaMetrica.topDetractores.map((d: any, idx: number) => (
                              <div key={idx} className="border-l-4 border-red-400 pl-3 py-1">
                                <p className="text-xs text-blue-600">💡 {d.sugerencia}</p>
                                <p className="text-xs text-gray-400 mt-1">{d.empresaNombre} · {d.usuarioNombre} · score {d.score}/10 · {d.periodo}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}
              </div>

            ) : (
              <div className="flex-1 p-8 overflow-y-auto bg-gray-50 flex flex-col items-center justify-center text-center">
                <BarChart className="w-24 h-24 text-gray-200 mb-4" />
                <h3 className="text-xl font-bold text-gray-800 mb-2">Módulo en Desarrollo</h3>
                <p className="text-gray-500 max-w-md">La interfaz visual de <strong>"{metricaAnalisis}"</strong> está siendo construida.</p>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* CABECERA DASHBOARD */}
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-6 shrink-0 sticky top-0 z-30 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-blue-600/20 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
              <Activity className="w-7 h-7 text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">Torre de Control Shipro</h2>
              <p className="text-sm font-medium text-slate-400 mt-1">Inteligencia logística y rendimiento del ecosistema.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {cargandoDatos ? (
              <div className="px-4 py-2.5 rounded-lg text-sm font-bold bg-slate-800 border border-slate-700 text-blue-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Procesando base de datos...
              </div>
            ) : (
              <div className="px-4 py-2.5 rounded-lg text-sm font-bold bg-green-500/20 border border-green-500/30 text-green-400 flex items-center gap-2">
                <PackageCheck className="w-4 h-4" /> {totalEnvios.toLocaleString()} Envíos
              </div>
            )}
            <button onClick={() => setShowFiltros(!showFiltros)} className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all border flex-1 sm:flex-none ${showFiltros ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>
              <SlidersHorizontal className="w-4 h-4" /> Filtros Globales
            </button>
            <select className="px-4 py-2.5 border border-slate-700 rounded-lg text-sm font-bold text-white bg-slate-800 outline-none cursor-pointer appearance-none flex-1 sm:flex-none text-center sm:text-left">
              <option>Todo el Histórico</option>
              <option>Últimos 30 días</option>
              <option>Este mes</option>
            </select>
          </div>
        </div>

        {showFiltros && (
          <div className="mt-6 pt-6 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-in slide-in-from-top-4 fade-in duration-200">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Cliente / Cuenta</label>
              <select value={filtroEmpresaId} onChange={(e) => setFiltroEmpresaId(e.target.value)} className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg p-2.5 outline-none cursor-pointer">
                <option value="TODAS">Todo el ecosistema (Global)</option>
                {listaClientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Courier</label>
              <select className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg p-2.5 outline-none"><option>Todos los couriers</option></select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Rango Fecha</label>
              <div className="flex gap-2">
                 <input type="date" value={filtroRuteoDesde} onChange={e => setFiltroRuteoDesde(e.target.value)} className="w-1/2 bg-slate-800 border border-slate-700 text-white text-[10px] rounded-lg p-2"/>
                 <input type="date" value={filtroRuteoHasta} onChange={e => setFiltroRuteoHasta(e.target.value)} className="w-1/2 bg-slate-800 border border-slate-700 text-white text-[10px] rounded-lg p-2"/>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="p-8 max-w-7xl mx-auto w-full space-y-8">

        {/* Card de envíos bloqueados por saldo (DEUDA 16) — visibilidad operacional Modo Dios. */}
        {bloqueadosSaldoCount > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Wallet className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-900">
                  <span className="font-black">{bloqueadosSaldoCount}</span> envíos bloqueados por saldo
                  {filtroEmpresaId === "TODAS" ? " en el ecosistema" : " en esta empresa"}
                </p>
                <p className="text-xs text-amber-700">Esperan que el cliente recargue saldo. Se procesan automáticamente al recargar.</p>
              </div>
            </div>
            <Link href="/" className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              Ver bandeja →
            </Link>
          </div>
        )}

        {/* Card de envíos bloqueados por depósito (DEUDA 27) — visibilidad operacional Modo Dios. */}
        {bloqueadosDepositoCount > 0 && (
          <div className="bg-indigo-50 border border-indigo-300 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Warehouse className="w-5 h-5 text-indigo-700" />
              </div>
              <div>
                <p className="text-sm font-bold text-indigo-900">
                  <span className="font-black">{bloqueadosDepositoCount}</span> envíos bloqueados por depósito
                  {filtroEmpresaId === "TODAS" ? " en el ecosistema" : " en esta empresa"}
                </p>
                <p className="text-xs text-indigo-700">Pendiente de configuración cliente. Se procesan automáticamente al configurar depósito predeterminado.</p>
              </div>
            </div>
            <Link href="/" className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              Ver bandeja →
            </Link>
          </div>
        )}

        {/* BLOQUE 1: TRIAGE */}
        <div>
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><AlertCircle className="w-5 h-5 text-red-500" /> Triage de Excepciones</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`bg-white border rounded-xl p-5 shadow-sm relative overflow-hidden flex flex-col h-full ${estadosHuerfanos > 0 ? 'border-red-300' : 'border-gray-200'}`}>
              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2 mb-1"><ArrowRightLeft className={estadosHuerfanos > 0 ? 'text-red-500' : 'text-gray-400'} /> 1. Resolver Nomenclador</h4>
              {cargandoNomenclador ? (
                <p className="text-xs text-gray-400 mb-4 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Cargando metrica...</p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-1">
                    {estadosHuerfanos === 0
                      ? "Todos los codigos API mapeados."
                      : <span className="font-bold text-red-600">{estadosHuerfanos} codigos sin mapear.</span>}
                  </p>
                  {nomencladorMetrica && (
                    <p className="text-[10px] text-gray-400 mb-3">
                      Cobertura simple: {nomencladorMetrica.porcentajeCoberturaSimple?.toFixed(1)}%
                      {nomencladorMetrica.eventosConDato && nomencladorMetrica.porcentajeCoberturaPonderada !== null && (
                        <> · Ponderada: {nomencladorMetrica.porcentajeCoberturaPonderada.toFixed(1)}%</>
                      )}
                      {!nomencladorMetrica.eventosConDato && (
                        <> · Ponderada: aun sin datos</>
                      )}
                    </p>
                  )}
                </>
              )}
              <div className="mt-auto flex items-center gap-3">
                <button onClick={() => abrirAnalisis("Resolucion de Nomenclador")} className="text-xs font-black text-blue-600">Analizar</button>
                {estadosHuerfanos > 0 && <Link href="/nomenclador" className="text-xs font-black text-red-600">Mapear ahora</Link>}
              </div>
            </div>
            <div className={`bg-white border rounded-xl p-5 shadow-sm relative flex flex-col h-full ${(auditoriaDireccionesMetrica?.resumen?.tasaAuditoria ?? 0) > 10 ? 'border-orange-300' : 'border-gray-200'}`}>
              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2 mb-1"><MapPinned className={(auditoriaDireccionesMetrica?.resumen?.tasaAuditoria ?? 0) > 10 ? 'text-orange-500' : 'text-gray-400'} /> 2. Auditoría Direcciones</h4>
              <p className="text-xs text-gray-500 mb-4 font-bold text-orange-600">{cargandoAuditoriaDirecciones ? 'Cargando…' : `${auditoriaDireccionesMetrica?.resumen?.tasaAuditoria ?? 0}% direcciones con problemas`}</p>
              <button onClick={() => abrirAnalisis("Auditoría de Direcciones")} className="text-xs font-black text-blue-600 text-left mt-auto">Analizar</button>
            </div>
            <div className={`bg-white border rounded-xl p-5 shadow-sm relative flex flex-col h-full ${(fugaRuteoMetrica?.resumen?.tasaIneficiencia ?? 0) > 50 ? 'border-purple-300' : 'border-purple-200'}`}>
              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2 mb-1"><Target className="text-purple-500" /> 3. Fuga por Ruteo</h4>
              <p className="text-xs text-gray-500 mb-4 font-black text-purple-700">{cargandoFugaRuteo ? 'Cargando…' : formatPesos(fugaRuteoMetrica?.resumen?.fugaTotal ?? 0)}</p>
              <button onClick={() => abrirAnalisis("Fuga por Ruteo Ineficiente")} className="text-xs font-black text-blue-600 text-left mt-auto">Analizar</button>
            </div>
          </div>
        </div>

        {/* BLOQUE 2: KPIs */}
        <div>
           <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-blue-600" /> Rendimiento Core</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full ${(desvioPesoMetrica?.resumen?.tasaSobreAforados ?? 0) > 20 ? 'border-red-300' : 'border-gray-200'}`}>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><Box className="text-red-500" /> 4. Desvío de Peso</p>
              <h3 className="text-3xl font-black mb-1">{cargandoDesvioPeso ? '…' : (desvioPesoMetrica?.resumen?.tasaSobreAforados ?? 0)}%</h3>
              <button onClick={() => abrirAnalisis("Desvío Financiero por Peso Volumétrico")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full ${efectividadGlobal < 85 ? 'border-orange-300' : 'border-gray-200'}`}>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><PackageCheck className="text-green-500" /> 5. Efec. 1ra Visita</p>
              <h3 className="text-3xl font-black mb-1">{efectividadGlobal}%</h3>
              <button onClick={() => abrirAnalisis("Efectividad de Entregas en 1ra Visita")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col h-full">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><Undo2 className="text-red-500 w-4 h-4" /> 6. Anatomia Devolucion</p>
              <h3 className="text-3xl font-black mb-1">{anatomiaDevolucionMetrica?.resumen?.cantidadTotal ?? 0}</h3>
              <p className="text-xs text-gray-500 mb-2">
                {anatomiaDevolucionMetrica?.resumen?.costoTotalFacturado != null
                  ? `$${Math.round(anatomiaDevolucionMetrica.resumen.costoTotalFacturado).toLocaleString('es-AR')}`
                  : '$0'} facturados
              </p>
              <button onClick={() => abrirAnalisis("Anatomia de la Devolucion")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
            <div className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col h-full ${(ticketsMesaAyudaMetrica?.resumen?.tasaSoporte ?? 0) > 5 ? 'border-red-300' : 'border-gray-200'}`}>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><Headset className="text-orange-500" /> 7. Carga de Soporte</p>
              <h3 className="text-3xl font-black mb-1">{ticketsMesaAyudaMetrica?.resumen?.tasaSoporte ?? 0}%</h3>
              <button onClick={() => abrirAnalisis("Tasa de Tickets de Mesa de Ayuda")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col h-full">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><TrendingDown className="text-blue-500" /> 8. Tiempos Colecta</p>
              {cargandoTiemposColecta ? (
                <h3 className="text-3xl font-black mb-1 text-gray-300"><Loader2 className="w-6 h-6 animate-spin inline" /></h3>
              ) : tiempoColectaHoras === null ? (
                <>
                  <h3 className="text-3xl font-black mb-1 text-gray-400">--</h3>
                  <p className="text-[10px] text-gray-400 mb-1">Sin envios con fecha de colecta en la ventana</p>
                </>
              ) : (
                <>
                  <h3 className="text-3xl font-black mb-1">
                    {tiempoColectaHoras < 48
                      ? `${Math.round(tiempoColectaHoras)}`
                      : (tiempoColectaHoras / 24).toFixed(1)}
                    <span className="text-lg font-bold text-gray-400"> {tiempoColectaHoras < 48 ? "h" : "dias"}</span>
                  </h3>
                  {tiemposColectaMetrica && (
                    <p className="text-[10px] text-gray-400 mb-1">
                      P95: {tiemposColectaMetrica.estadisticosGlobales?.p95 < 48
                        ? `${Math.round(tiemposColectaMetrica.estadisticosGlobales.p95)}h`
                        : `${(tiemposColectaMetrica.estadisticosGlobales.p95 / 24).toFixed(1)} dias`}
                      {" "}· {tiemposColectaMetrica.cantidadEnviosValidos} envios
                    </p>
                  )}
                </>
              )}
              <button onClick={() => abrirAnalisis("Tiempos Colecta")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col h-full">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1.5"><Clock className="text-blue-500" /> 9. Promesa Calibrada</p>
              {cargandoPromesaCalibrada ? (
                <h3 className="text-3xl font-black mb-1 text-gray-300"><Loader2 className="w-6 h-6 animate-spin inline" /></h3>
              ) : promesaCalibradaDias === null || cantidadEnviosCalibrados === 0 ? (
                <>
                  <h3 className="text-3xl font-black mb-1 text-gray-400">--</h3>
                  <p className="text-[10px] text-gray-400 mb-1">Sin envios entregados en la ventana</p>
                </>
              ) : (
                <>
                  <h3 className="text-3xl font-black mb-1">
                    {promesaCalibradaDias}
                    <span className="text-lg font-bold text-gray-400"> dias</span>
                  </h3>
                  <p className="text-[10px] text-gray-400 mb-1">
                    {tasaCumplimientoGlobal !== null
                      ? `Cumplimiento: ${(tasaCumplimientoGlobal * 100).toFixed(0)}%`
                      : "Sin datos de cumplimiento aun"}
                    {" "}· {cantidadEnviosCalibrados} envios
                  </p>
                </>
              )}
              <button onClick={() => abrirAnalisis("Promesa Calibrada")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Desglosar</button>
            </div>
          </div>
        </div>

        {/* BLOQUE 3: ANÁLISIS VIVOS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase mb-6 flex items-center justify-between"><span><Store className="w-4 h-4 text-[#233b6b] inline mr-2" /> 10. Modalidades</span><button onClick={() => abrirAnalisis("Adopción de Modalidades")} className="p-1.5 bg-gray-50 hover:bg-blue-50 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            {cargandoModalidades ? (
              <div className="space-y-5 flex-1 animate-pulse">
                <div className="h-4 bg-gray-100 rounded"></div>
                <div className="h-4 bg-gray-100 rounded"></div>
                <div className="h-4 bg-gray-100 rounded"></div>
              </div>
            ) : cantidadEnviosModalidades === 0 ? (
              <div className="space-y-3 flex-1 text-xs text-gray-400">
                <p>Sin envios en la ventana.</p>
                <p className="text-[10px]">La metrica se calcula sobre envios creados en los ultimos 90 dias.</p>
              </div>
            ) : (
              <div className="space-y-5 flex-1">
                {top3Modalidades.map((item: any, idx: number) => {
                  const colors = ["bg-slate-700", "bg-purple-500", "bg-blue-500"];
                  const textColors = ["text-gray-700", "text-purple-600", "text-blue-600"];
                  return (
                    <div key={item.modalidad}>
                      <div className="flex justify-between text-xs font-bold mb-1">
                        <span className="truncate pr-2" title={item.modalidad}>{item.modalidad}</span>
                        <span className={textColors[idx]}>{item.porcentaje}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className={`${colors[idx]} h-1.5 rounded-full`} style={{ width: `${item.porcentaje}%` }}></div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
                  Forward {splitForwardReverse.forward.porcentaje}% · Reverse {splitForwardReverse.reverse.porcentaje}% · {cantidadEnviosModalidades} envios
                </p>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase mb-6 flex items-center justify-between"><span><PieChart className="w-4 h-4 text-[#233b6b] inline mr-2" /> 11. Riesgo Courier</span><button onClick={() => abrirAnalisis("Concentración Courier")} className="p-1.5 bg-gray-50 hover:bg-blue-50 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="flex-1 flex flex-col justify-center space-y-4">
              {cargandoConcentracionCourier ? (
                <p className="text-xs text-gray-400 text-center font-bold">Cargando...</p>
              ) : ((concentracionCourierMetrica?.shareByCourier ?? []).length === 0) ? (
                <p className="text-xs text-gray-400 text-center font-bold">Sin datos para graficar</p>
              ) : (concentracionCourierMetrica?.shareByCourier ?? []).slice(0, 3).map((c: any, i: number) => (
                <div key={i} className="w-full flex items-center gap-2">
                  <div className="w-full bg-gray-100 rounded-full h-3"><div className={`${coloresRiesgo[i] || 'bg-gray-400'} h-3 rounded-full`} style={{ width: `${c.porcentaje}%` }}></div></div>
                  <div className="flex flex-col text-right w-16"><span className="text-xs font-black text-gray-800">{c.porcentaje}%</span><span className="text-[9px] text-gray-400 uppercase truncate" title={c.nombre}>{c.nombre}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-6 flex items-center justify-between"><span className="flex items-center gap-2"><Map className="w-4 h-4 text-[#233b6b]" /> 12. Mapa SLA (Real)</span><button onClick={() => abrirAnalisis("Mapa de Calor SLA")} className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-500 rounded-md transition-colors"><ZoomIn className="w-4 h-4" /></button></h3>
            <div className="flex-1 grid grid-cols-3 sm:grid-cols-4 gap-2 text-[10px] font-bold text-center text-white items-center content-start">
              {cargandoMapaSla ? <p className="col-span-full text-gray-400 py-4 font-bold text-center">Cargando…</p> : (mapaSlaMetrica?.mapaZonas?.length ?? 0) === 0 ? <p className="col-span-full text-gray-400 py-4 font-bold text-center">Sin datos de SLA finalizados</p> : (mapaSlaMetrica?.mapaZonas ?? []).slice(0, 12).map((z: any, i: number) => {
                const color = z.indice <= 0.8 ? 'bg-green-500' : z.indice <= 1 ? 'bg-blue-500' : 'bg-red-500';
                return (
                  <div key={i} className={`${color} rounded p-2 flex flex-col items-center justify-center shadow-sm hover:scale-105 transition-transform`} title={z.zona}>
                    <span className="truncate w-full block uppercase">{z.zona.substring(0,6)}</span>
                    <span className="text-[9px] text-white/90 block">Ix: {z.indice}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* BLOQUE 4: VOZ DEL COMPRADOR */}
        <div className="pb-10">
           <h3 className="text-lg font-black text-gray-800 uppercase tracking-wider mb-3 mt-8 flex items-center gap-2">
             <HeartHandshake className="w-5 h-5 text-indigo-500" /> Voz del Comprador y del Cliente
           </h3>
           <h3 className="text-sm font-black text-gray-800 uppercase tracking-wider mb-4 flex items-center gap-2">
             13. Experiencia del Consumidor (NPS Analítico)
           </h3>
           <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col h-full max-w-md">
             <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
               <HeartHandshake className="w-4 h-4 text-indigo-500" /> 13. Experiencia del Consumidor (NPS)
             </h4>
             <div className="flex items-center justify-center mb-4">
               <div className={`w-28 h-28 rounded-full border-8 flex items-center justify-center bg-white shadow-inner ${
                 cargandoNpsComprador ? 'border-gray-300' :
                 (npsCompradorMetrica?.resumen?.npsScore ?? 0) >= 50 ? 'border-green-500' :
                 (npsCompradorMetrica?.resumen?.npsScore ?? 0) >= 0 ? 'border-yellow-500' :
                 'border-red-500'
               }`}>
                 <span className="text-4xl font-black text-gray-800">
                   {cargandoNpsComprador ? '…' :
                    (npsCompradorMetrica?.resumen?.npsScore ?? 0) > 0
                      ? `+${npsCompradorMetrica.resumen.npsScore}`
                      : (npsCompradorMetrica?.resumen?.npsScore ?? 0)}
                 </span>
               </div>
             </div>
             <p className="text-xs text-center text-gray-500 mb-4">
               {cargandoNpsComprador
                 ? 'Cargando…'
                 : npsCompradorMetrica
                   ? `${npsCompradorMetrica.resumen.totalEncuestas} encuestas · score prom. ${npsCompradorMetrica.resumen.scorePromedio}/10`
                   : 'Sin datos'}
             </p>
             <button onClick={() => abrirAnalisis("NPS Comprador")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Analizar</button>
           </div>
           <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col h-full max-w-md">
             <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
               <HeartHandshake className="w-4 h-4 text-indigo-500" /> 14. NPS Cliente Empresa
             </h4>
             <div className="flex items-center justify-center mb-4">
               <div className={`w-28 h-28 rounded-full border-8 flex items-center justify-center bg-white shadow-inner ${
                 cargandoNpsClienteEmpresa ? 'border-gray-300' :
                 (npsClienteEmpresaMetrica?.resumen?.npsScorePonderado ?? 0) >= 50 ? 'border-green-500' :
                 (npsClienteEmpresaMetrica?.resumen?.npsScorePonderado ?? 0) >= 0 ? 'border-yellow-500' :
                 'border-red-500'
               }`}>
                 <span className="text-4xl font-black text-gray-800">
                   {cargandoNpsClienteEmpresa ? '…' :
                    (npsClienteEmpresaMetrica?.resumen?.npsScorePonderado ?? 0) > 0
                      ? `+${npsClienteEmpresaMetrica.resumen.npsScorePonderado}`
                      : (npsClienteEmpresaMetrica?.resumen?.npsScorePonderado ?? 0)}
                 </span>
               </div>
             </div>
             <p className="text-xs text-center text-gray-500 mb-4">
               {cargandoNpsClienteEmpresa
                 ? 'Cargando…'
                 : npsClienteEmpresaMetrica
                   ? `${npsClienteEmpresaMetrica.resumen.totalEncuestasVotadas} de ${npsClienteEmpresaMetrica.resumen.totalEncuestasEnviadas} respondieron · ${npsClienteEmpresaMetrica.calidadDatos.periodoActual}`
                   : 'Sin datos'}
             </p>
             <button onClick={() => abrirAnalisis("NPS Cliente Empresa")} className="w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold mt-auto hover:bg-blue-50">Analizar</button>
           </div>
        </div>

      </div>
    </div>
  );
}
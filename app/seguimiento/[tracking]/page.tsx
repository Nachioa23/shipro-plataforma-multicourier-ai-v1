// =============================================================================
// /seguimiento/[tracking] — DEPRECADO (2026-06-02, QW#5)
// =============================================================================
// La pagina canonica es /s/[tracking]. Esta ruta queda como redirect 301
// para que mails historicos que ya circularon a clientes no rompan.
// Cuando no haya mails viejos en circulacion (estimado: 90 dias post-cambio),
// se puede eliminar esta carpeta completa.
// =============================================================================
import { redirect, RedirectType } from "next/navigation";

export default async function SeguimientoRedirect({
  params,
}: {
  params: Promise<{ tracking: string }>;
}) {
  const { tracking } = await params;
  redirect(`/s/${tracking}`, RedirectType.replace);
}

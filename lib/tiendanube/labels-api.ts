// =============================================================================
// DEUDA 144 (Momento 3 labels, Parte 3) — Módulo de labels de Tiendanube.
// =============================================================================
// Centraliza las llamadas a la API de Tiendanube relacionadas al ciclo de vida
// de una etiqueta (label) dentro de un fulfillment order. Hoy: un solo endpoint,
// PATCH READY_TO_DOWNLOAD. En piezas posteriores se sumarán:
//   - PATCH CANCELED (para reemplazar una provisoria por la real post-desbloqueo).
//   - GET/list labels (auditoría / diagnóstico).
//
// Contrato oficial (Poggi + doc). Todos los endpoints van bajo:
//   {base}/{version}/{store_id}/fulfillment-orders/{ffo_id}/labels/{label_id}
//
// AUTH: el caller pasa el accessToken PLAINTEXT (ya descifrado con decryptSecret).
// Este módulo NO descifra. Reusa apiUrl + authHeaders del módulo común
// (lib/tiendanube/api.ts, MOVE 1) para no duplicar construcción de URL / headers.
// =============================================================================

import { fetchTiendanube } from "@/lib/tiendanube/http";
import { apiUrl, authHeaders } from "@/lib/tiendanube/api";

export interface PatchLabelReadyInput {
  storeId: number;
  /** Access token PLAINTEXT — caller ya lo descifró con decryptSecret. */
  accessToken: string;
  fulfillmentOrderId: string;
  labelId: string;
  /** Tracking asociado a la etiqueta. SHP-* si provisoria; real del courier si definitiva. */
  trackingCode: string;
  /** Página de seguimiento visible para el comprador. Convención Shipro: `${APP_URL}/s/${trackingCode}`. */
  trackingUrl: string;
  /** URL desde la que Tiendanube descarga el PDF (nuestro endpoint /labels/download?token=...). */
  downloadUrl: string;
  /** Nombre del archivo con el que Tiendanube lo guarda internamente. Convención: `Etiqueta_${labelId}.pdf`. */
  fileName: string;
}

/**
 * PATCH a Tiendanube marcando la etiqueta READY_TO_DOWNLOAD con la URL de
 * descarga + tracking. DEUDA 144 Momento 3 Parte 3. Contrato Poggi/Gemini:
 *   PATCH /fulfillment-orders/{ffo}/labels/{label} con body:
 *     { status: "READY_TO_DOWNLOAD",
 *       tracking_info: { code, url },
 *       documents: [{ file_name, type: "LABEL", format: "PDF", download_url_from_app }] }
 *
 * Throws Error(HTTP status + body slice) si Tiendanube responde no-2xx. NO
 * reintenta acá — el reintento/cancel post-fallo es responsabilidad del flujo
 * de reemplazo (pieza posterior). El caller lo envuelve best-effort.
 */
export async function patchLabelReadyToDownload(
  input: PatchLabelReadyInput,
): Promise<void> {
  const res = await fetchTiendanube(
    apiUrl(
      input.storeId,
      `fulfillment-orders/${input.fulfillmentOrderId}/labels/${input.labelId}`,
    ),
    {
      method: "PATCH",
      headers: authHeaders(input.accessToken),
      body: JSON.stringify({
        status: "READY_TO_DOWNLOAD",
        tracking_info: {
          code: input.trackingCode,
          url: input.trackingUrl,
        },
        documents: [
          {
            file_name: input.fileName,
            type: "LABEL",
            format: "PDF",
            download_url_from_app: input.downloadUrl,
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(
      `patchLabelReadyToDownload HTTP ${res.status}: ${detalle}`.slice(0, 300),
    );
  }
}

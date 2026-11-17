-- TramoEnvio.refCourierInterno — id privado del courier (ej. Pickit
-- transactionId) para cancelar/re-etiquetar, distinto del trackingExterno
-- público. Aditiva + nullable: adapters que no lo necesitan lo dejan NULL
-- y los call-sites de cancelación caen al fallback trackingExterno.

ALTER TABLE "TramoEnvio" ADD COLUMN "refCourierInterno" TEXT;

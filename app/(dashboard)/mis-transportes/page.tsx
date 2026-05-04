import { redirect } from "next/navigation";

// Compatibilidad con links viejos (DEUDA 4: refactor a /configuracion/transportes).
export default function MisTransportesRedirect() {
  redirect("/configuracion/transportes");
}

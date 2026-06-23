// ============================================================================
// app/providers.tsx — Client Component wrapper para providers globales
//
// DEUDA 17.D fix (2026-06-23): SessionProvider movido a root layout para
// que rutas fuera de (dashboard) (ej: /onboarding, /login) tengan acceso
// a useSession() sin loop del gate.
//
// Server Components NO pueden importar SessionProvider directamente
// (next-auth/react es client-only). Este wrapper soluciona ese constraint.
// ============================================================================

"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

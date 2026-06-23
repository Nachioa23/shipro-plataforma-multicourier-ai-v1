import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      rol: string;
      empresaId: number | null;
      // DEUDA 17.D: campos para gate del wizard onboarding.
      onboardingCompletado: boolean;
      passwordTemporal: boolean;
    };
  }
  interface User {
    rol: string;
    empresaId: number | null;
    onboardingCompletado: boolean;
    passwordTemporal: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    rol: string;
    empresaId: number | null;
    onboardingCompletado: boolean;
    passwordTemporal: boolean;
  }
}

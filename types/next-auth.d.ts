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
    };
  }
  interface User {
    rol: string;
    empresaId: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    rol: string;
    empresaId: number | null;
  }
}

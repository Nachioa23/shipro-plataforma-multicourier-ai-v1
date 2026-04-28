import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      rol: string;
      empresaId: number;
    };
  }
  interface User {
    rol: string;
    empresaId: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    rol: string;
    empresaId: number;
  }
}

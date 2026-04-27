import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/prisma"; // El cable que creamos antes

// Le explicamos a Typescript que nuestro usuario tiene campos extra (rol y empresa)
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      rol: string;
      empresaId: number;
    }
  }
  interface User {
    rol: string;
    empresaId: number;
  }
}

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credenciales",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "tu@email.com" },
        password: { label: "Contraseña", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // 1. Buscamos el mail en tu base de datos Prisma
        const user = await prisma.usuario.findUnique({
          where: { email: credentials.email }
        });

        // Si no existe el usuario, rebotamos
        if (!user) return null;

        // 2. Comparamos la contraseña 
        // (Nota: Como es un prototipo, la leemos directo. En prod se encripta)
        if (user.password !== credentials.password) return null;

        // 3. Si todo está OK, le damos el pase VIP con sus datos reales
        return {
          id: user.id.toString(),
          name: user.nombre,
          email: user.email,
          rol: user.rol,
          empresaId: user.empresaId
        };
      }
    })
  ],
  callbacks: {
    // Metemos el rol y la empresa en el "ticket" de sesión invisible
    async jwt({ token, user }) {
      if (user) {
        token.rol = user.rol;
        token.empresaId = user.empresaId;
      }
      return token;
    },
    // Le pasamos ese ticket a las pantallas (Frontend)
    async session({ session, token }) {
      if (session.user) {
        session.user.rol = token.rol as string;
        session.user.empresaId = token.empresaId as number;
      }
      return session;
    }
  },
  pages: {
    signIn: '/', // Por ahora, si hay error, lo mandamos al inicio
  }
});

export { handler as GET, handler as POST };
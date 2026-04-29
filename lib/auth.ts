import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credenciales",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "tu@email.com" },
        password: { label: "Contraseña", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.usuario.findUnique({
          where: { email: credentials.email },
          include: { empresa: { select: { activo: true } } }
        });

        if (!user) return null;

        const passwordMatch = await bcrypt.compare(credentials.password, user.password);
        if (!passwordMatch) return null;

        // Usuarios shipro (empresaId=null) no pertenecen a ninguna empresa: no aplicar el check de empresa activa.
        if (user.empresa && !user.empresa.activo) {
          throw new Error("Empresa deshabilitada. Contactá a soporte.");
        }

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
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.rol = user.rol;
        token.empresaId = user.empresaId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.rol = token.rol;
        session.user.empresaId = token.empresaId;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  }
};

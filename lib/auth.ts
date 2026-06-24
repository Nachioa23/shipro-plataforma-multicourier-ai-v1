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
          // DEUDA 17.D: incluir onboardingCompletado para gate + passwordTemporal para forzar cambio.
          include: { empresa: { select: { activo: true, onboardingCompletado: true } } }
        });

        if (!user) return null;

        const passwordMatch = await bcrypt.compare(credentials.password, user.password);
        if (!passwordMatch) return null;

        // Usuarios shipro (empresaId=null) no pertenecen a ninguna empresa: no aplicar el check de empresa activa.
        // Menor 7 (2026-06-03): usamos codigo enumerable en lugar de mensaje literal.
        // NextAuth v4 con signIn redirect:false propaga el message del Error a res.error.
        // El frontend (app/login/page.tsx) mapea los codigos a mensajes user-facing.
        // Mantener los codigos como SCREAMING_SNAKE_CASE para futuros casos.
        if (user.empresa && !user.empresa.activo) {
          throw new Error("EMPRESA_INACTIVA");
        }

        // DEUDA 17.F.1: bloquear usuarios desactivados (soft-delete).
        if (!user.activo) {
          throw new Error("USUARIO_INACTIVO");
        }

        return {
          id: user.id.toString(),
          name: user.nombre,
          email: user.email,
          rol: user.rol,
          empresaId: user.empresaId,
          // DEUDA 17.D: gate wizard onboarding.
          // Usuarios shipro (empresaId=null) no tienen onboarding → siempre true.
          // Usuarios cliente: heredan flag de su empresa.
          onboardingCompletado: user.empresa?.onboardingCompletado ?? true,
          passwordTemporal: user.passwordTemporal,
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
    async jwt({ token, user, trigger }) {
      if (user) {
        token.rol = user.rol;
        token.empresaId = user.empresaId;
        // DEUDA 17.D: persistir flags onboarding en token.
        token.onboardingCompletado = user.onboardingCompletado;
        token.passwordTemporal = user.passwordTemporal;
      }

      // DEUDA 17.E.4.0: cuando useSession().update() se llama desde el frontend,
      // re-fetch desde BD los flags onboarding (necesario despues de
      // /api/onboarding/finalizar para que el gate del layout se libere).
      if (trigger === "update" && token.email) {
        const usuario = await prisma.usuario.findUnique({
          where: { email: token.email },
          include: { empresa: { select: { onboardingCompletado: true } } },
        });
        if (usuario) {
          token.onboardingCompletado = usuario.empresa?.onboardingCompletado ?? true;
          token.passwordTemporal = usuario.passwordTemporal;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.rol = token.rol;
        session.user.empresaId = token.empresaId;
        // DEUDA 17.D: exponer flags onboarding al cliente.
        session.user.onboardingCompletado = token.onboardingCompletado;
        session.user.passwordTemporal = token.passwordTemporal;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  }
};

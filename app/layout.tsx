import type { Metadata } from "next";
import { Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({ 
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"] 
});

export const metadata: Metadata = {
  title: "Shipro | Plataforma Multicourier",
  description: "Gestión inteligente de logística y envíos para E-commerce.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="es">
      <body className={`${sora.className} antialiased text-gray-800 bg-gray-50`}>
        {/* Aquí es donde se inyectarán todas las páginas dinámicamente. */}
        {/* Las páginas públicas de seguimiento irán directo acá, sin barra lateral. */}
        {children}
      </body>
    </html>
  );
}
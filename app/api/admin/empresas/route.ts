import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const empresas = await prisma.empresa.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' }
    });
    return NextResponse.json(empresas);
  } catch (error) {
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { getTournamentSnapshot, toPublicSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) {
    return NextResponse.json({ message: "Turnamen tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(toPublicSnapshot(snapshot));
}

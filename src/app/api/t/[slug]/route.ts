import { NextResponse } from "next/server";
import { getTournamentSnapshot } from "@/lib/queries";
import { etagFromRevision, toClientSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) {
    return NextResponse.json({ message: "Turnamen tidak ditemukan." }, { status: 404 });
  }

  const client = toClientSnapshot(snapshot);
  const etag = etagFromRevision(client.revision);
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-cache",
      },
    });
  }

  return NextResponse.json(client, {
    headers: {
      ETag: etag,
      "Cache-Control": "no-cache",
    },
  });
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TournamentBoard } from "@/components/tournament-board";
import { isAdminFor } from "@/lib/actions";
import { getTournamentSnapshot, toPublicSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) {
    return { title: "Turnamen tidak ditemukan · Coconut Padel" };
  }
  return {
    title: `${snapshot.tournament.name} · Coconut Padel`,
    description: "Pertandingan dan klasemen Americano live.",
  };
}

export default async function TournamentPage({ params }: PageProps) {
  const { slug } = await params;
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) notFound();
  const isAdmin = await isAdminFor(slug);

  return (
    <TournamentBoard
      slug={slug}
      initialSnapshot={toPublicSnapshot(snapshot)}
      isAdmin={isAdmin}
    />
  );
}

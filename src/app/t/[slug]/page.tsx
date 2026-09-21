import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TournamentBoard } from "@/components/tournament-board";
import { isAdminFor } from "@/lib/actions";
import { getTournamentSnapshotCached } from "@/lib/queries";
import { toClientSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = await getTournamentSnapshotCached(slug);
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
  const [snapshot, isAdmin] = await Promise.all([
    getTournamentSnapshotCached(slug),
    isAdminFor(slug),
  ]);
  if (!snapshot) notFound();

  return (
    <TournamentBoard
      slug={slug}
      initialSnapshot={toClientSnapshot(snapshot)}
      isAdmin={isAdmin}
    />
  );
}

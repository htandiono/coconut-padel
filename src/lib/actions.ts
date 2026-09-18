"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customAlphabet } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matchPlayers, matches, players, tournaments } from "@/lib/db/schema";
import {
  adminCookieName,
  hashPin,
  isValidPin,
  signAdminToken,
  verifyPin,
} from "@/lib/auth";
import { generateRound } from "@/lib/matchmaker";
import { isValidAmericanoScore } from "@/lib/scoring";
import {
  getTournamentBySlug,
  getTournamentSnapshot,
  listPendingMatches,
  pastMatchesFromSnapshot,
} from "@/lib/queries";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);
const POINTS_OPTIONS = [16, 21, 24, 32] as const;

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function requireAdmin(slug: string) {
  const jar = await cookies();
  const token = jar.get(adminCookieName(slug))?.value;
  return token === signAdminToken(slug);
}

async function setAdminCookie(slug: string) {
  const jar = await cookies();
  jar.set(adminCookieName(slug), signAdminToken(slug), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

function refreshTournament(slug: string) {
  revalidatePath(`/t/${slug}`);
}

async function persistRound(tournamentId: string, roundNumber: number, generated: ReturnType<typeof generateRound>) {
  const db = getDb();
  for (const match of generated.matches) {
    const [created] = await db
      .insert(matches)
      .values({
        tournamentId,
        roundNumber,
        courtNumber: match.court,
        status: "pending",
      })
      .returning();

    await db.insert(matchPlayers).values([
      { matchId: created.id, playerId: match.teamA[0], team: "A" },
      { matchId: created.id, playerId: match.teamA[1], team: "A" },
      { matchId: created.id, playerId: match.teamB[0], team: "B" },
      { matchId: created.id, playerId: match.teamB[1], team: "B" },
    ]);
  }
}

async function generateNextRoundFor(slug: string): Promise<ActionResult> {
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) return { ok: false, message: "Turnamen tidak ditemukan." };

  const pending = snapshot.matches.filter((match) => match.status === "pending");
  if (pending.length > 0) {
    return { ok: false, message: "Selesaikan skor pertandingan yang masih berjalan dulu." };
  }

  const nextRound = snapshot.currentRound + 1;
  const generated = generateRound({
    players: snapshot.players.map((player) => ({ id: player.id, present: player.present })),
    courtCount: snapshot.tournament.courtCount,
    pastMatches: pastMatchesFromSnapshot(snapshot),
    roundNumber: nextRound,
  });

  if (generated.matches.length === 0) {
    return {
      ok: false,
      message: "Butuh minimal 4 pemain yang sudah hadir untuk membuat pertandingan.",
    };
  }

  await persistRound(snapshot.tournament.id, nextRound, generated);
  if (snapshot.tournament.status !== "live") {
    const db = getDb();
    await db.update(tournaments).set({ status: "live" }).where(eq(tournaments.id, snapshot.tournament.id));
  }
  return { ok: true, message: `Ronde ${nextRound} siap dimainkan.` };
}

export async function createTournament(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  const courtCount = Number(formData.get("courtCount") ?? 1);
  const pointsPerMatch = Number(formData.get("pointsPerMatch") ?? 24);
  const playerNames = formData.getAll("playerName").map((value) => String(value).trim());
  const lateFlags = formData.getAll("playerLate").map((value) => String(value) === "1");

  if (name.length < 3) {
    return { ok: false as const, message: "Nama turnamen minimal 3 karakter." };
  }
  if (!isValidPin(pin)) {
    return { ok: false as const, message: "PIN pengelola harus 4 sampai 6 digit angka." };
  }
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 12) {
    return { ok: false as const, message: "Jumlah lapangan harus antara 1 dan 12." };
  }
  if (!POINTS_OPTIONS.includes(pointsPerMatch as (typeof POINTS_OPTIONS)[number])) {
    return { ok: false as const, message: "Pilih poin per pertandingan yang tersedia." };
  }

  const roster = playerNames
    .map((playerName, index) => ({ name: playerName, isLate: lateFlags[index] ?? false }))
    .filter((player) => player.name.length > 0);

  if (roster.length < 4) {
    return { ok: false as const, message: "Masukkan minimal 4 pemain." };
  }

  const slug = nanoid();
  const db = getDb();
  const [tournament] = await db
    .insert(tournaments)
    .values({
      slug,
      name,
      courtCount,
      pointsPerMatch,
      status: "setup",
      adminPinHash: hashPin(pin),
    })
    .returning();

  await db.insert(players).values(
    roster.map((player) => ({
      tournamentId: tournament.id,
      name: player.name,
      present: !player.isLate,
      isLate: player.isLate,
    })),
  );

  await setAdminCookie(slug);
  redirect(`/t/${slug}`);
}

export async function unlockAdmin(slug: string, pin: string): Promise<ActionResult> {
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (!verifyPin(pin, tournament.adminPinHash)) {
    return { ok: false, message: "PIN pengelola salah." };
  }
  await setAdminCookie(slug);
  refreshTournament(slug);
  return { ok: true, message: "Mode pengelola aktif." };
}

export async function addPlayer(slug: string, name: string, late: boolean): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const trimmed = name.trim();
  if (trimmed.length < 1) return { ok: false, message: "Nama pemain tidak boleh kosong." };

  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (tournament.status === "finished") return { ok: false, message: "Turnamen sudah selesai." };

  const db = getDb();
  await db.insert(players).values({
    tournamentId: tournament.id,
    name: trimmed,
    present: !late,
    isLate: late,
  });
  refreshTournament(slug);
  return {
    ok: true,
    message: late
      ? `${trimmed} dicatat sebagai pemain telat dan akan diprioritaskan setelah datang.`
      : `${trimmed} masuk daftar pemain.`,
  };
}

export async function setPlayerArrival(slug: string, playerId: string, present: boolean): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };

  const db = getDb();
  await db
    .update(players)
    .set(present ? { present: true, isLate: true } : { present: false })
    .where(eq(players.id, playerId));

  refreshTournament(slug);
  return {
    ok: true,
    message: present
      ? "Pemain ditandai sudah datang. Ronde berikutnya akan memprioritaskannya."
      : "Pemain ditandai belum datang.",
  };
}

export async function updateCourtCount(slug: string, courtCount: number): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 12) {
    return { ok: false, message: "Jumlah lapangan harus antara 1 dan 12." };
  }
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };

  const db = getDb();
  await db.update(tournaments).set({ courtCount }).where(eq(tournaments.id, tournament.id));
  refreshTournament(slug);
  return { ok: true, message: `Jumlah lapangan diubah menjadi ${courtCount}.` };
}

export async function startOrNextRound(slug: string): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (tournament.status === "finished") return { ok: false, message: "Turnamen sudah selesai." };

  const result = await generateNextRoundFor(slug);
  refreshTournament(slug);
  return result;
}

export async function submitScore(
  slug: string,
  matchId: string,
  teamAScore: number,
  teamBScore: number,
): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (!isValidAmericanoScore(teamAScore, teamBScore, tournament.pointsPerMatch)) {
    return {
      ok: false,
      message: `Skor Americano harus berjumlah ${tournament.pointsPerMatch} poin.`,
    };
  }

  const db = getDb();
  await db
    .update(matches)
    .set({
      teamAScore,
      teamBScore,
      status: "completed",
    })
    .where(eq(matches.id, matchId));

  const pending = await listPendingMatches(tournament.id);
  if (pending.length === 0 && tournament.status === "live") {
    await generateNextRoundFor(slug);
  }

  refreshTournament(slug);
  return { ok: true, message: "Skor tersimpan." };
}

export async function finishTournament(slug: string): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };

  const db = getDb();
  await db.update(tournaments).set({ status: "finished" }).where(eq(tournaments.id, tournament.id));
  refreshTournament(slug);
  return { ok: true, message: "Turnamen ditutup. Klasemen akhir tetap bisa dilihat lewat tautan." };
}

export async function isAdminFor(slug: string) {
  return requireAdmin(slug);
}

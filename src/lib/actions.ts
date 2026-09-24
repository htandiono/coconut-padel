"use server";

import { after } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customAlphabet } from "nanoid";
import { and, eq } from "drizzle-orm";
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
  pastMatchesFromSnapshot,
} from "@/lib/queries";
import { toClientSnapshot, type ClientSnapshot } from "@/lib/snapshot";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);
const POINTS_OPTIONS = [16, 21, 24, 32] as const;

export type ActionResult =
  | { ok: true; message?: string; snapshot?: ClientSnapshot }
  | { ok: false; message: string };

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
  after(() => {
    revalidatePath(`/t/${slug}`);
  });
}

async function okWithSnapshot(slug: string, message: string): Promise<ActionResult> {
  const snapshot = await getTournamentSnapshot(slug);
  refreshTournament(slug);
  if (!snapshot) return { ok: true, message };
  return { ok: true, message, snapshot: toClientSnapshot(snapshot) };
}

async function persistRound(tournamentId: string, roundNumber: number, generated: ReturnType<typeof generateRound>) {
  if (generated.matches.length === 0) return;

  const db = getDb();
  const created = await db
    .insert(matches)
    .values(
      generated.matches.map((match) => ({
        tournamentId,
        roundNumber,
        courtNumber: match.court,
        status: "pending" as const,
      })),
    )
    .returning({ id: matches.id });

  await db.insert(matchPlayers).values(
    created.flatMap((row, index) => {
      const match = generated.matches[index];
      return [
        { matchId: row.id, playerId: match.teamA[0], team: "A" },
        { matchId: row.id, playerId: match.teamA[1], team: "A" },
        { matchId: row.id, playerId: match.teamB[0], team: "B" },
        { matchId: row.id, playerId: match.teamB[1], team: "B" },
      ];
    }),
  );
}

/**
 * Buat match baru di lapangan yang kosong, hanya memakai pemain yang
 * sedang tidak bermain. Ronde lain boleh masih jalan.
 */
async function fillCourts(slug: string): Promise<ActionResult> {
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (snapshot.tournament.status === "finished") {
    return { ok: false, message: "Turnamen sudah selesai." };
  }

  const pending = snapshot.matches.filter((match) => match.status === "pending");
  const busyCourts = new Set(pending.map((match) => match.courtNumber));
  const busyPlayers = new Set(
    pending.flatMap((match) => [...match.teamA, ...match.teamB].map((player) => player.id)),
  );

  const freeCourts: number[] = [];
  for (let court = 1; court <= snapshot.tournament.courtCount; court += 1) {
    if (!busyCourts.has(court)) freeCourts.push(court);
  }
  if (freeCourts.length === 0) {
    return { ok: false, message: "Semua lapangan lagi dipakai." };
  }

  const freePlayers = snapshot.players.filter(
    (player) => player.present && !busyPlayers.has(player.id),
  );
  if (freePlayers.length < 4) {
    return {
      ok: false,
      message:
        pending.length > 0
          ? "Pemain bebas belum cukup 4. Tunggu match selesai."
          : "Butuh minimal 4 pemain hadir.",
    };
  }

  const nextRound = snapshot.currentRound + 1;
  const generated = generateRound({
    players: freePlayers.map((player) => ({ id: player.id, present: true })),
    courtCount: freeCourts.length,
    pastMatches: pastMatchesFromSnapshot(snapshot),
    roundNumber: nextRound,
  });
  if (generated.matches.length === 0) {
    return { ok: false, message: "Butuh minimal 4 pemain hadir." };
  }

  const placed = generated.matches.map((match) => ({
    ...match,
    court: freeCourts[match.court - 1],
  }));
  await persistRound(snapshot.tournament.id, nextRound, { ...generated, matches: placed });

  if (snapshot.tournament.status !== "live") {
    const db = getDb();
    await db
      .update(tournaments)
      .set({ status: "live" })
      .where(eq(tournaments.id, snapshot.tournament.id));
  }

  const message =
    snapshot.currentRound === 0
      ? "Turnamen dimulai."
      : `Match baru di lapangan ${placed.map((match) => match.court).join(" & ")}.`;
  return okWithSnapshot(slug, message);
}

/** Setelah aksi yang membebaskan pemain/lapangan, coba isi court kosong. */
async function fillThenRespond(slug: string, base: string, live: boolean): Promise<ActionResult> {
  if (live) {
    const filled = await fillCourts(slug);
    if (filled.ok) {
      return {
        ok: true,
        message: filled.message ? `${base} ${filled.message}` : base,
        snapshot: filled.snapshot,
      };
    }
  }
  return okWithSnapshot(slug, base);
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
    return { ok: false as const, message: "PIN harus 4-6 digit angka." };
  }
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 12) {
    return { ok: false as const, message: "Jumlah lapangan 1-12." };
  }
  if (!POINTS_OPTIONS.includes(pointsPerMatch as (typeof POINTS_OPTIONS)[number])) {
    return { ok: false as const, message: "Pilih poin yang tersedia." };
  }

  const roster = playerNames
    .map((playerName, index) => ({ name: playerName, isLate: lateFlags[index] ?? false }))
    .filter((player) => player.name.length > 0);

  if (roster.length < 4) {
    return { ok: false as const, message: "Minimal 4 pemain." };
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
    return { ok: false, message: "PIN salah." };
  }
  await setAdminCookie(slug);
  return okWithSnapshot(slug, "Mode pengelola aktif.");
}

export async function addPlayer(slug: string, name: string, late: boolean): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const trimmed = name.trim();
  if (trimmed.length < 1) return { ok: false, message: "Isi nama pemain." };

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

  if (late) {
    return okWithSnapshot(slug, `${trimmed} masuk daftar — nunggu datang.`);
  }
  return fillThenRespond(slug, `${trimmed} ditambahkan.`, tournament.status === "live");
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

  if (present) {
    return fillThenRespond(slug, "Siap main — dapat prioritas.", tournament.status === "live");
  }
  return okWithSnapshot(slug, "Ditandai keluar.");
}

export async function updateCourtCount(slug: string, courtCount: number): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 12) {
    return { ok: false, message: "Jumlah lapangan 1-12." };
  }
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };

  const db = getDb();
  await db.update(tournaments).set({ courtCount }).where(eq(tournaments.id, tournament.id));
  return fillThenRespond(slug, `Lapangan jadi ${courtCount}.`, tournament.status === "live");
}

export async function startOrNextRound(slug: string): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  return fillCourts(slug);
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
    return { ok: false, message: `Skor harus total ${tournament.pointsPerMatch}.` };
  }

  const db = getDb();
  const [existing] = await db
    .select({ status: matches.status })
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tournamentId, tournament.id)))
    .limit(1);
  if (!existing) return { ok: false, message: "Match tidak ditemukan." };

  await db
    .update(matches)
    .set({
      teamAScore,
      teamBScore,
      status: "completed",
    })
    .where(eq(matches.id, matchId));

  if (existing.status === "completed") {
    return okWithSnapshot(slug, "Skor diubah.");
  }
  return fillThenRespond(slug, "Skor tersimpan.", tournament.status === "live");
}

export async function finishTournament(slug: string): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };

  const db = getDb();
  await db.update(tournaments).set({ status: "finished" }).where(eq(tournaments.id, tournament.id));
  return okWithSnapshot(slug, "Turnamen ditutup.");
}

export async function isAdminFor(slug: string) {
  return requireAdmin(slug);
}

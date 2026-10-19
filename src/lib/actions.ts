"use server";

import { after } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customAlphabet } from "nanoid";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { matchPlayers, matches, players, tournaments } from "@/lib/db/schema";
import {
  adminCookieName,
  hashPin,
  isValidPin,
  signAdminToken,
  verifyPin,
} from "@/lib/auth";
import {
  generateRound,
  previewUpcomingRounds,
  roundToActivate,
  roundsAheadOfPlay,
  scheduledTailCeiling,
  statusesForBatch,
  type ScheduleMode,
} from "@/lib/matchmaker";
import { isValidAmericanoScore, parsePointAdjustment } from "@/lib/scoring";
import {
  getTournamentBySlug,
  getTournamentSnapshot,
  pastMatchesFromSnapshot,
  type TournamentSnapshot,
} from "@/lib/queries";
import { toClientSnapshot, type ClientSnapshot } from "@/lib/snapshot";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);
const POINTS_OPTIONS = [16, 21, 24, 32] as const;
const SCHEDULE_MODES = ["continuous", "full"] as const;

function parseScheduleMode(value: string): ScheduleMode | null {
  return SCHEDULE_MODES.includes(value as ScheduleMode) ? (value as ScheduleMode) : null;
}

export type ActionResult =
  | { ok: true; message?: string; snapshot?: ClientSnapshot }
  | { ok: false; message: string };

type FillResult = ActionResult & { held?: boolean };

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

async function persistRound(
  tournamentId: string,
  roundNumber: number,
  generated: ReturnType<typeof generateRound>,
  status: "pending" | "scheduled" = "pending",
) {
  if (generated.matches.length === 0) return false;

  const db = getDb();
  const existing = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.roundNumber, roundNumber)))
    .limit(1);
  if (existing.length > 0) return false;

  const created = await db
    .insert(matches)
    .values(
      generated.matches.map((match) => ({
        tournamentId,
        roundNumber,
        courtNumber: match.court,
        status,
      })),
    )
    .returning({ id: matches.id });

  if (created.length !== generated.matches.length) return false;

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
  return true;
}

async function markLive(snapshot: TournamentSnapshot) {
  if (snapshot.tournament.status === "live") return;
  const db = getDb();
  await db
    .update(tournaments)
    .set({ status: "live" })
    .where(eq(tournaments.id, snapshot.tournament.id));
}

async function savePlannedRounds(snapshot: TournamentSnapshot, alreadyPlaying: boolean, limit: number) {
  if (limit <= 0) return 0;
  const nextRoundNumber =
    snapshot.matches.reduce((max, match) => Math.max(max, match.roundNumber), 0) + 1;
  const rounds = previewUpcomingRounds({
    players: snapshot.players.map((player) => ({ id: player.id, present: player.present })),
    courtCount: snapshot.tournament.courtCount,
    pastMatches: pastMatchesFromSnapshot(snapshot),
    nextRoundNumber,
    limit,
  });
  const statuses = statusesForBatch(rounds.length, alreadyPlaying);
  let saved = 0;
  for (const [index, round] of rounds.entries()) {
    const created = await persistRound(snapshot.tournament.id, round.roundNumber, round, statuses[index]);
    if (created) saved += 1;
  }
  return saved;
}

/** Susun ulang ronde yang belum main dan belum punya skor. */
async function rewriteScheduledTail(slug: string) {
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot || snapshot.tournament.scheduleMode !== "full") return;
  const ceiling = scheduledTailCeiling(snapshot.matches);
  const removable = snapshot.matches.filter(
    (match) => match.status === "scheduled" && match.roundNumber > ceiling,
  );
  if (removable.length === 0) return;

  const db = getDb();
  await db.delete(matches).where(
    inArray(
      matches.id,
      removable.map((match) => match.id),
    ),
  );

  const fresh = await getTournamentSnapshot(slug);
  if (!fresh) return;
  await savePlannedRounds(fresh, true, roundsAheadOfPlay(fresh.matches));
}

async function deleteScheduledMatches(tournamentId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.status, "scheduled")));
  if (rows.length === 0) return;
  await db.delete(matches).where(
    inArray(
      matches.id,
      rows.map((row) => row.id),
    ),
  );
}

/**
 * Mode ronde penuh: ronde pertama langsung main, ronde berikut tersimpan
 * dan bisa diisi skor. Ronde berikut naik jadi "main" setelah ronde aktif selesai.
 */
async function advanceFullSchedule(slug: string, snapshot: TournamentSnapshot): Promise<FillResult> {
  const pending = snapshot.matches.some((match) => match.status === "pending");
  const scheduled = snapshot.matches.some((match) => match.status === "scheduled");

  if (!pending && scheduled) {
    const activate = roundToActivate(snapshot.matches);
    if (activate === null) return { ok: false, message: "Belum ada ronde untuk dimainkan." };

    const db = getDb();
    await db
      .update(matches)
      .set({ status: "pending" })
      .where(
        and(
          eq(matches.tournamentId, snapshot.tournament.id),
          eq(matches.roundNumber, activate),
          eq(matches.status, "scheduled"),
        ),
      );

    const fresh = await getTournamentSnapshot(slug);
    if (fresh) await savePlannedRounds(fresh, true, roundsAheadOfPlay(fresh.matches));
    return okWithSnapshot(slug, `Ronde ${activate} dimulai.`);
  }

  if (!pending && !scheduled) {
    const created = await savePlannedRounds(snapshot, false, roundsAheadOfPlay(snapshot.matches));
    if (created === 0) return { ok: false, message: "Butuh minimal 4 pemain hadir." };
    await markLive(snapshot);
    return okWithSnapshot(slug, snapshot.currentRound === 0 ? "Jadwal ronde siap." : "Ronde berikutnya siap.");
  }

  const created = await savePlannedRounds(snapshot, true, roundsAheadOfPlay(snapshot.matches));
  if (created > 0) return okWithSnapshot(slug, "Jadwal ronde siap.");
  return { ok: false, held: true, message: "Ronde berikutnya sudah ada di jadwal." };
}

/** Isi jadwal yang masih kurang dari 20 ronde di depan ronde yang sedang main. */
export async function ensureUpcomingRounds(slug: string): Promise<TournamentSnapshot | null> {
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) return null;
  const playing = snapshot.matches.some((match) => match.status === "pending");
  if (snapshot.tournament.scheduleMode !== "full" || snapshot.tournament.status !== "live" || !playing) {
    return snapshot;
  }

  const created = await savePlannedRounds(snapshot, true, roundsAheadOfPlay(snapshot.matches));
  if (created === 0) return snapshot;
  refreshTournament(slug);
  return (await getTournamentSnapshot(slug)) ?? snapshot;
}

/**
 * Buat match baru di lapangan yang kosong, hanya memakai pemain yang
 * sedang tidak bermain. Mode isi langsung boleh mengisi lapangan yang
 * sudah selesai meski lapangan lain masih main.
 */
async function fillCourts(slug: string): Promise<FillResult> {
  const snapshot = await getTournamentSnapshot(slug);
  if (!snapshot) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (snapshot.tournament.status === "finished") {
    return { ok: false, message: "Turnamen sudah selesai." };
  }
  if (snapshot.tournament.scheduleMode === "full") {
    return advanceFullSchedule(slug, snapshot);
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
    if (filled.held) {
      return okWithSnapshot(slug, `${base} ${filled.message}`);
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
  const scheduleMode = parseScheduleMode(String(formData.get("scheduleMode") ?? "continuous"));
  const playerNames = formData.getAll("playerName").map((value) => String(value).trim());
  const lateFlags = formData.getAll("playerLate").map((value) => String(value) === "1");
  const pointValues = formData.getAll("playerPoints").map((value) => String(value).trim());

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
  if (!scheduleMode) {
    return { ok: false as const, message: "Mode jadwal tidak dikenal." };
  }

  const roster = playerNames
    .map((playerName, index) => ({
      name: playerName,
      isLate: scheduleMode === "full" ? false : (lateFlags[index] ?? false),
      pointAdjustment: parsePointAdjustment(pointValues[index] ?? "0"),
    }))
    .filter((player) => player.name.length > 0);

  if (roster.some((player) => player.pointAdjustment === null)) {
    return { ok: false as const, message: "Poin penyesuaian harus bilangan bulat dari -999 sampai 999." };
  }

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
      scheduleMode,
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
      pointAdjustment: player.pointAdjustment ?? 0,
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
  if (late && tournament.scheduleMode === "full") {
    return { ok: false, message: "Mode ronde penuh tidak memakai pemain telat." };
  }

  const db = getDb();
  await db.insert(players).values({
    tournamentId: tournament.id,
    name: trimmed,
    present: !late,
    isLate: late,
  });

  if (!late && tournament.scheduleMode === "full" && tournament.status === "live") {
    await rewriteScheduledTail(slug);
  }
  if (late) {
    return okWithSnapshot(slug, `${trimmed} masuk daftar — nunggu datang.`);
  }
  return fillThenRespond(slug, `${trimmed} ditambahkan.`, tournament.status === "live");
}

export async function setPlayerArrival(slug: string, playerId: string, present: boolean): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (tournament.scheduleMode === "full") {
    return { ok: false, message: "Mode ronde penuh tidak memakai pemain telat." };
  }

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

export async function setPlayerPoints(slug: string, playerId: string, points: number): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  if (!Number.isInteger(points) || points < -999 || points > 999) {
    return { ok: false, message: "Poin harus bilangan bulat dari -999 sampai 999." };
  }

  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (tournament.status === "finished") return { ok: false, message: "Turnamen sudah selesai." };

  const db = getDb();
  const updated = await db
    .update(players)
    .set({ pointAdjustment: points })
    .where(and(eq(players.id, playerId), eq(players.tournamentId, tournament.id)))
    .returning({ id: players.id });
  if (updated.length === 0) return { ok: false, message: "Pemain tidak ditemukan." };
  return okWithSnapshot(slug, "Poin diperbarui.");
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
  if (tournament.scheduleMode === "full" && tournament.status === "live") {
    await rewriteScheduledTail(slug);
  }
  return fillThenRespond(slug, `Lapangan jadi ${courtCount}.`, tournament.status === "live");
}

export async function updateScheduleMode(slug: string, mode: string): Promise<ActionResult> {
  if (!(await requireAdmin(slug))) return { ok: false, message: "Masuk sebagai pengelola dulu." };
  const scheduleMode = parseScheduleMode(mode);
  if (!scheduleMode) return { ok: false, message: "Mode jadwal tidak dikenal." };

  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return { ok: false, message: "Turnamen tidak ditemukan." };
  if (tournament.status === "finished") return { ok: false, message: "Turnamen sudah selesai." };

  const db = getDb();
  await db
    .update(tournaments)
    .set({ scheduleMode })
    .where(eq(tournaments.id, tournament.id));

  if (scheduleMode === "full") {
    await db
      .update(players)
      .set({ present: true, isLate: false })
      .where(eq(players.tournamentId, tournament.id));
    if (tournament.status === "live") await rewriteScheduledTail(slug);
  }

  const message =
    scheduleMode === "full"
      ? "Mode ronde penuh. Jadwal ronde bisa langsung diisi skor."
      : "Mode isi langsung. Lapangan kosong langsung diisi.";
  if (scheduleMode === "continuous") {
    await deleteScheduledMatches(tournament.id);
  }
  return fillThenRespond(slug, message, tournament.status === "live");
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
  if (existing.status === "scheduled") {
    await ensureUpcomingRounds(slug);
    return okWithSnapshot(slug, "Skor tersimpan.");
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

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { matchPlayers, matches, players, tournaments } from "./db/schema";
import { computeStandings, type CompletedMatch } from "./scoring";
import type { PastMatch } from "./matchmaker";

export type TournamentSnapshot = {
  tournament: typeof tournaments.$inferSelect;
  players: Array<typeof players.$inferSelect>;
  matches: Array<
    typeof matches.$inferSelect & {
      teamA: Array<typeof players.$inferSelect>;
      teamB: Array<typeof players.$inferSelect>;
    }
  >;
  standings: ReturnType<typeof computeStandings>;
  sittingOut: Array<typeof players.$inferSelect>;
  currentRound: number;
};

export async function getTournamentBySlug(slug: string) {
  const db = getDb();
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.slug, slug))
    .limit(1);
  return tournament ?? null;
}

export async function getTournamentSnapshot(slug: string): Promise<TournamentSnapshot | null> {
  const tournament = await getTournamentBySlug(slug);
  if (!tournament) return null;

  const db = getDb();
  const [playerRows, matchRows] = await Promise.all([
    db.select().from(players).where(eq(players.tournamentId, tournament.id)).orderBy(asc(players.createdAt)),
    db
      .select()
      .from(matches)
      .where(eq(matches.tournamentId, tournament.id))
      .orderBy(asc(matches.roundNumber), asc(matches.courtNumber)),
  ]);

  const playerMap = new Map(playerRows.map((player) => [player.id, player]));
  const matchIds = matchRows.map((match) => match.id);
  const lineup =
    matchIds.length === 0
      ? []
      : await db.select().from(matchPlayers).where(inArray(matchPlayers.matchId, matchIds));

  const lineupByMatch = new Map<string, Array<typeof matchPlayers.$inferSelect>>();
  for (const row of lineup) {
    if (!matchIds.includes(row.matchId)) continue;
    const list = lineupByMatch.get(row.matchId) ?? [];
    list.push(row);
    lineupByMatch.set(row.matchId, list);
  }

  const hydrated = matchRows.map((match) => {
    const slots = lineupByMatch.get(match.id) ?? [];
    const teamA = slots
      .filter((slot) => slot.team === "A")
      .map((slot) => playerMap.get(slot.playerId))
      .filter((player): player is typeof players.$inferSelect => Boolean(player));
    const teamB = slots
      .filter((slot) => slot.team === "B")
      .map((slot) => playerMap.get(slot.playerId))
      .filter((player): player is typeof players.$inferSelect => Boolean(player));
    return { ...match, teamA, teamB };
  });

  const completed: CompletedMatch[] = [];
  for (const match of hydrated) {
    if (
      match.status === "completed" &&
      match.teamAScore !== null &&
      match.teamBScore !== null &&
      match.teamA.length === 2 &&
      match.teamB.length === 2
    ) {
      completed.push({
        teamA: [match.teamA[0].id, match.teamA[1].id],
        teamB: [match.teamB[0].id, match.teamB[1].id],
        teamAScore: match.teamAScore,
        teamBScore: match.teamBScore,
      });
    }
  }

  const currentRound = matchRows.reduce((max, match) => Math.max(max, match.roundNumber), 0);
  const latestRoundMatches = hydrated.filter((match) => match.roundNumber === currentRound);
  const playingIds = new Set(
    latestRoundMatches.flatMap((match) => [...match.teamA, ...match.teamB].map((player) => player.id)),
  );
  const sittingOut =
    currentRound === 0
      ? []
      : playerRows.filter((player) => player.present && !playingIds.has(player.id));

  return {
    tournament,
    players: playerRows,
    matches: hydrated,
    standings: computeStandings(
      playerRows.map((player) => player.id),
      completed,
    ),
    sittingOut,
    currentRound,
  };
}

export function pastMatchesFromSnapshot(snapshot: TournamentSnapshot): PastMatch[] {
  return snapshot.matches
    .filter((match) => match.teamA.length === 2 && match.teamB.length === 2)
    .map((match) => ({
      teamA: [match.teamA[0].id, match.teamA[1].id] as [string, string],
      teamB: [match.teamB[0].id, match.teamB[1].id] as [string, string],
    }));
}

export type PublicTournament = Omit<typeof tournaments.$inferSelect, "adminPinHash">;

export type PublicSnapshot = Omit<TournamentSnapshot, "tournament"> & {
  tournament: PublicTournament;
};

export function toPublicSnapshot(snapshot: TournamentSnapshot): PublicSnapshot {
  const { adminPinHash: _pin, ...tournament } = snapshot.tournament;
  return { ...snapshot, tournament };
}

export async function listPendingMatches(tournamentId: string) {
  const db = getDb();
  return db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.status, "pending")));
}

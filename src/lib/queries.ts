import { cache } from "react";
import { asc, eq } from "drizzle-orm";
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
  const db = getDb();
  const [rosterRows, matchRows] = await Promise.all([
    db
      .select({
        tournament: tournaments,
        player: players,
      })
      .from(tournaments)
      .leftJoin(players, eq(players.tournamentId, tournaments.id))
      .where(eq(tournaments.slug, slug))
      .orderBy(asc(players.createdAt)),
    db
      .select({
        match: matches,
        slot: matchPlayers,
      })
      .from(matches)
      .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
      .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
      .where(eq(tournaments.slug, slug))
      .orderBy(asc(matches.roundNumber), asc(matches.courtNumber)),
  ]);

  if (rosterRows.length === 0) return null;

  const tournament = rosterRows[0].tournament;
  const playerRows = rosterRows
    .map((row) => row.player)
    .filter((player): player is typeof players.$inferSelect => Boolean(player));
  const playerMap = new Map(playerRows.map((player) => [player.id, player]));

  const matchOrder: Array<typeof matches.$inferSelect> = [];
  const seenMatches = new Set<string>();
  const lineupByMatch = new Map<string, Array<typeof matchPlayers.$inferSelect>>();

  for (const row of matchRows) {
    if (!seenMatches.has(row.match.id)) {
      seenMatches.add(row.match.id);
      matchOrder.push(row.match);
    }
    if (row.slot) {
      const list = lineupByMatch.get(row.match.id) ?? [];
      list.push(row.slot);
      lineupByMatch.set(row.match.id, list);
    }
  }

  const hydrated = matchOrder.map((match) => {
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

  const currentRound = matchOrder.reduce((max, match) => Math.max(max, match.roundNumber), 0);
  // Pemain hadir yang tidak sedang bermain = antrean match berikutnya.
  const playingIds = new Set(
    hydrated
      .filter((match) => match.status === "pending")
      .flatMap((match) => [...match.teamA, ...match.teamB].map((player) => player.id)),
  );
  const sittingOut =
    currentRound === 0 ? [] : playerRows.filter((player) => player.present && !playingIds.has(player.id));

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

export const getTournamentSnapshotCached = cache(getTournamentSnapshot);

export function pastMatchesFromSnapshot(snapshot: TournamentSnapshot): PastMatch[] {
  return snapshot.matches
    .filter((match) => match.teamA.length === 2 && match.teamB.length === 2)
    .map((match) => ({
      teamA: [match.teamA[0].id, match.teamA[1].id] as [string, string],
      teamB: [match.teamB[0].id, match.teamB[1].id] as [string, string],
    }));
}


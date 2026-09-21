import type { StandingRow } from "@/lib/scoring";
import type { TournamentSnapshot } from "@/lib/queries";

export type ClientPlayer = {
  id: string;
  name: string;
  present: boolean;
  isLate: boolean;
};

export type ClientMatchPlayer = {
  id: string;
  name: string;
};

export type ClientMatch = {
  id: string;
  roundNumber: number;
  courtNumber: number;
  status: string;
  teamAScore: number | null;
  teamBScore: number | null;
  teamA: ClientMatchPlayer[];
  teamB: ClientMatchPlayer[];
};

export type ClientSnapshot = {
  revision: string;
  currentRound: number;
  tournament: {
    name: string;
    status: string;
    courtCount: number;
    pointsPerMatch: number;
  };
  players: ClientPlayer[];
  matches: ClientMatch[];
  standings: StandingRow[];
  sittingOut: ClientMatchPlayer[];
};

function slimPlayer(player: { id: string; name: string }): ClientMatchPlayer {
  return { id: player.id, name: player.name };
}

export function snapshotRevision(snapshot: Omit<ClientSnapshot, "revision">) {
  const players = snapshot.players
    .map((player) => `${player.id}:${Number(player.present)}:${Number(player.isLate)}`)
    .join(",");
  const matchState = snapshot.matches
    .map((match) => `${match.id}:${match.status}:${match.teamAScore ?? ""}:${match.teamBScore ?? ""}`)
    .join(",");
  return [
    snapshot.tournament.status,
    snapshot.tournament.courtCount,
    snapshot.currentRound,
    snapshot.players.length,
    snapshot.matches.length,
    players,
    matchState,
  ].join("|");
}

export function toClientSnapshot(snapshot: TournamentSnapshot): ClientSnapshot {
  const payload: Omit<ClientSnapshot, "revision"> = {
    currentRound: snapshot.currentRound,
    tournament: {
      name: snapshot.tournament.name,
      status: snapshot.tournament.status,
      courtCount: snapshot.tournament.courtCount,
      pointsPerMatch: snapshot.tournament.pointsPerMatch,
    },
    players: snapshot.players.map((player) => ({
      id: player.id,
      name: player.name,
      present: player.present,
      isLate: player.isLate,
    })),
    matches: snapshot.matches.map((match) => ({
      id: match.id,
      roundNumber: match.roundNumber,
      courtNumber: match.courtNumber,
      status: match.status,
      teamAScore: match.teamAScore,
      teamBScore: match.teamBScore,
      teamA: match.teamA.map(slimPlayer),
      teamB: match.teamB.map(slimPlayer),
    })),
    standings: snapshot.standings,
    sittingOut: snapshot.sittingOut.map(slimPlayer),
  };

  return { ...payload, revision: snapshotRevision(payload) };
}

export function etagFromRevision(revision: string) {
  let hash = 2166136261;
  for (let index = 0; index < revision.length; index += 1) {
    hash ^= revision.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `"${(hash >>> 0).toString(36)}"`;
}

export type CompletedMatch = {
  teamA: [string, string];
  teamB: [string, string];
  teamAScore: number;
  teamBScore: number;
};

export type StandingRow = {
  playerId: string;
  matches: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  highestRound: number;
  rank: number;
};

function emptyRow(playerId: string): StandingRow {
  return {
    playerId,
    matches: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    diff: 0,
    highestRound: 0,
    rank: 0,
  };
}

function h2hPoints(
  matches: CompletedMatch[],
  a: string,
  b: string,
): number {
  let score = 0;
  for (const match of matches) {
    const aInA = match.teamA.includes(a);
    const aInB = match.teamB.includes(a);
    const bInA = match.teamA.includes(b);
    const bInB = match.teamB.includes(b);
    if ((aInA && bInB) || (aInB && bInA)) {
      if (aInA) score += match.teamAScore - match.teamBScore;
      else score += match.teamBScore - match.teamAScore;
    }
  }
  return score;
}

export function isValidAmericanoScore(teamAScore: number, teamBScore: number, pointsPerMatch: number) {
  if (!Number.isInteger(teamAScore) || !Number.isInteger(teamBScore)) return false;
  if (teamAScore < 0 || teamBScore < 0) return false;
  return teamAScore + teamBScore === pointsPerMatch;
}

export function computeStandings(
  playerIds: string[],
  matches: CompletedMatch[],
): StandingRow[] {
  const rows = new Map(playerIds.map((id) => [id, emptyRow(id)]));

  for (const match of matches) {
    const apply = (ids: [string, string], scored: number, conceded: number) => {
      for (const id of ids) {
        const row = rows.get(id);
        if (!row) continue;
        row.matches += 1;
        row.points += scored;
        row.pointsFor += scored;
        row.pointsAgainst += conceded;
        row.diff = row.pointsFor - row.pointsAgainst;
        row.highestRound = Math.max(row.highestRound, scored);
        if (scored > conceded) row.wins += 1;
        else if (scored < conceded) row.losses += 1;
        else row.draws += 1;
      }
    };
    apply(match.teamA, match.teamAScore, match.teamBScore);
    apply(match.teamB, match.teamBScore, match.teamAScore);
  }

  const list = [...rows.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const h2h = h2hPoints(matches, b.playerId, a.playerId);
    if (h2h !== 0) return h2h;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.highestRound !== a.highestRound) return b.highestRound - a.highestRound;
    return a.playerId.localeCompare(b.playerId);
  });

  list.forEach((row, index) => {
    if (
      index > 0 &&
      row.points === list[index - 1].points &&
      h2hPoints(matches, row.playerId, list[index - 1].playerId) === 0 &&
      row.wins === list[index - 1].wins &&
      row.losses === list[index - 1].losses &&
      row.diff === list[index - 1].diff &&
      row.highestRound === list[index - 1].highestRound
    ) {
      row.rank = list[index - 1].rank;
    } else {
      row.rank = index + 1;
    }
  });

  return list;
}

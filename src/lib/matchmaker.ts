export type PlayerRef = {
  id: string;
  present: boolean;
};

export type PastMatch = {
  teamA: [string, string];
  teamB: [string, string];
};

export type GeneratedMatch = {
  court: number;
  teamA: [string, string];
  teamB: [string, string];
};

export type GeneratedRound = {
  matches: GeneratedMatch[];
  sittingOut: string[];
};

type Counts = Map<string, Map<string, number>>;

function bump(counts: Counts, a: string, b: string) {
  if (a === b) return;
  if (!counts.has(a)) counts.set(a, new Map());
  if (!counts.has(b)) counts.set(b, new Map());
  counts.get(a)!.set(b, (counts.get(a)!.get(b) ?? 0) + 1);
  counts.get(b)!.set(a, (counts.get(b)!.get(a) ?? 0) + 1);
}

function getCount(counts: Counts, a: string, b: string) {
  return counts.get(a)?.get(b) ?? 0;
}

function pairingsOfFour(
  ids: [string, string, string, string],
): Array<{ teamA: [string, string]; teamB: [string, string] }> {
  const [a, b, c, d] = ids;
  return [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ];
}

function pairingCost(
  teamA: [string, string],
  teamB: [string, string],
  partners: Counts,
  opponents: Counts,
) {
  const partnerRepeats =
    getCount(partners, teamA[0], teamA[1]) + getCount(partners, teamB[0], teamB[1]);
  const opponentRepeats =
    getCount(opponents, teamA[0], teamB[0]) +
    getCount(opponents, teamA[0], teamB[1]) +
    getCount(opponents, teamA[1], teamB[0]) +
    getCount(opponents, teamA[1], teamB[1]);
  return partnerRepeats * 50 + opponentRepeats * 10;
}

function buildHistory(pastMatches: PastMatch[]) {
  const partners: Counts = new Map();
  const opponents: Counts = new Map();
  const matchesPlayed = new Map<string, number>();
  const lastRoundSat = new Set<string>();

  const addPlayed = (id: string) => {
    matchesPlayed.set(id, (matchesPlayed.get(id) ?? 0) + 1);
  };

  for (const match of pastMatches) {
    bump(partners, match.teamA[0], match.teamA[1]);
    bump(partners, match.teamB[0], match.teamB[1]);
    for (const a of match.teamA) {
      for (const b of match.teamB) bump(opponents, a, b);
    }
    for (const id of [...match.teamA, ...match.teamB]) addPlayed(id);
  }

  if (pastMatches.length > 0) {
    const lastRoundPlayers = new Set<string>();
    const lastBatch = pastMatches;
    for (const match of lastBatch) {
      for (const id of [...match.teamA, ...match.teamB]) lastRoundPlayers.add(id);
    }
    for (const [id, count] of matchesPlayed) {
      if (!lastRoundPlayers.has(id) && count >= 0) lastRoundSat.add(id);
    }
  }

  return { partners, opponents, matchesPlayed };
}

function hashTie(id: string, roundNumber: number) {
  let h = 2166136261 ^ roundNumber;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function chooseBestPairing(
  ids: [string, string, string, string],
  partners: Counts,
  opponents: Counts,
) {
  let best = pairingsOfFour(ids)[0];
  let bestCost = Infinity;
  for (const pairing of pairingsOfFour(ids)) {
    const cost = pairingCost(pairing.teamA, pairing.teamB, partners, opponents);
    if (cost < bestCost) {
      best = pairing;
      bestCost = cost;
    }
  }
  return best;
}

function pickCourt(
  remaining: string[],
  matchesPlayed: Map<string, number>,
  partners: Counts,
  opponents: Counts,
): { teamA: [string, string]; teamB: [string, string]; used: string[] } {
  if (remaining.length === 4) {
    const pairing = chooseBestPairing(
      remaining as [string, string, string, string],
      partners,
      opponents,
    );
    return { ...pairing, used: remaining };
  }

  const seed = remaining[0];
  const others = remaining.slice(1);
  let best: { teamA: [string, string]; teamB: [string, string]; used: string[] } | null =
    null;
  let bestScore = Infinity;

  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      for (let k = j + 1; k < others.length; k += 1) {
        const quartet: [string, string, string, string] = [
          seed,
          others[i],
          others[j],
          others[k],
        ];
        const pairing = chooseBestPairing(quartet, partners, opponents);
        const partnerOfSeed = pairing.teamA.includes(seed)
          ? pairing.teamA.find((id) => id !== seed)!
          : pairing.teamB.find((id) => id !== seed)!;
        const mixBonus = -(matchesPlayed.get(partnerOfSeed) ?? 0);
        const score =
          pairingCost(pairing.teamA, pairing.teamB, partners, opponents) + mixBonus;
        if (score < bestScore) {
          bestScore = score;
          best = { ...pairing, used: quartet };
        }
      }
    }
  }

  if (!best) {
    throw new Error("Tidak cukup pemain untuk membentuk pertandingan.");
  }
  return best;
}

export function generateRound(input: {
  players: PlayerRef[];
  courtCount: number;
  pastMatches: PastMatch[];
  roundNumber: number;
}): GeneratedRound {
  const present = input.players.filter((player) => player.present).map((p) => p.id);
  const courtsThisRound = Math.min(input.courtCount, Math.floor(present.length / 4));

  if (courtsThisRound < 1) {
    return { matches: [], sittingOut: present };
  }

  const { partners, opponents, matchesPlayed } = buildHistory(input.pastMatches);
  const slots = courtsThisRound * 4;

  const ranked = [...present].sort((a, b) => {
    const playDiff = (matchesPlayed.get(a) ?? 0) - (matchesPlayed.get(b) ?? 0);
    if (playDiff !== 0) return playDiff;
    return hashTie(a, input.roundNumber) - hashTie(b, input.roundNumber);
  });

  const playing = ranked.slice(0, slots);
  const sittingOut = ranked.slice(slots);
  const remaining = [...playing];
  const matches: GeneratedMatch[] = [];

  for (let court = 1; court <= courtsThisRound; court += 1) {
    remaining.sort((a, b) => {
      const playDiff = (matchesPlayed.get(a) ?? 0) - (matchesPlayed.get(b) ?? 0);
      if (playDiff !== 0) return playDiff;
      return hashTie(a, input.roundNumber + court) - hashTie(b, input.roundNumber + court);
    });
    const picked = pickCourt(remaining, matchesPlayed, partners, opponents);
    matches.push({ court, teamA: picked.teamA, teamB: picked.teamB });
    for (const id of picked.used) {
      const index = remaining.indexOf(id);
      if (index >= 0) remaining.splice(index, 1);
    }
  }

  return { matches, sittingOut };
}

export function toPastMatch(teamA: [string, string], teamB: [string, string]): PastMatch {
  return { teamA, teamB };
}

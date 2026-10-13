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

export type ScheduleMode = "continuous" | "full";

/** Ronde penuh: jangan buat match baru selama masih ada lapangan yang main. */
export function shouldHoldForFullRound(scheduleMode: string, pendingMatchCount: number) {
  return scheduleMode === "full" && pendingMatchCount > 0;
}

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
  // Kuadrat: yang belum pernah ketemu selalu menang, dan kalau repeat
  // tak terhindarkan, repeat disebar ke pasangan atau lawan yang
  // jumlahnya paling sedikit.
  const square = (count: number) => count * count;
  const partnerRepeats =
    square(getCount(partners, teamA[0], teamA[1])) +
    square(getCount(partners, teamB[0], teamB[1]));
  const opponentRepeats =
    square(getCount(opponents, teamA[0], teamB[0])) +
    square(getCount(opponents, teamA[0], teamB[1])) +
    square(getCount(opponents, teamA[1], teamB[0])) +
    square(getCount(opponents, teamA[1], teamB[1]));
  // Rekan masih didahulukan, tapi lawan yang jarang ketemu cukup kuat
  // untuk mengalahkan pasangan baru kalau lawannya sudah sering bentrok.
  return partnerRepeats * 50 + opponentRepeats * 30;
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

/** Ronde terjadwal yang dijaga di depan ronde yang sedang dimainkan. */
export const UPCOMING_ROUND_TARGET = 20;

/** Berapa ronde ke depan yang ditampilkan di mode ronde penuh. */
export function upcomingRoundLimit(playerCount: number, courtCount: number) {
  const courts = Math.min(courtCount, Math.floor(playerCount / 4));
  if (courts < 1) return 0;
  return UPCOMING_ROUND_TARGET;
}

/**
 * Berapa ronde yang masih perlu ditambahkan agar jadwal mencapai
 * 20 ronde setelah ronde yang sedang, atau yang akan, dimainkan.
 */
export function roundsAheadOfPlay(matches: { roundNumber: number; status: string }[]) {
  const ceiling = scheduledTailCeiling(matches);
  const maxRound = matches.reduce((max, match) => Math.max(max, match.roundNumber), 0);
  const pending = matches.some((match) => match.status === "pending");
  const scheduledRounds = matches
    .filter((match) => match.status === "scheduled")
    .map((match) => match.roundNumber);

  let anchor: number;
  if (matches.length === 0) anchor = 1;
  else if (pending) anchor = Math.max(ceiling, 1);
  else if (scheduledRounds.length > 0) anchor = Math.min(...scheduledRounds);
  else anchor = maxRound + 1;

  return Math.max(0, anchor + UPCOMING_ROUND_TARGET - maxRound);
}

export type PreviewRound = GeneratedRound & { roundNumber: number };

export type StoredMatchStatus = "pending" | "scheduled" | "completed";

/** Ronde pertama langsung main. Sisanya terjadwal dan tetap bisa diisi skor. */
export function statusesForBatch(count: number, alreadyPlaying: boolean): Array<"pending" | "scheduled"> {
  return Array.from({ length: count }, (_, index) =>
    !alreadyPlaying && index === 0 ? "pending" : "scheduled",
  );
}

/** Ronde terjadwal paling awal yang boleh naik jadi sedang main. */
export function roundToActivate(matches: { roundNumber: number; status: string }[]): number | null {
  if (matches.some((match) => match.status === "pending")) return null;
  const scheduled = matches.filter((match) => match.status === "scheduled");
  if (scheduled.length === 0) return null;
  return Math.min(...scheduled.map((match) => match.roundNumber));
}

/** Ronde di atas angka ini masih terjadwal dan boleh disusun ulang. */
export function scheduledTailCeiling(matches: { roundNumber: number; status: string }[]): number {
  const locked = matches.filter((match) => match.status !== "scheduled");
  if (locked.length === 0) return 0;
  return Math.max(...locked.map((match) => match.roundNumber));
}

/** Perkiraan ronde berikut. Roster yang berubah akan mengubah hasilnya. */
export function previewUpcomingRounds(input: {
  players: PlayerRef[];
  courtCount: number;
  pastMatches: PastMatch[];
  nextRoundNumber: number;
  limit?: number;
}): PreviewRound[] {
  const presentCount = input.players.filter((player) => player.present).length;
  const limit = input.limit ?? upcomingRoundLimit(presentCount, input.courtCount);
  const past = [...input.pastMatches];
  const rounds: PreviewRound[] = [];

  for (let index = 0; index < limit; index += 1) {
    const roundNumber = input.nextRoundNumber + index;
    const generated = generateRound({
      players: input.players,
      courtCount: input.courtCount,
      pastMatches: past,
      roundNumber,
    });
    if (generated.matches.length === 0) break;
    rounds.push({ ...generated, roundNumber });
    for (const match of generated.matches) {
      past.push({ teamA: match.teamA, teamB: match.teamB });
    }
  }

  return rounds;
}

export function toPastMatch(teamA: [string, string], teamB: [string, string]): PastMatch {
  return { teamA, teamB };
}

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

function square(count: number) {
  return count * count;
}

function relation(partners: Counts, opponents: Counts, a: string, b: string) {
  return { partner: getCount(partners, a, b), opponent: getCount(opponents, a, b) };
}

function pairingLoad(
  teamA: [string, string],
  teamB: [string, string],
  partners: Counts,
  opponents: Counts,
) {
  // Urutan: jangan ulang rekan, lalu jangan satu lapangan lagi dengan
  // orang yang sama, baru setelah itu sebar lawan. Kuadrat menyebar
  // repeat ke pasangan yang paling jarang.
  let partner = 0;
  let shared = 0;
  let opponent = 0;
  const add = (a: string, b: string, role: "partner" | "opponent") => {
    const seen = relation(partners, opponents, a, b);
    if (role === "partner") partner += square(seen.partner);
    else opponent += square(seen.opponent);
    shared += square(seen.partner + seen.opponent);
  };
  add(teamA[0], teamA[1], "partner");
  add(teamB[0], teamB[1], "partner");
  add(teamA[0], teamB[0], "opponent");
  add(teamA[0], teamB[1], "opponent");
  add(teamA[1], teamB[0], "opponent");
  add(teamA[1], teamB[1], "opponent");
  return { partner, shared, opponent };
}

function compareKeys(a: number[], b: number[]) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const [head, ...tail] = items;
  const withHead = combinations(tail, count - 1).map((rest) => [head, ...rest]);
  return [...withHead, ...combinations(tail, count)];
}

function combinationCount(total: number, count: number) {
  if (count < 0 || count > total) return 0;
  const pick = Math.min(count, total - count);
  let result = 1;
  for (let index = 1; index <= pick; index += 1) {
    result = (result * (total - pick + index)) / index;
  }
  return result;
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
  roundNumber: number,
) {
  let best = pairingsOfFour(ids)[0];
  let bestKey = [Infinity, Infinity, Infinity, Infinity];
  for (const pairing of pairingsOfFour(ids)) {
    const load = pairingLoad(pairing.teamA, pairing.teamB, partners, opponents);
    const label = [pairing.teamA, pairing.teamB]
      .map((team) => [...team].sort().join("-"))
      .sort()
      .join("|");
    const key = [load.partner, load.shared, load.opponent, hashTie(label, roundNumber)];
    if (compareKeys(key, bestKey) < 0) {
      best = pairing;
      bestKey = key;
    }
  }
  return { ...best, partner: bestKey[0], shared: bestKey[1], opponent: bestKey[2] };
}

function assignCourts(
  players: string[],
  partners: Counts,
  opponents: Counts,
  roundNumber: number,
): { matches: GeneratedMatch[]; partner: number; shared: number; opponent: number } {
  const search = (
    remaining: string[],
    court: number,
  ): { matches: GeneratedMatch[]; partner: number; shared: number; opponent: number } => {
    if (remaining.length === 0) return { matches: [], partner: 0, shared: 0, opponent: 0 };
    const seed = remaining[0];
    const rest = remaining.slice(1);
    let best: { matches: GeneratedMatch[]; partner: number; shared: number; opponent: number } | null =
      null;
    let bestKey = [Infinity, Infinity, Infinity, Infinity];

    for (const extra of combinations(rest, 3)) {
      const quartet = [seed, extra[0], extra[1], extra[2]] as [string, string, string, string];
      const pairing = chooseBestPairing(quartet, partners, opponents, roundNumber);
      const used = new Set(quartet);
      const next = search(
        remaining.filter((id) => !used.has(id)),
        court + 1,
      );
      const key = [
        pairing.partner + next.partner,
        pairing.shared + next.shared,
        pairing.opponent + next.opponent,
        hashTie(`${quartet.slice().sort().join("-")}/${court}`, roundNumber),
      ];
      if (!best || compareKeys(key, bestKey) < 0) {
        best = {
          matches: [{ court, teamA: pairing.teamA, teamB: pairing.teamB }, ...next.matches],
          partner: pairing.partner + next.partner,
          shared: pairing.shared + next.shared,
          opponent: pairing.opponent + next.opponent,
        };
        bestKey = key;
      }
    }

    if (!best) throw new Error("Tidak cukup pemain untuk membentuk pertandingan.");
    return best;
  };

  return search([...players].sort(), 1);
}

function familiarity(
  id: string,
  others: string[],
  partners: Counts,
  opponents: Counts,
) {
  return others.reduce((sum, other) => {
    const seen = relation(partners, opponents, id, other);
    return sum + square(seen.partner) * 100 + square(seen.partner + seen.opponent) * 10 + square(seen.opponent);
  }, 0);
}

function pickByHistory(
  must: string[],
  tied: string[],
  need: number,
  partners: Counts,
  opponents: Counts,
  roundNumber: number,
) {
  const chosen = [...must];
  const rest = [...tied];
  const picked: string[] = [];
  while (picked.length < need) {
    rest.sort(
      (a, b) =>
        familiarity(a, chosen, partners, opponents) - familiarity(b, chosen, partners, opponents) ||
        hashTie(a, roundNumber) - hashTie(b, roundNumber),
    );
    const next = rest.shift();
    if (!next) break;
    picked.push(next);
    chosen.push(next);
  }
  return picked;
}

function planMatches(
  pool: string[],
  courtCount: number,
  matchesPlayed: Map<string, number>,
  partners: Counts,
  opponents: Counts,
  roundNumber: number,
) {
  const courts = Math.min(courtCount, Math.floor(pool.length / 4));
  const slots = courts * 4;
  const played = (id: string) => matchesPlayed.get(id) ?? 0;
  const ranked = [...pool].sort((a, b) => played(a) - played(b) || hashTie(a, roundNumber) - hashTie(b, roundNumber));
  const cutoff = played(ranked[slots - 1]);
  const must = ranked.filter((id) => played(id) < cutoff);
  const tied = ranked.filter((id) => played(id) === cutoff);
  const need = slots - must.length;
  const groups =
    combinationCount(tied.length, need) > 4000
      ? [pickByHistory(must, tied, need, partners, opponents, roundNumber)]
      : combinations(tied, need);

  let best: { matches: GeneratedMatch[]; playing: string[] } | null = null;
  let bestKey = [Infinity, Infinity, Infinity, Infinity];
  for (const chosen of groups) {
    const playing = [...must, ...chosen];
    const assigned = assignCourts(playing, partners, opponents, roundNumber);
    const key = [
      assigned.partner,
      assigned.shared,
      assigned.opponent,
      hashTie([...playing].sort().join(","), roundNumber),
    ];
    if (!best || compareKeys(key, bestKey) < 0) {
      best = { matches: assigned.matches, playing };
      bestKey = key;
    }
  }

  if (!best) throw new Error("Tidak cukup pemain untuk membentuk pertandingan.");
  const playing = new Set(best.playing);
  return {
    matches: best.matches,
    sittingOut: pool.filter((id) => !playing.has(id)),
  };
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
  return planMatches(present, courtsThisRound, matchesPlayed, partners, opponents, input.roundNumber);
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

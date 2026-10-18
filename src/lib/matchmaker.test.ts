import { describe, expect, it } from "vitest";
import {
  generateRound,
  previewUpcomingRounds,
  roundToActivate,
  roundsAheadOfPlay,
  scheduledTailCeiling,
  shouldHoldForFullRound,
  statusesForBatch,
  type PastMatch,
} from "./matchmaker";
import { computeStandings, isValidAmericanoScore } from "./scoring";

describe("americano scoring", () => {
  it("menerima skor yang jumlahnya sama dengan poin pertandingan", () => {
    expect(isValidAmericanoScore(16, 8, 24)).toBe(true);
    expect(isValidAmericanoScore(12, 12, 24)).toBe(true);
    expect(isValidAmericanoScore(17, 8, 24)).toBe(false);
  });

  it("membagi poin tim ke setiap pemain lalu merangking seperti PDLUP", () => {
    const standings = computeStandings(
      ["a", "b", "c", "d"],
      [
        { teamA: ["a", "b"], teamB: ["c", "d"], teamAScore: 16, teamBScore: 8 },
        { teamA: ["a", "c"], teamB: ["b", "d"], teamAScore: 10, teamBScore: 14 },
      ],
    );

    expect(standings[0].playerId).toBe("b");
    expect(standings.find((row) => row.playerId === "a")?.points).toBe(26);
    expect(standings.find((row) => row.playerId === "b")?.points).toBe(30);
    expect(standings.find((row) => row.playerId === "c")?.points).toBe(18);
    expect(standings.find((row) => row.playerId === "d")?.points).toBe(22);
  });

  it("menambahkan poin penyesuaian ke total klasemen", () => {
    const standings = computeStandings(
      ["a", "b"],
      [{ teamA: ["a", "b"], teamB: ["c", "d"], teamAScore: 16, teamBScore: 8 }],
      { a: -4, b: 8 },
    );

    expect(standings.find((row) => row.playerId === "a")?.points).toBe(12);
    expect(standings.find((row) => row.playerId === "b")?.points).toBe(24);
    expect(standings[0].playerId).toBe("b");
  });
});

describe("ronde penuh", () => {
  it("menahan match baru selama masih ada lapangan yang main", () => {
    expect(shouldHoldForFullRound("full", 1)).toBe(true);
    expect(shouldHoldForFullRound("full", 0)).toBe(false);
    expect(shouldHoldForFullRound("continuous", 2)).toBe(false);
  });

  it("memutar yang duduk begitu semua lapangan selesai, untuk 9 pemain di 2 lapangan", () => {
    const players = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, present: true }));
    const first = generateRound({
      players,
      courtCount: 2,
      pastMatches: [],
      roundNumber: 1,
    });
    expect(first.matches).toHaveLength(2);
    expect(first.sittingOut).toHaveLength(1);

    const sat = first.sittingOut[0];
    const second = generateRound({
      players,
      courtCount: 2,
      pastMatches: first.matches.map((match) => ({ teamA: match.teamA, teamB: match.teamB })),
      roundNumber: 2,
    });
    const playing = second.matches.flatMap((match) => [...match.teamA, ...match.teamB]);
    expect(playing).toContain(sat);
    expect(second.sittingOut).not.toContain(sat);
  });

  it("menampilkan 20 ronde ke depan dan tetap menggilir pemain yang duduk", () => {
    const players = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, present: true }));
    const first = generateRound({
      players,
      courtCount: 2,
      pastMatches: [],
      roundNumber: 1,
    });
    const upcoming = previewUpcomingRounds({
      players,
      courtCount: 2,
      pastMatches: first.matches.map((match) => ({ teamA: match.teamA, teamB: match.teamB })),
      nextRoundNumber: 2,
    });

    expect(upcoming).toHaveLength(20);
    expect(upcoming[0].roundNumber).toBe(2);
    expect(upcoming[19].roundNumber).toBe(21);
    expect(upcoming[0].matches).toHaveLength(2);
    const playingNext = upcoming[0].matches.flatMap((match) => [...match.teamA, ...match.teamB]);
    expect(playingNext).toContain(first.sittingOut[0]);

    const sitters = [first.sittingOut[0], ...upcoming.slice(0, 8).map((round) => round.sittingOut[0])];
    expect(new Set(sitters).size).toBe(sitters.length);
  });

  it("menjaga 20 ronde setelah ronde yang sedang dimainkan", () => {
    expect(roundsAheadOfPlay([])).toBe(21);
    expect(
      roundsAheadOfPlay([
        { roundNumber: 1, status: "pending" },
        { roundNumber: 8, status: "scheduled" },
      ]),
    ).toBe(13);
    expect(
      roundsAheadOfPlay([
        { roundNumber: 1, status: "completed" },
        { roundNumber: 2, status: "scheduled" },
        { roundNumber: 8, status: "scheduled" },
      ]),
    ).toBe(14);
    expect(roundsAheadOfPlay([{ roundNumber: 8, status: "completed" }])).toBe(21);
    expect(
      roundsAheadOfPlay([
        { roundNumber: 6, status: "pending" },
        { roundNumber: 26, status: "scheduled" },
      ]),
    ).toBe(0);
  });

  it("menahan ronde terjadwal sampai ronde yang sedang main selesai", () => {
    const matches = [
      { roundNumber: 1, status: "pending" },
      { roundNumber: 2, status: "scheduled" },
      { roundNumber: 3, status: "scheduled" },
    ];
    expect(roundToActivate(matches)).toBeNull();
    expect(scheduledTailCeiling(matches)).toBe(1);
    expect(statusesForBatch(3, true)).toEqual(["scheduled", "scheduled", "scheduled"]);
  });

  it("mengaktifkan ronde terjadwal paling awal setelah tidak ada yang main", () => {
    const matches = [
      { roundNumber: 1, status: "completed" },
      { roundNumber: 2, status: "scheduled" },
      { roundNumber: 4, status: "scheduled" },
    ];
    expect(roundToActivate(matches)).toBe(2);
    expect(scheduledTailCeiling(matches)).toBe(1);
    expect(statusesForBatch(3, false)).toEqual(["pending", "scheduled", "scheduled"]);
  });
});

describe("americano matchmaker", () => {
  it("mengisi beberapa lapangan sekaligus", () => {
    const round = generateRound({
      players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, present: true })),
      courtCount: 2,
      pastMatches: [],
      roundNumber: 1,
    });
    expect(round.matches).toHaveLength(2);
    expect(round.sittingOut).toHaveLength(0);
  });

  it("mendudukkan pemain jika jumlahnya tidak kelipatan 4", () => {
    const round = generateRound({
      players: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, present: true })),
      courtCount: 1,
      pastMatches: [],
      roundNumber: 1,
    });
    expect(round.matches).toHaveLength(1);
    expect(round.sittingOut).toHaveLength(1);
  });

  it("mengutamakan pemain telat yang belum main", () => {
    const first = generateRound({
      players: [
        { id: "hadir-1", present: true },
        { id: "hadir-2", present: true },
        { id: "hadir-3", present: true },
        { id: "hadir-4", present: true },
        { id: "telat", present: false },
      ],
      courtCount: 1,
      pastMatches: [],
      roundNumber: 1,
    });

    const next = generateRound({
      players: [
        { id: "hadir-1", present: true },
        { id: "hadir-2", present: true },
        { id: "hadir-3", present: true },
        { id: "hadir-4", present: true },
        { id: "telat", present: true },
      ],
      courtCount: 1,
      pastMatches: first.matches.map((match) => ({
        teamA: match.teamA,
        teamB: match.teamB,
      })),
      roundNumber: 2,
    });

    const playing = [
      ...next.matches[0].teamA,
      ...next.matches[0].teamB,
    ];
    expect(playing).toContain("telat");
    expect(next.sittingOut).not.toContain("telat");
  });

  it("menyebar repeat pairing rata saat pemain sedikit dan ronde banyak", () => {
    const players = ["a", "b", "c", "d"].map((id) => ({ id, present: true }));
    const past: PastMatch[] = [];
    const pairCounts = new Map<string, number>();

    for (let round = 1; round <= 6; round += 1) {
      const generated = generateRound({
        players,
        courtCount: 1,
        pastMatches: past,
        roundNumber: round,
      });
      const match = generated.matches[0];
      past.push({ teamA: match.teamA, teamB: match.teamB });
      for (const team of [match.teamA, match.teamB]) {
        const key = [...team].sort().join("-");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }

    // 4 pemain punya 6 kemungkinan pasangan; setelah 6 ronde semua harus
    // terpakai tepat 2 kali — tidak ada pasangan yang diulang berlebihan.
    expect(pairCounts.size).toBe(6);
    for (const count of pairCounts.values()) {
      expect(count).toBe(2);
    }
  });

  it("memilih pasangan yang paling jarang dipasangkan", () => {
    const past: PastMatch[] = [
      { teamA: ["a", "b"], teamB: ["c", "d"] },
      { teamA: ["a", "b"], teamB: ["c", "d"] },
      { teamA: ["a", "c"], teamB: ["b", "d"] },
    ];
    const next = generateRound({
      players: ["a", "b", "c", "d"].map((id) => ({ id, present: true })),
      courtCount: 1,
      pastMatches: past,
      roundNumber: 4,
    });
    const teams = [next.matches[0].teamA, next.matches[0].teamB].map((team) =>
      [...team].sort().join("-"),
    );
    // a-d dan b-c belum pernah sepasangan, jadi harus dipilih.
    expect(teams).toContain("a-d");
    expect(teams).toContain("b-c");
  });

  it("menghadapi lawan yang jarang ketemu meski harus mengulang pasangan", () => {
    const past: PastMatch[] = [{ teamA: ["a", "c"], teamB: ["b", "d"] }];
    for (let index = 0; index < 2; index += 1) {
      past.push({ teamA: ["a", "x"], teamB: ["c", "y"] });
      past.push({ teamA: ["b", "x"], teamB: ["d", "y"] });
    }

    const next = generateRound({
      players: ["a", "b", "c", "d"].map((id) => ({ id, present: true })),
      courtCount: 1,
      pastMatches: past,
      roundNumber: 4,
    });
    const teams = [next.matches[0].teamA, next.matches[0].teamB].map((team) =>
      [...team].sort().join("-"),
    );
    // a-c dan b-d sudah sering jadi lawan. Lebih rata kalau mereka sepasangan,
    // lalu masing-masing menghadapi orang yang belum sering ditemui.
    expect(teams).toContain("a-c");
    expect(teams).toContain("b-d");
  });
});

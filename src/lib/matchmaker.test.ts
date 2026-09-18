import { describe, expect, it } from "vitest";
import { generateRound } from "./matchmaker";
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
});

import { describe, expect, it } from "vitest";
import { etagFromRevision, snapshotRevision } from "./snapshot";

describe("snapshot revision", () => {
  const payload = {
    currentRound: 1,
    tournament: { name: "Jumat Malam", status: "live", courtCount: 2, pointsPerMatch: 24 },
    players: [{ id: "p1", name: "Hendrik", present: true, isLate: false }],
    matches: [
      {
        id: "m1",
        roundNumber: 1,
        courtNumber: 1,
        status: "pending",
        teamAScore: null,
        teamBScore: null,
        teamA: [{ id: "p1", name: "Hendrik" }],
        teamB: [{ id: "p2", name: "Budi" }],
      },
    ],
    standings: [],
    sittingOut: [],
  };

  it("stays stable for the same board", () => {
    expect(snapshotRevision(payload)).toBe(snapshotRevision(payload));
  });

  it("changes when a score is saved", () => {
    const scored = {
      ...payload,
      matches: [{ ...payload.matches[0], status: "completed", teamAScore: 16, teamBScore: 8 }],
    };
    expect(snapshotRevision(scored)).not.toBe(snapshotRevision(payload));
  });

  it("builds a short etag", () => {
    expect(etagFromRevision(snapshotRevision(payload))).toMatch(/^"[0-9a-z]+"$/);
  });
});

import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  courtCount: integer("court_count").notNull().default(1),
  pointsPerMatch: integer("points_per_match").notNull().default(24),
  status: text("status").notNull().default("setup"),
  adminPinHash: text("admin_pin_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    present: boolean("present").notNull().default(true),
    isLate: boolean("is_late").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("players_tournament_id_idx").on(table.tournamentId)],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    courtNumber: integer("court_number").notNull(),
    teamAScore: integer("team_a_score"),
    teamBScore: integer("team_b_score"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("matches_tournament_round_idx").on(table.tournamentId, table.roundNumber)],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    team: text("team").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.playerId] }),
    index("match_players_player_id_idx").on(table.playerId),
  ],
);

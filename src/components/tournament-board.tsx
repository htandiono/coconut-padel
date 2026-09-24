"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Check, Lock, Minus, Plus, Share2, Trophy, UserPlus } from "lucide-react";
import {
  addPlayer,
  finishTournament,
  setPlayerArrival,
  startOrNextRound,
  submitScore,
  unlockAdmin,
  updateCourtCount,
  type ActionResult,
} from "@/lib/actions";
import type { ClientMatch, ClientSnapshot } from "@/lib/snapshot";
import { useLiveSnapshot } from "@/lib/use-live-snapshot";
import { BrandHeader } from "@/components/brand-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const statusLabel: Record<string, string> = {
  setup: "Persiapan",
  live: "Live",
  finished: "Selesai",
};

function namesOf(players: ClientMatch["teamA"]) {
  return players.map((player) => player.name).join(" & ");
}

export function TournamentBoard({
  slug,
  initialSnapshot,
  isAdmin: initialAdmin,
}: {
  slug: string;
  initialSnapshot: ClientSnapshot;
  isAdmin: boolean;
}) {
  const { snapshot, applySnapshot, setMutating } = useLiveSnapshot(slug, initialSnapshot);
  const [isAdmin, setIsAdmin] = useState(initialAdmin);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const playerNames = useMemo(
    () => new Map(snapshot.players.map((player) => [player.id, player.name])),
    [snapshot.players],
  );
  const pendingMatches = useMemo(
    () =>
      snapshot.matches
        .filter((match) => match.status === "pending")
        .sort((a, b) => a.courtNumber - b.courtNumber),
    [snapshot.matches],
  );
  const doneMatches = useMemo(
    () => snapshot.matches.filter((match) => match.status === "completed").reverse(),
    [snapshot.matches],
  );
  const busyIds = useMemo(
    () =>
      new Set(
        pendingMatches.flatMap((match) => [...match.teamA, ...match.teamB].map((player) => player.id)),
      ),
    [pendingMatches],
  );
  const presentCount = snapshot.players.filter((player) => player.present).length;
  const lateWaiting = snapshot.players.filter((player) => !player.present);

  const live = snapshot.tournament.status === "live";
  const finished = snapshot.tournament.status === "finished";

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function run(action: () => Promise<ActionResult>) {
    if (busy) return;
    setBusy(true);
    setMutating(true);
    try {
      const result = await action();
      if (result.ok && result.snapshot) applySnapshot(result.snapshot);
      setNotice({ key: Date.now(), text: result.message ?? (result.ok ? "Berhasil." : "Gagal.") });
    } finally {
      setMutating(false);
      setBusy(false);
    }
  }

  async function shareLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Salin tautan", url);
    }
  }

  return (
    <div className="court-grid min-h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
        <BrandHeader />

        <div className="flex flex-col gap-4 rounded-2xl border border-primary/20 bg-card p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{statusLabel[snapshot.tournament.status] ?? snapshot.tournament.status}</Badge>
              <Badge variant="outline">{snapshot.tournament.courtCount} lapangan</Badge>
              <Badge variant="outline">{snapshot.tournament.pointsPerMatch} poin</Badge>
              {snapshot.currentRound > 0 ? (
                <Badge variant="outline">Ronde {snapshot.currentRound}</Badge>
              ) : null}
              {isAdmin ? <Badge variant="secondary">Pengelola</Badge> : null}
            </div>
            <h1 className="font-heading text-3xl tracking-tight sm:text-4xl">
              {snapshot.tournament.name}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={shareLink}>
              {copied ? <Check /> : <Share2 />}
              {copied ? "Disalin" : "Bagikan"}
            </Button>
            {!isAdmin ? (
              <PinDialog
                slug={slug}
                onUnlock={(next) => {
                  setIsAdmin(true);
                  if (next) applySnapshot(next);
                }}
              />
            ) : null}
          </div>
        </div>

        {notice ? (
          <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm">
            {notice.text}
          </p>
        ) : null}

        {lateWaiting.length > 0 && !finished ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Belum datang:</span>
            {lateWaiting.map((player) => (
              <Badge key={player.id} variant="secondary">
                {player.name}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">— dapat prioritas begitu hadir</span>
          </div>
        ) : null}

        {isAdmin && !finished ? (
          <AdminBar
            courtCount={snapshot.tournament.courtCount}
            started={snapshot.currentRound > 0}
            live={live}
            stats={`${presentCount} hadir · ${pendingMatches.length} match jalan · ${snapshot.sittingOut.length} nunggu`}
            busy={busy}
            onStart={() => run(() => startOrNextRound(slug))}
            onFinish={() => run(() => finishTournament(slug))}
            onCourts={(count) => run(() => updateCourtCount(slug, count))}
          />
        ) : null}

        <Tabs defaultValue="matches">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="matches">Match</TabsTrigger>
            <TabsTrigger value="standings">Klasemen</TabsTrigger>
            <TabsTrigger value="players">Pemain</TabsTrigger>
          </TabsList>

          <TabsContent value="matches" className="mt-4 space-y-4">
            {finished ? <ChampionCard snapshot={snapshot} playerNames={playerNames} /> : null}

            {snapshot.currentRound === 0 ? (
              <EmptyMatches isAdmin={isAdmin} />
            ) : (
              <>
                {live && snapshot.sittingOut.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nunggu giliran: {snapshot.sittingOut.map((player) => player.name).join(", ")}
                  </p>
                ) : null}

                {pendingMatches.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {pendingMatches.map((match) => (
                      <MatchCard
                        key={match.id}
                        match={match}
                        pointsPerMatch={snapshot.tournament.pointsPerMatch}
                        isAdmin={isAdmin && !finished}
                        busy={busy}
                        onSave={(a, b) => run(() => submitScore(slug, match.id, a, b))}
                      />
                    ))}
                  </div>
                ) : !finished ? (
                  <p className="text-sm text-muted-foreground">Belum ada match jalan.</p>
                ) : null}

                {doneMatches.length > 0 ? (
                  <MatchHistory
                    matches={doneMatches}
                    pointsPerMatch={snapshot.tournament.pointsPerMatch}
                    defaultOpen={finished}
                    isAdmin={isAdmin}
                    busy={busy}
                    onSave={(matchId, a, b) => run(() => submitScore(slug, matchId, a, b))}
                  />
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="standings" className="mt-4">
            <StandingsTable snapshot={snapshot} playerNames={playerNames} />
          </TabsContent>

          <TabsContent value="players" className="mt-4">
            <PlayersPanel
              slug={slug}
              snapshot={snapshot}
              busyIds={busyIds}
              isAdmin={isAdmin && !finished}
              busy={busy}
              onArrive={(playerId, present) => run(() => setPlayerArrival(slug, playerId, present))}
              onAdd={(name, late) => run(() => addPlayer(slug, name, late))}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ChampionCard({
  snapshot,
  playerNames,
}: {
  snapshot: ClientSnapshot;
  playerNames: Map<string, string>;
}) {
  const champions = snapshot.standings.filter((row) => row.rank === 1 && row.matches > 0);
  if (champions.length === 0) return null;
  return (
    <Card className="border-primary/40 bg-primary/10">
      <CardContent className="flex items-center gap-3 py-4">
      <Trophy className="size-8 shrink-0 text-primary" />
        <div>
          <p className="font-heading text-xl">
            {champions.map((row) => playerNames.get(row.playerId)).join(" & ")}
          </p>
          <p className="text-sm text-muted-foreground">Juara · {champions[0].points} poin</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyMatches({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <Trophy className="mx-auto mb-3 size-8 text-primary" />
        <p className="font-medium">Belum ada match</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? "Minimal 4 pemain hadir, lalu tekan Mulai." : "Belum dimulai."}
        </p>
      </CardContent>
    </Card>
  );
}

function AdminBar({
  courtCount,
  started,
  live,
  stats,
  busy,
  onStart,
  onFinish,
  onCourts,
}: {
  courtCount: number;
  started: boolean;
  live: boolean;
  stats: string;
  busy: boolean;
  onStart: () => void;
  onFinish: () => void;
  onCourts: (count: number) => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{stats}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1">
            <span className="pr-1 text-xs text-muted-foreground">Lapangan</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={busy || courtCount <= 1}
              onClick={() => onCourts(courtCount - 1)}
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="w-5 text-center text-sm tabular-nums">{courtCount}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={busy || courtCount >= 12}
              onClick={() => onCourts(courtCount + 1)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <Button disabled={busy} onClick={onStart}>
            {busy ? "Sebentar…" : started ? "Buat match" : "Mulai turnamen"}
          </Button>
          {live ? <FinishDialog busy={busy} onFinish={onFinish} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FinishDialog({ onFinish, busy }: { onFinish: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="destructive" disabled={busy} onClick={() => setOpen(true)}>
        Tutup
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tutup turnamen?</AlertDialogTitle>
            <AlertDialogDescription>
              Match baru berhenti dibuat. Klasemen tetap bisa dilihat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onFinish();
                setOpen(false);
              }}
            >
              Tutup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TeamRow({ names, score, winner }: { names: string; score: number | null; winner: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
        winner ? "bg-primary/15" : "bg-secondary/40"
      }`}
    >
      <span className={`text-sm ${winner ? "font-semibold text-primary" : "font-medium"}`}>
        {names}
      </span>
      <span className="font-heading text-2xl tabular-nums">{score ?? "–"}</span>
    </div>
  );
}

const MatchCard = memo(function MatchCard({
  match,
  pointsPerMatch,
  isAdmin,
  busy,
  onSave,
}: {
  match: ClientMatch;
  pointsPerMatch: number;
  isAdmin: boolean;
  busy?: boolean;
  onSave: (teamAScore: number, teamBScore: number) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [scoreA, setScoreA] = useState<number | null>(match.teamAScore);
  const pending = match.status === "pending";
  const completed = match.status === "completed";
  const scoreB = scoreA === null ? null : pointsPerMatch - scoreA;

  return (
    <Card className={pending ? "border-primary/40" : "match-card-past"}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Lapangan {match.courtNumber} · Ronde {match.roundNumber}
          </span>
          <Badge variant={completed ? "secondary" : "default"}>
            {completed ? "Selesai" : "Main"}
          </Badge>
        </div>
        <div className="space-y-1.5">
          <TeamRow
            names={namesOf(match.teamA)}
            score={match.teamAScore}
            winner={completed && (match.teamAScore ?? 0) > (match.teamBScore ?? 0)}
          />
          <TeamRow
            names={namesOf(match.teamB)}
            score={match.teamBScore}
            winner={completed && (match.teamBScore ?? 0) > (match.teamAScore ?? 0)}
          />
        </div>
        {isAdmin ? (
          <>
            <Button
              className="w-full"
              variant={pending ? "default" : "outline"}
              disabled={busy}
              onClick={() => setOpen(true)}
            >
              {pending ? "Isi skor" : "Ubah skor"}
            </Button>
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                if (next) setScoreA(match.teamAScore);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{pending ? "Isi skor" : "Ubah skor"}</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-secondary/40 p-3 text-center">
                  <div>
                    <p className="font-heading text-4xl tabular-nums">{scoreA ?? "–"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{namesOf(match.teamA)}</p>
                  </div>
                  <span className="text-xl text-muted-foreground">:</span>
                  <div>
                    <p className="font-heading text-4xl tabular-nums">{scoreB ?? "–"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{namesOf(match.teamB)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Ketuk skor {namesOf(match.teamA)} — sisanya otomatis.
                </p>
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: pointsPerMatch + 1 }, (_, value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setScoreA(value)}
                      className={`h-9 rounded-md border text-sm tabular-nums transition-colors ${
                        scoreA === value
                          ? "border-primary bg-primary font-semibold text-primary-foreground"
                          : "border-border/60 hover:border-primary/50"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <DialogFooter>
                  <Button
                    className="w-full"
                    disabled={scoreA === null || busy || scoreA === match.teamAScore}
                    onClick={async () => {
                      if (scoreA === null) return;
                      await onSave(scoreA, pointsPerMatch - scoreA);
                      setOpen(false);
                    }}
                  >
                    {busy ? "Menyimpan…" : "Simpan"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
});

function MatchHistory({
  matches,
  pointsPerMatch,
  defaultOpen,
  isAdmin,
  busy,
  onSave,
}: {
  matches: ClientMatch[];
  pointsPerMatch: number;
  defaultOpen: boolean;
  isAdmin: boolean;
  busy: boolean;
  onSave: (matchId: string, teamAScore: number, teamBScore: number) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      className="rounded-xl border border-border/70 p-4"
    >
      <summary className="cursor-pointer text-sm font-medium">
        Riwayat ({matches.length})
      </summary>
      {open ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              pointsPerMatch={pointsPerMatch}
              isAdmin={isAdmin}
              busy={busy}
              onSave={(a, b) => onSave(match.id, a, b)}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function StandingsTable({
  snapshot,
  playerNames,
}: {
  snapshot: ClientSnapshot;
  playerNames: Map<string, string>;
}) {
  const lateIds = useMemo(
    () => new Set(snapshot.players.filter((player) => !player.present).map((player) => player.id)),
    [snapshot.players],
  );

  if (snapshot.standings.every((row) => row.matches === 0)) {
    return <p className="text-sm text-muted-foreground">Klasemen muncul setelah skor pertama.</p>;
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Pemain</TableHead>
              <TableHead>Poin</TableHead>
              <TableHead>M</TableHead>
              <TableHead>W</TableHead>
              <TableHead>L</TableHead>
              <TableHead>+/−</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.standings.map((row) => (
              <TableRow key={row.playerId}>
                <TableCell className="font-medium">
                  {row.rank === 1 ? (
                    <Trophy className="inline size-3.5 text-primary" />
                  ) : (
                    row.rank
                  )}
                </TableCell>
                <TableCell>
                  {playerNames.get(row.playerId)}
                  {lateIds.has(row.playerId) ? (
                    <span className="ml-2 text-xs text-accent">belum datang</span>
                  ) : null}
                </TableCell>
                <TableCell className="font-heading text-base tabular-nums">{row.points}</TableCell>
                <TableCell className="tabular-nums">{row.matches}</TableCell>
                <TableCell className="tabular-nums">{row.wins}</TableCell>
                <TableCell className="tabular-nums">{row.losses}</TableCell>
                <TableCell className="tabular-nums">
                  {row.diff > 0 ? `+${row.diff}` : row.diff}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Urutan: poin, head-to-head, menang, kalah, selisih.
        </p>
      </CardContent>
    </Card>
  );
}

function PlayersPanel({
  slug,
  snapshot,
  busyIds,
  isAdmin,
  busy,
  onArrive,
  onAdd,
}: {
  slug: string;
  snapshot: ClientSnapshot;
  busyIds: Set<string>;
  isAdmin: boolean;
  busy: boolean;
  onArrive: (playerId: string, present: boolean) => void;
  onAdd: (name: string, late: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [late, setLate] = useState(true);
  const matchCountById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of snapshot.standings) counts.set(row.playerId, row.matches);
    return counts;
  }, [snapshot.standings]);

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="size-4" />
              Tambah pemain
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor={`new-player-${slug}`}>Nama</Label>
              <Input
                id={`new-player-${slug}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={late} onCheckedChange={setLate} />
              Telat
            </label>
            <Button
              disabled={busy || name.trim().length === 0}
              onClick={() => {
                onAdd(name, late);
                setName("");
              }}
            >
              Tambah
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {snapshot.players.map((player) => {
          const playing = busyIds.has(player.id);
          return (
            <Card key={player.id}>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium">{player.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {matchCountById.get(player.id) ?? 0} match
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={player.present ? (playing ? "default" : "outline") : "secondary"}
                  >
                    {player.present ? (playing ? "Main" : "Siap") : "Belum datang"}
                  </Badge>
                  {isAdmin ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onArrive(player.id, !player.present)}
                    >
                      {player.present ? "Tandai keluar" : "Tandai hadir"}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PinDialog({
  slug,
  onUnlock,
}: {
  slug: string;
  onUnlock: (snapshot?: ClientSnapshot) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Lock />
        Pengelola
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PIN pengelola</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`admin-pin-${slug}`}>PIN</Label>
            <Input
              id={`admin-pin-${slug}`}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              inputMode="numeric"
              placeholder="4-6 digit"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={busy || pin.trim().length < 4}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await unlockAdmin(slug, pin);
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  onUnlock(result.snapshot);
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Sebentar…" : "Buka"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

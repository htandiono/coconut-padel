"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  Share2,
  Trophy,
  UserPlus,
  Check,
} from "lucide-react";
import {
  addPlayer,
  finishTournament,
  setPlayerArrival,
  startOrNextRound,
  submitScore,
  unlockAdmin,
  updateCourtCount,
} from "@/lib/actions";
import type { PublicSnapshot } from "@/lib/queries";
import { BrandHeader } from "@/components/brand-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  live: "Berlangsung",
  finished: "Selesai",
};

function namesOf(players: PublicSnapshot["matches"][number]["teamA"]) {
  return players.map((player) => player.name).join(" & ");
}

export function TournamentBoard({
  slug,
  initialSnapshot,
  isAdmin,
}: {
  slug: string;
  initialSnapshot: PublicSnapshot;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const playerNames = useMemo(
    () => new Map(snapshot.players.map((player) => [player.id, player.name])),
    [snapshot.players],
  );

  useEffect(() => {
    setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/t/${slug}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as PublicSnapshot;
      setSnapshot(data);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [slug]);

  const latestMatches = snapshot.matches.filter((match) => match.roundNumber === snapshot.currentRound);
  const pendingCount = latestMatches.filter((match) => match.status === "pending").length;
  const presentCount = snapshot.players.filter((player) => player.present).length;
  const lateWaiting = snapshot.players.filter((player) => !player.present);

  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    const result = await action();
    setNotice(result.message ?? (result.ok ? "Berhasil." : "Gagal."));
    router.refresh();
  }

  async function shareLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Salin tautan turnamen", url);
    }
  }

  return (
    <div className="court-grid min-h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <BrandHeader compact />
        <div className="flex flex-col gap-4 rounded-2xl border border-primary/20 bg-card/85 p-5 backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{statusLabel[snapshot.tournament.status] ?? snapshot.tournament.status}</Badge>
              <Badge variant="outline">{snapshot.tournament.courtCount} lapangan</Badge>
              <Badge variant="secondary">{snapshot.tournament.pointsPerMatch} poin / match</Badge>
              {snapshot.currentRound > 0 ? <Badge variant="outline">Ronde {snapshot.currentRound}</Badge> : null}
            </div>
            <h1 className="font-heading text-3xl tracking-tight sm:text-4xl">{snapshot.tournament.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Siapa pun yang punya tautan ini bisa melihat pertandingan dan klasemen secara live.
              {isAdmin ? " Kamu sedang dalam mode pengelola." : " Pengelola memakai PIN untuk mengisi skor."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={shareLink}>
              {copied ? <Check /> : <Share2 />}
              {copied ? "Tautan disalin" : "Bagikan tautan"}
            </Button>
            {!isAdmin ? <PinDialog slug={slug} onDone={() => router.refresh()} /> : null}
          </div>
        </div>

        {notice ? (
          <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm">{notice}</p>
        ) : null}

        {lateWaiting.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Menunggu pemain telat</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {lateWaiting.map((player) => (
                <Badge key={player.id} variant="secondary">
                  {player.name}
                </Badge>
              ))}
              <p className="w-full text-xs text-muted-foreground">
                Ketika mereka ditandai sudah datang, ronde berikutnya akan memasukkan mereka lebih dulu supaya jumlah match-nya mengejar.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {isAdmin ? (
          <AdminBar
            snapshot={snapshot}
            presentCount={presentCount}
            pendingCount={pendingCount}
            onStart={() => run(() => startOrNextRound(slug))}
            onFinish={() => run(() => finishTournament(slug))}
            onCourts={(count) => run(() => updateCourtCount(slug, count))}
          />
        ) : null}

        <Tabs defaultValue="matches">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="matches">Pertandingan</TabsTrigger>
            <TabsTrigger value="standings">Klasemen</TabsTrigger>
            <TabsTrigger value="players">Pemain</TabsTrigger>
          </TabsList>
          <TabsContent value="matches" className="mt-4 space-y-4">
            {snapshot.currentRound === 0 ? (
              <EmptyMatches isAdmin={isAdmin} />
            ) : (
              <>
                {snapshot.sittingOut.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Istirahat ronde ini: {snapshot.sittingOut.map((player) => player.name).join(", ")}
                  </p>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {latestMatches.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      pointsPerMatch={snapshot.tournament.pointsPerMatch}
                      isAdmin={isAdmin && snapshot.tournament.status !== "finished"}
                      onSave={(a, b) => run(() => submitScore(slug, match.id, a, b))}
                    />
                  ))}
                </div>
                {snapshot.matches.some((match) => match.roundNumber !== snapshot.currentRound) ? (
                  <details className="rounded-xl border border-border/70 p-4">
                    <summary className="cursor-pointer text-sm font-medium">Ronde sebelumnya</summary>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {snapshot.matches
                        .filter((match) => match.roundNumber !== snapshot.currentRound)
                        .slice()
                        .reverse()
                        .map((match) => (
                          <MatchCard
                            key={match.id}
                            match={match}
                            pointsPerMatch={snapshot.tournament.pointsPerMatch}
                            isAdmin={false}
                            onSave={async () => undefined}
                          />
                        ))}
                    </div>
                  </details>
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
              isAdmin={isAdmin && snapshot.tournament.status !== "finished"}
              onArrive={(playerId, present) => run(() => setPlayerArrival(slug, playerId, present))}
              onAdd={(name, late) => run(() => addPlayer(slug, name, late))}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function FinishDialog({ onFinish }: { onFinish: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Tutup turnamen
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tutup turnamen?</AlertDialogTitle>
            <AlertDialogDescription>
              Klasemen tetap bisa dilihat lewat tautan yang sama, tapi match baru tidak akan dibuat.
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

function EmptyMatches({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <Trophy className="mx-auto mb-3 size-8 text-primary" />
        <p className="font-medium">Belum ada pertandingan</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Mulai turnamen setelah pemain yang hadir cukup untuk mengisi lapangan."
            : "Menunggu pengelola memulai ronde pertama."}
        </p>
      </CardContent>
    </Card>
  );
}

function AdminBar({
  snapshot,
  presentCount,
  pendingCount,
  onStart,
  onFinish,
  onCourts,
}: {
  snapshot: PublicSnapshot;
  presentCount: number;
  pendingCount: number;
  onStart: () => void;
  onFinish: () => void;
  onCourts: (count: number) => void;
}) {
  const [courts, setCourts] = useState(snapshot.tournament.courtCount);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {presentCount} pemain hadir · {pendingCount} match menunggu skor
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="courts" className="text-xs">
              Lapangan
            </Label>
            <Input
              id="courts"
              className="w-16"
              type="number"
              min={1}
              max={12}
              value={courts}
              onChange={(event) => setCourts(Number(event.target.value))}
            />
            <Button variant="outline" size="sm" onClick={() => onCourts(courts)}>
              Simpan
            </Button>
          </div>
          {snapshot.tournament.status !== "finished" ? (
            <Button onClick={onStart}>
              {snapshot.currentRound === 0 ? "Mulai turnamen" : "Ronde berikutnya"}
            </Button>
          ) : null}
          {snapshot.tournament.status === "live" ? (
            <FinishDialog onFinish={onFinish} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MatchCard({
  match,
  pointsPerMatch,
  isAdmin,
  onSave,
}: {
  match: PublicSnapshot["matches"][number];
  pointsPerMatch: number;
  isAdmin: boolean;
  onSave: (teamAScore: number, teamBScore: number) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [scoreA, setScoreA] = useState(match.teamAScore ?? 0);
  const [scoreB, setScoreB] = useState(match.teamBScore ?? pointsPerMatch);
  const total = scoreA + scoreB;
  const valid = total === pointsPerMatch;

  return (
    <Card className={match.status === "pending" ? "ring-1 ring-primary/30" : ""}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Lapangan {match.courtNumber} · Ronde {match.roundNumber}
          </p>
          <CardTitle className="mt-1 text-lg">{namesOf(match.teamA)}</CardTitle>
        </div>
        <Badge variant={match.status === "completed" ? "secondary" : "default"}>
          {match.status === "completed" ? "Selesai" : "Berjalan"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
          <div>
            <p className="text-3xl font-heading">{match.teamAScore ?? "–"}</p>
            <p className="text-xs text-muted-foreground">{namesOf(match.teamA)}</p>
          </div>
          <p className="text-muted-foreground">vs</p>
          <div>
            <p className="text-3xl font-heading">{match.teamBScore ?? "–"}</p>
            <p className="text-xs text-muted-foreground">{namesOf(match.teamB)}</p>
          </div>
        </div>
        {isAdmin && match.status === "pending" ? (
          <>
            <Button className="w-full" onClick={() => setOpen(true)}>
              Isi skor
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Skor Americano</DialogTitle>
                  <DialogDescription>
                    Jumlah kedua tim harus {pointsPerMatch} poin. Setiap pemain mendapat poin timnya.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{namesOf(match.teamA)}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={pointsPerMatch}
                      value={scoreA}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setScoreA(next);
                        setScoreB(pointsPerMatch - next);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{namesOf(match.teamB)}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={pointsPerMatch}
                      value={scoreB}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setScoreB(next);
                        setScoreA(pointsPerMatch - next);
                      }}
                    />
                  </div>
                </div>
                <p className={valid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                  Total {total} / {pointsPerMatch}
                </p>
                <DialogFooter>
                  <Button
                    disabled={!valid}
                    onClick={async () => {
                      await onSave(scoreA, scoreB);
                      setOpen(false);
                    }}
                  >
                    Simpan skor
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StandingsTable({
  snapshot,
  playerNames,
}: {
  snapshot: PublicSnapshot;
  playerNames: Map<string, string>;
}) {
  if (snapshot.standings.every((row) => row.matches === 0)) {
    return <p className="text-sm text-muted-foreground">Klasemen muncul setelah skor pertama diisi.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Klasemen individual</CardTitle>
      </CardHeader>
      <CardContent>
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
                <TableCell className="font-medium">{row.rank}</TableCell>
                <TableCell>
                  {playerNames.get(row.playerId)}
                  {snapshot.players.find((player) => player.id === row.playerId && !player.present) ? (
                    <span className="ml-2 text-xs text-accent">telat</span>
                  ) : null}
                </TableCell>
                <TableCell className="font-heading text-base">{row.points}</TableCell>
                <TableCell>{row.matches}</TableCell>
                <TableCell>{row.wins}</TableCell>
                <TableCell>{row.losses}</TableCell>
                <TableCell>{row.diff > 0 ? `+${row.diff}` : row.diff}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Urutan: poin total, head-to-head, kemenangan, lebih sedikit kekalahan, selisih poin, skor ronde tertinggi.
        </p>
      </CardContent>
    </Card>
  );
}

function PlayersPanel({
  slug,
  snapshot,
  isAdmin,
  onArrive,
  onAdd,
}: {
  slug: string;
  snapshot: PublicSnapshot;
  isAdmin: boolean;
  onArrive: (playerId: string, present: boolean) => void;
  onAdd: (name: string, late: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [late, setLate] = useState(true);
  const matchCount = (playerId: string) =>
    snapshot.standings.find((row) => row.playerId === playerId)?.matches ?? 0;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="size-4" />
              Tambah pemain di tengah jalan
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor={`new-player-${slug}`}>Nama</Label>
              <Input id={`new-player-${slug}`} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={late} onCheckedChange={setLate} />
              Datang belakangan
            </label>
            <Button
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
        {snapshot.players.map((player) => (
          <Card key={player.id}>
            <CardContent className="flex items-center justify-between gap-3 py-4">
              <div>
                <p className="font-medium">{player.name}</p>
                <p className="text-xs text-muted-foreground">{matchCount(player.id)} pertandingan</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={player.present ? "default" : "secondary"}>
                  {player.present ? "Hadir" : "Belum datang"}
                </Badge>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onArrive(player.id, !player.present)}
                  >
                    {player.present ? "Tandai telat" : "Sudah datang"}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PinDialog({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Lock />
        Masuk pengelola
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PIN pengelola</DialogTitle>
            <DialogDescription>Diperlukan untuk mengisi skor, menambah pemain, dan memutar ronde.</DialogDescription>
          </DialogHeader>
          <Input
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            inputMode="numeric"
            placeholder="4-6 digit"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              onClick={async () => {
                const result = await unlockAdmin(slug, pin);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setOpen(false);
                onDone();
              }}
            >
              Buka mode pengelola
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

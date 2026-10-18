"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "cn";
import { createTournament, type ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type PlayerDraft = { id: number; name: string; late: boolean; points: string };

export function CreateTournamentForm() {
  const [fullRound, setFullRound] = useState(false);
  const nextPlayerId = useRef(5);
  const [players, setPlayers] = useState<PlayerDraft[]>([
    { id: 1, name: "", late: false, points: "0" },
    { id: 2, name: "", late: false, points: "0" },
    { id: 3, name: "", late: false, points: "0" },
    { id: 4, name: "", late: false, points: "0" },
  ]);
  const [state, formAction, pending] = useActionState(createTournament, null as ActionResult | null);
  const filled = useMemo(() => players.filter((player) => player.name.trim()).length, [players]);

  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">Buat turnamen</CardTitle>
        <CardDescription>
          {fullRound
            ? "Semua pemain ikut dari ronde pertama."
            : "Tandai yang bakal telat — main bisa mulai duluan tanpa mereka."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="scheduleMode" value={fullRound ? "full" : "continuous"} />
          <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
            <Switch
              id="fullRound"
              checked={fullRound}
              onCheckedChange={(checked) => {
                setFullRound(checked);
                if (checked) {
                  setPlayers((current) => current.map((row) => ({ ...row, late: false })));
                }
              }}
            />
            <Label htmlFor="fullRound">Ronde penuh</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Nama turnamen</Label>
              <Input id="name" name="name" required placeholder="Misalnya: Jumat Malam Binjai" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="courtCount">Jumlah lapangan</Label>
              <Input id="courtCount" name="courtCount" type="number" min={1} max={12} defaultValue={2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pointsPerMatch">Poin per pertandingan</Label>
              <select
                id="pointsPerMatch"
                name="pointsPerMatch"
                defaultValue="24"
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
              >
                <option value="16">16 poin</option>
                <option value="21">21 poin</option>
                <option value="24">24 poin</option>
                <option value="32">32 poin</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pin">PIN pengelola (4-6 digit)</Label>
              <Input id="pin" name="pin" inputMode="numeric" pattern="\d{4,6}" required placeholder="Misalnya 1234" />
              <p className="text-xs text-muted-foreground">
                Buat isi skor dan atur pemain. Yang lain cukup buka tautannya.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Pemain · {filled}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = nextPlayerId.current;
                  nextPlayerId.current += 1;
                  setPlayers((current) => [...current, { id, name: "", late: false, points: "0" }]);
                }}
              >
                <Plus />
                Tambah
              </Button>
            </div>
            <PlayerTable
              players={players}
              fullRound={fullRound}
              onChange={(id, patch) =>
                setPlayers((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
              }
              onRemove={(id) => setPlayers((current) => current.filter((row) => row.id !== id))}
            />
          </div>

          {state && !state.ok ? (
            <p className="rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive">{state.message}</p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Sebentar…" : "Buat turnamen"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PlayerTable({
  players,
  fullRound,
  onChange,
  onRemove,
}: {
  players: PlayerDraft[];
  fullRound: boolean;
  onChange: (id: number, patch: Partial<Pick<PlayerDraft, "name" | "late" | "points">>) => void;
  onRemove: (id: number) => void;
}) {
  const removable = players.length > 4;
  const gridClass = cn(
    "grid items-center gap-x-2",
    fullRound
      ? removable
        ? "grid-cols-[minmax(0,1fr)_4.5rem_2rem]"
        : "grid-cols-[minmax(0,1fr)_4.5rem]"
      : removable
        ? "grid-cols-[minmax(0,1fr)_4.5rem_auto_2rem]"
        : "grid-cols-[minmax(0,1fr)_4.5rem_auto]",
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      <div className={cn(gridClass, "border-b border-border/70 bg-muted/40 px-2 py-2 text-xs font-medium text-muted-foreground")}>
        <span>Nama</span>
        <span className="text-center">Poin</span>
        {fullRound ? null : <span className="px-1 text-center whitespace-nowrap">Akan telat</span>}
        {removable ? <span className="sr-only">Hapus</span> : null}
      </div>
      {players.map((player, index) => (
        <div
          key={player.id}
          className={cn(gridClass, "border-b border-border/70 px-2 py-1.5 last:border-b-0")}
        >
          <Input
            name="playerName"
            value={player.name}
            placeholder={`Pemain ${index + 1}`}
            aria-label={`Nama pemain ${index + 1}`}
            className="min-w-0"
            onChange={(event) => onChange(player.id, { name: event.target.value })}
          />
          <Input
            name="playerPoints"
            aria-label={`Poin pemain ${index + 1}`}
            inputMode="numeric"
            value={player.points}
            className="px-2 text-center tabular-nums"
            onChange={(event) => onChange(player.id, { points: event.target.value })}
          />
          <input className="hidden" type="hidden" name="playerLate" value={!fullRound && player.late ? "1" : "0"} />
          {fullRound ? null : (
            <div className="flex justify-center">
              <Switch
                checked={player.late}
                aria-label={`Akan telat, pemain ${index + 1}`}
                onCheckedChange={(checked) => onChange(player.id, { late: checked })}
              />
            </div>
          )}
          {removable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Hapus pemain ${index + 1}`}
              onClick={() => onRemove(player.id)}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

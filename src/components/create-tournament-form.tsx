"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createTournament, type ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type PlayerDraft = { id: number; name: string; late: boolean };

export function CreateTournamentForm() {
  const [players, setPlayers] = useState<PlayerDraft[]>([
    { id: 1, name: "", late: false },
    { id: 2, name: "", late: false },
    { id: 3, name: "", late: false },
    { id: 4, name: "", late: false },
  ]);
  const [state, formAction, pending] = useActionState(createTournament, null as ActionResult | null);
  const filled = useMemo(() => players.filter((player) => player.name.trim()).length, [players]);

  return (
    <Card className="border-primary/20 bg-card/90 backdrop-blur">
      <CardHeader>
        <CardTitle className="font-heading text-2xl">Buat turnamen Americano</CardTitle>
        <CardDescription>
          Isi pemain yang sudah di lokasi. Tandai yang pasti telat — pertandingan bisa dimulai tanpa mereka,
          lalu mereka diprioritaskan sampai jumlah mainnya menyusul.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
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
                PIN ini untuk mengisi skor dan mengatur pemain. Siapa pun yang punya tautan tetap bisa melihat pertandingan dan klasemen.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Daftar pemain · {filled} nama</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setPlayers((current) => [...current, { id: Date.now(), name: "", late: false }])
                }
              >
                <Plus />
                Tambah baris
              </Button>
            </div>
            <div className="space-y-2">
              {players.map((player, index) => (
                <div key={player.id} className="flex items-center gap-2 rounded-lg border border-border/70 p-2">
                  <Input
                    name="playerName"
                    value={player.name}
                    placeholder={`Pemain ${index + 1}`}
                    onChange={(event) =>
                      setPlayers((current) =>
                        current.map((row) =>
                          row.id === player.id ? { ...row, name: event.target.value } : row,
                        ),
                      )
                    }
                  />
                  <input type="hidden" name="playerLate" value={player.late ? "1" : "0"} />
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={player.late}
                      onCheckedChange={(checked) =>
                        setPlayers((current) =>
                          current.map((row) =>
                            row.id === player.id ? { ...row, late: checked } : row,
                          ),
                        )
                      }
                    />
                    Akan telat
                  </label>
                  {players.length > 4 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setPlayers((current) => current.filter((row) => row.id !== player.id))}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {state && !state.ok ? (
            <p className="rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive">{state.message}</p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Menyimpan…" : "Buat turnamen & bagikan tautan"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

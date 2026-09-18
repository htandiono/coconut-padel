import { BrandHeader } from "@/components/brand-header";
import { CreateTournamentForm } from "@/components/create-tournament-form";

export default function HomePage() {
  return (
    <div className="court-grid min-h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12">
        <BrandHeader />
        <section className="grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <p className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-primary">
              Americano dulu · multi lapangan
            </p>
            <h1 className="font-heading text-4xl leading-tight tracking-tight sm:text-6xl">
              Main dulu.
              <span className="block text-primary">Yang telat menyusul.</span>
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              Coconut Padel mengatur pertandingan Americano seperti PDLUP: setiap rally jadi poin
              individual, pasangan berputar, dan klasemen langsung kelihatan. Bedanya, pemain yang
              datang belakangan tidak membuat lapangan menganggur — mereka diprioritaskan sampai
              jumlah match-nya kejar.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Poin Americano", "Skor tim dijumlahkan 16/21/24/32, lalu masuk ke klasemen pemain."],
                ["Pemain telat", "Mulai tanpa mereka. Saat datang, matchmaker mengejar ketertinggalan."],
                ["Tautan publik", "Siapa pun dengan link bisa melihat match dan klasemen live."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-xl border border-border/80 bg-card/70 p-4">
                  <p className="font-medium text-primary">{title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
          <CreateTournamentForm />
        </section>
      </div>
    </div>
  );
}

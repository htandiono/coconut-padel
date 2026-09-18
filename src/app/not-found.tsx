import Link from "next/link";
import { BrandHeader } from "@/components/brand-header";

export default function NotFound() {
  return (
    <div className="court-grid flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-12">
        <BrandHeader compact />
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="font-heading text-3xl">Halaman tidak ditemukan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Turnamen ini mungkin sudah tidak ada atau tautannya salah.
          </p>
          <Link href="/" className="mt-6 inline-block text-sm text-primary underline">
            Kembali ke beranda
          </Link>
        </div>
      </div>
    </div>
  );
}

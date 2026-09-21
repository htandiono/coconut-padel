import Link from "next/link";

export function CoconutMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="24" cy="26" r="14" fill="currentColor" className="text-accent" />
      <circle cx="19" cy="22" r="2" fill="#3b2a14" />
      <circle cx="24" cy="20" r="2" fill="#3b2a14" />
      <circle cx="29" cy="22" r="2" fill="#3b2a14" />
      <path
        d="M16 14c4-8 12-8 16 0"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandHeader() {
  return (
    <header>
      <Link href="/" className="flex w-fit items-center gap-3">
        <CoconutMark className="size-10 shrink-0" />
        <div>
          <p className="font-heading text-xl leading-none tracking-tight text-primary sm:text-2xl">
            Coconut Padel
          </p>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-accent">
            Karya Anak Binjai
          </p>
        </div>
      </Link>
    </header>
  );
}

import { BrandHeader } from "@/components/brand-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function TournamentLoading() {
  return (
    <div className="court-grid min-h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <BrandHeader />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-16 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

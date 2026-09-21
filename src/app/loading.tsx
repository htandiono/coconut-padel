import { BrandHeader } from "@/components/brand-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <div className="court-grid min-h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12">
        <BrandHeader />
        <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <Skeleton className="h-7 w-48 rounded-full" />
            <Skeleton className="h-24 w-full max-w-xl rounded-xl" />
            <Skeleton className="h-20 w-full max-w-xl rounded-xl" />
          </div>
          <Skeleton className="h-[28rem] rounded-xl" />
        </div>
      </div>
    </div>
  );
}

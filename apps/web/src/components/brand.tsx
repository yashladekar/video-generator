import Link from "next/link";
import { Clapperboard } from "lucide-react";

import { cn } from "@video-generator/ui/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/dashboard"
      className={cn("flex items-center gap-2.5", className)}
    >
      <span className="flex size-8 items-center justify-center bg-foreground text-background">
        <Clapperboard className="size-4" />
      </span>
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight">ReelForge</span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Faceless studio
          </span>
        </span>
      ) : null}
    </Link>
  );
}

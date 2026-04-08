"use client";

import { Heart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SwipeControlsProps = {
  onLike: () => void;
  onDislike: () => void;
  disabled?: boolean;
  className?: string;
};

export function SwipeControls({
  onLike,
  onDislike,
  disabled,
  className,
}: SwipeControlsProps) {
  return (
    <div className={cn("flex items-center justify-center gap-8", className)}>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="h-16 w-16 rounded-full border-rose-500/30 bg-rose-500/10 text-rose-300 shadow-lg shadow-rose-900/30 hover:bg-rose-500/20"
        onClick={onDislike}
        disabled={disabled}
        aria-label="Dislike"
      >
        <X className="h-8 w-8" />
      </Button>
      <Button
        type="button"
        size="icon"
        className="h-20 w-20 rounded-full shadow-xl shadow-violet-900/50"
        onClick={onLike}
        disabled={disabled}
        aria-label="Like"
      >
        <Heart className="h-9 w-9 fill-current" />
      </Button>
    </div>
  );
}

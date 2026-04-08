"use client";

import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import Image from "next/image";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

export type MemeItem = {
  id: string;
  image_url: string;
  category?: string;
};

type MemeCardProps = {
  meme: MemeItem;
  onSwipe: (dir: "left" | "right") => void;
  className?: string;
  stackIndex?: number;
};

const SWIPE_THRESHOLD = 120;

export function MemeCard({ meme, onSwipe, className, stackIndex = 0 }: MemeCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const likeOpacity = useTransform(x, [40, 120], [0, 1]);
  const passOpacity = useTransform(x, [-40, -120], [0, 1]);

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const offset = info.offset.x;
      const velocity = info.velocity.x;
      if (offset > SWIPE_THRESHOLD || velocity > 500) {
        onSwipe("right");
      } else if (offset < -SWIPE_THRESHOLD || velocity < -500) {
        onSwipe("left");
      }
    },
    [onSwipe]
  );

  return (
    <motion.div
      style={{ x, rotate, zIndex: 10 - stackIndex }}
      drag={stackIndex === 0 ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.85}
      onDragEnd={handleDragEnd}
      className={cn(
        "absolute inset-x-4 inset-y-0 mx-auto flex max-h-[min(72vh,640px)] w-full max-w-md flex-col justify-center touch-pan-y",
        stackIndex > 0 && "pointer-events-none scale-[0.96] opacity-60",
        className
      )}
    >
      <div
        className={cn(
          "relative aspect-[4/5] w-full overflow-hidden rounded-[2rem] border border-white/15",
          "bg-gradient-to-br from-white/10 to-white/[0.02] shadow-[0_0_60px_-12px_rgba(139,92,246,0.45)]",
          "backdrop-blur-xl"
        )}
      >
        <Image
          src={meme.image_url}
          alt="Meme"
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 28rem"
          priority={stackIndex === 0}
          unoptimized={
            meme.image_url.includes("reddit") ||
            meme.image_url.includes("imgur") ||
            !meme.image_url.startsWith(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
          }
        />
        <div className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-white/10" />
        <motion.span
          style={{ opacity: likeOpacity }}
          className="pointer-events-none absolute left-6 top-6 rotate-[-12deg] rounded-xl border-4 border-emerald-400/90 px-3 py-1 text-2xl font-black uppercase tracking-widest text-emerald-300"
        >
          Vibe
        </motion.span>
        <motion.span
          style={{ opacity: passOpacity }}
          className="pointer-events-none absolute right-6 top-6 rotate-[12deg] rounded-xl border-4 border-rose-400/90 px-3 py-1 text-2xl font-black uppercase tracking-widest text-rose-300"
        >
          Nah
        </motion.span>
      </div>
    </motion.div>
  );
}

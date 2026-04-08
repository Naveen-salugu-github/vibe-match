"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type MatchRevealProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefine?: () => void;
  peerEmail?: string;
  displayName?: string;
  avatarUrl?: string | null;
  age?: number | null;
  score?: number;
  matchId?: string;
};

export function MatchReveal({
  open,
  onOpenChange,
  onRefine,
  peerEmail,
  displayName,
  avatarUrl,
  age,
  score,
  matchId,
}: MatchRevealProps) {
  const label = displayName?.trim() || (peerEmail ? maskEmail(peerEmail) : "Your match");
  const initial = label.charAt(0).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden border-violet-500/30">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.35),_transparent_55%)]" />
        <DialogHeader className="relative z-10">
          <DialogTitle className="flex items-center justify-center gap-2 text-center text-2xl">
            <Sparkles className="h-7 w-7 text-amber-300" />
            Closest vibe match
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            Opposite-gender match from our vibe pool — open chat when you&apos;re ready.
          </DialogDescription>
        </DialogHeader>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 18, stiffness: 220 }}
              className="relative z-10 flex flex-col items-center gap-5 py-4"
            >
              <div className="relative">
                <motion.div
                  className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 opacity-60 blur-xl"
                  animate={{ opacity: [0.45, 0.75, 0.45] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                />
                <div className="relative h-32 w-32 overflow-hidden rounded-[2rem] border-2 border-white/30 shadow-2xl">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="128px"
                      unoptimized={
                        avatarUrl.includes("randomuser.me") ||
                        avatarUrl.includes("pravatar") ||
                        avatarUrl.includes("picsum") ||
                        avatarUrl.includes("supabase.co")
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-600/80 to-cyan-500/60 text-3xl font-semibold text-white">
                      {initial}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold text-white/95">{label}</p>
                {age != null && (
                  <p className="mt-0.5 text-sm text-white/50">{age} years old</p>
                )}
                {peerEmail && (
                  <p className="mt-1 text-sm text-white/45">{maskEmail(peerEmail)}</p>
                )}
                {score != null && (
                  <p className="mt-2 text-sm text-violet-200/90">
                    Meme-taste overlap · {(score * 100).toFixed(0)}%
                  </p>
                )}
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row">
                {matchId && (
                  <Button asChild className="w-full gap-2 rounded-2xl" size="lg">
                    <Link href={`/chat/${matchId}`} onClick={() => onOpenChange(false)}>
                      <MessageCircle className="h-5 w-5" />
                      Text this person
                    </Link>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full rounded-2xl"
                  onClick={() => {
                    onRefine?.();
                    onOpenChange(false);
                  }}
                >
                  Refine with 20 more memes
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function maskEmail(email: string) {
  const [u, d] = email.split("@");
  if (!d) return email;
  const safe = u.length <= 2 ? `${u[0]}*` : `${u.slice(0, 2)}···`;
  return `${safe}@${d}`;
}

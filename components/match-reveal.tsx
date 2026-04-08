"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type MatchRevealProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerEmail?: string;
  score?: number;
};

export function MatchReveal({ open, onOpenChange, peerEmail, score }: MatchRevealProps) {
  const initial = peerEmail?.charAt(0).toUpperCase() ?? "?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden border-violet-500/30">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.35),_transparent_55%)]" />
        <DialogHeader className="relative z-10">
          <DialogTitle className="flex items-center justify-center gap-2 text-center text-2xl">
            <Sparkles className="h-7 w-7 text-amber-300" />
            New vibe unlocked
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            You matched with someone who shares your meme brain — almost eerily so.
          </DialogDescription>
        </DialogHeader>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 18, stiffness: 220 }}
              className="relative z-10 flex flex-col items-center gap-6 py-4"
            >
              <div className="relative">
                <motion.div
                  className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 opacity-60 blur-xl"
                  animate={{ opacity: [0.45, 0.75, 0.45] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                />
                <Avatar className="relative h-28 w-28 rounded-[2rem] border-2 border-white/30 shadow-2xl">
                  <AvatarFallback className="rounded-[2rem] text-3xl">{initial}</AvatarFallback>
                </Avatar>
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-white/90">
                  {peerEmail ? maskEmail(peerEmail) : "Your match"}
                </p>
                {score != null && (
                  <p className="mt-1 text-sm text-violet-200/80">
                    Compatibility · {(score * 100).toFixed(0)}%
                  </p>
                )}
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

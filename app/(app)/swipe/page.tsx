"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { MemeCard, type MemeItem } from "@/components/meme-card";
import { SwipeControls } from "@/components/swipe-controls";
import { MatchReveal } from "@/components/match-reveal";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SWIPES_FOR_PROFILE } from "@/lib/matching";
import { Sparkles } from "lucide-react";
import { useSwipeKeyboard } from "@/hooks/useSwipeKeyboard";

type ProfileUser = {
  id: string;
  swipe_count: number;
  personality_vector: Record<string, number>;
};

async function fetchMemes(): Promise<MemeItem[]> {
  const res = await fetch("/api/memes?limit=10");
  if (!res.ok) throw new Error("Failed to load memes");
  const data = (await res.json()) as { memes: MemeItem[] };
  return data.memes ?? [];
}

async function fetchProfile(): Promise<ProfileUser> {
  const res = await fetch("/api/profile");
  if (!res.ok) throw new Error("Failed to load profile");
  const data = (await res.json()) as { user: ProfileUser };
  return data.user;
}

export default function SwipePage() {
  const qc = useQueryClient();
  const [stack, setStack] = useState<MemeItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchPeer, setMatchPeer] = useState<{ email?: string; score?: number }>({});

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
  });

  const memesQuery = useQuery({
    queryKey: ["memes-feed"],
    queryFn: fetchMemes,
  });

  useEffect(() => {
    if (memesQuery.data?.length && stack.length === 0) {
      setStack(memesQuery.data);
    }
  }, [memesQuery.data, stack.length]);

  useEffect(() => {
    const seen = typeof window !== "undefined" && localStorage.getItem("vibe_onboarding_seen");
    if (!seen) {
      setOnboardingOpen(true);
    }
  }, []);

  const refill = useCallback(async () => {
    const fresh = await qc.fetchQuery({ queryKey: ["memes-feed"], queryFn: fetchMemes });
    setStack((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      const merged = [...prev];
      for (const m of fresh) {
        if (!ids.has(m.id)) merged.push(m);
      }
      return merged;
    });
  }, [qc]);

  useEffect(() => {
    if (stack.length <= 4 && stack.length > 0) {
      void refill();
    }
  }, [stack.length, refill]);

  const swipeCount = profileQuery.data?.swipe_count ?? 0;
  const progressPct = Math.min(100, (swipeCount / SWIPES_FOR_PROFILE) * 100);

  const topTraits = useMemo(() => {
    const v = profileQuery.data?.personality_vector ?? {};
    return Object.entries(v)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k.replace(/_/g, " "));
  }, [profileQuery.data?.personality_vector]);

  const dismissOnboarding = () => {
    localStorage.setItem("vibe_onboarding_seen", "1");
    setOnboardingOpen(false);
  };

  const handleSwipeDir = useCallback(
    async (dir: "left" | "right") => {
      const meme = stack[0];
      if (!meme || busy) return;
      const swipe_type = dir === "right" ? "like" : "dislike";
      setStack((s) => s.slice(1));
      setBusy(true);
      try {
        const res = await fetch("/api/swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meme_id: meme.id, swipe_type }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          newMatches?: { peerId: string; score: number; peerEmail?: string }[];
          error?: string;
        };
        if (!res.ok) {
          console.error(data.error);
          return;
        }
        await qc.invalidateQueries({ queryKey: ["profile"] });

        const nm = data.newMatches ?? [];
        if (nm.length > 0) {
          const first = nm[0]!;
          const confettiKey = `vibe_confetti_${profileQuery.data?.id ?? "u"}`;
          const already = localStorage.getItem(confettiKey);
          if (!already) {
            confetti({ particleCount: 120, spread: 80, origin: { y: 0.65 } });
            localStorage.setItem(confettiKey, "1");
          }
          setMatchPeer({ email: first.peerEmail, score: first.score });
          setMatchOpen(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [stack, busy, qc, profileQuery.data?.id]
  );

  useSwipeKeyboard((dir) => void handleSwipeDir(dir));

  const visible = stack.slice(0, 3);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Find your meme twin</h1>
            <p className="text-white/55">
              Swipe memes to discover your vibe personality. After {SWIPES_FOR_PROFILE} swipes we
              unlock your profile and start matching.
            </p>
          </div>

          <Card className="glass-panel overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-violet-300" />
                Progress to first match
              </CardTitle>
              <CardDescription>
                {swipeCount} / {SWIPES_FOR_PROFILE} swipes · vector updates after{" "}
                {SWIPES_FOR_PROFILE}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Progress value={progressPct} />
            </CardContent>
          </Card>

          <div className="relative mx-auto min-h-[min(72vh,640px)] w-full max-w-md">
            {memesQuery.isLoading && (
              <p className="text-center text-white/50">Loading memes…</p>
            )}
            {memesQuery.isError && (
              <p className="text-center text-rose-300">Could not load memes. Seed the database.</p>
            )}
            <AnimatePresence>
              {visible.map((m, i) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, x: i === 0 ? 0 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <MemeCard meme={m} onSwipe={handleSwipeDir} stackIndex={i} />
                </motion.div>
              ))}
            </AnimatePresence>
            {!memesQuery.isLoading && stack.length === 0 && (
              <p className="text-center text-white/50">
                You&apos;re all caught up — check back after more memes drop.
              </p>
            )}
          </div>

          <SwipeControls
            onLike={() => void handleSwipeDir("right")}
            onDislike={() => void handleSwipeDir("left")}
            disabled={busy || stack.length === 0}
            className="pb-4"
          />
          <p className="text-center text-xs text-white/40">
            Keyboard: ← dislike · → like
          </p>
        </div>

        <div className="space-y-4">
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg">Your vibe traits</CardTitle>
              <CardDescription>Top signals from tags you engage with.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topTraits.length === 0 ? (
                <p className="text-sm text-white/45">
                  Keep swiping — traits appear after your vector builds.
                </p>
              ) : (
                <ul className="space-y-2">
                  {topTraits.map((t) => (
                    <li
                      key={t}
                      className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm capitalize text-white/85"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {onboardingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <Card className="glass-panel max-w-md border-violet-500/30">
            <CardHeader>
              <CardTitle>Swipe memes to discover your vibe personality.</CardTitle>
              <CardDescription>
                We never ask for your phone number. Your taste becomes a playful vector — then we
                match you with opposite-gender users above a similarity threshold.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                onClick={dismissOnboarding}
                className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/40"
              >
                Let&apos;s swipe
              </button>
            </CardContent>
          </Card>
        </div>
      )}

      <MatchReveal
        open={matchOpen}
        onOpenChange={setMatchOpen}
        peerEmail={matchPeer.email}
        score={matchPeer.score}
      />
    </div>
  );
}

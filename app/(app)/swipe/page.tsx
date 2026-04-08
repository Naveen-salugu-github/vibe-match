"use client";

import { useCallback, useEffect, useState } from "react";
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

type ArchetypeDto = {
  title: string;
  shareLine: string;
  description: string;
};

type ProfileUser = {
  id: string;
  swipe_count: number;
  personality_vector: Record<string, number>;
  archetype: ArchetypeDto | null;
};

type BestMatchDto = {
  peerId: string;
  score: number;
  peerEmail?: string;
  displayName?: string;
  avatarUrl?: string | null;
  age?: number | null;
  matchId: string;
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
  const data = (await res.json()) as {
    user: ProfileUser & { archetype: ArchetypeDto | null };
  };
  return data.user;
}

export default function SwipePage() {
  const qc = useQueryClient();
  const [stack, setStack] = useState<MemeItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [localSwipeCount, setLocalSwipeCount] = useState(0);
  const [countHydrated, setCountHydrated] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchPeer, setMatchPeer] = useState<{
    email?: string;
    displayName?: string;
    avatarUrl?: string | null;
    age?: number | null;
    score?: number;
    matchId?: string;
  }>({});

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

  useEffect(() => {
    if (profileQuery.data?.swipe_count == null) return;
    const fromServer = profileQuery.data.swipe_count;
    if (!countHydrated) {
      setLocalSwipeCount(fromServer);
      setCountHydrated(true);
      return;
    }
    // Never jump backward visually; keep UI snappy and monotonic.
    setLocalSwipeCount((prev) => Math.max(prev, fromServer));
  }, [profileQuery.data?.swipe_count, countHydrated]);

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

  const swipeCount = localSwipeCount;
  const progressPct =
    swipeCount < SWIPES_FOR_PROFILE
      ? Math.min(100, (swipeCount / SWIPES_FOR_PROFILE) * 100)
      : (() => {
          const inRound = swipeCount % SWIPES_FOR_PROFILE;
          return inRound === 0 ? 100 : (inRound / SWIPES_FOR_PROFILE) * 100;
        })();
  const nextMilestone =
    swipeCount < SWIPES_FOR_PROFILE
      ? SWIPES_FOR_PROFILE
      : (Math.floor(swipeCount / SWIPES_FOR_PROFILE) + 1) * SWIPES_FOR_PROFILE;

  const archetype = profileQuery.data?.archetype;

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
      setLocalSwipeCount((prev) => prev + 1);
      setBusy(true);
      try {
        const res = await fetch("/api/swipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meme_id: meme.id, swipe_type }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          swipeCount?: number;
          bestMatch?: BestMatchDto | null;
          milestone?: number;
          generatedMatch?: boolean;
          error?: string;
        };
        if (!res.ok) {
          console.error(data.error);
          setLocalSwipeCount((prev) => Math.max(0, prev - 1));
          return;
        }
        if (typeof data.swipeCount === "number") {
          setLocalSwipeCount((prev) => Math.max(prev, data.swipeCount ?? 0));
        }
        void qc.invalidateQueries({ queryKey: ["profile"] });

        const bm = data.bestMatch;
        if (bm) {
          const confettiKey = `vibe_confetti_${profileQuery.data?.id ?? "u"}`;
          const already = localStorage.getItem(confettiKey);
          if (!already) {
            confetti({ particleCount: 120, spread: 80, origin: { y: 0.65 } });
            localStorage.setItem(confettiKey, "1");
          }
          setMatchPeer({
            email: bm.peerEmail,
            displayName: bm.displayName,
            avatarUrl: bm.avatarUrl,
            age: bm.age ?? undefined,
            score: bm.score,
            matchId: bm.matchId,
          });
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
              Swipe memes to discover your vibe archetype. After {SWIPES_FOR_PROFILE} swipes we
              match you with your closest opposite-gender vibe from our pool.
            </p>
          </div>

          <Card className="glass-panel overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-violet-300" />
                Progress to first match
              </CardTitle>
              <CardDescription>
                {swipeCount} swipes · next refined match milestone at {nextMilestone}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Progress value={progressPct} />
              {swipeCount >= SWIPES_FOR_PROFILE && (
                <p className="text-xs text-cyan-200/90">
                  {busy
                    ? "Looking for matches..."
                    : "Looks for matches. Check Matches, or keep swiping to refine every +20."}
                </p>
              )}
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
              <CardTitle className="text-lg">Vibe archetype</CardTitle>
              <CardDescription>
                Instead of matching only by similarity, you get a shareable meme personality — then
                we pair you with opposite-gender vibes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!archetype ? (
                <p className="text-sm text-white/45">
                  Keep swiping — your archetype appears once your taste vector unlocks.
                </p>
              ) : (
                <>
                  <p className="text-2xl font-bold tracking-tight text-transparent bg-gradient-to-r from-violet-200 to-cyan-200 bg-clip-text">
                    {archetype.title}
                  </p>
                  <p className="text-sm font-medium text-violet-200/90">{archetype.shareLine}</p>
                  <p className="text-sm leading-relaxed text-white/55">{archetype.description}</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {onboardingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <Card className="glass-panel max-w-md border-violet-500/30">
            <CardHeader>
              <CardTitle>Swipe memes to discover your vibe archetype.</CardTitle>
              <CardDescription>
                We never ask for your phone number. You’ll see a fun archetype (Chaos Goblin,
                Wholesome Bean, and more) — built for screenshots and shareability — then we match
                you with opposite-gender vibes.
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
        displayName={matchPeer.displayName}
        avatarUrl={matchPeer.avatarUrl}
        age={matchPeer.age}
        score={matchPeer.score}
        matchId={matchPeer.matchId}
        onRefine={() => {
          // user chose to continue swiping for a stronger future match
        }}
      />
    </div>
  );
}

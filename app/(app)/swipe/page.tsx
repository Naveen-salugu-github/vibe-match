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
  const [swipeFlash, setSwipeFlash] = useState<null | "left" | "right">(null);
  const [streak, setStreak] = useState(1);
  const [dropInMin, setDropInMin] = useState(30);
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
    const today = new Date().toISOString().slice(0, 10);
    const prev = localStorage.getItem("vibe_streak_day");
    const value = Number(localStorage.getItem("vibe_streak_count") ?? "1");
    if (prev !== today) {
      const y = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
      const next = prev === y ? value + 1 : 1;
      localStorage.setItem("vibe_streak_day", today);
      localStorage.setItem("vibe_streak_count", String(next));
      setStreak(next);
    } else {
      setStreak(value);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setDropInMin((m) => (m <= 1 ? 30 : m - 1));
    }, 60_000);
    return () => clearInterval(timer);
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
  const phaseLabel = useMemo(() => {
    const round = Math.floor(swipeCount / SWIPES_FOR_PROFILE) + 1;
    if (round <= 1) return "Calibration 1";
    return `Refinement ${round - 1}`;
  }, [swipeCount]);

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
      setSwipeFlash(dir);
      setTimeout(() => setSwipeFlash(null), 180);
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
  const archetype = profileQuery.data?.archetype;

  const shareArchetype = useCallback(async () => {
    if (!archetype) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 1080, 1350);
    grad.addColorStop(0, "#2c1450");
    grad.addColorStop(1, "#0b0f19");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(64, 64, 952, 1222);
    ctx.fillStyle = "#9ae6ff";
    ctx.font = "bold 44px Inter";
    ctx.fillText("VibeMatch Archetype", 120, 165);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 88px Inter";
    ctx.fillText(archetype.title, 120, 320);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "34px Inter";
    ctx.fillText(archetype.shareLine, 120, 400);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "30px Inter";
    wrapText(ctx, archetype.description, 120, 490, 840, 46);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "28px Inter";
    ctx.fillText("swipe your humor • find your same-vibe person", 120, 1185);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    const file = new File([blob], `vibe-${archetype.title.replace(/\s+/g, "-").toLowerCase()}.png`, {
      type: "image/png",
    });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: `I'm ${archetype.title} on VibeMatch`, files: [file] });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [archetype]);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Find your meme twin</h1>
            <p className="text-white/55">
              Swipe your humor, lock your archetype, and connect with same-vibe partners who
              actually get you.
            </p>
          </div>

          <Card className="premium-card overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-violet-300" />
                {phaseLabel}
              </CardTitle>
              <CardDescription>
                {swipeCount} swipes · next refined match milestone at {nextMilestone}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Progress value={progressPct} />
              <div className="flex items-center justify-between text-[11px] text-white/60">
                <span>Daily streak: {streak} day{streak > 1 ? "s" : ""}</span>
                <span>New meme drop in ~{dropInMin}m</span>
              </div>
              {swipeCount >= SWIPES_FOR_PROFILE && (
                <p className="text-xs text-cyan-200/90">
                  {busy
                    ? "Looking for matches..."
                    : "Looks for same-vibe partners. Check Matches, or keep swiping to refine every +20."}
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
            {swipeFlash && (
              <motion.div
                key={swipeFlash}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 0.92, scale: 1.06 }}
                exit={{ opacity: 0, scale: 1.14 }}
                transition={{ duration: 0.2 }}
                className={`pointer-events-none absolute inset-0 rounded-[2rem] ${
                  swipeFlash === "right" ? "bg-emerald-400/20" : "bg-rose-400/20"
                }`}
              />
            )}
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
          <Card className="premium-card">
            <CardHeader>
              <CardTitle className="text-lg">Vibe archetype</CardTitle>
              <CardDescription>
                Your collectible meme identity card. Share it, then refine for stronger chemistry.
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
                  <button
                    type="button"
                    onClick={() => void shareArchetype()}
                    className="mt-1 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    Share archetype card
                  </button>
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
                you with opposite-gender, same-vibe partners.
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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = `${line}${word} `;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = `${word} `;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

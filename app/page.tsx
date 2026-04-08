import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Shield, Zap, MessageCircle } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0f19] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,255,0.4),transparent),radial-gradient(ellipse_50%_40%_at_100%_0%,rgba(56,189,248,0.15),transparent)]" />
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-16 px-4 pb-24 pt-16 md:pt-24">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 shadow-lg shadow-violet-900/40">
              <Sparkles className="h-5 w-5" />
            </span>
            VibeMatch
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-6">
            <p className="inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1 text-xs font-medium text-violet-200">
              Privacy-first · No phone number
            </p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-6xl md:leading-[1.05]">
              Swipe memes.
              <span className="block bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                Find your same-vibe person.
              </span>
            </h1>
            <p className="max-w-xl text-lg text-white/60">
              Train your vibe engine with rapid meme swipes, unlock a collectible archetype, and
              connect with same-vibe partners who actually get your humor.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild className="rounded-2xl px-8">
                <Link href="/signup">Get started</Link>
              </Button>
              <Button size="lg" variant="secondary" asChild className="rounded-2xl px-8">
                <Link href="/login">Log in</Link>
              </Button>
            </div>
          </div>

          <Card className="premium-card border-violet-500/20 shadow-2xl shadow-violet-950/50">
            <CardHeader>
              <CardTitle className="text-xl">The Vibe Engine</CardTitle>
              <CardDescription>
                One emotional loop: calibrate fast, reveal identity, then turn chemistry into replies.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-violet-400/30 bg-violet-500/10 px-4 py-3">
                <p className="text-xs uppercase tracking-widest text-violet-200/80">After 20 swipes</p>
                <p className="mt-1 text-lg font-semibold text-white">Collect your archetype card</p>
                <p className="mt-1 text-sm text-white/65">
                  Chaos Goblin, Wholesome Bean, Soft Meme Lord, Dark Humor Wizard.
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3">
                <p className="text-xs uppercase tracking-widest text-cyan-200/80">Match phase</p>
                <p className="mt-1 text-lg font-semibold text-white">Closest match materializes</p>
                <p className="mt-1 text-sm text-white/65">
                  Connect with same-vibe partners now, or refine with 20 more memes for an even stronger next one.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase tracking-widest text-white/55">Inbox</p>
                <p className="mt-1 text-lg font-semibold text-white">Inbox keeps the loop alive</p>
                <p className="mt-1 text-sm text-white/65">
                  Jump back into chats fast, with latest message previews.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Zap,
              title: "Personality vector",
              body: "After 20 swipes we turn meme tags into a taste fingerprint — then cosine-match you.",
            },
            {
              icon: Shield,
              title: "No phone required",
              body: "Email + password only. Chat blocks numbers and off-platform handles by default.",
            },
            {
              icon: MessageCircle,
              title: "Realtime chat",
              body: "When you match, jump into a modern thread with typing hints and glass UI.",
            },
          ].map((item) => (
            <Card key={item.title} className="premium-card">
              <CardHeader>
                <item.icon className="h-8 w-8 text-cyan-300/90" />
                <CardTitle className="text-lg">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-white/55">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </div>
  );
}

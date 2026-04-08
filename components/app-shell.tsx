import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#0b0f19] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,255,0.35),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(56,189,248,0.12),transparent)]" />
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b0f19]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/swipe" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 shadow-lg shadow-violet-900/40">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <span>VibeMatch</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/swipe"
              className="rounded-xl px-3 py-2 text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              Swipe
            </Link>
            <Link
              href="/matches"
              className="rounded-xl px-3 py-2 text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              Matches
            </Link>
            <Link
              href="/inbox"
              className="rounded-xl px-3 py-2 text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              Inbox
            </Link>
            {user ? (
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm" className="text-white/60">
                  Sign out
                </Button>
              </form>
            ) : null}
          </nav>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-16 pt-6">{children}</main>
    </div>
  );
}

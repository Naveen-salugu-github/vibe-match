"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

type MatchRow = {
  id: string;
  compatibility_score: number;
  created_at: string;
  peer: {
    id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
    age: number | null;
    is_demo_profile: boolean;
  };
};

async function fetchMatches(): Promise<MatchRow[]> {
  const res = await fetch("/api/match");
  if (!res.ok) throw new Error("Failed to load matches");
  const data = (await res.json()) as { matches: MatchRow[] };
  return data.matches ?? [];
}

export default function MatchesPage() {
  const q = useQuery({ queryKey: ["matches"], queryFn: fetchMatches });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Matches</h1>
        <p className="text-white/55">
          Opposite-gender vibe matches — chat stays in-app with safety filters.
        </p>
      </div>

      {q.isLoading && <p className="text-white/50">Loading…</p>}
      {q.isError && <p className="text-rose-300">Could not load matches.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {(q.data ?? []).map((m) => {
          const title =
            m.peer.display_name?.trim() ||
            (m.peer.email ? maskEmail(m.peer.email) : "Match");
          return (
            <Card key={m.id} className="glass-panel">
              <CardHeader className="flex flex-row items-start gap-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/15">
                  {m.peer.avatar_url ? (
                    <Image
                      src={m.peer.avatar_url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="64px"
                      unoptimized={
                        m.peer.avatar_url.includes("randomuser.me") ||
                        m.peer.avatar_url.includes("supabase.co")
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/10 text-lg font-semibold">
                      {title.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>
                    {(m.compatibility_score * 100).toFixed(0)}% overlap
                    {m.peer.age != null ? ` · ${m.peer.age} yrs` : ""}
                    {m.peer.is_demo_profile ? " · Vibe pool" : ""}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Button asChild variant="secondary" className="w-full gap-2">
                  <Link href={`/chat/${m.id}`}>
                    <MessageCircle className="h-4 w-4" />
                    Open chat
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <Card className="glass-panel border-dashed border-white/15">
          <CardHeader>
            <CardTitle>No matches yet</CardTitle>
            <CardDescription>
              Complete 20 swipes to unlock your archetype and your closest opposite-gender vibe match.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function maskEmail(email: string) {
  const [u, d] = email.split("@");
  if (!d) return email;
  const safe = u.length <= 2 ? `${u[0]}*` : `${u.slice(0, 2)}···`;
  return `${safe}@${d}`;
}

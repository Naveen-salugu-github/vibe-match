"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

type MatchRow = {
  id: string;
  compatibility_score: number;
  created_at: string;
  peer: { id: string; email: string };
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
          People whose meme taste lines up with yours — chat stays in-app with safety filters.
        </p>
      </div>

      {q.isLoading && <p className="text-white/50">Loading…</p>}
      {q.isError && <p className="text-rose-300">Could not load matches.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {(q.data ?? []).map((m) => (
          <Card key={m.id} className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg">{maskEmail(m.peer.email)}</CardTitle>
              <CardDescription>
                {(m.compatibility_score * 100).toFixed(0)}% vibe overlap
              </CardDescription>
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
        ))}
      </div>

      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <Card className="glass-panel border-dashed border-white/15">
          <CardHeader>
            <CardTitle>No matches yet</CardTitle>
            <CardDescription>
              Keep swiping — after your profile unlocks, we pair you with opposite-gender users above
              the similarity threshold.
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

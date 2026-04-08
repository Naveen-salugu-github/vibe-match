"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type InboxRow = {
  id: string;
  compatibility_score: number;
  peer: {
    id: string;
    display_name: string | null;
    email: string;
    avatar_url: string | null;
    age: number | null;
  };
  last_message: {
    content: string;
    created_at: string;
    mine: boolean;
  } | null;
};

async function fetchInbox(): Promise<InboxRow[]> {
  const res = await fetch("/api/inbox");
  if (!res.ok) throw new Error("Failed to load inbox");
  const data = (await res.json()) as { inbox: InboxRow[] };
  return data.inbox ?? [];
}

export default function InboxPage() {
  const q = useQuery({ queryKey: ["inbox"], queryFn: fetchInbox });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inbox</h1>
        <p className="text-white/55">See your matched chats and latest replies.</p>
      </div>

      {q.isLoading && <p className="text-white/50">Loading…</p>}
      {q.isError && <p className="text-rose-300">Could not load inbox.</p>}

      <div className="space-y-3">
        {(q.data ?? []).map((row) => {
          const name = row.peer.display_name?.trim() || maskEmail(row.peer.email);
          return (
            <Card key={row.id} className="glass-panel">
              <CardHeader className="flex flex-row items-start gap-4 pb-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/15">
                  {row.peer.avatar_url ? (
                    <Image
                      src={row.peer.avatar_url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="56px"
                      unoptimized={
                        row.peer.avatar_url.includes("randomuser.me") ||
                        row.peer.avatar_url.includes("supabase.co")
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/10 text-lg font-semibold">
                      {name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-lg">{name}</CardTitle>
                  <CardDescription>
                    {(row.compatibility_score * 100).toFixed(0)}% overlap
                    {row.peer.age != null ? ` · ${row.peer.age} yrs` : ""}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3 pt-0">
                <p className="line-clamp-1 text-sm text-white/60">
                  {row.last_message
                    ? `${row.last_message.mine ? "You: " : ""}${row.last_message.content}`
                    : "No messages yet. Say hi 👋"}
                </p>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/chat/${row.id}`}>Open</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <Card className="glass-panel border-dashed border-white/15">
          <CardHeader>
            <CardTitle>No chats yet</CardTitle>
            <CardDescription>
              Get your first match in Swipe, then replies will show up here.
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


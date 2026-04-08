import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ChatInterface, type ChatMessage } from "@/components/chat-interface";
import { Button } from "@/components/ui/button";

type PageProps = {
  params: { matchId: string };
};

export default async function ChatPage({ params }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: match, error: mErr } = await supabase
    .from("matches")
    .select("id, user1_id, user2_id")
    .eq("id", params.matchId)
    .single();

  if (mErr || !match) notFound();
  if (match.user1_id !== user.id && match.user2_id !== user.id) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, content, created_at")
    .eq("match_id", params.matchId)
    .order("created_at", { ascending: true });

  const peerId = match.user1_id === user.id ? match.user2_id : match.user1_id;
  const svc = createServiceClient();
  const { data: peer } = await svc
    .from("users")
    .select("email, display_name, avatar_url, age")
    .eq("id", peerId)
    .single();

  const initial: ChatMessage[] = (messages ?? []) as ChatMessage[];

  const peerLabel =
    peer?.display_name?.trim() ||
    (peer?.email ? maskEmail(peer.email) : "Match");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/15">
            {peer?.avatar_url ? (
              <Image
                src={peer.avatar_url}
                alt=""
                fill
                className="object-cover"
                sizes="56px"
                unoptimized={
                  peer.avatar_url.includes("randomuser.me") ||
                  peer.avatar_url.includes("supabase.co")
                }
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/10 text-lg font-semibold">
                {peerLabel.charAt(0)}
              </div>
            )}
          </div>
          <div>
            <Button variant="ghost" asChild className="-ml-2 h-auto text-white/60">
              <Link href="/matches">← Matches</Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">Chat · {peerLabel}</h1>
            {peer?.age != null && (
              <p className="text-sm text-white/45">{peer.age} years old</p>
            )}
            <p className="text-sm text-white/45">Realtime · filtered for safety</p>
          </div>
        </div>
      </div>
      <ChatInterface
        matchId={params.matchId}
        currentUserId={user.id}
        initialMessages={initial}
      />
    </div>
  );
}

function maskEmail(email: string) {
  const [u, d] = email.split("@");
  if (!d) return email;
  const safe = u.length <= 2 ? `${u[0]}*` : `${u.slice(0, 2)}···`;
  return `${safe}@${d}`;
}

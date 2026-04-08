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
  const { data: peer } = await svc.from("users").select("email").eq("id", peerId).single();

  const initial: ChatMessage[] = (messages ?? []) as ChatMessage[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" asChild className="-ml-2 text-white/60">
            <Link href="/matches">← Matches</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            Chat · {maskEmail(peer?.email ?? "")}
          </h1>
          <p className="text-sm text-white/45">Realtime · filtered for safety</p>
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

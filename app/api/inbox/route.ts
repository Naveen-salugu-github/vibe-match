import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: matches, error } = await supabase
    .from("matches")
    .select("id, user1_id, user2_id, compatibility_score, created_at")
    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const svc = createServiceClient();
  const rows = await Promise.all(
    (matches ?? []).map(async (m) => {
      const peerId = m.user1_id === user.id ? m.user2_id : m.user1_id;
      const [{ data: peer }, { data: lastMsg }] = await Promise.all([
        svc
          .from("users")
          .select("display_name, email, avatar_url, age")
          .eq("id", peerId)
          .single(),
        supabase
          .from("messages")
          .select("content, created_at, sender_id")
          .eq("match_id", m.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        id: m.id,
        compatibility_score: m.compatibility_score,
        peer: {
          id: peerId,
          display_name: peer?.display_name ?? null,
          email: peer?.email ?? "",
          avatar_url: peer?.avatar_url ?? null,
          age: peer?.age ?? null,
        },
        last_message: lastMsg
          ? {
              content: lastMsg.content,
              created_at: lastMsg.created_at,
              mine: lastMsg.sender_id === user.id,
            }
          : null,
      };
    })
  );

  return NextResponse.json({ inbox: rows });
}


import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("matches")
    .select("id, user1_id, user2_id, compatibility_score, created_at")
    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const svc = createServiceClient();
  const enriched = await Promise.all(
    (rows ?? []).map(async (m) => {
      const peerId = m.user1_id === user.id ? m.user2_id : m.user1_id;
      const { data: peer } = await svc.from("users").select("email").eq("id", peerId).single();
      return {
        id: m.id,
        compatibility_score: m.compatibility_score,
        created_at: m.created_at,
        peer: {
          id: peerId,
          email: peer?.email ?? "",
        },
      };
    })
  );

  return NextResponse.json({ matches: enriched });
}

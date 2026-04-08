import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 20);

  const { data: swipedRows, error: swErr } = await supabase
    .from("swipes")
    .select("meme_id")
    .eq("user_id", user.id);

  if (swErr) {
    return NextResponse.json({ error: swErr.message }, { status: 500 });
  }

  const swiped = new Set((swipedRows ?? []).map((r) => r.meme_id));

  const { data: memes, error } = await supabase
    .from("memes")
    .select("id, image_url, tags, category, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pool = (memes ?? []).filter((m) => !swiped.has(m.id));
  // Pseudo-shuffle for variety
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  return NextResponse.json({ memes: pool.slice(0, limit) });
}

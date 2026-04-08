import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { moderateMessage } from "@/lib/moderation";

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
  const matchId = searchParams.get("match_id");
  if (!matchId) {
    return NextResponse.json({ error: "match_id required" }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .eq("id", matchId)
    .single();

  if (!row || (row.user1_id !== user.id && row.user2_id !== user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, sender_id, content, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [] });
}

type PostBody = {
  match_id?: string;
  content?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const match_id = body.match_id;
  const content = body.content?.trim() ?? "";
  if (!match_id) {
    return NextResponse.json({ error: "match_id required" }, { status: 400 });
  }

  const mod = moderateMessage(content);
  if (!mod.ok) {
    return NextResponse.json({ error: mod.reason, blocked: true }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .eq("id", match_id)
    .single();

  if (!row || (row.user1_id !== user.id && row.user2_id !== user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({
      match_id,
      sender_id: user.id,
      content,
    })
    .select("id, sender_id, content, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: inserted });
}

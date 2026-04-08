import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  computePersonalityVector,
  SWIPES_FOR_PROFILE,
  type Gender,
} from "@/lib/matching";
import { findAndInsertMatches } from "@/lib/match-service";

export const dynamic = "force-dynamic";

type Body = {
  meme_id?: string;
  swipe_type?: "like" | "dislike";
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const meme_id = body.meme_id;
  const swipe_type = body.swipe_type;
  if (!meme_id || (swipe_type !== "like" && swipe_type !== "dislike")) {
    return NextResponse.json({ error: "meme_id and swipe_type required" }, { status: 400 });
  }

  const { error: insErr } = await supabase.from("swipes").insert({
    user_id: user.id,
    meme_id,
    swipe_type,
  });

  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json({ error: "Already swiped this meme" }, { status: 409 });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const { data: swipeRows, error: swErr } = await supabase
    .from("swipes")
    .select("swipe_type, meme_id")
    .eq("user_id", user.id);

  if (swErr) {
    return NextResponse.json({ error: swErr.message }, { status: 500 });
  }

  const memeIds = Array.from(new Set((swipeRows ?? []).map((s) => s.meme_id)));
  const { data: memeRows, error: mErr } = await supabase
    .from("memes")
    .select("id, tags")
    .in("id", memeIds.length ? memeIds : ["00000000-0000-0000-0000-000000000000"]);

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const tagByMeme = new Map((memeRows ?? []).map((m) => [m.id, m.tags]));

  const flat = (swipeRows ?? []).map((r) => ({
    swipe_type: r.swipe_type as "like" | "dislike",
    tags: tagByMeme.get(r.meme_id) ?? [],
  }));

  const total = flat.length;
  let personalityReady = false;
  let newMatches: { peerId: string; score: number; peerEmail?: string }[] = [];

  if (total >= SWIPES_FOR_PROFILE) {
    const vector = computePersonalityVector(flat);
    personalityReady = true;

    const { data: profile } = await supabase
      .from("users")
      .select("gender")
      .eq("id", user.id)
      .single();

    const gender = (profile?.gender ?? "other") as Gender;

    const { error: upErr } = await supabase
      .from("users")
      .update({ personality_vector: vector })
      .eq("id", user.id);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    try {
      const result = await findAndInsertMatches(user.id, gender, vector);
      const svc = createServiceClient();
      newMatches = await Promise.all(
        result.newMatches.map(async (m) => {
          const { data: peer } = await svc.from("users").select("email").eq("id", m.peerId).single();
          return { peerId: m.peerId, score: m.score, peerEmail: peer?.email };
        })
      );
    } catch (e) {
      console.error("match pipeline", e);
    }
  }

  return NextResponse.json({
    ok: true,
    swipeCount: total,
    personalityReady,
    newMatches,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getArchetypeFromVector } from "@/lib/archetypes";
import {
  computePersonalityVector,
  SWIPES_FOR_PROFILE,
  type Gender,
} from "@/lib/matching";
import { findBestDemoMatchAndInsert } from "@/lib/match-service";

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
  let archetypePayload: {
    id: string;
    title: string;
    shareLine: string;
    description: string;
  } | null = null;

  let bestMatch: {
    peerId: string;
    score: number;
    peerEmail?: string;
    displayName?: string;
    avatarUrl?: string | null;
    age?: number | null;
    matchId: string;
  } | null = null;

  if (total >= SWIPES_FOR_PROFILE) {
    const vector = computePersonalityVector(flat);
    personalityReady = true;
    const arche = getArchetypeFromVector(vector);
    archetypePayload = {
      id: arche.id,
      title: arche.title,
      shareLine: arche.shareLine,
      description: arche.description,
    };

    const { data: profile } = await supabase
      .from("users")
      .select("gender")
      .eq("id", user.id)
      .single();

    const gender = (profile?.gender ?? "male") as Gender;

    const { error: upErr } = await supabase
      .from("users")
      .update({
        personality_vector: vector,
        archetype: arche.title,
      })
      .eq("id", user.id);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    try {
      const result = await findBestDemoMatchAndInsert(user.id, gender, vector);
      if (result) {
        const svc = createServiceClient();
        const { data: peer } = await svc
          .from("users")
          .select("email, display_name, avatar_url, age")
          .eq("id", result.peerId)
          .single();
        bestMatch = {
          peerId: result.peerId,
          score: result.score,
          peerEmail: peer?.email,
          displayName: peer?.display_name ?? undefined,
          avatarUrl: peer?.avatar_url,
          age: peer?.age,
          matchId: result.matchId,
        };
      }
    } catch (e) {
      console.error("match pipeline", e);
    }
  }

  return NextResponse.json({
    ok: true,
    swipeCount: total,
    personalityReady,
    archetype: archetypePayload,
    bestMatch,
    newMatches: bestMatch
      ? [
          {
            peerId: bestMatch.peerId,
            score: bestMatch.score,
            peerEmail: bestMatch.peerEmail,
            matchId: bestMatch.matchId,
          },
        ]
      : [],
  });
}

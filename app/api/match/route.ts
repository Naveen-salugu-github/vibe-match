import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { findBestDemoMatchAndInsert } from "@/lib/match-service";
import type { Gender, PersonalityVector } from "@/lib/matching";

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

  const base = rows ?? [];

  const enriched = await Promise.all(
    base.map(async (m) => {
      const peerId = m.user1_id === user.id ? m.user2_id : m.user1_id;
      const { data: peer } = await svc
        .from("users")
        .select("email, display_name, avatar_url, age, is_demo_profile")
        .eq("id", peerId)
        .single();
      return {
        id: m.id,
        compatibility_score: m.compatibility_score,
        created_at: m.created_at,
        peer: {
          id: peerId,
          email: peer?.email ?? "",
          display_name: peer?.display_name ?? null,
          avatar_url: peer?.avatar_url ?? null,
          age: peer?.age ?? null,
          is_demo_profile: peer?.is_demo_profile === true,
        },
      };
    })
  );

  return NextResponse.json({ matches: enriched });
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If a match already exists, no-op.
  const { data: existing } = await supabase
    .from("matches")
    .select("id")
    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { data: me } = await supabase
    .from("users")
    .select("gender, personality_vector")
    .eq("id", user.id)
    .single();

  const gender = (me?.gender ?? "male") as Gender;
  const vector = (me?.personality_vector ?? {}) as PersonalityVector;

  if (Object.keys(vector).length === 0) {
    return NextResponse.json(
      { error: "Personality vector not ready yet. Swipe more memes." },
      { status: 400 }
    );
  }

  try {
    const result = await findBestDemoMatchAndInsert(user.id, gender, vector);
    if (!result) {
      return NextResponse.json(
        { error: "No demo profiles available. Run npm run seed:demo." },
        { status: 400 }
      );
    }

    const svc = createServiceClient();
    const { data: peer } = await svc
      .from("users")
      .select("email, display_name, avatar_url, age, is_demo_profile")
      .eq("id", result.peerId)
      .single();

    return NextResponse.json({
      ok: true,
      match: {
        id: result.matchId,
        compatibility_score: result.score,
        peer: {
          id: result.peerId,
          email: peer?.email ?? "",
          display_name: peer?.display_name ?? null,
          avatar_url: peer?.avatar_url ?? null,
          age: peer?.age ?? null,
          is_demo_profile: peer?.is_demo_profile === true,
        },
      },
    });
  } catch (e: unknown) {
    const msg =
      typeof e === "object" &&
      e !== null &&
      "message" in e &&
      typeof (e as { message?: unknown }).message === "string"
        ? ((e as { message: string }).message as string)
        : "Match generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

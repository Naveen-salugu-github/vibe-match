import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getArchetypeFromVector } from "@/lib/archetypes";
import type { PersonalityVector } from "@/lib/matching";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from("users")
    .select(
      "email, gender, personality_vector, created_at, avatar_url, age, display_name, profile_completed, archetype"
    )
    .eq("id", user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { count } = await supabase
    .from("swipes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const pv = (profile?.personality_vector ?? {}) as PersonalityVector;
  const archetypeOut =
    Object.keys(pv).length > 0
      ? (() => {
          const a = getArchetypeFromVector(pv);
          return { title: a.title, shareLine: a.shareLine, description: a.description };
        })()
      : null;

  return NextResponse.json({
    user: {
      id: user.id,
      email: profile?.email,
      gender: profile?.gender,
      personality_vector: pv,
      created_at: profile?.created_at,
      swipe_count: count ?? 0,
      avatar_url: profile?.avatar_url ?? null,
      age: profile?.age ?? null,
      display_name: profile?.display_name ?? null,
      profile_completed: profile?.profile_completed === true,
      archetype: archetypeOut,
    },
  });
}

type PatchBody = {
  gender?: "male" | "female";
  age?: number;
  avatar_url?: string | null;
  display_name?: string | null;
};

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.gender === "male" || body.gender === "female") {
    updates.gender = body.gender;
    await supabase.auth.updateUser({
      data: { gender: body.gender },
    });
  }

  if (body.age !== undefined) {
    if (typeof body.age !== "number" || body.age < 18 || body.age > 120) {
      return NextResponse.json({ error: "Age must be between 18 and 120" }, { status: 400 });
    }
    updates.age = body.age;
  }

  if (body.display_name !== undefined) {
    updates.display_name = typeof body.display_name === "string" ? body.display_name.trim() : null;
  }

  if (body.avatar_url !== undefined) {
    updates.avatar_url = body.avatar_url;
  }

  const { data: current } = await supabase
    .from("users")
    .select("avatar_url, age, gender")
    .eq("id", user.id)
    .single();

  const nextAvatar = (updates.avatar_url !== undefined ? updates.avatar_url : current?.avatar_url) as
    | string
    | null
    | undefined;
  const nextAge = (updates.age !== undefined ? updates.age : current?.age) as number | null | undefined;
  const nextGender = (updates.gender !== undefined ? updates.gender : current?.gender) as string | undefined;

  const canComplete =
    typeof nextAvatar === "string" &&
    nextAvatar.length > 0 &&
    typeof nextAge === "number" &&
    nextAge >= 18 &&
    (nextGender === "male" || nextGender === "female");

  if (canComplete) {
    updates.profile_completed = true;
  }

  const { error: upErr } = await supabase.from("users").update(updates).eq("id", user.id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profile_completed: canComplete });
}

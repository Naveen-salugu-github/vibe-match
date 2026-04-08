import { createServiceClient } from "@/lib/supabase/service";
import {
  canMatchGenders,
  cosineSimilarity,
  MATCH_SIMILARITY_THRESHOLD,
  orderedPair,
  type Gender,
  type PersonalityVector,
} from "@/lib/matching";

export type BestMatchResult = {
  peerId: string;
  score: number;
  matchId: string;
};

/**
 * Real users only match **opposite-gender demo profiles** (`is_demo_profile = true`).
 * Picks the single best cosine match; prefers scores ≥ threshold, otherwise still returns the best available.
 */
export async function findBestDemoMatchAndInsert(
  userId: string,
  gender: Gender,
  vector: PersonalityVector
): Promise<BestMatchResult | null> {
  const supabase = createServiceClient();
  const keys = Object.keys(vector);
  if (keys.length === 0) return null;

  if (gender !== "male" && gender !== "female") {
    return null;
  }

  const { data: demos, error } = await supabase
    .from("users")
    .select("id, gender, personality_vector")
    .eq("is_demo_profile", true)
    .neq("id", userId);

  if (error || !demos?.length) {
    console.error("findBestDemoMatchAndInsert fetch", error);
    return null;
  }

  const { data: existingMatches } = await supabase
    .from("matches")
    .select("user1_id, user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

  const alreadyMatchedPeerIds = new Set<string>();
  for (const m of existingMatches ?? []) {
    alreadyMatchedPeerIds.add(m.user1_id === userId ? m.user2_id : m.user1_id);
  }

  const candidates: { id: string; score: number }[] = [];
  for (const row of demos) {
    const g = row.gender as Gender;
    if (!canMatchGenders(gender, g)) continue;
    if (alreadyMatchedPeerIds.has(row.id)) continue;

    const pv = (row.personality_vector ?? {}) as PersonalityVector;
    if (Object.keys(pv).length === 0) continue;

    const score = cosineSimilarity(vector, pv);
    candidates.push({ id: row.id, score });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const above = candidates.filter((c) => c.score >= MATCH_SIMILARITY_THRESHOLD);
  const best = (above.length > 0 ? above[0] : candidates[0])!;

  const [u1, u2] = orderedPair(userId, best.id);

  const { data: existing } = await supabase
    .from("matches")
    .select("id, compatibility_score")
    .eq("user1_id", u1)
    .eq("user2_id", u2)
    .maybeSingle();

  if (existing) {
    return { peerId: best.id, score: existing.compatibility_score, matchId: existing.id };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("matches")
    .insert({
      user1_id: u1,
      user2_id: u2,
      compatibility_score: best.score,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("findBestDemoMatchAndInsert insert", insErr);
    return null;
  }

  return { peerId: best.id, score: best.score, matchId: inserted.id };
}

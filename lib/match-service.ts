import { createServiceClient } from "@/lib/supabase/service";
import {
  canMatchGenders,
  cosineSimilarity,
  MATCH_SIMILARITY_THRESHOLD,
  orderedPair,
  type Gender,
  type PersonalityVector,
} from "@/lib/matching";

export async function findAndInsertMatches(
  userId: string,
  gender: Gender,
  vector: PersonalityVector
): Promise<{ newMatches: { peerId: string; score: number }[] }> {
  const supabase = createServiceClient();
  const keys = Object.keys(vector);
  if (keys.length === 0) return { newMatches: [] };

  const { data: others, error } = await supabase
    .from("users")
    .select("id, gender, personality_vector")
    .neq("id", userId);

  if (error || !others) {
    console.error("findAndInsertMatches fetch", error);
    return { newMatches: [] };
  }

  const newMatches: { peerId: string; score: number }[] = [];

  for (const row of others) {
    const g = row.gender as Gender;
    if (!canMatchGenders(gender, g)) continue;

    const pv = (row.personality_vector ?? {}) as PersonalityVector;
    if (Object.keys(pv).length === 0) continue;

    const score = cosineSimilarity(vector, pv);
    if (score < MATCH_SIMILARITY_THRESHOLD) continue;

    const [u1, u2] = orderedPair(userId, row.id);
    const { data: existing } = await supabase
      .from("matches")
      .select("id")
      .eq("user1_id", u1)
      .eq("user2_id", u2)
      .maybeSingle();

    if (existing) continue;

    const { error: insErr } = await supabase.from("matches").insert({
      user1_id: u1,
      user2_id: u2,
      compatibility_score: score,
    });

    if (!insErr) {
      newMatches.push({ peerId: row.id, score });
    }
  }

  return { newMatches };
}

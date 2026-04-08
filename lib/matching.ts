export const SWIPES_FOR_PROFILE = 20;
export const MATCH_SIMILARITY_THRESHOLD = 0.7;

export type PersonalityVector = Record<string, number>;

export function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === "string");
  }
  if (typeof tags === "string") {
    try {
      const p = JSON.parse(tags) as unknown;
      return Array.isArray(p) ? p.filter((t): t is string => typeof t === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Aggregate tag scores from swipes; likes +1, dislikes -0.35 per tag */
export function computePersonalityVector(
  rows: { tags: unknown; swipe_type: "like" | "dislike" }[]
): PersonalityVector {
  const raw: Record<string, number> = {};
  for (const row of rows) {
    const w = row.swipe_type === "like" ? 1 : -0.35;
    for (const tag of parseTags(row.tags)) {
      const k = tag.trim().toLowerCase();
      if (!k) continue;
      raw[k] = (raw[k] ?? 0) + w;
    }
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) return {};
  let min = Infinity;
  let max = -Infinity;
  for (const k of keys) {
    const v = raw[k]!;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const span = max - min || 1;
  const out: PersonalityVector = {};
  for (const k of keys) {
    const v = raw[k]!;
    out[k] = Math.max(0, Math.min(1, (v - min) / span));
  }
  return out;
}

export function cosineSimilarity(a: PersonalityVector, b: PersonalityVector): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type Gender = "male" | "female" | "other";

export function canMatchGenders(a: Gender, b: Gender): boolean {
  if (a === "male" && b === "female") return true;
  if (a === "female" && b === "male") return true;
  if (a === "other" && b === "other") return true;
  return false;
}

export function orderedPair(u1: string, u2: string): [string, string] {
  return u1 < u2 ? [u1, u2] : [u2, u1];
}

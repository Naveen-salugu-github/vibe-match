import type { PersonalityVector } from "@/lib/matching";

export type ArchetypeId = "chaos_goblin" | "soft_meme_lord" | "dark_humor_wizard" | "wholesome_bean";

export type ArchetypeResult = {
  id: ArchetypeId;
  title: string;
  /** One-liner for screenshots / share */
  shareLine: string;
  description: string;
};

const ARCHETYPES: Record<ArchetypeId, Omit<ArchetypeResult, "id">> = {
  chaos_goblin: {
    title: "Chaos Goblin",
    shareLine: "Certified chaos — your FYP never knows what’s next.",
    description: "Dark humor, sarcasm, and unhinged energy. You match energy with entropy.",
  },
  soft_meme_lord: {
    title: "Soft Meme Lord",
    shareLine: "Soft hands, sharp memes — wholesome with a sting.",
    description: "You like it sweet, but you’re not boring. Irony with a warm center.",
  },
  dark_humor_wizard: {
    title: "Dark Humor Wizard",
    shareLine: "Your humor has lore — and a little danger.",
    description: "Edgy is a feature, not a bug. You live in the comment section’s shadow realm.",
  },
  wholesome_bean: {
    title: "Wholesome Bean",
    shareLine: "Pure serotonin in meme form.",
    description: "Animals, kindness, and good vibes. The timeline heals when you scroll.",
  },
};

function val(v: PersonalityVector, key: string): number {
  return v[key] ?? 0;
}

/**
 * Maps a personality vector to a shareable “vibe archetype” (not pure cosine similarity).
 */
export function getArchetypeFromVector(v: PersonalityVector): ArchetypeResult {
  const keys = Object.keys(v);
  if (keys.length === 0) {
    return { id: "soft_meme_lord", ...ARCHETYPES.soft_meme_lord };
  }

  const dark = val(v, "dark_humor");
  const wholesome = val(v, "wholesome");
  const sarcasm = val(v, "sarcasm");
  const gaming = val(v, "gaming");
  const animals = val(v, "animals");
  const anime = val(v, "anime");
  const politics = val(v, "politics");

  const chaosScore = (dark + sarcasm + gaming) / 3;
  const softBlend = (wholesome + sarcasm) / 2;
  const wholesomeLean = (wholesome + animals + anime) / 3;

  // Decision order: strongest signals first
  if (wholesomeLean >= 0.45 && wholesome >= dark && wholesome >= sarcasm * 0.9) {
    return { id: "wholesome_bean", ...ARCHETYPES.wholesome_bean };
  }

  if (dark >= 0.5 && dark >= wholesome && dark >= sarcasm * 0.85) {
    return { id: "dark_humor_wizard", ...ARCHETYPES.dark_humor_wizard };
  }

  if (chaosScore >= 0.42 && (gaming > 0.35 || politics > 0.35 || dark > 0.4)) {
    return { id: "chaos_goblin", ...ARCHETYPES.chaos_goblin };
  }

  if (softBlend >= 0.38 && wholesome > 0.25 && sarcasm > 0.25) {
    return { id: "soft_meme_lord", ...ARCHETYPES.soft_meme_lord };
  }

  // Tie-break: pick max “character”
  const scores: [ArchetypeId, number][] = [
    ["chaos_goblin", chaosScore + politics * 0.2],
    ["soft_meme_lord", softBlend],
    ["dark_humor_wizard", dark + sarcasm * 0.5],
    ["wholesome_bean", wholesomeLean],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const pick = scores[0]![0];
  return { id: pick, ...ARCHETYPES[pick] };
}

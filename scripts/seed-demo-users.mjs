/**
 * Creates 15 female + 15 male demo auth users with photos, ages, and personality vectors.
 * Run once: npm run seed:demo
 * Requires: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 * Optional: DEMO_SEED_PASSWORD (default: VibeMatchDemo2026!)
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_SEED_PASSWORD || "VibeMatchDemo2026!";

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const femalePersonas = [
  { name: "Ava", age: 22, w: 0, v: { wholesome: 0.92, animals: 0.85, sarcasm: 0.25, general: 0.4 } },
  { name: "Mia", age: 19, w: 1, v: { dark_humor: 0.88, sarcasm: 0.75, gaming: 0.7, reddit: 0.5 } },
  { name: "Zoe", age: 24, w: 2, v: { sarcasm: 0.9, politics: 0.8, dark_humor: 0.45, general: 0.35 } },
  { name: "Lily", age: 21, w: 3, v: { anime: 0.9, wholesome: 0.55, sarcasm: 0.4, general: 0.3 } },
  { name: "Emma", age: 27, w: 4, v: { gaming: 0.88, sarcasm: 0.65, dark_humor: 0.5, reddit: 0.6 } },
  { name: "Nora", age: 30, w: 5, v: { wholesome: 0.7, sarcasm: 0.85, reddit: 0.5, general: 0.4 } },
  { name: "Jade", age: 18, w: 6, v: { dark_humor: 0.75, politics: 0.7, sarcasm: 0.55, general: 0.45 } },
  { name: "Sara", age: 26, w: 7, v: { animals: 0.9, wholesome: 0.88, sarcasm: 0.2, general: 0.35 } },
  { name: "Chloe", age: 23, w: 8, v: { anime: 0.75, wholesome: 0.8, sarcasm: 0.5, gaming: 0.45 } },
  { name: "Nina", age: 29, w: 9, v: { dark_humor: 0.65, sarcasm: 0.9, reddit: 0.7, general: 0.4 } },
  { name: "Ruby", age: 20, w: 10, v: { politics: 0.85, sarcasm: 0.7, dark_humor: 0.55, general: 0.4 } },
  { name: "Ivy", age: 32, w: 11, v: { gaming: 0.75, wholesome: 0.5, sarcasm: 0.8, reddit: 0.55 } },
  { name: "Ella", age: 25, w: 12, v: { wholesome: 0.85, sarcasm: 0.6, animals: 0.5, general: 0.4 } },
  { name: "Kate", age: 28, w: 13, v: { dark_humor: 0.8, anime: 0.55, sarcasm: 0.65, general: 0.35 } },
  { name: "Maya", age: 34, w: 14, v: { sarcasm: 0.75, wholesome: 0.65, gaming: 0.6, reddit: 0.5 } },
];

const malePersonas = [
  { name: "Leo", age: 24, m: 0, v: { dark_humor: 0.85, gaming: 0.8, sarcasm: 0.75, reddit: 0.55 } },
  { name: "Max", age: 21, m: 1, v: { wholesome: 0.88, animals: 0.5, sarcasm: 0.45, general: 0.4 } },
  { name: "Kai", age: 19, m: 2, v: { anime: 0.9, sarcasm: 0.6, gaming: 0.55, general: 0.35 } },
  { name: "Noah", age: 31, m: 3, v: { politics: 0.82, sarcasm: 0.7, dark_humor: 0.5, general: 0.4 } },
  { name: "Evan", age: 22, m: 4, v: { sarcasm: 0.92, wholesome: 0.55, reddit: 0.65, general: 0.38 } },
  { name: "Alex", age: 27, m: 5, v: { gaming: 0.9, dark_humor: 0.6, sarcasm: 0.7, reddit: 0.6 } },
  { name: "Ryan", age: 26, m: 6, v: { wholesome: 0.75, sarcasm: 0.7, animals: 0.55, general: 0.42 } },
  { name: "Finn", age: 20, m: 7, v: { dark_humor: 0.78, sarcasm: 0.85, politics: 0.45, general: 0.4 } },
  { name: "Jake", age: 29, m: 8, v: { reddit: 0.85, sarcasm: 0.8, gaming: 0.65, general: 0.4 } },
  { name: "Owen", age: 33, m: 9, v: { animals: 0.7, wholesome: 0.82, sarcasm: 0.35, general: 0.4 } },
  { name: "Liam", age: 18, m: 10, v: { anime: 0.8, gaming: 0.75, sarcasm: 0.55, general: 0.35 } },
  { name: "Cole", age: 30, m: 11, v: { dark_humor: 0.9, sarcasm: 0.72, politics: 0.55, general: 0.38 } },
  { name: "Sean", age: 25, m: 12, v: { sarcasm: 0.78, wholesome: 0.68, reddit: 0.6, general: 0.4 } },
  { name: "Marcus", age: 35, m: 13, v: { politics: 0.75, dark_humor: 0.7, sarcasm: 0.65, general: 0.42 } },
  { name: "Dean", age: 28, m: 14, v: { gaming: 0.82, sarcasm: 0.68, dark_humor: 0.62, reddit: 0.58 } },
];

async function upsertDemo({ email, gender, display_name, age, avatar_url, personality_vector }) {
  const patch = {
    display_name,
    age,
    avatar_url,
    gender,
    personality_vector,
    is_demo_profile: true,
    profile_completed: true,
  };

  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { gender },
  });

  if (cErr) {
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u) => u.email === email);
    if (!existing?.id) {
      console.error(email, cErr);
      return null;
    }
    const { error: uErr } = await supabase.from("users").update(patch).eq("id", existing.id);
    if (uErr) throw uErr;
    return existing.id;
  }

  const id = created.user.id;
  const { error: uErr } = await supabase.from("users").update(patch).eq("id", id);
  if (uErr) throw uErr;
  return id;
}

async function main() {
  let n = 0;
  for (let i = 0; i < femalePersonas.length; i++) {
    const p = femalePersonas[i];
    const email = `demo-f-${String(i + 1).padStart(2, "0")}@vibematch.demo`;
    const avatar_url = `https://randomuser.me/api/portraits/women/${p.w}.jpg`;
    await upsertDemo({
      email,
      gender: "female",
      display_name: p.name,
      age: p.age,
      avatar_url,
      personality_vector: p.v,
    });
    n++;
    console.log("OK", email);
  }
  for (let i = 0; i < malePersonas.length; i++) {
    const p = malePersonas[i];
    const email = `demo-m-${String(i + 1).padStart(2, "0")}@vibematch.demo`;
    const avatar_url = `https://randomuser.me/api/portraits/men/${p.m}.jpg`;
    await upsertDemo({
      email,
      gender: "male",
      display_name: p.name,
      age: p.age,
      avatar_url,
      personality_vector: p.v,
    });
    n++;
    console.log("OK", email);
  }
  console.log(`Done. ${n} demo profiles ready.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

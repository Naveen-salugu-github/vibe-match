/**
 * Daily meme ingestion worker for Railway cron.
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Railway: New Project → Deploy from repo → Cron schedule e.g. 0 3 * * *
 * Start command: node workers/meme-ingest.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function tagsFromPost(title, subreddit) {
  const base = new Set();
  const t = (title || "").toLowerCase();
  if (/wholesome|heart|love|dog|cat/.test(t)) base.add("wholesome");
  if (/dark|cursed|cursedcomments|edgy/.test(t)) base.add("dark_humor");
  if (/sarcasm|irony|satire/.test(t)) base.add("sarcasm");
  if (/politic|news|world/.test(t)) base.add("politics");
  if (/gaming|gamer|minecraft|valorant/.test(t)) base.add("gaming");
  if (/anime|manga|weeb/.test(t)) base.add("anime");
  if (base.size === 0) base.add("general");
  base.add(subreddit?.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "reddit");
  return [...base];
}

async function fetchReddit() {
  const res = await fetch("https://www.reddit.com/r/memes/hot.json?limit=12", {
    headers: { "User-Agent": "VibeMatchWorker/1.0" },
  });
  if (!res.ok) throw new Error(`Reddit ${res.status}`);
  const json = await res.json();
  const children = json?.data?.children ?? [];
  const out = [];
  for (const c of children) {
    const p = c?.data;
    if (!p) continue;
    const urlImg =
      p.url_overridden_by_dest ||
      p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&");
    if (!urlImg || !/^https:\/\//i.test(urlImg)) continue;
    if (!/\.(png|jpe?g|gif|webp)$/i.test(urlImg) && !urlImg.includes("i.redd.it")) continue;
    out.push({
      image_url: urlImg,
      tags: tagsFromPost(p.title, p.subreddit),
      category: "reddit",
    });
  }
  return out;
}

async function main() {
  const rows = await fetchReddit();
  let inserted = 0;
  for (const row of rows) {
    const { error } = await supabase.from("memes").insert(row);
    if (!error) inserted++;
    else if (!error.message?.includes("duplicate")) {
      console.warn("insert skip:", error.message);
    }
  }
  console.log(`Meme ingest done. Inserted ${inserted} / ${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

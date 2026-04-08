import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type Body = {
  image_url?: string;
  tags?: string[];
  category?: string;
};

export async function POST(request: Request) {
  const secret = request.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const image_url = body.image_url?.trim();
  if (!image_url) {
    return NextResponse.json({ error: "image_url required" }, { status: 400 });
  }

  const tags = Array.isArray(body.tags) ? body.tags : [];
  const category = body.category?.trim() || "general";

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("memes")
    .insert({
      image_url,
      tags,
      category,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminUploadPage() {
  const [imageUrl, setImageUrl] = useState("");
  const [tags, setTags] = useState("dark_humor, wholesome, sarcasm");
  const [category, setCategory] = useState("general");
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    const tagList = tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    try {
      const res = await fetch("/api/admin/memes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
        },
        body: JSON.stringify({
          image_url: imageUrl,
          tags: tagList,
          category,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; id?: string };
      if (!res.ok) {
        setStatus(data.error ?? "Failed");
        return;
      }
      setStatus(`Inserted meme ${data.id}`);
      setImageUrl("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Local meme upload</h1>
        <p className="text-sm text-white/50">
          Fallback when the Railway worker is offline. Requires{" "}
          <code className="rounded bg-white/10 px-1">ADMIN_SECRET</code> on the server.
        </p>
      </div>
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle>Add meme</CardTitle>
          <CardDescription>Image URL plus comma-separated tags for personality vectors.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="secret">Admin secret</Label>
              <Input
                id="secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Matches server ADMIN_SECRET"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="url">Image URL</Label>
              <Input
                id="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat">Category</Label>
              <Input id="cat" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            {status && (
              <p className="text-sm text-violet-200/90" role="status">
                {status}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Saving…" : "Insert meme"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

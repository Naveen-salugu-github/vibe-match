"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingProfilePage() {
  const router = useRouter();
  const [gender, setGender] = useState<"male" | "female">("male");
  const [age, setAge] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function onFileChange(f: File | null) {
    setFile(f);
    if (f) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ageNum = Number.parseInt(age, 10);
    if (!Number.isFinite(ageNum) || ageNum < 18) {
      setError("You must be 18 or older.");
      return;
    }
    if (!file) {
      setError("Please add a profile photo.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError("Not signed in.");
      return;
    }

    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) {
      setLoading(false);
      setError(pwErr.message);
      return;
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/avatar.${ext}`;

    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });

    if (upErr) {
      setLoading(false);
      setError(upErr.message);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gender,
        age: ageNum,
        avatar_url: publicUrl,
        display_name: displayName.trim() || null,
      }),
    });

    const data = (await res.json()) as { error?: string };
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Could not save profile");
      return;
    }

    await supabase.auth.updateUser({ data: { gender } });
    router.push("/swipe");
    router.refresh();
  }

  return (
    <div className="relative min-h-screen bg-[#0b0f19] px-4 py-12 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,255,0.35),transparent)]" />
      <div className="relative z-10 mx-auto w-full max-w-md">
        <Card className="glass-panel border-violet-500/25">
          <CardHeader>
            <CardTitle className="text-2xl">Finish your profile</CardTitle>
            <CardDescription>
              Opposite-gender matching needs your gender, age (18+), and a profile photo — no phone
              number required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label>Gender</Label>
                <div className="flex gap-2">
                  {(["male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(g)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm capitalize transition ${
                        gender === g
                          ? "border-violet-500/60 bg-violet-500/20 text-white"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="age">Age</Label>
                <Input
                  id="age"
                  type="number"
                  min={18}
                  max={120}
                  required
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="18+"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Display name (optional)</Label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How you want to appear"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pw">Create a password (for next time)</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input
                  id="pw2"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="photo">Profile photo</Label>
                <Input
                  id="photo"
                  type="file"
                  accept="image/*"
                  required
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                  className="cursor-pointer text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-white"
                />
                {preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt="Preview"
                    className="mt-2 h-32 w-32 rounded-2xl border border-white/15 object-cover"
                  />
                )}
              </div>

              {error && <p className="text-sm text-rose-300">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Saving…" : "Save & start swiping"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

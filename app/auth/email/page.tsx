"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function EmailCodeStartPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedEmail = localStorage.getItem("pending_email") ?? "";
    const savedGender = localStorage.getItem("pending_gender");
    if (savedEmail) setEmail(savedEmail);
    if (savedGender === "male" || savedGender === "female") setGender(savedGender);
  }, []);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    try {
      localStorage.setItem("pending_email", cleanEmail);
      localStorage.setItem("pending_gender", gender);

      const { error: err } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding/profile`,
        },
      });
      if (err) {
        setError(err.message);
        return;
      }
      router.push(`/auth/otp?email=${encodeURIComponent(cleanEmail)}`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#0b0f19] px-4 py-16 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,255,0.35),transparent)]" />
      <div className="relative z-10 mx-auto w-full max-w-md">
        <Card className="glass-panel border-violet-500/20">
          <CardHeader>
            <CardTitle className="text-2xl">Continue with email code</CardTitle>
            <CardDescription>
              We’ll email you a 6-digit code. After verification, you’ll upload your profile photo
              (required) and start swiping.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Gender (for opposite-gender matching)</Label>
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

              {error && <p className="text-sm text-rose-300">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending code…" : "Send email code"}
              </Button>
            </form>

            <p className="mt-4 text-center text-xs text-white/45">
              Tip: check Promotions/Spam folders. You can also use the email link if your client
              hides codes.
            </p>

            <p className="mt-4 text-center text-sm text-white/50">
              By continuing, you agree to keep contact info out of chat.{" "}
              <Link href="/" className="text-violet-300 hover:underline">
                Back
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


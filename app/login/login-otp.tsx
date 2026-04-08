"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function LoginOtp() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedEmail = localStorage.getItem("pending_email") ?? "";
    if (savedEmail) setEmail(savedEmail);
  }, []);

  async function loginWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { error: err } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (err) {
        setError(err.message);
        return;
      }
      router.push("/swipe");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    try {
      localStorage.setItem("pending_email", cleanEmail);
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
    <div className="relative z-10 mx-auto w-full max-w-md">
      <Card className="glass-panel border-violet-500/20">
        <CardHeader>
          <CardTitle className="text-2xl">Log in</CardTitle>
          <CardDescription>
            If you’ve set a password before, use it. Otherwise, use an email code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="password" className="w-full">
            <TabsList>
              <TabsTrigger value="password">Password</TabsTrigger>
              <TabsTrigger value="code">Email code</TabsTrigger>
            </TabsList>

            <TabsContent value="password">
              <form onSubmit={loginWithPassword} className="space-y-4">
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
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-rose-300">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : "Log in"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="code">
              <form onSubmit={sendCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email_code">Email</Label>
                  <Input
                    id="email_code"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    required
                  />
                </div>
                {error && <p className="text-sm text-rose-300">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending code…" : "Continue with email code"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="mt-4 text-center text-sm text-white/50">
            New here?{" "}
            <Link href="/signup" className="text-violet-300 hover:underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const RESEND_SECONDS = 30;

export function OtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const qpEmail = (searchParams.get("email") ?? "").trim().toLowerCase();
  const [email, setEmail] = useState(qpEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const savedEmail = (localStorage.getItem("pending_email") ?? "").trim().toLowerCase();
    if (!email && savedEmail) setEmail(savedEmail);
  }, [email]);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function verifyOtp(token: string) {
    if (!email) {
      setError("Missing email. Go back and request a code again.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
      if (vErr) {
        setError(vErr.message);
        return;
      }

      // Persist gender chosen on /auth/email, before onboarding.
      const pendingGender = localStorage.getItem("pending_gender");
      if (pendingGender === "male" || pendingGender === "female") {
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gender: pendingGender }),
        });
      }

      router.push("/onboarding/profile");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const digits = code.replace(/\D/g, "").slice(0, 6);
    if (digits !== code) setCode(digits);
    if (digits.length === 6) {
      void verifyOtp(digits);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function resend() {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding/profile`,
        },
      });
      if (err) {
        setError(err.message);
        return;
      }
      setResendIn(RESEND_SECONDS);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative z-10 mx-auto w-full max-w-md">
      <Card className="glass-panel border-cyan-500/20">
        <CardHeader>
          <CardTitle className="text-2xl">Enter your code</CardTitle>
          <CardDescription>
            We sent a 6-digit code to <span className="text-white/80">{email || "your email"}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">6-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              className="text-center text-lg tracking-[0.35em]"
              disabled={loading}
            />
            <p className="text-xs text-white/45">
              Auto-verifies when you type all 6 digits.
            </p>
          </div>

          {error && <p className="text-sm text-rose-300">{error}</p>}

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/login")}
              disabled={loading}
            >
              Change email
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void resend()}
              disabled={loading || resendIn > 0}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


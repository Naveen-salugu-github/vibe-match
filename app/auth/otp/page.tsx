import { Suspense } from "react";
import { OtpForm } from "./otp-form";

export default function OtpPage() {
  return (
    <div className="relative min-h-screen bg-[#0b0f19] px-4 py-16 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(56,189,248,0.16),transparent),radial-gradient(ellipse_70%_50%_at_50%_-20%,rgba(120,80,255,0.3),transparent)]" />
      <Suspense
        fallback={
          <div className="relative z-10 mx-auto max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
            Loading…
          </div>
        }
      >
        <OtpForm />
      </Suspense>
    </div>
  );
}


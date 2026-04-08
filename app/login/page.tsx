export default function LoginPage() {
  // Back-compat route: keep /login but route to OTP flow.
  return (
    <div className="min-h-screen bg-[#0b0f19] px-4 py-16 text-white">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-white/70">Login now uses email codes.</p>
        <a
          href="/auth/email"
          className="mt-4 inline-block rounded-2xl bg-gradient-to-r from-violet-600 to-cyan-500 px-6 py-3 text-sm font-semibold text-white"
        >
          Continue with email code
        </a>
      </div>
    </div>
  );
}

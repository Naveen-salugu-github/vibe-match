import { LoginOtp } from "./login-otp";

export default function LoginPage() {
  return (
    <div className="relative min-h-screen bg-[#0b0f19] px-4 py-16 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,255,0.35),transparent)]" />
      <LoginOtp />
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Eye, EyeOff, Wallet, AtSign } from 'lucide-react';

export default function SignUp() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: implement registration
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[linear-gradient(160deg,#E8EBF2,#F0F1F6,#ECEEF4)]">
      {/* Decorative radial orbs */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(5,150,105,0.08)_0%,transparent_70%)]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.08)_0%,transparent_70%)]" />

      <div className="relative z-10 flex w-full flex-col items-center px-4 py-10">
        {/* Floating logo */}
        <img
          src="/logo.jpg"
          alt="Roil"
          className="mb-5 h-16 w-16 rounded-2xl shadow-lg"
        />

        {/* Card */}
        <div className="w-full max-w-[620px] rounded-3xl border border-[#D6D9E3] bg-[#F3F4F9] px-10 py-9">
          {/* Header */}
          <h1 className="text-center text-[28px] font-[800] text-[#111827]">
            Create your account
          </h1>
          <p className="mt-1.5 text-center text-sm text-[#6B7280]">
            Start managing your private treasury on Canton Network
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {/* First Name + Last Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="signup-first" className="mb-1.5 block text-sm font-medium text-[#111827]">
                  First Name
                </label>
                <input
                  id="signup-first"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  className="w-full rounded-xl border border-[#D6D9E3] bg-white px-[18px] py-[14px] text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
                />
              </div>
              <div>
                <label htmlFor="signup-last" className="mb-1.5 block text-sm font-medium text-[#111827]">
                  Last Name
                </label>
                <input
                  id="signup-last"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  className="w-full rounded-xl border border-[#D6D9E3] bg-white px-[18px] py-[14px] text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-[#111827]">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#6B7280]" />
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-[#D6D9E3] bg-white py-[14px] pl-11 pr-[18px] text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-[#111827]">
                Password
              </label>
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full rounded-xl border border-[#D6D9E3] bg-white px-[18px] py-[14px] text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827]"
                >
                  {showPassword ? <Eye className="h-[18px] w-[18px]" /> : <EyeOff className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="signup-confirm" className="mb-1.5 block text-sm font-medium text-[#111827]">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="signup-confirm"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full rounded-xl border border-[#D6D9E3] bg-white px-[18px] py-[14px] text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827]"
                >
                  {showConfirmPassword ? <Eye className="h-[18px] w-[18px]" /> : <EyeOff className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            {/* Username (optional) */}
            <div>
              <label htmlFor="signup-username" className="mb-1.5 block text-sm font-medium text-[#111827]">
                Username <span className="font-normal text-[#9CA3AF]">(optional)</span>
              </label>
              <div className="relative">
                <AtSign className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#6B7280]" />
                <input
                  id="signup-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  className="w-full rounded-xl border border-[#D6D9E3] bg-white py-[14px] pl-11 pr-[18px] text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
                />
              </div>
            </div>

            {/* Terms checkbox */}
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#D6D9E3] text-[#059669] focus:ring-[#059669]"
              />
              <span className="text-sm text-[#6B7280]">
                I agree to the{' '}
                <span className="font-medium text-[#059669] hover:text-[#047857] cursor-pointer">
                  Terms of Service
                </span>{' '}
                and{' '}
                <span className="font-medium text-[#059669] hover:text-[#047857] cursor-pointer">
                  Privacy Policy
                </span>
              </span>
            </label>

            {/* Create Account button */}
            <button
              type="submit"
              disabled={!termsAccepted}
              className="w-full rounded-xl bg-gradient-to-br from-[#059669] to-[#10B981] py-[14px] text-sm font-semibold text-white shadow-[0_4px_16px_#05966930] transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Account
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#D6D9E3]" />
            <span className="text-xs text-[#6B7280]">or</span>
            <div className="h-px flex-1 bg-[#D6D9E3]" />
          </div>

          {/* Social buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#D6D9E3] bg-white py-[12px] text-sm font-medium text-[#111827] transition hover:bg-[#F3F4F9]"
            >
              <Wallet className="h-[18px] w-[18px]" />
              Wallet
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#111827] py-[12px] text-sm font-medium text-white transition hover:bg-[#1f2937]"
            >
              <span className="text-base font-bold leading-none">&#120143;</span>
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#D6D9E3] bg-white py-[12px] text-sm font-medium text-[#111827] transition hover:bg-[#F3F4F9]"
            >
              <span className="text-base font-bold text-[#4285F4]">G</span>
              Google
            </button>
          </div>

          {/* Sign in link */}
          <p className="mt-6 text-center text-sm text-[#6B7280]">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-[#059669] hover:text-[#047857]">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

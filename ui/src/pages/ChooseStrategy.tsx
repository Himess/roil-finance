import { Link } from 'react-router-dom';

function ProgressBar({ filled }: { filled: number }) {
  return (
    <div className="flex gap-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex-1 h-1.5 rounded-full"
          style={{
            backgroundColor: i < filled ? undefined : '#D6D9E3',
            background: i < filled ? 'linear-gradient(90deg, #059669, #10B981)' : undefined,
          }}
        />
      ))}
    </div>
  );
}

export default function ChooseStrategy() {
  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="mb-5">
        <p className="text-[14px] font-semibold text-[#059669] mb-1">Step 1 of 5</p>
        <h1 className="text-[30px] font-bold text-[#111827] leading-tight">
          Choose a Strategy
        </h1>
        <p className="text-[15px] text-[#6B7280] mt-1">
          Start with a proven template or design your own allocation from scratch.
        </p>
      </div>

      <ProgressBar filled={1} />

      {/* Two cards side by side — fill remaining space */}
      <div className="grid grid-cols-2 gap-6 mt-7 flex-1 min-h-0">
        {/* LEFT — Ready Strategy */}
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-2xl p-8 flex flex-col items-center justify-center text-center">
          <img
            src="/first_portfolio.png"
            alt="Ready Strategy"
            className="w-[220px] h-[220px] object-contain mb-6"
          />

          <h2 className="text-[28px] font-bold text-[#111827] mb-2">
            Use a Ready Strategy
          </h2>
          <p className="text-[15px] text-[#6B7280] mb-5 max-w-[340px]">
            Choose from proven portfolio templates designed by experts.
          </p>

          {/* Pill tags */}
          <div className="flex flex-wrap gap-2 justify-center mb-7">
            <span className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-[#E0F5EA] text-[#059669]">
              6 templates
            </span>
            <span className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-[#E0F5EA] text-[#059669]">
              Auto-allocated
            </span>
            <span className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-[#E0F5EA] text-[#059669]">
              Quick start
            </span>
          </div>

          <Link
            to="/create/templates"
            className="inline-flex items-center gap-2 px-7 py-3 rounded-xl text-white font-semibold text-[15px]
                       bg-gradient-to-br from-[#059669] to-[#10B981] hover:opacity-90 transition-opacity shadow-md"
          >
            Browse Templates
          </Link>
        </div>

        {/* RIGHT — Build Your Own */}
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-2xl p-8 flex flex-col items-center justify-center text-center">
          <img
            src="/strategies/custom.png"
            alt="Custom Build"
            className="w-[220px] h-[220px] object-contain mb-6"
          />

          <h2 className="text-[28px] font-bold text-[#111827] mb-2">
            Build Your Own
          </h2>
          <p className="text-[15px] text-[#6B7280] mb-5 max-w-[340px]">
            Create a fully custom portfolio with your own token allocations.
          </p>

          {/* Pill tags */}
          <div className="flex flex-wrap gap-2 justify-center mb-7">
            <span className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-[#DBEAFE] text-[#2563EB]">
              Custom tokens
            </span>
            <span className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-[#FCE7F3] text-[#DB2777]">
              Manual weights
            </span>
            <span className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-[#F3E8FF] text-[#7C3AED]">
              Advanced
            </span>
          </div>

          <Link
            to="/create/build"
            className="inline-flex items-center gap-2 px-7 py-3 rounded-xl font-semibold text-[15px]
                       border-2 border-[#D6D9E3] text-[#111827] hover:border-[#9CA3AF] transition-colors bg-white"
          >
            Start from Scratch
          </Link>
        </div>
      </div>
    </div>
  );
}

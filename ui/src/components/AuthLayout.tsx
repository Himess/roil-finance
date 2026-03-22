import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, #E8EBF2 0%, #F0F1F6 50%, #ECEEF4 100%)',
      }}
    >
      {/* Subtle radial gradient circles */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          top: '-10%',
          left: '-5%',
          background: 'radial-gradient(circle, rgba(5,150,105,0.07) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: 500,
          height: 500,
          bottom: '-8%',
          right: '-3%',
          background: 'radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 70%)',
        }}
      />

      {/* Floating logo */}
      <img
        src="/logo.jpg"
        alt="Roil"
        className="w-16 h-16 rounded-2xl object-cover shadow-lg mb-8 relative z-10"
      />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

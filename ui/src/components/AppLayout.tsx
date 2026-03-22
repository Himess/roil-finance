import type { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import ProfileDropdown from '@/components/ProfileDropdown';
import { Wallet } from 'lucide-react';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />

      <div className="flex-1 flex flex-col" style={{ marginLeft: 72 }}>
        {/* Top bar */}
        <header className="flex items-center justify-end gap-3 px-8 shrink-0" style={{ height: 64 }}>
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold
                       bg-white border border-[#D6D9E3] text-[#111827] hover:bg-[#F3F4F9] hover:border-[#9CA3AF] transition-colors"
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
          <ProfileDropdown />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto px-8 pb-8">
          {children}
        </main>
      </div>
    </div>
  );
}

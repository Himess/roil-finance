import { NavLink, useLocation } from 'react-router-dom';
import { Wallet, Repeat2, Trophy, Clock, PieChart, HelpCircle } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/app/create', icon: Wallet },
  { to: '/app/portfolio', icon: PieChart },
  { to: '/app/dca', icon: Repeat2 },
  { to: '/app/rewards', icon: Trophy },
  { to: '/app/history', icon: Clock },
] as const;

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col items-center bg-white border-r border-[#D6D9E3] z-30 py-5"
      style={{ width: 72 }}
    >
      {/* Logo — click to go home */}
      <NavLink to="/app">
        <img
          src="/logo.jpg"
          alt="Roil"
          className="w-10 h-10 rounded-xl object-cover mb-6"
        />
      </NavLink>

      {/* Navigation */}
      <nav className="flex flex-col items-center gap-2 flex-1">
        {NAV_ITEMS.map(({ to, icon: Icon }) => {
          const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
          return (
            <NavLink
              key={to}
              to={to}
              className="flex items-center justify-center rounded-xl transition-colors"
              style={{ width: 44, height: 44 }}
            >
              <div
                className={`flex items-center justify-center w-full h-full rounded-xl transition-colors ${
                  isActive
                    ? 'bg-gradient-to-b from-[#059669] to-[#10B981] text-white'
                    : 'text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#ECEEF4]'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={2} />
              </div>
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom icons — Twitter + Help */}
      <div className="flex flex-col items-center gap-2 mb-1">
        <a
          href="https://x.com/RoilFinance"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-xl text-[#9CA3AF] hover:text-[#111827] hover:bg-[#ECEEF4] transition-colors"
          style={{ width: 44, height: 44 }}
          title="Follow us on X"
        >
          <XIcon className="w-[18px] h-[18px]" />
        </a>
        <a
          href="https://docs.roil.fi"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-xl text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#ECEEF4] transition-colors"
          style={{ width: 44, height: 44 }}
          title="Help & Docs"
        >
          <HelpCircle className="w-5 h-5" strokeWidth={2} />
        </a>
      </div>
    </aside>
  );
}

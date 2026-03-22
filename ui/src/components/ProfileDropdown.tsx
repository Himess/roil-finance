import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Settings, Moon, LogOut } from 'lucide-react';

export default function ProfileDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleNavigate(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div ref={ref} className="relative">
      {/* Avatar button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white text-sm font-semibold"
        style={{ width: 38, height: 38 }}
      >
        HK
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-2 bg-[#F3F4F9] rounded-xl shadow-lg border border-[#D6D9E3] py-2 z-50"
          style={{ width: 260 }}
        >
          {/* Profile section */}
          <div className="flex items-center gap-3 px-4 py-3">
            <div
              className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white text-base font-semibold flex-shrink-0"
              style={{ width: 44, height: 44 }}
            >
              HK
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#111827] truncate">
                Hime K.
              </div>
              <div className="text-xs text-[#9CA3AF] truncate">
                hime@roil.finance
              </div>
            </div>
          </div>

          {/* Menu items */}
          <DropdownItem icon={LayoutGrid} label="Dashboard" onClick={() => handleNavigate('/app')} />
          <DropdownItem icon={Settings} label="Settings" onClick={() => handleNavigate('/app/settings')} />
          <DropdownItem icon={Moon} label="Dark Mode" />

          {/* Divider */}
          <div className="my-1 border-t border-[#D6D9E3]" />

          {/* Log Out */}
          <DropdownItem icon={LogOut} label="Log Out" danger onClick={() => handleNavigate('/login')} />
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-2 text-sm transition-colors hover:bg-[#ECEEF4] ${
        danger ? 'text-[#E11D48]' : 'text-[#111827]'
      }`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

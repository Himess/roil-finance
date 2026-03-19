import { PORTFOLIO_TEMPLATES } from '@/config';
import clsx from 'clsx';
import TokenIcon from '@/components/TokenIcon';

interface TemplateSelectorProps {
  onSelect: (template: typeof PORTFOLIO_TEMPLATES[number]) => void;
}


export default function TemplateSelector({ onSelect }: TemplateSelectorProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-medium text-ink-secondary">Quick Start -- Choose a Strategy</h3>
      <div className="flex flex-col gap-6">
        {PORTFOLIO_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className={clsx(
              'card flex items-stretch justify-between py-8 px-8 gap-8 border-2 min-h-[120px] transition-all duration-200 cursor-pointer',
              'hover:shadow-md hover:-translate-y-0.5',
              'border-surface-border hover:border-ink-faint',
            )}
          >
            {/* Left: Name + Description (text-left) */}
            <div className="flex-1 min-w-0 text-left flex flex-col justify-center">
              <h4 className="text-2xl font-bold text-ink">{t.name}</h4>
              <p className="text-lg text-ink-secondary mt-2">{t.description}</p>
            </div>

            {/* Right: Tokens + Badge top, CTA bottom */}
            <div className="flex flex-col items-end justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {t.targets.map((target) => (
                    <TokenIcon key={target.asset.symbol} symbol={target.asset.symbol} size={40} showBadge={false} />
                  ))}
                </div>
              </div>
              <span className="text-lg font-semibold text-accent whitespace-nowrap mt-3">
                Use This Strategy →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

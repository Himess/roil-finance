import React, { type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import clsx from 'clsx';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: number; label: string };
  icon?: ReactNode;
  className?: string;
}

function StatsCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  className,
}: StatsCardProps) {
  const isPositive = trend && trend.value >= 0;

  return (
    <div className={clsx('card hover:shadow-sm transition-shadow duration-200', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-base text-ink-secondary font-medium">{title}</p>
          <p className="text-3xl font-extrabold text-ink mt-1">{value}</p>
          {subtitle && (
            <p className="text-sm text-ink-muted mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-full bg-accent-light flex items-center justify-center text-accent">
            {icon}
          </div>
        )}
      </div>

      {trend && (
        <div className="flex items-center gap-1.5 mt-3">
          {isPositive ? (
            <TrendingUp className="w-4 h-4 text-positive" />
          ) : (
            <TrendingDown className="w-4 h-4 text-negative" />
          )}
          <span
            className={clsx(
              'text-sm font-medium',
              isPositive ? 'text-positive' : 'text-negative',
            )}
          >
            {isPositive ? '+' : ''}
            {trend.value}%
          </span>
          <span className="text-sm text-ink-muted">{trend.label}</span>
        </div>
      )}
    </div>
  );
}

export default React.memo(StatsCard);

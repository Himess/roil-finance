import { useState } from 'react';
import { Wallet, Layout, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import TemplateSelector from './TemplateSelector';
import { PORTFOLIO_TEMPLATES } from '@/config';
import type { TargetAllocation, TriggerMode } from '@/types';

interface OnboardingWizardProps {
  walletConnected: boolean;
  onConnectWallet: () => void;
  onComplete: (targets: TargetAllocation[], triggerMode: TriggerMode) => void;
  onSkip: () => void;
}

const STEPS = ['Connect Wallet', 'Choose Strategy', 'Review & Confirm'];


export default function OnboardingWizard({ walletConnected, onConnectWallet, onComplete, onSkip }: OnboardingWizardProps) {
  const [step, setStep] = useState(walletConnected ? 1 : 0);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof PORTFOLIO_TEMPLATES[number] | null>(null);

  const handleTemplateSelect = (template: typeof PORTFOLIO_TEMPLATES[number]) => {
    setSelectedTemplate(template);
    setStep(2);
  };

  const handleConfirm = () => {
    if (!selectedTemplate) return;
    const targets: TargetAllocation[] = selectedTemplate.targets.map(t => ({
      asset: t.asset,
      targetPct: t.targetPct,
    }));
    const triggerMode: TriggerMode = {
      tag: 'DriftThreshold',
      value: Number(selectedTemplate.triggerMode.value),
    };
    onComplete(targets, triggerMode);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress steps */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={clsx(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
              i < step ? 'bg-accent text-white' :
              i === step ? 'bg-accent-light text-accent border border-accent' :
              'bg-surface-muted text-ink-muted'
            )}>
              {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            <span className={clsx('text-base font-medium hidden sm:inline', i === step ? 'text-ink' : 'text-ink-muted')}>{label}</span>
            {i < STEPS.length - 1 && <div className="w-8 h-0.5 bg-surface-border" />}
          </div>
        ))}
      </div>

      {/* Step 0: Connect Wallet */}
      {step === 0 && (
        <div className="card p-8 text-center">
          <Wallet className="w-12 h-12 text-accent mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-ink mb-2">Welcome to Canton Rebalancer</h2>
          <p className="text-base text-ink-secondary mb-6">
            Connect your Canton wallet to start managing your portfolio with automated rebalancing, DCA, and rewards.
          </p>
          <button onClick={onConnectWallet} className="btn-primary px-6 py-3 text-base">
            Connect Wallet
          </button>
          <button onClick={onSkip} className="block mx-auto mt-4 text-base text-ink-muted hover:text-ink">
            Skip -- explore with demo data
          </button>
        </div>
      )}

      {/* Step 1: Choose Strategy */}
      {step === 1 && (
        <div className="card p-6">
          <Layout className="w-8 h-8 text-accent mb-3" />
          <h2 className="text-xl font-bold text-ink mb-1">Choose Your Strategy</h2>
          <p className="text-base text-ink-secondary mb-6">
            Pick a pre-built portfolio strategy or skip to create your own.
          </p>
          <TemplateSelector onSelect={handleTemplateSelect} />
          <div className="flex justify-between mt-6">
            <button onClick={() => setStep(0)} className="text-base text-ink-secondary hover:text-ink flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={onSkip} className="text-base text-ink-muted hover:text-ink">
              Skip -- I'll set up manually
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review & Confirm */}
      {step === 2 && selectedTemplate && (
        <div className="card p-6">
          <CheckCircle className="w-8 h-8 text-positive mb-3" />
          <h2 className="text-xl font-bold text-ink mb-1">Review Your Strategy</h2>
          <p className="text-base text-ink-secondary mb-6">
            Confirm your portfolio allocation and start rebalancing.
          </p>

          <div className="bg-surface-muted rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-semibold text-ink">{selectedTemplate.name}</span>
            </div>
            <div className="space-y-2">
              {selectedTemplate.targets.map(t => (
                <div key={t.asset.symbol} className="flex justify-between text-sm">
                  <span className="text-ink">{t.asset.symbol}</span>
                  <span className="text-ink font-medium">{t.targetPct}%</span>
                </div>
              ))}
            </div>
            <div className="border-t border-surface-border mt-3 pt-3 text-sm text-ink-muted">
              Auto-rebalance when drift exceeds {selectedTemplate.triggerMode.value}%
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => { setSelectedTemplate(null); setStep(1); }} className="text-base text-ink-secondary hover:text-ink flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> Change Strategy
            </button>
            <button onClick={handleConfirm} className="btn-primary flex items-center gap-2">
              Create Portfolio <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Roil (Canton Private Rebalancer) — Pitch Deck Slides
// Self-contained React component with inline styles. No external CSS.
// ---------------------------------------------------------------------------

const TOTAL_SLIDES = 11;

const C = {
  bg: '#0a0e17',
  cardBlue: 'rgba(37,99,235,0.06)',
  accent: '#2563EB',
  accentLight: 'rgba(37,99,235,0.15)',
  text: '#e8ecf1',
  muted: '#7a8494',
  positive: '#22c55e',
  positiveLight: 'rgba(34,197,94,0.10)',
  warning: '#eab308',
  warningLight: 'rgba(234,179,8,0.10)',
  danger: '#ef4444',
  dangerLight: 'rgba(239,68,68,0.08)',
  border: 'rgba(37,99,235,0.12)',
  cardBg: 'rgba(255,255,255,0.03)',
  white: '#ffffff',
};

const baseSlide: React.CSSProperties = {
  width: '100%',
  maxWidth: 1200,
  margin: '0 auto',
  padding: '48px 64px',
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  color: C.text,
};

const titleStyle: React.CSSProperties = {
  fontSize: 48,
  fontWeight: 800,
  letterSpacing: '-0.03em',
  lineHeight: 1.1,
  margin: 0,
  color: C.white,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 500,
  color: C.accent,
  margin: '12px 0 0',
  letterSpacing: '-0.01em',
};

const bodyText: React.CSSProperties = {
  fontSize: 18,
  lineHeight: 1.6,
  color: C.text,
  margin: '24px 0 0',
};

const cardGrid = (cols: number): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${cols}, 1fr)`,
  gap: 20,
  marginTop: 32,
});

const card: React.CSSProperties = {
  background: C.cardBlue,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: '24px 28px',
};

const cardTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: C.accent,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  margin: '0 0 8px',
};

const cardValue: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: C.white,
  margin: 0,
};

const cardDesc: React.CSSProperties = {
  fontSize: 14,
  color: C.muted,
  margin: '6px 0 0',
  lineHeight: 1.5,
};

const alertBox = (color: string, bgColor: string): React.CSSProperties => ({
  background: bgColor,
  border: `1px solid ${color}`,
  borderRadius: 12,
  padding: '20px 28px',
  marginTop: 32,
  fontSize: 16,
  lineHeight: 1.6,
  color,
});

const badge: React.CSSProperties = {
  display: 'inline-block',
  background: C.accentLight,
  color: C.accent,
  padding: '6px 16px',
  borderRadius: 100,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.04em',
  marginBottom: 20,
};

const tokenCircle = (color: string): React.CSSProperties => ({
  width: 44,
  height: 44,
  borderRadius: '50%',
  background: color,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 800,
  color: '#fff',
  flexShrink: 0,
});

const flowArrow: React.CSSProperties = {
  fontSize: 24,
  color: C.accent,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

// ── Slide Components ────────────────────────────────────────────────────────

function Slide1() {
  return (
    <div style={baseSlide}>
      <div style={badge}>THE PRIVACY PROBLEM</div>
      <h1 style={titleStyle}>On EVM, Everyone Sees{' '}
        <span style={{ color: C.danger }}>Your Portfolio</span>
      </h1>
      <p style={subtitleStyle}>The Privacy Problem in DeFi Portfolio Management</p>
      <p style={bodyText}>
        On Ethereum, Base, and every EVM chain, all holdings, trades, and strategies are fully public.
        Every wallet balance is queryable. Every swap is indexed. Your alpha is everyone's alpha.
      </p>

      <div style={cardGrid(3)}>
        <div style={card}>
          <p style={cardTitle}>Total Value Locked</p>
          <p style={cardValue}>$150B+</p>
          <p style={cardDesc}>TVL in DeFi protocols across EVM chains</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Portfolio Rebalancers</p>
          <p style={cardValue}>Glider, Shrimpy, 3Commas</p>
          <p style={cardDesc}>All operate on public blockchains with zero privacy</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>The Problem</p>
          <p style={{ ...cardValue, fontSize: 22, color: C.danger }}>Every Rebalance is Front-Runnable</p>
          <p style={cardDesc}>MEV bots extract $1B+/year from DeFi users</p>
        </div>
      </div>

      <div style={alertBox(C.danger, C.dangerLight)}>
        <strong>Competitors copy your alpha.</strong> MEV bots front-run your trades.{' '}
        <strong>Everyone sees your strategy.</strong> On EVM, privacy is an afterthought&mdash;if it exists at all.
      </div>
    </div>
  );
}

function Slide2() {
  const features = [
    { title: 'Private Treasury', desc: 'Your treasury allocations, trade sizes, and strategies are invisible to everyone. Canton\'s sub-transaction privacy means even counterparties see only their part.', icon: '\u{1F512}' },
    { title: 'Smart Order Routing', desc: 'Cantex AMM + Temple Orderbook. Best price across Canton DEXes, every time.', icon: '\u{1F500}' },
    { title: 'Auto-Compound', desc: '3 yield strategies: Simple Earn, LP Yield, and Staking Rewards. Compounded automatically.', icon: '\u{1F4C8}' },
    { title: 'DCA Engine', desc: 'Dollar-cost average hourly, daily, weekly, or monthly. Fully automated, fully private.', icon: '\u{23F0}' },
  ];
  return (
    <div style={baseSlide}>
      <div style={badge}>THE SOLUTION</div>
      <h1 style={titleStyle}>
        <span style={{ color: C.accent }}>Roil</span> &mdash; Private Treasury Management
      </h1>
      <p style={subtitleStyle}>For Individuals AND Institutions &middot; Built on Canton Network</p>
      <p style={bodyText}>
        Roil is a privacy-first treasury management platform on Canton Network. Whether you're an individual
        managing your crypto portfolio or an institution handling tokenized assets &mdash; Roil automates allocation,
        rebalancing, and yield optimization while keeping your strategy completely private.
      </p>

      <div style={cardGrid(2)}>
        {features.map((f) => (
          <div key={f.title} style={{ ...card, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 32, lineHeight: 1 }}>{f.icon}</div>
            <div>
              <p style={{ ...cardTitle, color: C.white, textTransform: 'none', letterSpacing: 0, fontSize: 17 }}>{f.title}</p>
              <p style={cardDesc}>{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={alertBox(C.positive, C.positiveLight)}>
        <strong>All trades private.</strong> Sub-transaction privacy. <strong>Only YOU see your strategy.</strong>
      </div>
    </div>
  );
}

function SlideWhoIsRoilFor() {
  const individualItems = [
    'Passive portfolio management without revealing your strategy',
    'DCA into crypto + gold + bonds automatically',
    'Earn CC rewards for every rebalance',
    '8 pre-built strategies or build your own',
  ];
  const institutionalItems = [
    'Private treasury management for DAOs, funds, and corporates',
    'CIP-0056 compliant for regulated assets',
    'Atomic settlement \u2014 no partial execution risk',
    'KYC-compatible via Canton\u2019s privacy model',
  ];

  return (
    <div style={baseSlide}>
      <div style={badge}>TARGET MARKET</div>
      <h1 style={titleStyle}>Who Is <span style={{ color: C.accent }}>Roil</span> For?</h1>
      <p style={subtitleStyle}>From Retail to Institutional</p>

      <div style={cardGrid(2)}>
        <div style={{ ...card, padding: '32px 28px' }}>
          <p style={{ ...cardTitle, fontSize: 18, marginBottom: 16, color: C.accent }}>Individual Investors</p>
          <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc' }}>
            {individualItems.map((item) => (
              <li key={item} style={{ fontSize: 15, color: C.text, lineHeight: 2 }}>{item}</li>
            ))}
          </ul>
        </div>
        <div style={{ ...card, padding: '32px 28px', borderColor: C.warning }}>
          <p style={{ ...cardTitle, fontSize: 18, marginBottom: 16, color: C.warning }}>Institutions & Treasuries</p>
          <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc' }}>
            {institutionalItems.map((item) => (
              <li key={item} style={{ fontSize: 15, color: C.text, lineHeight: 2 }}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{
        marginTop: 32,
        textAlign: 'center' as const,
        padding: '20px 32px',
        background: C.cardBg,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
      }}>
        <p style={{ margin: 0, fontSize: 16, color: C.muted, fontWeight: 600, lineHeight: 1.6 }}>
          <span style={{ color: C.accent, fontWeight: 700 }}>Today:</span> Individual portfolios on devnet.{' '}
          <span style={{ color: C.warning, fontWeight: 700 }}>Tomorrow:</span> Institutional treasury management with real-world assets on mainnet.
        </p>
      </div>
    </div>
  );
}

function Slide3() {
  const steps = [
    { num: '1', title: 'Choose Strategy', desc: '8 templates or fully custom allocation' },
    { num: '2', title: 'Set Allocations', desc: '9 tokens: crypto + RWA assets' },
    { num: '3', title: 'Auto-Rebalance', desc: 'Drift threshold triggers rebalance' },
    { num: '4', title: 'Smart Router', desc: 'Best price across Canton DEXes' },
    { num: '5', title: 'Earn Rewards', desc: 'CC fee rebates for every trade' },
  ];
  return (
    <div style={baseSlide}>
      <div style={badge}>HOW IT WORKS</div>
      <h1 style={titleStyle}>How <span style={{ color: C.accent }}>Roil</span> Works</h1>
      <p style={subtitleStyle}>From Strategy to Execution</p>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, marginTop: 40 }}>
        {steps.map((s, i) => (
          <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              ...card,
              flex: 1,
              textAlign: 'center' as const,
              display: 'flex',
              flexDirection: 'column' as const,
              alignItems: 'center',
              padding: '28px 16px',
              minHeight: 160,
              justifyContent: 'flex-start',
            }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: C.accent,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 20,
                marginBottom: 12,
              }}>
                {s.num}
              </div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: C.white }}>{s.title}</p>
              <p style={{ ...cardDesc, textAlign: 'center' as const, marginTop: 8 }}>{s.desc}</p>
            </div>
            {i < steps.length - 1 && (
              <div style={flowArrow}>&rarr;</div>
            )}
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 40,
        textAlign: 'center' as const,
        padding: '20px 32px',
        background: C.cardBg,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
      }}>
        <p style={{ margin: 0, fontSize: 18, color: C.muted, fontWeight: 600 }}>
          Everything <span style={{ color: C.accent }}>on-ledger</span>.{' '}
          Everything <span style={{ color: C.accent }}>private</span>.{' '}
          Everything <span style={{ color: C.accent }}>auditable</span>.
        </p>
      </div>
    </div>
  );
}

function Slide4() {
  const rows = [
    { feature: 'Portfolio visibility', canton: 'Private', evm: 'Public', cantonGood: true },
    { feature: 'Trade privacy', canton: 'Sub-tx privacy', evm: 'Fully exposed', cantonGood: true },
    { feature: 'Front-running', canton: 'Impossible', evm: '$1B+ MEV/year', cantonGood: true },
    { feature: 'Token standard', canton: 'CIP-0056 institutional', evm: 'ERC-20 basic', cantonGood: true },
    { feature: 'Settlement', canton: 'Atomic multi-step', evm: 'Sequential', cantonGood: true },
    { feature: 'Smart contracts', canton: 'Daml formal verification', evm: 'Solidity', cantonGood: true },
  ];

  const cellBase: React.CSSProperties = {
    padding: '16px 24px',
    fontSize: 15,
    borderBottom: `1px solid ${C.border}`,
  };

  return (
    <div style={baseSlide}>
      <div style={badge}>CANTON ADVANTAGE</div>
      <h1 style={titleStyle}>Why <span style={{ color: C.accent }}>Canton Network</span>?</h1>
      <p style={subtitleStyle}>What EVM Can't Do</p>

      <div style={{
        marginTop: 36,
        borderRadius: 16,
        overflow: 'hidden',
        border: `1px solid ${C.border}`,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...cellBase, textAlign: 'left', color: C.muted, fontWeight: 600, background: 'rgba(37,99,235,0.03)' }}>Feature</th>
              <th style={{ ...cellBase, textAlign: 'center', color: C.accent, fontWeight: 700, background: 'rgba(37,99,235,0.03)' }}>Canton</th>
              <th style={{ ...cellBase, textAlign: 'center', color: C.muted, fontWeight: 700, background: 'rgba(37,99,235,0.03)' }}>EVM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.feature}>
                <td style={{ ...cellBase, fontWeight: 600, color: C.text }}>{r.feature}</td>
                <td style={{ ...cellBase, textAlign: 'center', color: C.positive, fontWeight: 600 }}>{r.canton}</td>
                <td style={{ ...cellBase, textAlign: 'center', color: C.danger, fontWeight: 500 }}>{r.evm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        marginTop: 32,
        textAlign: 'center' as const,
        padding: '18px 32px',
        background: C.accentLight,
        borderRadius: 12,
        border: `1px solid ${C.accent}`,
      }}>
        <p style={{ margin: 0, fontSize: 17, color: C.accent, fontWeight: 700 }}>
          Privacy by design, not by workaround.
        </p>
      </div>
    </div>
  );
}

function Slide5() {
  const columns = [
    {
      label: 'Crypto',
      tokens: [
        { symbol: 'CC', color: '#2563EB', name: 'Canton Coin' },
        { symbol: 'CBTC', color: '#f7931a', name: 'Canton BTC' },
        { symbol: 'ETHx', color: '#627eea', name: 'Ethereum' },
        { symbol: 'SOLx', color: '#9945ff', name: 'Solana' },
      ],
    },
    {
      label: 'Stablecoin',
      tokens: [
        { symbol: 'USDCx', color: '#2775ca', name: 'USD Coin' },
      ],
    },
    {
      label: 'Real World Assets',
      tokens: [
        { symbol: 'XAUt', color: '#d4a017', name: 'Gold' },
        { symbol: 'XAGt', color: '#a8a8a8', name: 'Silver' },
        { symbol: 'USTb', color: '#1a5276', name: 'US Treasury' },
        { symbol: 'MMF', color: '#16a085', name: 'Money Market' },
      ],
    },
  ];

  return (
    <div style={baseSlide}>
      <div style={badge}>SUPPORTED ASSETS</div>
      <h1 style={titleStyle}><span style={{ color: C.accent }}>9</span> Tokenized Assets</h1>
      <p style={subtitleStyle}>Crypto Today &middot; Gold, Silver, Bonds Tomorrow</p>

      <div style={cardGrid(3)}>
        {columns.map((col) => (
          <div key={col.label} style={{ ...card, padding: '28px 24px' }}>
            <p style={{ ...cardTitle, marginBottom: 20 }}>{col.label}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {col.tokens.map((t) => (
                <div key={t.symbol} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={tokenCircle(t.color)}>{t.symbol.slice(0, 2)}</div>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: C.white }}>{t.symbol}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>{t.name}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The RWA Opportunity */}
      <div style={{
        marginTop: 24,
        padding: '20px 24px',
        background: C.warningLight,
        border: `1px solid rgba(234,179,8,0.2)`,
        borderRadius: 12,
      }}>
        <div style={{ fontSize: 14, color: C.warning, textTransform: 'uppercase' as const, letterSpacing: 0.5, fontWeight: 700, marginBottom: 8 }}>
          The RWA Opportunity
        </div>
        <p style={{ fontSize: 16, color: C.text, lineHeight: 1.6, margin: 0 }}>
          Canton mainnet already has <span style={{ color: C.warning, fontWeight: 700 }}>CC, USDCx, and CBTC</span> live today.
          As tokenized gold (XAUt), silver (XAGt), US Treasury bonds (USTb), and money market funds go live on Canton,
          Roil becomes the <span style={{ color: C.warning, fontWeight: 700 }}>first platform</span> where users can
          build portfolios mixing crypto AND real-world assets &mdash; all with privacy.
        </p>
        <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
          <div style={{ fontSize: 14, color: C.muted }}>
            <span style={{ color: C.positive, fontWeight: 700 }}>$388B</span> tokenized on Canton today
          </div>
          <div style={{ fontSize: 14, color: C.muted }}>
            <span style={{ color: C.positive, fontWeight: 700 }}>$350B/day</span> US Treasury activity via DTCC
          </div>
          <div style={{ fontSize: 14, color: C.muted }}>
            <span style={{ color: C.positive, fontWeight: 700 }}>$8T/month</span> repo transactions (Broadridge)
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 32,
        textAlign: 'center' as const,
        padding: '18px 32px',
        background: C.cardBg,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
      }}>
        <p style={{ margin: 0, fontSize: 16, color: C.muted, fontWeight: 600 }}>
          First portfolio rebalancer with tokenized <span style={{ color: '#d4a017' }}>gold</span>,{' '}
          <span style={{ color: '#a8a8a8' }}>silver</span>, and{' '}
          <span style={{ color: '#1a5276' }}>US Treasury bonds</span>
        </p>
      </div>
    </div>
  );
}

function Slide6() {
  return (
    <div style={baseSlide}>
      <div style={badge}>SMART ORDER ROUTER</div>
      <h1 style={titleStyle}>Best Price, <span style={{ color: C.accent }}>Every Time</span></h1>
      <p style={subtitleStyle}>Canton DEX Aggregator</p>

      <div style={cardGrid(2)}>
        <div style={{ ...card, borderColor: C.accent }}>
          <p style={{ ...cardTitle, fontSize: 18, marginBottom: 12 }}>Cantex</p>
          <p style={{ ...cardValue, fontSize: 22 }}>AMM</p>
          <p style={cardDesc}>
            Automated Market Maker. Constant-product pools. Best for larger trades with deep liquidity.
          </p>
        </div>
        <div style={{ ...card, borderColor: C.accent }}>
          <p style={{ ...cardTitle, fontSize: 18, marginBottom: 12 }}>Temple</p>
          <p style={{ ...cardValue, fontSize: 22 }}>Orderbook</p>
          <p style={cardDesc}>
            Limit order book. Best for precise pricing and smaller trades with tight spreads.
          </p>
        </div>
      </div>

      {/* Flow visual */}
      <div style={{
        marginTop: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '28px 24px',
        background: C.cardBg,
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        flexWrap: 'wrap' as const,
      }}>
        {[
          { label: 'Your Trade', bg: 'rgba(255,255,255,0.06)' },
          null,
          { label: 'Smart Router', bg: C.accentLight },
          null,
          { label: 'Cantex Quote', bg: 'rgba(37,99,235,0.06)' },
          null,
          { label: 'Temple Quote', bg: 'rgba(37,99,235,0.06)' },
          null,
          { label: 'Best Price Wins', bg: C.positiveLight },
        ].map((item, i) =>
          item === null ? (
            <div key={`arrow-${i}`} style={flowArrow}>&rarr;</div>
          ) : (
            <div key={item.label} style={{
              background: item.bg,
              padding: '14px 22px',
              borderRadius: 12,
              fontWeight: 700,
              fontSize: 14,
              color: item.label === 'Best Price Wins' ? C.positive : C.white,
              border: `1px solid ${C.border}`,
              whiteSpace: 'nowrap' as const,
            }}>
              {item.label}
            </div>
          )
        )}
      </div>

      <div style={cardGrid(3)}>
        <div style={{ ...card, textAlign: 'center' as const }}>
          <p style={cardTitle}>Platform Fee</p>
          <p style={cardValue}>0.1%</p>
        </div>
        <div style={{ ...card, textAlign: 'center' as const }}>
          <p style={cardTitle}>Slippage Protection</p>
          <p style={{ ...cardValue, fontSize: 20 }}>Pre-Swap Check</p>
        </div>
        <div style={{ ...card, textAlign: 'center' as const }}>
          <p style={cardTitle}>Token Standard</p>
          <p style={{ ...cardValue, fontSize: 20 }}>CIP-0056</p>
        </div>
      </div>
    </div>
  );
}

function Slide7() {
  const templates = [
    { name: 'Conservative', alloc: '50% USDCx, 20% USTb, 15% XAUt, 15% CC', color: '#2775ca' },
    { name: 'Balanced Growth', alloc: '30% CC, 25% CBTC, 20% ETHx, 15% USDCx, 10% XAUt', color: '#2563EB' },
    { name: 'BTC-ETH Maxi', alloc: '45% CBTC, 35% ETHx, 20% CC', color: '#f7931a' },
    { name: 'Crypto Basket', alloc: '25% CC, 25% CBTC, 25% ETHx, 25% SOLx', color: '#627eea' },
    { name: 'Precious Metals', alloc: '45% XAUt, 30% XAGt, 25% USDCx', color: '#d4a017' },
    { name: 'Institutional Grade', alloc: '35% USTb, 25% MMF, 20% XAUt, 20% USDCx', color: '#1a5276' },
    { name: 'Stablecoin Yield', alloc: '60% USDCx, 25% USTb, 15% MMF', color: '#16a085' },
    { name: 'All Weather', alloc: '20% CC, 15% CBTC, 15% ETHx, 15% USDCx, 15% XAUt, 10% USTb, 10% MMF', color: '#9945ff' },
  ];

  return (
    <div style={baseSlide}>
      <div style={badge}>PORTFOLIO TEMPLATES</div>
      <h1 style={titleStyle}><span style={{ color: C.accent }}>8</span> Pre-Built Strategies</h1>
      <p style={subtitleStyle}>From Conservative to All Weather</p>

      <div style={cardGrid(4)}>
        {templates.map((t) => (
          <div key={t.name} style={{
            ...card,
            padding: '20px 18px',
            borderTop: `3px solid ${t.color}`,
          }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 15, color: C.white }}>{t.name}</p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{t.alloc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Slide8() {
  const stats = [
    { label: 'Lines of Code', value: '20,000+' },
    { label: 'Automated Tests', value: '240+' },
    { label: 'Daml Modules', value: '6' },
    { label: 'Backend Test Files', value: '17' },
  ];

  const stack = [
    'Daml 3.4.11',
    'TypeScript / Express',
    'React 19',
    'Cantex + Temple DEX',
    'CIP-0056',
    'Prometheus / Grafana',
  ];

  return (
    <div style={baseSlide}>
      <div style={badge}>TECH STACK</div>
      <h1 style={titleStyle}>Production-Grade <span style={{ color: C.accent }}>Architecture</span></h1>
      <p style={subtitleStyle}>Not a Hackathon Project</p>

      <div style={cardGrid(4)}>
        {stats.map((s) => (
          <div key={s.label} style={{ ...card, textAlign: 'center' as const }}>
            <p style={cardValue}>{s.value}</p>
            <p style={{ ...cardDesc, marginTop: 8 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div style={{ ...card, marginTop: 28, padding: '28px 32px' }}>
        <p style={{ ...cardTitle, marginBottom: 16 }}>Technology Stack</p>
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 12 }}>
          {stack.map((s) => (
            <div key={s} style={{
              background: C.accentLight,
              color: C.accent,
              padding: '8px 18px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
            }}>
              {s}
            </div>
          ))}
        </div>
      </div>

      <div style={{
        marginTop: 28,
        padding: '20px 28px',
        background: C.cardBg,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
      }}>
        <p style={{ ...cardTitle, marginBottom: 8 }}>Security</p>
        <p style={{ margin: 0, fontSize: 15, color: C.muted, lineHeight: 1.7 }}>
          <span style={{ color: C.text, fontWeight: 600 }}>JWT RS256/ES256</span> &middot;{' '}
          <span style={{ color: C.text, fontWeight: 600 }}>Circuit Breaker</span> &middot;{' '}
          <span style={{ color: C.text, fontWeight: 600 }}>Rate Limiting</span> &middot;{' '}
          <span style={{ color: C.text, fontWeight: 600 }}>Graceful Shutdown</span>
        </p>
      </div>
    </div>
  );
}

function Slide9() {
  const phases = [
    {
      label: 'Phase 1',
      time: 'Now',
      title: 'Devnet',
      items: ['DAR deploy to Canton devnet', 'Cantex integration test', 'GSF registration'],
      color: C.accent,
      active: true,
    },
    {
      label: 'Phase 2',
      time: 'Q2 2026',
      title: 'Testnet',
      items: ['Stop-loss / take-profit', 'Multi-portfolio support', 'Real yield strategies'],
      color: C.positive,
      active: false,
    },
    {
      label: 'Phase 3',
      time: 'Q3 2026',
      title: 'Mainnet',
      items: ['Cross-chain via CCIP', 'Compliance module', 'Copy trading'],
      color: C.warning,
      active: false,
    },
    {
      label: 'Phase 4',
      time: 'Q4 2026+',
      title: 'Growth',
      items: ['AI portfolio optimization', 'Institutional dashboards', 'DAO governance'],
      color: '#a855f7',
      active: false,
    },
  ];

  return (
    <div style={baseSlide}>
      <div style={badge}>ROADMAP</div>
      <h1 style={titleStyle}>Roadmap</h1>
      <p style={subtitleStyle}>From Devnet to Institutional Scale</p>

      {/* Timeline bar */}
      <div style={{ position: 'relative', marginTop: 48 }}>
        <div style={{
          position: 'absolute',
          top: 24,
          left: 0,
          right: 0,
          height: 4,
          background: C.border,
          borderRadius: 2,
        }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, position: 'relative' }}>
          {phases.map((p) => (
            <div key={p.label}>
              {/* Dot on timeline */}
              <div style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: p.active ? p.color : C.cardBg,
                border: `3px solid ${p.color}`,
                margin: '16px auto 24px',
                boxShadow: p.active ? `0 0 16px ${p.color}` : 'none',
              }} />
              <div style={{
                ...card,
                borderTop: `3px solid ${p.color}`,
                padding: '20px 18px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: p.color, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{p.label}</span>
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{p.time}</span>
                </div>
                <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 17, color: C.white }}>{p.title}</p>
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {p.items.map((item) => (
                    <li key={item} style={{ fontSize: 13, color: C.muted, lineHeight: 1.8 }}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Slide10() {
  const actions = [
    { title: 'Apply for Devnet Access', desc: 'Get early access to Canton devnet and start building', link: '#' },
    { title: 'Cantex API Integration', desc: 'Connect to Cantex AMM for liquidity and swaps', link: '#' },
    { title: 'GSF Featured App', desc: 'Register as a Global Synchronizer Featured Application', link: '#' },
  ];

  return (
    <div style={baseSlide}>
      <div style={badge}>LET'S BUILD</div>
      <h1 style={titleStyle}>
        Let's Build the Future of{' '}
        <span style={{ color: C.accent }}>Private Treasury Management</span>
      </h1>
      <p style={subtitleStyle}>Canton Network's First Portfolio Rebalancer</p>
      <p style={{ fontSize: 16, color: C.muted, marginTop: 8, fontWeight: 600 }}>
        First Canton app to combine portfolio rebalancing + DCA + auto-compound + RWA support
      </p>

      <div style={cardGrid(3)}>
        {actions.map((a) => (
          <div key={a.title} style={{
            ...card,
            textAlign: 'center' as const,
            padding: '32px 24px',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}>
            <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 17, color: C.white }}>{a.title}</p>
            <p style={{ ...cardDesc, margin: 0 }}>{a.desc}</p>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 36,
        display: 'flex',
        justifyContent: 'center',
        gap: 24,
        flexWrap: 'wrap' as const,
      }}>
        {[
          { label: 'GitHub', url: 'https://github.com' },
          { label: 'Canton Network', url: 'https://canton.network' },
          { label: 'Devnet Application', url: 'https://canton.network/devnet' },
        ].map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: C.accent,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: 'none',
              padding: '10px 24px',
              border: `1px solid ${C.accent}`,
              borderRadius: 8,
              transition: 'background 0.2s',
            }}
          >
            {link.label}
          </a>
        ))}
      </div>

      <div style={{
        marginTop: 48,
        textAlign: 'center' as const,
        padding: '24px 32px',
        background: C.accentLight,
        borderRadius: 16,
        border: `1px solid ${C.accent}`,
      }}>
        <p style={{ margin: 0, fontSize: 20, color: C.white, fontWeight: 700 }}>
          Built with <span style={{ color: C.accent }}>Daml</span>.{' '}
          Powered by <span style={{ color: C.accent }}>Canton</span>.{' '}
          Privacy by default.
        </p>
      </div>
    </div>
  );
}

// ── Slide Registry ──────────────────────────────────────────────────────────

const SLIDES = [Slide1, Slide2, SlideWhoIsRoilFor, Slide3, Slide4, Slide5, Slide6, Slide7, Slide8, Slide9, Slide10];

// ── Main Component ──────────────────────────────────────────────────────────

export default function Slides() {
  const [current, setCurrent] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goNext = useCallback(() => setCurrent((c) => Math.min(c + 1, TOTAL_SLIDES - 1)), []);
  const goPrev = useCallback(() => setCurrent((c) => Math.max(c - 1, 0)), []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Home') { e.preventDefault(); setCurrent(0); }
      if (e.key === 'End') { e.preventDefault(); setCurrent(TOTAL_SLIDES - 1); }
      if (e.key === 'Escape') { setAutoPlay(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  // Auto-progress
  useEffect(() => {
    if (autoPlay) {
      autoRef.current = setInterval(() => {
        setCurrent((c) => {
          if (c >= TOTAL_SLIDES - 1) {
            setAutoPlay(false);
            return c;
          }
          return c + 1;
        });
      }, 8000);
    }
    return () => {
      if (autoRef.current) clearInterval(autoRef.current);
    };
  }, [autoPlay]);

  const SlideComponent = SLIDES[current];

  const navBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: C.text,
    fontSize: 20,
    transition: 'background 0.15s',
  };

  const navBtnDisabled: React.CSSProperties = {
    ...navBtn,
    opacity: 0.3,
    cursor: 'default',
  };

  return (
    <div style={{
      background: C.bg,
      minHeight: '100vh',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Slide content */}
      <SlideComponent />

      {/* Bottom navigation bar */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '14px 24px',
        background: 'rgba(10,14,23,0.92)',
        backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`,
        zIndex: 100,
      }}>
        {/* Prev */}
        <button
          onClick={goPrev}
          disabled={current === 0}
          style={current === 0 ? navBtnDisabled : navBtn}
          aria-label="Previous slide"
        >
          &#8592;
        </button>

        {/* Slide dots */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              style={{
                width: i === current ? 28 : 10,
                height: 10,
                borderRadius: 5,
                background: i === current ? C.accent : 'rgba(255,255,255,0.15)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                padding: 0,
              }}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Counter */}
        <span style={{ fontSize: 14, color: C.muted, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'center' }}>
          {current + 1} / {TOTAL_SLIDES}
        </span>

        {/* Next */}
        <button
          onClick={goNext}
          disabled={current === TOTAL_SLIDES - 1}
          style={current === TOTAL_SLIDES - 1 ? navBtnDisabled : navBtn}
          aria-label="Next slide"
        >
          &#8594;
        </button>

        {/* Auto-play toggle */}
        <button
          onClick={() => setAutoPlay((a) => !a)}
          style={{
            ...navBtn,
            fontSize: 14,
            fontWeight: 700,
            width: 'auto',
            padding: '0 16px',
            color: autoPlay ? C.positive : C.muted,
            borderColor: autoPlay ? C.positive : C.border,
          }}
          aria-label={autoPlay ? 'Pause auto-progress' : 'Start auto-progress'}
        >
          {autoPlay ? '\u{23F8} Auto' : '\u{25B6} Auto'}
        </button>
      </div>
    </div>
  );
}

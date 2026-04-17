# CLAUDE.md — Roil Finance Project Context

> Bu dosya yeni Claude Code terminal oturumlarının projeyi hızla anlayabilmesi için
> oluşturulmuştur. Tüm önemli bilgiler burada. Tarih: 2026-04-17.

---

## 1. Proje Nedir?

**Roil Finance** — Canton Network üzerinde çalışan, gizlilik odaklı, otomatik portföy yönetim platformu.

**Temel özellikler:**
- Drift-based auto-rebalance (hedef % sapmada otomatik dengeleme)
- Smart Order Router (Cantex AMM + Temple CLOB — en iyi fiyatlı DEX'e yönlendirme)
- DCA (Dollar Cost Averaging — saatlik/günlük/haftalık/aylık tekrarlayan alım)
- Auto-compound (yield reinvestment — 3 strateji)
- xReserve USDC bridge (Ethereum Sepolia ↔ Canton USDCx, Circle + Digital Asset)
- 9 asset desteği: CC, USDCx, CBTC, ETHx, SOLx, XAUt, XAGt, USTb, MMF
- Featured App reward sistemi (CIP-0047 activity markers)
- Governance (freeze/pause/fee update/audit log)
- Treasury swap (oracle fiyatlama + spread fee)
- Whitelist sistemi (invite code, 1000 user cap)
- Reward tiers (Bronze → Silver → Gold → Platinum, fee rebate)

**Tech stack:**
- **Daml** SDK 3.4.11 — 10 modül, 1786 LOC, v0.3.1 DAR
- **Backend** TypeScript/Express — 50 dosya, 16K LOC, Canton JSON Ledger API v2
- **Frontend** React 19 + Vite + Tailwind — ayrı private repo `Himess/roil-app`
- **Deployment** Vercel (frontend) + Netcup VPS (backend + Splice validators)

---

## 2. Repo Yapısı

```
roil-finance/              ← Ana repo (public: github.com/Himess/roil-finance)
├── main/                  ← Daml kontratları
│   ├── daml/              ← 10 .daml modülü (TokenTransfer, Portfolio, DCA, ...)
│   ├── daml.yaml          ← v0.3.1, SDK 3.4.11, 6 Splice data-dep
│   └── dars/              ← Splice DAR'ları (featured-app, token-holding, metadata, transfer-instruction, allocation, allocation-request)
├── test/                  ← Daml testleri
│   ├── daml/              ← 9 test modülü (146 test script, hepsi pass)
│   └── daml.yaml          ← v0.3.1, ana DAR'a + Splice DAR'lara referans
├── backend/
│   ├── src/
│   │   ├── engine/        ← rebalance, dca, compound, featured-app, trigger-manager, treasury, rewards, whitelist
│   │   ├── services/      ← cantex-client, temple-client, xreserve-client, price-oracle, yield-sources, admin-party-validator, transaction-stream, performance-tracker
│   │   ├── routes/        ← portfolio, market, swap, dca, rewards, admin, xreserve, whitelist, governance
│   │   ├── middleware/    ← auth (JWT), security, rate-limiter, idempotency (per-key lock), error-handler, admin-auth
│   │   ├── monitoring/    ← logger, metrics (OpenTelemetry)
│   │   ├── db/            ← PostgreSQL (optional, in-memory fallback)
│   │   ├── config.ts      ← Env + instruments + templates
│   │   ├── ledger.ts      ← Canton JSON API v2 client (JWT builder, query, exercise, pagination)
│   │   ├── server.ts      ← Express app factory (CORS, routes, health)
│   │   └── index.ts       ← Entry (cron, bootstrap, shutdown)
│   ├── deploy/            ← roil-backend.service (systemd, hardened)
│   └── package.json       ← roil-finance-backend v1.0.0
├── docs/
│   ├── featured-app-application.md  ← FA başvuru draft (HAZIR)
│   ├── dev-fund-application.md      ← Dev Fund grant draft (HAZIR)
│   └── devnet-application.md        ← DevNet başvuru (eski, tamamlanmış)
├── docs-internal/         ← Türkçe strateji dokümanları (.gitignore'da, public'te yok)
│   ├── CANTON-ECONOMICS-REPORT.md
│   └── REPORT.md
├── monitoring/            ← Prometheus + Grafana docker-compose + dashboards
├── scripts/               ← Deploy, DAR upload, test scripts
├── CLAUDE.md              ← BU DOSYA
├── CHANGELOG.md           ← v0.3.0 + [Unreleased]
├── PRE-APPLICATION-AUDIT.md  ← Kapsamlı 4-agent audit raporu (2026-04-16)
├── SPRINT-EXECUTION-REPORT.md ← Sprint execution 19/19 task tamam
├── ARCHITECTURE.md
├── SECURITY.md
├── TREASURY.md
├── ROADMAP.md
├── README.md
└── .github/workflows/ci.yml  ← Daml build+test, backend build+test, Docker validation
```

**Frontend repo (ayrı):**
```
Himess/roil-app (private)  ← github.com/Himess/roil-app, branch: main
├── src/
│   ├── pages/             ← Dashboard, Landing, LandingV2, Swap, DCA, Portfolio, ...
│   ├── components/        ← AppLayout, Sidebar, NetworkBadge, DemoBanner, ProtectedRoute, XReserveModal, ...
│   ├── hooks/             ← useApi, usePortfolio, useDCA, useRewards, useMarket, ...
│   ├── context/           ← AuthContext, PartyContext
│   └── config.ts          ← VITE_BACKEND_URL, VITE_NETWORK, asset colors, templates
├── vercel.json            ← SPA rewrites
└── Vercel project: "ui" in "himess-projects" scope
    Custom domain: roil.app
    Env vars: VITE_BACKEND_URL=https://api.roil.app, VITE_NETWORK=testnet
```

---

## 3. Canlı Deploy Durumu (2026-04-17 güncel)

### VPS'ler (Netcup, Ubuntu 24.04)

| VPS | IP | Hostname | Durum |
|---|---|---|---|
| **DevNet** | 159.195.71.102 | roil-devnet | Splice v0.5.17 validator (6 container, healthy). Daml SDK 3.4.11 + Java 17 kurulu. DAR build/test burada yapılıyor. |
| **TestNet** | 159.195.78.106 | roil-testnet | Splice v0.5.17 validator + **Roil backend live** (systemd `roil-backend.service`, port 3001). DAR v0.3.1 uploaded. Caddy TLS `api.roil.app`. |
| **MainNet** | 159.195.76.220 | roil-mainnet | Bare VPS. Docker/Splice KURULU DEĞİL. 2026-04-20 provisioning bekleniyor (Pedro'dan onboarding secret). |

**VPS credentials dosyası:** `C:\Users\USER\Desktop\Canton-DevNet-Server.txt` (IP, root password, SSH key path, Netcup hesap bilgileri, tüm detay burada)
**SSH key:** `C:\Users\USER\.ssh\id_ed25519` (yedek: `Desktop/canton-ssh-key-backup/`)

### TestNet Backend Detayları
- **URL:** `https://api.roil.app` (Caddy 2.6.2, Let's Encrypt cert `CN=api.roil.app`, auto-renew)
- **Caddy config:** `/etc/caddy/Caddyfile` — bind `159.195.78.106:80/443`, reverse_proxy `localhost:3001`
- **Splice nginx:** `127.0.0.1:80` (HOST_BIND_IP=127.0.0.1 in validator .env)
- **Backend .env:** `/root/roil-backend/.env` (chmod 600)
  - `JWT_SECRET` — 88-char openssl random (rotated 2026-04-16)
  - `CC_ADMIN_PARTY` — real DSO: `DSO::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337`
  - `USDCX_ADMIN_PARTY` — real xReserve operator: `decentralized-usdc-interchain-rep::122049e2af8a725bd19759320fc83c638e7718973eac189d8f201309c512d1ffec61`
  - CBTC/ETHx/SOLx/XAUt/XAGt/USTb/MMF — **mock party** (mock-*-issuer::...)
  - `ALLOWED_ORIGINS=https://roil.app,https://www.roil.app,https://api.roil.app`
- **Backend log:** `/var/log/roil-backend.log` (logrotate: daily, 14-day, 100MB)
- **Backend log (journald):** `journalctl -u roil-backend` (systemd standart çıktı)
- **DAR'lar:** `/root/roil-finance-0.3.0.dar` + `/root/roil-finance-0.3.1.dar`

### Frontend (Vercel)
- **URL:** `https://roil.app`
- **Vercel project:** `ui` in scope `himess-projects`
- **Son commit:** `bd308d3` "feat: TestNet transparency — network badge, demo banner, route guards"
- **Env vars:** `VITE_BACKEND_URL=https://api.roil.app`, `VITE_NETWORK=testnet`

### DNS (Cloudflare)
- `roil.app` → Vercel IP `76.76.21.21` (Vercel proxy)
- `api.roil.app` → `159.195.78.106` (DNS only, gray cloud — Caddy handles TLS)

---

## 4. Son Yapılan Büyük Sprint (2026-04-16/17)

### 4-Agent Audit Raporu
`PRE-APPLICATION-AUDIT.md` dosyasında kapsamlı dürüst audit:
- Backend: 7/10 → 8/10
- Daml + CIP: 6/10 → 8.5/10
- Frontend: 6/10 → 7.5/10
- Ops + Docs: 5/10 → 8/10
- **Genel: 6.5/10 → 8/10 (FA submit edilebilir)**

### Tamamlanan 19 Task

**Quick fixes (yapıldı):**
1. ✅ CHANGELOG.md v0.3.0 entry
2. ✅ CI: DAR path wildcard (was hardcoded 0.2.0)
3. ✅ Turkish internal docs → `docs-internal/` (gitignore'd)
4. ✅ systemd: User=root → roil (unprivileged + NoNewPrivileges + ProtectSystem=strict)
5. ✅ Frontend LandingV2 XSS fix (dangerouslySetInnerHTML → emoji codepoints)

**Daml CIP-0056 compliance (yapıldı):**
6. ✅ TransferInstruction factory integrated (3 new Splice DAR data-deps)
7. ✅ TestDCA.daml — 14 test scripts
8. ✅ TestWhitelist.daml — 15 test scripts
9. ✅ TestTransferPreapproval.daml — 19 test scripts
10. ✅ DAR v0.3.1 build (DevNet) + TestNet upload — **146/146 tests passing**

**Backend P0 fixes (yapıldı + deployed):**
11. ✅ Idempotency: per-key in-flight promise lock (concurrent duplicate prevention)
12. ✅ Ledger: queryContracts limit param + truncation warning + async iterator
13. ✅ Admin party validator: startup heuristic check (real/mock/missing)

**Frontend UX (yapıldı + Vercel deployed):**
14. ✅ NetworkBadge: persistent "Canton TestNet" pill in header
15. ✅ DemoBanner: two-state (disconnected / unauth), always visible when demo data
16. ✅ ProtectedRoute: soft guard + hard mode for /wallet, /admin
17. ✅ LandingV2 XSS eliminated
18. ✅ Pushed + Vercel auto-deployed

**Application drafts (yapıldı):**
17. ✅ `docs/featured-app-application.md` — 12 section, CIP matrix, 6-month projection
18. ✅ `docs/dev-fund-application.md` — $10,750 budget, milestones, risks

**Reports (yapıldı):**
19. ✅ `SPRINT-EXECUTION-REPORT.md`

### GitHub Son Commit'ler
- `roil-finance` master: `ad6f2a5` "fix: admin party validator — heuristic check"
- `roil-app` main: `bd308d3` "feat: TestNet transparency"

---

## 5. Kritik Tarihler

| Tarih | Olay | Aksiyon |
|---|---|---|
| **2026-04-20** | Canton MainNet açılışı | Pedro'dan onboarding secret al → MainNet VPS'te Docker+Splice kur → node başlat |
| **2026-04-20 – 2026-05-04** | FA başvuru penceresi | `docs/featured-app-application.md` kullanarak canton.foundation/featured-app-request'e submit |
| **2026-04-20 sonrası** | Dev Fund grant | `docs/dev-fund-application.md` → github.com/canton-foundation/canton-dev-fund PR |
| **FA onayı sonrası** | Traffic subsidization aktif et | Beneficiary weight konfigure et |
| **Sürekli** | UTXO konsolidasyonu, CIP pipeline takibi | MergeDelegation, issuance monitoring |

---

## 6. Kalan Adımlar (Yapılacaklar)

### P0 — MainNet Day (2026-04-20) öncesi
- [ ] MainNet VPS provisioning: Docker install, Splice v0.5.17 indirme, grpcurl, .env hazırlama
- [ ] Pedro'dan MainNet onboarding secret alma
- [ ] MainNet DSO party ID fetch (DevNet'tekinden farklı olacak): `python3 get-token.py administrator` + scan-proxy
- [ ] MainNet backend deploy (aynı pattern: scp dist + systemd)
- [ ] 5dk pitch video kayıt (senaryo: `docs/featured-app-application.md` §7)

### P1 — FA submission sonrası 2 hafta içinde
- [ ] Smoke-test: wallet connect → onboarding → xReserve deposit → swap → rebalance → FA marker verify
- [ ] Circuit-breaker atomic state fix (race condition under concurrent requests)
- [ ] xReserve poll 60s → 30s + optional push notification
- [ ] Frontend demo-data fallback → proper empty state (hooks still return DEMO_PORTFOLIO)
- [ ] Frontend e2e test coverage (auth flow, bridge, swap)

### P2 — Operasyonel iyileştirmeler
- [ ] Daml command dedup (commandId TTL cache)
- [ ] Per-user rate limiting (not just per-IP)
- [ ] Monitoring alerting rules (Prometheus alert.rules + PagerDuty)
- [ ] Price oracle backup (CoinGecko fallback for Cantex downtime)
- [ ] API versioning (/v1/ prefix)
- [ ] Passkey auth completion or removal (currently stub)

---

## 7. Canton CIP Compliance Durumu

| CIP | Durum | Not |
|---|---|---|
| CIP-0056 Token Standard Holding | ✅ PASS | TokenTransfer.daml Splice HoldingV1 import |
| CIP-0056 Settlement Deadlines | ✅ PASS | allocateBefore/settleBefore enforce |
| CIP-0056 TransferInstruction Factory | ✅ PASS | spliceInstructionCid field + LinkSpliceInstruction choice |
| CIP-0047 Activity Markers V2 (weight) | ✅ PASS | mapA loop per activityWeight |
| TransferPreapproval | ✅ PASS | provider observer + backend RecordActivity |
| FeaturedAppRight Claim | ⚠️ PARTIAL | Optional cid, UpdateRegistration sets; Amulet AppRewardCoupon claim delegated to SV |
| AllocationRequest interface | ❌ NOT IMPL | DAR available ama import yok; deferred |

---

## 8. Test Durumu

**Daml:** 146/146 passing (DevNet VPS, 2026-04-17)
- TestDCA (14), TestWhitelist (15), TestTransferPreapproval (19) — YENİ
- TestFeaturedApp (8), TestGovernance (20), TestPortfolio (24), TestRewards (9), TestTokenTransfer (12), TestTreasury (X)

**Backend:** TypeScript strict compile pass (`npm run build` clean)

**Frontend:** `npx tsc --noEmit` clean (type-safe)

---

## 9. Önemli Dosya Referansları

| Ne arıyorsun | Dosya |
|---|---|
| VPS IP/password/SSH key | `C:\Users\USER\Desktop\Canton-DevNet-Server.txt` |
| Backend .env (TestNet) | SSH `root@159.195.78.106:/root/roil-backend/.env` |
| DSO party fetch komutu | SSH → `python3 get-token.py administrator` + `curl -H "Authorization: Bearer <token>" http://localhost/api/validator/v0/scan-proxy/dso-party-id` |
| Daml build | SSH DevNet → `export PATH="$HOME/.daml/bin:$PATH" && cd /root/roil-build/main && daml build` |
| Daml test | SSH DevNet → `cd /root/roil-build/test && daml test` |
| Backend health | `curl https://api.roil.app/health` |
| xReserve info | `curl https://api.roil.app/api/xreserve/info` |
| Caddy config | SSH TestNet → `/etc/caddy/Caddyfile` |
| Splice validator compose | SSH → `/root/splice-node/docker-compose/validator/` |
| Vercel project | `vercel ls ui --scope himess-projects` (via `$APPDATA/npm/vercel.cmd`) |
| Cloudflare DNS | dash.cloudflare.com → roil.app → DNS Records (api A record) |
| FA draft | `docs/featured-app-application.md` |
| Dev Fund draft | `docs/dev-fund-application.md` |
| Audit raporu | `PRE-APPLICATION-AUDIT.md` |
| Sprint raporu | `SPRINT-EXECUTION-REPORT.md` |

---

## 10. Bilinen Sınırlamalar & Gotchas

1. **Mock party'ler (7 asset):** CBTC/ETHx/SOLx/XAUt/XAGt/USTb/MMF admin party'leri mock (mock-*-issuer::...). Bu asset'ler için swap/rebalance submit "unknown party" hatası verecektir. CC ve USDCx gerçek.

2. **Frontend demo data:** usePortfolio/useDCA hook'ları hâlâ DEMO_PORTFOLIO/DEMO_SCHEDULES fallback veriyor auth olmadığında. DemoBanner ile uyarı eklendi ama fallback kaldırılmadı. ~$84M portfolio değeri mock data'dan geliyor.

3. **Cantex + Temple MOCK mode:** TestNet'te Cantex/Temple API key'leri set edilmemiş. Backend logda `[Cantex] Running in MOCK mode` ve `[Temple] Running in mock mode` görünüyor. Gerçek swap execution'lar Cantex/Temple key'lerini gerektiriyor.

4. **systemd User=root hâlâ TestNet'te:** `backend/deploy/roil-backend.service` dosyasında `User=roil` yazılı ama **TestNet'te** hâlâ `User=root` ile çalışıyor (deploy sırasında systemd unit güncellenmedi, sadece local dosya değişti). Gerçek geçiş için: VPS'te `useradd -r -s /usr/sbin/nologin roil` + `/opt/roil-backend` dizini + chown + unit reload.

5. **CHANGELOG v0.3.1 eksik:** Daml v0.3.1 DAR build edildi ama CHANGELOG'da v0.3.1 girişi yok (v0.3.0 yazıldı). Sprint'te yapılan değişiklikler v0.3.0 altında listelendi çünkü henüz release tag'i yok.

6. **MainNet VPS boş:** Docker, Splice-node, grpcurl, Caddy — hiçbiri kurulu değil. 2026-04-20'de Pedro secret'ı gelince kurulum yapılacak.

7. **Splice DAR unused warning:** `splice-api-token-allocation-v1` ve `splice-api-token-allocation-request-v1` import edildi ama kullanılmıyor (AllocationRequest impl deferred). Build warning çıkıyor, fail etmiyor.

8. **Cloudflare api.roil.app DNS only:** Orange cloud (proxy) kapalı. Caddy kendi TLS'ini hallediyor. Proxy açmak istersen: Cloudflare'de "Full (strict)" + Caddy origin cert veya Cloudflare origin cert.

---

## 11. Kullanıcı Profili

- **İsim:** Semih
- **Email:** semihcvlk53@gmail.com / semih@roil.app
- **GitHub:** @Himess
- **Vercel:** `himess` (team: `himess-projects`)
- **Netcup Customer #:** 360577
- **Dil:** Türkçe (teknik terimler İngilizce kalır)
- **Canton Network SV Sponsor:** Canton Foundation (Pedro secret handoff 2026-04-20)

---

## 12. Yardımcı Komutlar (Hızlı Referans)

```bash
# SSH TestNet
ssh root@159.195.78.106

# SSH DevNet (Daml build environment)
ssh root@159.195.71.102

# SSH MainNet
ssh root@159.195.76.220

# Backend health check
curl -s https://api.roil.app/health | jq

# Backend son loglar
ssh root@159.195.78.106 'tail -30 /var/log/roil-backend.log'

# Daml build (DevNet üzerinde)
ssh root@159.195.71.102 'export PATH="$HOME/.daml/bin:$PATH" && cd /root/roil-build/main && daml build'

# Daml test (DevNet üzerinde)  
ssh root@159.195.71.102 'export PATH="$HOME/.daml/bin:$PATH" && cd /root/roil-build/test && daml test'

# Vercel status
"$APPDATA/npm/vercel.cmd" ls ui --scope himess-projects

# Canton TestNet DSO party
ssh root@159.195.78.106 'cd /root/splice-node/docker-compose/validator && TOKEN=$(python3 get-token.py administrator) && curl -s -H "Authorization: Bearer $TOKEN" http://localhost/api/validator/v0/scan-proxy/dso-party-id'

# Backend restart (TestNet)
ssh root@159.195.78.106 'systemctl restart roil-backend && sleep 3 && systemctl is-active roil-backend'
```

---

## 13. Hafıza Dosyaları (Claude Memory)

`C:\Users\USER\.claude\projects\C--Users-USER-desktop-roil-finance\memory\` altında:
- `project_overview.md` — Proje genel görünümü (v0.3.0 scope + stack)
- `mainnet_timeline.md` — MainNet 2026-04-20, Pedro secret, FA penceresi 2026-05-04
- `vps_inventory.md` — 3 VPS detay + creds pointer
- `deploy_topology.md` — Hangi servis nerede çalışıyor
- `frontend_repo.md` — roil-app ayrı private repo (Vercel)
- `testnet_admin_parties.md` — CC/USDCx real, 7 mock, DSO fetch komutu
- `MEMORY.md` — Index dosyası

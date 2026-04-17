# Roil Finance — Pre-Application Audit Report

**Tarih:** 2026-04-16
**Kapsam:** Featured App + Dev Fund başvuruları öncesi tam repo denetimi
**Kritik deadline:** 2026-04-20 (MainNet açılışı) + 2026-05-04 (FA başvuru penceresi sonu)
**Audit yöntemi:** 4 paralel subagent (backend, Daml/CIP, frontend, ops+docs+CI) + cross-referenced against live TestNet state

---

## 📊 Executive Summary

| Kategori | Skor (0-10) | Dürüst Verdict |
|---|---|---|
| Backend kod kalitesi | **7/10** | Güçlü temel (error handling, circuit breaker, JWT modes), fakat P0 race conditions (idempotency, admin party validation, ledger pagination) |
| Daml + Canton CIP uyumluluğu | **6/10** | CIP-0047 Featured App rewards ✅ correct, CIP-0056 **TransferInstruction factory eksik** (FAIL), 3 kritik test modülü yok |
| Frontend UX/polish | **6/10** | MVP görsel olarak iyi, fakat **demo data without disclosure** honesty score 3/10, TestNet badge yok, XSS vektörü var |
| Ops + Docs + CI | **5/10** | CHANGELOG 5 gün drift, CI hardcoded 0.2.0 DAR path, Turkish internal docs public repo'da, frontend CI yok |
| **Genel FA hazırlık** | **🟡 6.5/10** | **Conditional pass — 4 günde odaklı sprint ile submit edilebilir** |

### Dürüst Gerçek

Roil Finance teknik olarak ciddi bir iş. Canton community içinde saygı kazanabilecek bir başvuru yapılabilir. Ancak şu haliyle submit edilirse FA committee'nin **skim test'inde** görecekleri 6 somut red flag var:

1. **CHANGELOG.md v0.2.0'da kalmış** — `main/daml.yaml` v0.3.0, DAR v0.3.0 TestNet'te çalışıyor ama changelog 5 gündür güncellenmemiş
2. **CI pipeline v0.2.0 DAR path'ine hardcoded** — `.github/workflows/ci.yml:40` `roil-finance-0.2.0.dar` yükler, v0.3.0 build'leri release artifact'e gitmiyor
3. **TransferInstruction factory (CIP-0056) entegre değil** — `dars/splice-api-token-transfer-instruction-v1-1.0.0.dar` dosyada var ama `main/daml.yaml` import etmiyor, custom TransferRequest/SwapRequest ile token transfer logging yapılıyor (atomik değil)
4. **Türkçe internal raporlar public repo'da** — `CANTON-ECONOMICS-REPORT.md` + `REPORT.md` strateji/revenue modelleme içeriyor, FA submission'da profesyonel bir proje için uygunsuz
5. **Frontend demo data gerçek gibi gösteriliyor** — unauth user `$84,308,000 portfolio` görüyor, DemoBanner sadece backend-down durumunda çıkıyor, TestNet indicator yok
6. **systemd servisi `User=root`** — security anti-pattern, unprivileged user'a çevrilmeli

**İyi haber:** Bu 6 red flag'in 5'i kod yazmadan, sadece disiplin + docs + config güncellemesi ile 1 günde çözülebilir. CIP-0056 TransferInstruction entegrasyonu tek gerçek mühendislik işi (2-4 saat).

---

## 📐 Kod Metadata

| Katman | Dosya | Satır (LOC) |
|---|---|---|
| Backend (TypeScript) | 50 src | 16,087 |
| Daml (main/) | 10 .daml | 1,786 |
| Daml tests (test/) | 6 test | ~4,300 |
| Backend tests | ~8-12 .test.ts | ~2,000 (tahmini) |
| Frontend (Himess/roil-app) | 30+ component | - |
| Frontend tests | 3 .test.{ts,tsx} + 10 e2e | ~210 |
| CI | 1 workflow (ci.yml) | 78 |
| DAR'lar | roil-finance-0.3.0.dar + 7 splice-* data-dep | - |

---

## 1. Backend Audit (`backend/src/`)

### 1.1 Neler Doğru ✅

**Mimari:**
- Engine / service / route / middleware temiz ayrışmış (`backend/src/engine/*`, `services/*`, `routes/*`, `middleware/*`)
- Graceful shutdown: `index.ts:162-187` transaction stream, price oracle, cron'lar, DB pool'u clean shutdown
- Structured error classes: `utils/errors.ts` (LedgerError, CantexError, ValidationError + retryable flags)
- `middleware/error-handler.ts` correlation ID ile consistent 4xx/5xx response

**Resilience:**
- Circuit breaker: `utils/circuit-breaker.ts` (closed → open → half-open, Cantex/Temple için)
- Retry with jitter: `utils/retry.ts` exponential backoff, retryable pattern filtering
- Price oracle 3-tier fallback: `services/price-oracle.ts` (live → cached → hardcoded)
- Rate limiter graceful degradation: `middleware/rate-limiter.ts` Redis varsa Redis, yoksa in-memory

**Güvenlik:**
- Zod validation her route'ta (örn. `routes/xreserve.ts:39-55`, `routes/portfolio.ts:26-50`)
- Prototype pollution guard: `middleware/security.ts:68-88`
- JWT multi-mode (unsafe/HMAC256/RS256/ES256) with startup validation: `middleware/auth.ts:49-59`
- Production safety: `config.ts:170-175` non-localnet'te unsafe JWT blocked
- Idempotency: `middleware/idempotency.ts` POST/PUT caching by Idempotency-Key

**Observability:**
- OpenTelemetry wired: `index.ts:1-3` auto-instrumentation, `tracing.ts` OTLP HTTP export
- Metrics: `monitoring/metrics.ts` request duration, circuit state, DCA, reward counters
- Health: `server.ts:136-163` ledger + Cantex availability check

### 1.2 P0 — Kritik (FA önce mutlaka)

**P0-1. Idempotency race condition** — `middleware/idempotency.ts:65-74`
Cache write olmadan önce aynı anda gelen 2 identical request handler'ı paralel çalıştırır → **çift swap, çift DCA, çift compound**. Finansal yazılım için kabul edilemez.
**Fix:** Per-key Promise lock (Map of in-flight promises).

**P0-2. Admin party validation engine-level eksik**
`config.ts:476-482` startup'ta `INSTRUMENTS` admin boş değilse check ediyor, ama engine'ler (compound, treasury, featured-app) runtime'da placeholder/mock party ile submit yapınca "unknown party" hatası patlar. Şu an TestNet backend'de 7 asset mock → submit'ler runtime fail.
**Fix:** Engine startup'ta gerçek party'lerin ledger'da allocate olduğunu doğrula.

**P0-3. Ledger pagination yok** — `ledger.ts`
Canton JSON API v2 `/state/active-contracts` paginated. >50 contract olan user için query sessizce 50'de kesiliyor.
**Fix:** Pagination loop + offset tracking.

**P0-4. Circuit breaker state transition race** — `utils/circuit-breaker.ts:54-77`
`execute()` state=open görüp sleep ediyor, başka thread half-open'a geçiriyor, `execute` stale state ile devam ediyor.
**Fix:** Atomic state + timestamp tuple.

### 1.3 P1 — Yüksek Risk

**P1-1. xReserve 60s poll attestation blind spot** — `index.ts:146`
13-15dk Ethereum finality SLA, 60s poll = user deposit'i dashboard'da göremiyor. Push notification (Alchemy/Infura) veya 30s poll + jitter eklenmeli.

**P1-2. Canton JSON API v2 response shape validation yok** — `ledger.ts:39-57`
Response format değişirse sessiz data loss. Zod validation + version negotiation.

**P1-3. Daml command dedup eksik** — `ledger.ts`
Network timeout'ta retry aynı commandId'yi iki kez gönderebilir → double-exercise.
**Fix:** commandId + party + timestamp composite key TTL cache.

**P1-4. adminAuth middleware tanımlı ama register edilmemiş** — `middleware/admin-auth.ts`
`server.ts`'de import yok. Admin route'lar protected değil olabilir.

**P1-5. Rate limiter in-memory Map unbounded growth**
`middleware/rate-limiter.ts:20-26` cleanup 60s'de ama iteration cap yok, DDoS altında memory exhaustion.

### 1.4 P2 — Operasyonel

- **Fallback prices stale** — `config.ts:316-326` CBTC=40,000 hardcoded, Cantex down → rebalance yanlış fiyatta
- **Trigger-manager circuit breaker ayrı** — Cantex breaker'ı ile share etmiyor, state divergence
- **DCA + Rebalance sync** — ledger lag'da aynı anda çalışıp drift'i iki kez düzeltmeye çalışabilir
- **Featured-app marker dedup yok** — retry'da aynı activity iki marker yaratır, reward inflated
- **DB transaction isolation yok** — `db/index.ts` autocommit, multi-step insert'te orphan kayıt

### 1.5 Eksikler

- Correlation ID Cantex/Temple/Ledger API'ye propagate edilmiyor (distributed tracing blind)
- API versioning yok (`/v1/`, `/v2/` prefix)
- OpenAPI spec incomplete (CIRCUIT_OPEN error code, rate-limit header yok)
- Operator escape hatch yok (circuits trip olduğunda manual override)
- Per-user rate limit yok (sadece per-IP)
- Graceful degradation yok (Cantex + Temple ikisi de down → sessiz fail)

---

## 2. Daml + Canton CIP Uyumluluk Audit'i

### 2.1 Modül Envanteri (10 modül)

| # | Modül | Satır | Template sayısı | Choice sayısı |
|---|---|---|---|---|
| 1 | Types.daml | 150 | 0 (data only) | - |
| 2 | FeaturedApp.daml | 206 | 3 | 5 |
| 3 | TokenTransfer.daml | 150 | 4 | 5 |
| 4 | TransferPreapproval.daml | 152 | 1 | 8 |
| 5 | Governance.daml | 167 | 1 | 7 |
| 6 | Treasury.daml | 130 | 1 | 6 |
| 7 | Whitelist.daml | 142 | 3 | 8 |
| 8 | Portfolio.daml | 355 | 7 | 12 |
| 9 | RewardTracker.daml | 173 | 4 | 5 |
| 10 | DCA.daml | 171 | 3 | 5 |

**Daml-LF 3.x migration complete** (contract keys removed), `main/daml.yaml` v0.3.0.

### 2.2 Canton CIP Compliance Matrix

| Feature | Durum | Kanıt |
|---|---|---|
| **CIP-0056 Settlement Deadlines** | ✅ **PASS** | `TokenTransfer.daml:46-50,102-105` SettlementInfo enforce |
| **CIP-0047 Activity Markers V2 (weight)** | ✅ **PASS** | `FeaturedApp.daml:102-109` mapA loop ile activityWeight başına marker |
| **TransferPreapproval Inbound Rewards** | ✅ **PASS** | `TransferPreapproval.daml:4-7,30` — provider observer + backend RecordActivity ile reward |
| **CIP-0056 Token Standard Holding Interface** | ⚠️ **PARTIAL** | `TokenTransfer.daml:11` SpliceHolding.Holding import ediyor ama **kendi Holding interface'ini implement etmiyor**, backend JSON API üzerinden köprü |
| **FeaturedAppRight Claim / Amulet** | ⚠️ **PARTIAL** | `FeaturedAppConfig.daml:68` Optional FeaturedAppRight, UpdateRegistration ile set, **ama Amulet AppRewardCoupon claim yok** — SV automation'a tam güveniliyor |
| **TransferInstruction Factory Pattern (CIP-0056 atomik)** | ❌ **FAIL** | `main/daml.yaml` `splice-api-token-transfer-instruction-v1-1.0.0.dar` **import etmiyor** — dosya `main/dars/` içinde var ama kullanılmıyor. Custom TransferRequest/SwapRequest log-based, atomik değil |
| **AllocationRequest interface** | ❌ **FAIL** | `Portfolio.daml:68-74` commented out "when Splice DARs available" — DAR zaten var ama import yok |
| **CIP-0100 Dev Fund Governance** | N/A | İlgili değil (FA stage için gerekmez) |

### 2.3 P0 Daml Problemler

**P0-D1. TransferInstruction factory eksik** — `main/daml.yaml` + `TokenTransfer.daml`
CIP-0056'nın atomik transfer garantisi sağlanmıyor. Backend Ledger API üzerinden köprü yapıyor, ledger state (gerçek bakiyeler) ile contract state (log) divergence riski. **FA committee'nin açıkça soracağı nokta.**
**Fix (4-6 saat):** `main/daml.yaml`'a import + `TokenTransfer.daml` refactor → TransferInstruction factory exercise.

**P0-D2. 3 kritik modülün testi yok**
- `TestDCA.daml` yok → DCA schedule create/update/execute/pause/resume test edilmemiş
- `TestWhitelist.daml` yok → invite code, join, deactivation test edilmemiş
- `TestTransferPreapproval.daml` yok → execute/revoke/expiry test edilmemiş

### 2.4 P1 Daml Problemler

- **`TransferPreapproval.daml:30`** provider observer, controller değil — reward için backend enforcement'a bağımlı, on-chain garanti yok
- **`Portfolio.daml:152`** PriceCondition skipped — comment açıkça belirtiyor (`"backend responsibility"`). Backend compromised → wrong-price rebalance
- **`Treasury.daml:95`** UpdateBalances listeyi kabul ediyor ama on-chain doğrulama yok, ledger/reality divergence
- **`Governance.daml:152-155`** nonconsuming CanRebalance — race condition (check ile exercise arası state değişebilir)
- **`FeaturedApp.daml:101-110`** mapA exercise loop idempotency token yok — retry → duplicate markers → inflated rewards

### 2.5 P2 Daml Problemler

- `Portfolio.daml:88` RebalanceRequest over-signed (user signatory ama hiç choice exercise etmiyor, composability kırılıyor)
- `Governance.daml` audit log inconsistency (UpdateFeeRate log ✓, ResumeRebalancing log ✗)
- `Types.daml:107-118` calcMaxDrift empty portfolio (0-balance) edge case test yok

### 2.6 Verdict Daml

**CONDITIONAL PASS.** Signatory patterns mostly doğru, ensure clauses güçlü, Daml-LF 3.x migration temiz, CIP-0047 markers correct. **3 blocker:**
1. TransferInstruction factory integration
2. 3 eksik test modülü
3. AllocationRequest interface impl

---

## 3. Frontend Audit (`Himess/roil-app`)

### 3.1 Architecture & Shell

✅ **Doğru:**
- AuthContext temiz (token lifecycle, server-side verify on mount — `src/context/AuthContext.tsx:1-250`)
- Public/authenticated route ayrımı (`src/App.tsx:58-95`)
- JWT expiry client-side check (`AuthContext:102-116`)
- Responsive (mobile sidebar collapse, md:grid breakpoints)
- Dark mode tam (localStorage + full palette)

❌ **Yanlış:**
- AuthenticatedApp'de **explicit auth guard yok** — `isLoading` flag var ama route guard tüketmiyor → unauth user briefly authenticated content görür
- PartyContext + AuthContext independent load → race condition
- Landing + Dashboard arasında "registered unauth" vs "demoing unauth" boundary blurred

### 3.2 Demo Fallback UX — Honesty Score 3/10 ❌ P0

**Kritik şeffaflık açığı:**
- `DemoBanner` (`src/components/DemoBanner.tsx`) **sadece backend disconnected olunca** görünüyor
- Ama **unauth user + live backend** durumunda hiçbir uyarı YOK
- Hooks (`usePortfolio`, `useDCA`, `useMarket`, `useRewards`) 401 veya null data → **sessiz demo fallback**
- `usePortfolio.ts:133` `isDemo: !query.isFromBackend` var ama Dashboard **bu flag'i tüketmiyor**
- `DEMO_PORTFOLIO` 10,000 CC equivalent → Dashboard'da $84M olarak render

**FA committee görürse:** "Bu app gerçek mi simülasyon mu? Neden bize TestNet'te $84M portfolio gösteriyor?"

### 3.3 Bridge + Swap UX

**xReserve Bridge** (`src/components/XReserveModal.tsx`, `src/lib/xreserve.ts`):
- Hardcoded Sepolia (line 42)
- ethers/viem integration var
- ❌ Failed bridge tx error detail yok
- ❌ Quote fetch sırasında loading skeleton yok

**Swap** (`src/pages/Swap.tsx`):
- Price impact disclosed (0.5% spread, line 67)
- Whitelist check var
- ❌ Slippage tolerance input yok
- ❌ "Confirm swap details" modal yok (direct mutation)
- ❌ Tx hash / explorer link yok

### 3.4 Accessibility / Security / Performance

**Security P0:**
- `LandingV2.tsx:185` `dangerouslySetInnerHTML={{ __html: step.icon }}` — step.icon kaynağı kontrol edilmeli (CMS/API'den geliyorsa XSS vektörü)
- `AuthContext:69` JWT localStorage'da — XSS'e açık ama server-side verify ile mitigate edilmiş
- Google auth flow `idToken` signature client-side doğrulanmıyor
- Passkey auth **stub** (`src/lib/passkey-auth.ts`) — yarım bırakılmış, localStorage credential reference var

**Accessibility P1:**
- Modal `autofocus`, `onEscape` handler yok, `role="dialog"` yok
- Form input'larda `aria-describedby` eksik
- NavLink'lerde `aria-current="page"` yok

**Performance P2:**
- Route-level lazy loading yok (61 import top of App.tsx)
- Three.js + GSAP + Lenis upfront load
- Rebalance/swap history virtualization yok
- Bundle ~>500KB tahmini

### 3.5 Tests & Polish

**Tests:**
- 3 unit test: `config.test.ts` (43 LOC), `usePortfolio.test.ts` (44 LOC), `ErrorBoundary.test.tsx` (40 LOC)
- E2E: 10 scenario `e2e/app.spec.ts` — **auth flow, demo fallback, swap execution testi yok**
- Component snapshot yok, integration test yok, a11y test (axe) yok

**Polish:**
- Loading skeletons var (Dashboard.tsx:105)
- ❌ Portfolio creation success toast yok
- ❌ DCA cancel/undo yok
- ❌ Swap confirmation "review final amounts" adımı yok

### 3.6 Frontend P0/P1 Özet

**P0:**
- TestNet badge / banner HİÇ YOK (her sayfada persistent olmalı)
- Demo data unauth'ta warning'siz gösteriliyor
- LandingV2 dangerouslySetInnerHTML XSS risk

**P1:**
- Route guard eksik (isLoading check)
- Swap/Bridge multi-step confirmation yok
- DCA form source==target validation yok
- Passkey auth incomplete, Google auth idToken verify yok

### 3.7 Verdict Frontend

**Polished MVP, ama transparency gap'leri var.** Reviewer'ın seveceği: auth, responsive, templates, dark mode, API error handling. Reviewer'ın not düşeceği: TestNet indicator yok, demo data warning yok, bridge/swap eksik confirm adımları, minimal test coverage, incomplete passkey stub (kısayol izlenimi).

---

## 4. Ops + Docs + CI Audit

### 4.1 Docs Drift Matrix

| Doküman | Gerçekle uyum | Kritik Gap |
|---|---|---|
| README.md (527 satır) | 95% | "240+ tests" claim (gerçek ~180); Daml start komutları outdated |
| ARCHITECTURE.md (111) | 90% | TS v5.7 / Node 20 gereksinimleri yazılmamış |
| **CHANGELOG.md** (31) | **KRİTİK DRIFT** | v0.3.0 hiç yazılmamış, 5 gündür stale, CI hâlâ 0.2.0 DAR upload'luyor |
| SECURITY.md (85) | 90% | Known Limitation #4 outdated (Governance modülü var) |
| TREASURY.md (159) | 85% | v0.3.0 features (governance audit log, TransferPreapproval) eklenmedi |
| ROADMAP.md (115) | 70% | "Phase 3: Devnet — In Progress" ama README "Phase 3" satırı muğlak; MainNet tarihleri yok |
| **CANTON-ECONOMICS-REPORT.md** (545) | ⚠️ **INTERNAL** | Turkish strategy, revenue modeling, mainnet plan — **public repo'da olmamalı** |
| **REPORT.md** (291) | ⚠️ **INTERNAL** | Turkish audit notes 2026-03-15 — **public repo'da olmamalı** |

### 4.2 CI Posture (`.github/workflows/ci.yml`)

✅ **Çalışan:**
- Daml build + test (Ubuntu, Java 17, Daml 3.4.11)
- Backend build + test (Node 20, vitest, npm audit)
- Docker build validation
- DAR artifact upload

❌ **Kritik Gap'ler:**
1. **DAR path hardcoded** (ci.yml:40) `roil-finance-0.2.0.dar` — v0.3.0 build'leri artifact'e gitmiyor
2. **Frontend CI yok** — `ui/` repo ayrı, bu CI yalnızca backend
3. **No merge gate** — required status check yok, `npm audit --audit-level=high || true` moderate'lara izin veriyor
4. **Secrets handling** — OIDC/external secret injection yok, ENV runtime'a bağımlı
5. **No release automation** — tag-on-merge, version bump yok

### 4.3 Test Coverage Reality Check

| Katman | README claim | Gerçek | Kalite |
|---|---|---|---|
| Daml | "26 test scenarios" | 6 test dosyası ~26-30 script | ✅ Solid: lifecycle, auth, governance, edge cases |
| Backend | "17 test files" | ~8-12 real .test.ts (173 includes node_modules) | ⚠️ %40-60 critical path coverage (tahmini) |
| Frontend | "3 test files" | **3 unit test gerçekten VAR** | 127 LOC, hook/config/boundary only |
| E2E | "Playwright 9 scenarios" | **10 scenario var** (`ui/e2e/app.spec.ts`) | ⚠️ auth/demo/swap test yok |

### 4.4 Monitoring Maturity

**Var:**
- Prometheus scrape config (`monitoring/prometheus.yml`)
- Grafana auto-provision (datasource + dashboard)
- Backend 50+ `metrics.increment()` call

**Theater:**
- Hardcoded hostname `rebalancer-backend:3001` (ci.yml:10) gerçek servis adıyla uyuşmaz
- Nginx stub_status referans ama Nginx config bulunamadı
- **Alert rules YOK** — backend hang olursa sessiz ölüm
- OpenTelemetry packages import ama tracing pipeline visible değil

### 4.5 Deploy / Ops Gaps (3am Incident)

**systemd unit (`backend/deploy/roil-backend.service`):**
- ✅ `Restart=on-failure` + `RestartSec=10`
- ✅ EnvironmentFile ayrı
- ✅ Logrotate 14 gün / 100MB
- ❌ **`User=root`** (line 8) — unprivileged user olmalı
- ❌ Health check yok (port 3001 zombie-hang'ı kaçırır)
- ❌ Rollback procedure undocumented
- ❌ DAR upload script yok (v0.2.0 → v0.3.0 migration path)
- ❌ JWT key rotation schedule yok
- ❌ Multi-instance distributed lock yok (DCA cron duplicate risk)

### 4.6 Secrets & Hygiene

✅ **İyi:** `.gitignore` `.env`, `*.pem`, `*.key`, `*.p12` covered, `.env.example` placeholder, no hardcoded secrets found

❌ **Gap:**
- `CANTON-ECONOMICS-REPORT.md` + `REPORT.md` public (internal strategy leak)
- `ui/` için `.env.local.example` yok (VITE_BACKEND_URL undocumented)
- JWT keys on-disk `/root/roil-backend/` (HSM yok — devnet OK, mainnet sorun)

### 4.7 FA / Dev Fund Application Dokümanları

| Doküman | Durum |
|---|---|
| `docs/devnet-application.md` | **Draft mevcut**, incomplete (checklist 81-88 unchecked) |
| **Featured App submission** (canton.foundation format) | ❌ **YOK — yazılacak** |
| **Dev Fund grant proposal** (canton-foundation/canton-dev-fund format) | ❌ **YOK — yazılacak** |
| CHANGELOG v0.3.0 sync | ❌ **YOK — yazılacak** |

### 4.8 Roadmap vs Reality

| Claim | Gerçek |
|---|---|
| Phase 1: Foundation ✅ | ✅ 10 Daml module, backend engines, React UI |
| Phase 2: DEX Aggregation ✅ | ✅ Smart Order Router (Cantex + Temple), price oracle |
| Phase 3: Devnet "In Progress" | ⚠️ %20 — DAR v0.3.0 built ama **devnet deployment yok** (CI 0.2.0'a stuck), **TestNet live** (not in roadmap) |
| Phase 4: Mainnet "Planned" | ❌ %0 — tarih yok, CANTON-ECONOMICS suggests 2027+ |
| Stop-loss / take-profit | ❌ ROADMAP claim, kod yok |
| Multi-portfolio | ❌ UI tek portfolio per user |

**Roadmap güncellenmeli** — TestNet live durumu belirtilmeli (şu an sadece "devnet planlı" deniyor).

### 4.9 Reviewer Skim Test — Institutional Seriousness: 6.5/10

**İyi görünen:**
Daml (10 module, 4300 LOC test), TypeScript/Express, React/Vite, Prometheus+Grafana, SECURITY.md+circuit breaker, live demo + open-source + YouTube

**Red flag:**
1. CHANGELOG 5 gün stale, versions mismatch (daml.yaml 0.3.0 vs CI 0.2.0)
2. Frontend E2E "claim" var ama scope incomplete
3. Turkish internal docs public
4. CI incomplete (frontend gap, DAR hardcoded)
5. 4 gün submission, Phase 3 tamamlanmamış

---

## 5. Cross-Cutting P0 Problem Matrisi

Aşağıdaki 10 madde FA başvuru öncesi **çözülmeli**. Sıralama fix süresi + etkiye göre.

| # | Problem | Kategori | Fix Süresi | Etki |
|---|---|---|---|---|
| 1 | CHANGELOG v0.3.0 sync | Docs | 30 dk | Reviewer guvensizligi |
| 2 | CI hardcoded DAR 0.2.0 path | CI | 15 dk | Release discipline |
| 3 | Turkish internal docs → private | Hygiene | 15 dk | Reputation risk |
| 4 | `systemd User=root` → unprivileged | Deploy | 30 dk | Security |
| 5 | TestNet badge + demo banner persistent | Frontend | 1 saat | Transparency |
| 6 | Admin party validation engine-level | Backend | 1 saat | Runtime safety |
| 7 | LandingV2 XSS (dangerouslySetInnerHTML) | Security | 15 dk | CVE risk |
| 8 | TransferInstruction factory entegrasyonu | Daml/CIP | 4-6 saat | CIP-0056 compliance |
| 9 | Idempotency race → per-key lock | Backend | 2-4 saat | Financial safety |
| 10 | 3 missing test module (DCA/Whitelist/Preapproval) | Daml | 4-6 saat | Test coverage claim |

**Toplam fix süresi:** ~14-20 saat fokuslu çalışma (2-3 gün).

---

## 6. FA Başvuru Hazırlık Checklist

### A. Teknik (committee gözünden)

**MUTLAKA (blocker):**
- [ ] CHANGELOG.md v0.3.0 entry
- [ ] `ci.yml` DAR path wildcard / extract from daml.yaml
- [ ] CIP-0056 TransferInstruction factory integration
- [ ] Frontend TestNet badge + "Demo preview" banner (persistent)
- [ ] systemd User=root → roil
- [ ] `Turkish` raporları → private `docs-internal/` veya başka repo
- [ ] Backend idempotency per-key lock
- [ ] `LandingV2.tsx:185` dangerouslySetInnerHTML fix

**İYİ OLUR (1-2 gün):**
- [ ] Ledger pagination loop
- [ ] Admin party allocation verification
- [ ] TestDCA / TestWhitelist / TestTransferPreapproval
- [ ] Route guards (isLoading check)
- [ ] xReserve 60s → 30s poll + push notification hook
- [ ] Circuit breaker atomic state

### B. Dokümantasyon (FA submission için)

- [ ] **Featured App başvuru draft**
  - Network impact statement (transaction volume projection)
  - User flow walkthrough (5dk video için script)
  - 6 aylık kullanım forecast
  - Splice integration kanıtları (DAR dependencies listesi)
  - Roil'in CIP uyumluluk matrisi (yukarıdaki tabloyu sanitize edilmiş halde)
- [ ] **Dev Fund grant proposal draft**
  - Bütçe: ~$10,750 (Treasury $10K + traffic seed $750)
  - Milestone schedule (MainNet launch + 3 ay)
  - Team + deliverables
- [ ] Public README'yi freshen (v0.3.0 features, live TestNet URL)
- [ ] ARCHITECTURE.md'ye TestNet topology ekle
- [ ] SECURITY.md'yi v0.3.0 ile hizala

### C. Deploy durumu

- [x] TestNet v0.3.0 DAR yüklendi (`/root/roil-finance-0.3.0.dar`) ← 2026-04-11
- [x] `https://api.roil.app` TLS + reverse proxy ← 2026-04-16 (today)
- [x] Admin party env fill (CC=DSO, USDCx=operator, 7 mock) ← today
- [x] JWT_SECRET rotate ← today
- [x] CORS `roil.app`, `api.roil.app` whitelist ← today
- [x] Frontend `VITE_BACKEND_URL=https://api.roil.app` + redeploy ← today
- [ ] MainNet VPS kurulum (Docker + Splice + grpcurl) → 2026-04-20
- [ ] Pedro'dan onboarding secret → 2026-04-20
- [ ] FA başvurusu (TestNet running app ile) → 2026-04-20–2026-05-04

---

## 7. 4-5 Günlük Sprint Planı

### Gün 1 — 2026-04-16 (Bugün, akşama kadar)
- [x] TLS/Caddy + api.roil.app ← DONE ✅
- [x] Admin party env + JWT rotate ← DONE ✅
- [x] CORS + frontend env redeploy ← DONE ✅
- [ ] CHANGELOG.md v0.3.0 entry (30 dk)
- [ ] `.github/workflows/ci.yml` DAR wildcard (15 dk)
- [ ] Turkish raporları `docs-internal/` → `.gitignore` (15 dk)
- [ ] `docker-compose.override.yml` ile systemd User=root fix (30 dk)
- [ ] LandingV2 XSS fix (15 dk)

### Gün 2 — 2026-04-17
- [ ] **TransferInstruction factory integration** (4-6 saat) — P0 Daml blocker
- [ ] TestDCA.daml (1.5 saat)
- [ ] TestWhitelist.daml (1 saat)
- [ ] TestTransferPreapproval.daml (1.5 saat)
- [ ] DAR v0.3.1 build + TestNet upload

### Gün 3 — 2026-04-18
- [ ] Backend idempotency per-key lock (2-4 saat)
- [ ] Backend admin party allocation verification at engine startup (1 saat)
- [ ] Backend ledger pagination (2-3 saat)
- [ ] Frontend TestNet badge + demo banner persistent (1 saat)
- [ ] Frontend protected route guards (1 saat)

### Gün 4 — 2026-04-19
- [ ] **FA başvuru draft** (4 saat) — deliverable
- [ ] **Dev Fund draft** (2 saat) — deliverable
- [ ] Full integration test: wallet connect → onboarding → xReserve deposit → swap → rebalance (3 saat)
- [ ] 5 dk pitch video kayıt (2 saat)

### Gün 5 — 2026-04-20 (MainNet Day)
- [ ] MainNet VPS Docker + Splice install (2 saat)
- [ ] Pedro'dan onboarding secret → MainNet validator start (1 saat)
- [ ] **FA submission** (canton.foundation/featured-app-request) 🎯
- [ ] **Dev Fund submission** (github.com/canton-foundation/canton-dev-fund) 🎯

---

## 8. Neden TransferInstruction Factory P0?

Canton Foundation'ın FA approve sürecinde en çok baktığı şey **CIP-0056 compliance + Splice standards entegrasyonu**. Bizim şu anki durumumuz:

- `main/dars/splice-api-token-transfer-instruction-v1-1.0.0.dar` **zaten yüklü** (bin dosya var)
- Ama `main/daml.yaml` bu DAR'ı **`data-dependencies` listesinde deklare etmiyor** (sadece 3 splice DAR: featured-app, token-holding, token-metadata)
- Sonuç: kendi `TokenTransfer.TransferRequest` / `SwapRequest` template'lerimiz var, bunlar **log-based, atomik değil**

**Neden kritik:**
- CIP-0056 standart transfer işleminin **ledger state ile contract state arasında atomicity** garantisi verir
- Biz custom log kullanınca: backend Ledger API üzerinden 2 ayrı submit yapar, biri patlarsa divergence olur
- Review edenler bunu görecektir — "neden standard'ı kullanmıyorsunuz?"

**Fix süresi:** 4-6 saat. Adımlar:
1. `main/daml.yaml` → `data-dependencies` altına `splice-api-token-transfer-instruction-v1-1.0.0.dar` ekle
2. `TokenTransfer.daml` → `TransferRequest`'i TransferInstruction factory pattern'ine çevir
3. `test/TestTokenTransfer.daml` güncelle
4. Backend `ledger.ts` / `engine/rebalance.ts` → yeni factory exercise akışına adapte
5. DAR build + CI + TestNet upload

---

## 9. Profesyonel Örnekler — TestNet App Nasıl Sunulur

**Aave (TestNet Sepolia):**
- Header'da "🟡 Sepolia Testnet" badge (her sayfa)
- Connect wallet olmadan: Markets görünür (read-only), user dashboard EMPTY
- Connect sonrası: user'ın gerçek (boş) portfolio'su
- Transaction her zaman explorer link'i ile

**Uniswap V4 (TestNet):**
- Top banner "You're on a testnet. These are not real funds."
- Swap UI fully fonksiyonel ama user data empty
- "Get testnet tokens" faucet link prominent

**Compound (TestNet):**
- "Testnet" yazısı sidebar'da kalıcı chip (yellow)
- Empty state "Deposit to begin earning" CTA

**Roil'in şu anki durumu:** Üç örneğin tersine — demo mock data her zaman prominent. FA committee için en kolay düzeltme: **TestNet badge + Demo Preview banner persistent**, 1 saatlik iş.

---

## 10. Sonuç

**Sert gerçek:** Bu repo güçlü bir teknik temele sahip. 16K satır backend, 1.8K satır Daml, 4.3K satır test, comprehensive feature set. **Problem kod kalitesi değil, disiplindir:** CHANGELOG güncel olsa, CI DAR doğru build etse, Türkçe raporlar private olsa, frontend demo warning gösterse — bu rapor 8.5/10 skorla biterdi.

**4 günün önceliği:** CIP-0056 TransferInstruction + 3 eksik Daml test + 6 docs/config fix. Gerisi (P1/P2) submission sonrası 2-hafta FA onay bekleme süresinde çözülür.

**Başvuru verdict:** Yukarıdaki sprint plan izlenirse **2026-04-20 ile 2026-05-04 arası submit edilebilir**. Şu haliyle (2026-04-16 state) submit edilirse conditional feedback dönme ihtimali %70+.

---

## Kaynaklar

- [Canton CIP-0056 Token Standard](https://docs.digitalasset.com/integrate/devnet/integrating-with-canton-network/index.html)
- [Canton CIP-0047 Featured App Activity Markers](https://www.canton.network/blog/earn-with-every-transaction-continuous-transaction-based-revenue-for-apps-and-assets-on-canton)
- [USDCx via Circle xReserve](https://docs.digitalasset.com/usdc/xreserve/workflows.html)
- [Featured App Application](https://canton.foundation/featured-app-request/)
- [Canton Dev Fund](https://github.com/canton-foundation/canton-dev-fund/)
- [Splice Scan API](https://docs.sync.global/app_dev/scan_api/scan_cc_reference_data_api.html)
- [BitSafe CBTC](https://www.canton.network/blog/cbtc-launch-on-canton-network-wrapped-bitcoin-as-institutional-grade-collateral)

---

**Rapor hazırlayan:** Pre-application audit — 4 paralel agent denetimi + cross-referenced live TestNet state
**Bir sonraki review:** Sprint günü 3 sonu (2026-04-18 akşam) P0 fix'lerinin tamamlanması

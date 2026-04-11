# Canton Network Ekonomi Raporu — Roil Strateji Belgesi

> Hazırlanma: 10 Nisan 2026
> Amaç: MainNet'te maksimum CC kazanımı için strateji belirleme

---

## 1. CC (Canton Coin) Arz Takvimi

Canton Coin'de pre-mine yok, VC allocation yok. Her CC dolaşımdaki coin, kazanılarak elde edilmiş.

| Dönem | Yıllık Basım | App Builder'lar | Validator'lar | Super Validator'lar |
|--------|-------------|-----------------|---------------|---------------------|
| 0-0.5 yıl (Tem-Ara 2024) | 40B | %15 | %5 | %80 |
| 0.5-1.5 yıl (Oca-Haz 2025) | 20B | %40 | %12 | %48 |
| **1.5-5 yıl (Tem 2025-Haz 2029)** | **10B** | **%62** | **%18** | **%20** |
| 5-10 yıl (Tem 2029-Haz 2034) | 5B | %69 | %21 | %10 |
| 10+ yıl (Tem 2034+) | 2.5B/yıl | %75 | %20 | %5 |

**Biz şu an 1.5-5 yıl dilimindeyiz.** Bu, app builder'lar için en avantajlı dönem:
- App builder pool: **%62** (aylık ~516M CC)
- Validator pool: **%18**
- İkisini birden yaparsak (validator + app): **%80'ine** erişim

### Güncel Network İstatistikleri (~Nisan 2026)
- Dolaşımdaki arz: ~38.15 milyar CC
- Günlük basım: ~51.5M CC
- Günlük yakım: ~$2.4M (~$875M yıllık)
- Burn/Mint oranı: ~0.65-0.70 (yükselen trend)
- CC fiyat aralığı: $0.059-$0.194 (lansmandan beri)
- Aktif validator: 840+
- Super Validator: 42+ kurum, 26 aktif

---

## 2. Round Sistemi (10 Dakikalık Döngü)

Her 10 dakikada bir yeni `OpenMiningRound` oluşturulur. Her round 5 fazdan geçer:

1. **Fee Writing** — Ücret değerleri ledger'a yazılır
2. **Activity Recording** — Aktivite kayıtları oluşturulur ve mevcut round'a atanır
3. **Calculation** — Her kayıt tipi için CC-issuance-per-weight hesaplanır
4. **Minting** — Kayıt sahipleri, ağırlıkları oranında CC basabilir
5. **Completion** — Round kapanır

### Aktivite Kayıt Tipleri (5 adet)

| Kayıt Tipi | Kim Oluşturur | Kim Kazanır | Açıklama |
|------------|--------------|-------------|----------|
| `AppRewardCoupon` | SV otomasyonu | App provider | Featured app aktivitesi sonrası |
| `FeaturedAppActivityMarker` | App provider | → AppRewardCoupon'a dönüşür | Marker, SV tarafından coupon'a çevrilir |
| `ValidatorRewardCoupon` | Otomatik | Validator | Her `AmuletRules_Transfer` veya CC yakımında |
| `ValidatorLivenessActivityRecord` | Otomatik | Validator | Proof-of-life (CIP-0096 ile kaldırılıyor) |
| `SvRewardCoupon` | Her SV | Super Validator | Her round'da her SV bir tane oluşturur |

**Kritik:** Reward'lar round penceresi içinde mint edilmezse **expire** olur.

---

## 3. Fee Yapısı

### CC Transfer Ücretleri: **SIFIR** (CIP-0078 ile kaldırıldı)
- Oluşturma ücreti: $0.00
- Transfer ücreti: $0.00
- Kilit tutucu ücreti: $0.00
- Girdi toplamı = çıktı toplamı (her transferde)

### Holding Ücreti: **AKTİF**
- Oran: **Yıllık $1 / UTXO** (coin kontratı başına, miktar fark etmez)
- Transfer sırasında tahsil edilmez, coin expire olduğunda kesilir
- $0.01'lik bir UTXO ~3.65 gün yaşar
- **Strateji:** Küçük UTXO'ları düzenli olarak birleştir

### Synchronizer Traffic Ücreti: **ANA YAKIM KAYNAĞI** (tüm yakımın %94.8'i)
- Oran: **~$60/MB** (yakın zamanda $25/MB'den artırıldı)
- USD cinsinden, güncel on-chain kur üzerinden CC yakılarak ödenir
- Kur: SV'lerin medyan oylamasıyla belirlenir
- **Ücretsiz katman:** `burstAmount` byte, `burstWindow` içinde (örn: 400KB / ~20 dakika)
- Otomatik yenilenme: bir `burstWindow` inaktivite sonrası tamamen dolur
- Auto top-up: `hedef throughput x minimum top-up aralığı`

### Pre-Approval Maliyeti
- ~$1 / 90 gün / party

---

## 4. App Provider Reward Sistemi (Featured App)

### Mevcut Aylık Havuz
- Toplam reward'ların **%62'si** → aylık **~516 milyon CC**
- Round başına traffic payına oranla dağıtılır

### Reward Hesaplama Formülü
```
(Senin Aylık TX / Toplam Network TX) × (Aylık Mintable CC × CC Fiyat) = Aylık USD Kazanç
```

**Örnek:** 100K aylık TX / 40M toplam, 516M CC, $0.15/CC:
- (100K / 40M) × (516M × $0.15) = **$193,500/ay**

### İşlem Başına Üst Sınır (CIP-0098)
- Maksimum: **İşlem başına $1.50** app reward
- Düşük ağ aktivitesinde orantısız getiriyi önler

### Traffic Fee İadesi
- App provider traffic ücretini kendisi öderse: **%20 iade** (validator rewards pool'undan)
- Toplam kazanım potansiyeli: oluşturulan traffic ücretlerinin **%170'ine** kadar

### Featured App Çarpanı
- Her Featured App işlemi, **$1 ek yakım** gibi bonus ağırlık alır
- Orijinal çarpan üst sınırı: **100x**
- **Featured olmayan app'ler SIFIR reward kazanır** (CIP-0078 ile)

### CIP-0104: Traffic Tabanlı Ölçüm (Yeni Sistem)
- Marker tabanlı sistemi (`FeaturedAppActivityMarker`) doğrudan traffic ölçümüyle değiştiriyor
- Onay isteklerinden kaynaklanan traffic maliyeti, app provider'lara orantılı olarak dağıtılır
- Round başına uygun party başına bir coupon (eşik: minimum $0.50)
- Coupon'lar 24 saat geçerli (toplu mint'e izin verir)
- 5 fazlı geçiş, faz 2-4 arası minimum 30 gün

### Featured App Olma Gereksinimleri
1. [canton.foundation/featured-app-request](https://canton.foundation/featured-app-request/) adresinden başvur
2. MainNet lansmanından **2 hafta** içinde olmalı
3. Tokenomics Komitesi inceleme süresi: ~2 hafta
4. 5 dakikalık sunum + Q&A gerekebilir
5. Onay sonrası: 1 aylık istatistik raporu, sonra üç ayda bir rapor
6. Onaylanan kapsam dışına çıkılırsa 2 hafta düzeltme süresi

### Referans: En İyi App Kazançları
- Hashnote USYC, 3Trade, Brale: **aylık 100M - 500M CC**

---

## 5. Validator Reward Sistemi

### Üç Kazanç Yöntemi

#### 1. Proof-of-Life (Liveness) — KALDIRILIYOR
- Eskiden: validator reward'ların %70'i sırf node çalıştırmaktan geliyordu
- **CIP-0096:** Aşamalı azaltma, **30 Nisan 2026'da tamamen sıfır**
- Artık sadece node çalıştırmak para kazandırmıyor

#### 2. Transaction Reward (ValidatorRewardCoupon) — ANA KAYNAK
- Her `AmuletRules_Transfer` veya CC yakımında oluşturulur
- Validator'da host edilen kullanıcıların ödediği ücretlerle orantılı
- **Daha fazla kullanıcı = daha fazla reward**

#### 3. App Reward Paylaşımı
- App provider'lar beneficiary weight'leri ile validator'larla paylaşabilir
- Dual-role operatör olarak her iki tarafı da yakalarsın

### Mevcut Validator Pool
- Toplam reward'ların **%18'i** (1.5-5 yıl fazında)
- 840+ aktif validator node
- Tahmini APY: erken dönemde **%10-15** (dalgalanıyor)

### CIP-0096 Sonrası Gerçek
- Bedavacı teşvikleri kaldırıldı
- Kullanıcısı olmayan boş validator **çok az** kazanır
- **Kendi app'inin kullanıcılarını host eden** validator en çok kazanır

---

## 6. Kritik CIP'ler (Bizi Etkileyen)

### Tokenomics CIP'leri
| CIP | İsim | Durum | Etki |
|-----|------|-------|------|
| CIP-0078 | CC Fee Removal | Aktif | Transfer ücreti sıfır, traffic ücreti ana yakım kaynağı |
| CIP-0082 | Development Fund | Aktif | Tüm basımdan %5 fon, DeFi likidite desteği dahil |
| CIP-0096 | Liveness Kaldırma | 30 Nis 2026'da tamamlanır | Boş validator reward'ı sıfır |
| CIP-0098 | App Reward Cap | Aktif | İşlem başına maks $1.50 |
| CIP-0100 | Dev Fund Governance | Aktif | CIP-0082 üzerine yönetim |
| CIP-0104 | Traffic Tabanlı App Rewards | Geçiş sürecinde | Marker yerine gerçek traffic ölçümü |
| CIP-0105 | SV Locking | Aktif | %70 kilitle = %100 ağırlık (SV'ler için) |

### Standards Track CIP'leri
| CIP | İsim | Durum | Etki |
|-----|------|-------|------|
| CIP-0056 | Canton Token Standard | Aktif | Splice DAR interface'leri (Holding, Allocation, vb.) |
| CIP-0086 | ERC-20 Middleware | Aktif | Cross-chain köprü |
| CIP-0103 | dApp Standard | Aktif | dApp spesifikasyonları |
| CIP-0107 | 24h Submission Delay | Aktif | Son kullanıcı TX gecikmesi |
| CIP-0112 | Token Standard V2 | Draft | Gelecek iyileştirmeler |

---

## 7. Development Fund (CIP-0082 + CIP-0100)

- Tüm CC basımının **%5'i** Foundation yönetiminde fona ayrılır
- Uygun harcamalar: core R&D, dev tools, güvenlik, audit, referans implementasyonlar, **DeFi app likidite desteği**, kritik altyapı
- **Milestone bazlı** hibeler, doğrudan builder'lara verilir
- Üç ayda bir rapor + yıllık bağımsız denetim
- GitHub: [canton-foundation/canton-dev-fund](https://github.com/canton-foundation/canton-dev-fund/)

**Roil için:** DeFi app likidite desteği açıkça uygun harcama olarak listeleniyor. Treasury likiditesi veya geliştirme maliyetleri için hibe başvurusu yapılabilir.

---

## 8. Super Validator Sistemi (Referans)

SV olmak kurumsal düzeyde (Nasdaq, Visa, Apollo, DTCC gibi isimler). Bizi doğrudan etkilemiyor ama bilgi olarak:

- 42+ izinli kurum, 26 aktif
- Ağırlık sistemi: Tier 1 (10) → Tier 4 (0.5)
- CIP-0105: %70 kilitleme = %100 ağırlık, açma süresi 1 yıl lineer
- SV pool: şu an %20, 2029'da %10, 2034'te %5
- En büyük 13 SV: ~20.2B CC (~$3B) kilitli → deflasyonist etki

---

## 9. Roil İçin MainNet Strateji Planı

### Gelir Kanalları (Dual-Role: Validator + App Provider)

```
┌─────────────────────────────────────────────────────┐
│                   ROİL GELİR MODELİ                  │
├──────────────────────┬──────────────────────────────┤
│ App Rewards (%62)    │ Her TX → AppRewardCoupon      │
│                      │ Maks $1.50/TX                 │
│                      │ Traffic payına oranla          │
├──────────────────────┼──────────────────────────────┤
│ Validator Rewards    │ Host edilen kullanıcı TX'leri │
│ (%18)                │ → ValidatorRewardCoupon        │
├──────────────────────┼──────────────────────────────┤
│ Traffic Fee İadesi   │ Traffic ücretini öde          │
│ (%20 iade)           │ → %20 geri al                 │
├──────────────────────┼──────────────────────────────┤
│ Dev Fund Hibesi      │ DeFi likidite desteği başvuru │
├──────────────────────┼──────────────────────────────┤
│ CC Değer Artışı      │ Yakım > Basım = Deflasyon     │
└──────────────────────┴──────────────────────────────┘
```

### İşlem Başına Maksimum Kazanım
- App reward: $1.50
- Traffic fee iadesi: $0.20 (eğer $1 traffic ücreti ödediysen)
- Validator transaction reward: orantılı
- **Toplam potansiyel: oluşturulan traffic ücretlerinin %170'ine kadar**

### Aksiyon Planı (Öncelik Sırasına Göre)

#### 1. Featured App Başvurusu (EN KRİTİK)
- [canton.foundation/featured-app-request](https://canton.foundation/featured-app-request/)
- MainNet lansmanından 2 hafta içinde başvur
- Featured olmayan app = **SIFIR reward**
- 5 dakikalık sunum hazırla

#### 2. Transaction Hacmi Maksimize Et
- Her swap, DCA, rebalance, transfer = traffic = reward
- %62 pool az sayıda featured app arasında paylaşılıyor
- Erken giren orantısız pay alır

#### 3. Kullanıcıları Kendi Validator'ında Host Et
- Roil kullanıcılarının TX'leri → `ValidatorRewardCoupon`
- App + Validator reward dual capture

#### 4. Traffic Ücretlerini Kullanıcı Adına Öde
- ~$60/MB synchronizer ücreti
- %20 iade kazanırsın
- Kullanıcı için sürtünme azalır

#### 5. Dev Fund Hibesi Başvurusu
- DeFi likidite desteği açıkça uygun
- Treasury likiditesi için başvur
- Milestone bazlı, doğrudan ödeme

#### 6. Beneficiary Weight Optimizasyonu
- App reward'larını Roil app party + Roil validator party arasında paylaştır
- İki pool'dan da maksimum capture

#### 7. UTXO Konsolidasyonu
- Holding ücreti: yıllık $1/UTXO
- Küçük miktarları düzenli birleştir, erimesin

#### 8. CIP Pipeline Takibi
- CIP-0104 (traffic tabanlı) geçişi izle
- CIP-0096 (liveness kaldırma) 30 Nisan 2026
- CIP-0112 (Token Standard V2) draft aşamasında

---

## 10. Maliyet-Gelir Projeksiyonu (Tahmini)

### Sabit Maliyetler
| Kalem | Aylık |
|-------|-------|
| DevNet VPS (1000 G12) | €11.56 |
| TestNet VPS (500 G12) | €6.60 |
| MainNet VPS (500 G12) | €6.60 |
| Domain (roil.app) | ~€1 |
| **Toplam altyapı** | **~€26/ay** |

### Değişken Maliyetler
| Kalem | Birim Maliyet |
|-------|--------------|
| Synchronizer traffic | ~$60/MB |
| Pre-approval | ~$1/90 gün/party |
| Holding fee | $1/yıl/UTXO |

### Potansiyel Gelir (Senaryo Bazlı)

| Senaryo | Aylık TX | CC Kazanım | USD (@ $0.15/CC) |
|---------|----------|-----------|-------------------|
| Başlangıç | 1,000 | ~12,900 CC | ~$1,935 |
| Büyüme | 10,000 | ~129,000 CC | ~$19,350 |
| Olgun | 100,000 | ~516,000 CC+ | ~$77,400+ |
| Hedef | 1,000,000 | ~1.29M CC+ | ~$193,500+ |

*Not: Gerçek kazanımlar network aktivitesine, CC fiyatına ve featured app sayısına bağlı olarak değişir.*

---

## 11. Splice Dokümanlarından Ek Detaylar

### Gerçek Issuance Değerleri (MainNet Round 20788)
| Kayıt Tipi | Round Başına CC |
|------------|----------------|
| `ValidatorRewardCoupon` | 0.2 CC / coupon |
| `FeaturedAppRewardCoupon` | 100.0 CC / coupon |
| `SvRewardCoupon` | 0.4058 CC / weight unit |
| `ValidatorFaucetCoupon` | 324.01 CC / validator |

Bu demek ki: her featured app activity marker = **100 CC** ($0.15/CC'de = **$15**). Bu, web araştırmasındaki "$1 per marker" tahminiyle çelişiyor — gerçek değer çok daha yüksek olabilir (CC fiyatına bağlı).

### FeaturedAppActivityMarker V2 — Weight Parametresi
- V2 API (CIP-0047) `weight` parametresi destekliyor (>= 1.0)
- `weight: 5` olan tek bir marker = 5 adet `weight: 1` marker'a eşit
- **Composed transaction'lar:** Settlement işleminde trading venue + tüm asset registry'ler ayrı marker alabilir = işlem başına çoklu reward

### TransferPreapproval — Gizli Gelir Kaynağı
- Kullanıcılar için `TransferPreapproval` oluşturursanız, her gelen CC transferi sizin app'inize featured app reward kazandırır
- Maliyet: $1/yıl per party
- Siz `provider` olursunuz → `AppRewardCoupon` sizin

### Traffic Detayları
- `readVsWriteScalingFactor: 4` basis point (10,000 üzerinden)
- 1MB mesaj + 10 alıcı = 1,040,000 byte charge (çoklu alıcıda maliyet artar)
- `minTopupAmount: 200000` byte minimum per purchase
- Başarısız submission'lar da traffic tüketir (contention durumunda)
- Auto-top-up deadlock riski: yeterli reserve bırakılmalı

### Validator Party Limiti
- Maks **200 Splice wallet party** per validator (kaldırılması bekleniyor)
- Workaround: Ledger API üzerinden `ValidatorRight` olmadan external party oluştur → limiti bypass et
- Yüksek party sayısı için topology batch size'ı 20'ye çıkar

### Ek CIP'ler (VPS Dokümanlarından)
| CIP | İsim | Etki |
|-----|------|------|
| CIP-0003 | Validator Faucet | Liveness reward mekanizması |
| CIP-0042 | Traffic Price Calibration | $60/MB fiyatlandırma |
| CIP-0047 | Featured App Activity Markers | Non-CC-transfer app rewards + V2 weight |
| CIP-0051 | Streamlined Voting | Governance oylaması |
| CIP-0066 | Mint from Unclaimed Pool | Expire olmuş SV reward'ları geri kazanma |
| CIP-0073 | Weighted Validator Liveness | External party reward desteği |
| CIP-0089 | (Referenced) | CIP repo'da mevcut |
| CIP-0102 | Tharimmune SV Addition | Weight 4 SV ekleme |
| CIP-0103 | Vendor-neutral dApp API | dApp bağlantı standardı |

### IssuanceConfig Parametreleri
```
amuletToIssuePerYear     — Yıllık toplam CC basımı
validatorRewardPercentage — Validator pool yüzdesi
appRewardPercentage      — App pool yüzdesi
validatorRewardCap       — Validator reward üst sınırı
featuredAppRewardCap     — Featured app reward üst sınırı
unfeaturedAppRewardCap   — Unfeatured app reward (0.6 CC — neredeyse sıfır)
optValidatorFaucetCap    — Faucet üst sınırı (CIP-0096 sonrası $0)
optDevelopmentFundPercentage — Dev fund yüzdesi (%5)
```

---

## 12. Güncellenmiş Strateji Notları

VPS dokümanlarından gelen ek bilgilerle strateji güncellemesi:

### Featured App Reward Gerçek Değeri
Web araştırması "~$1/marker" diyordu ama gerçek issuance verileri **100 CC/marker** gösteriyor. CC fiyatına göre:
- $0.05/CC → $5/marker
- $0.10/CC → $10/marker
- $0.15/CC → $15/marker

Bu, işlem hacmi stratejisini **çok daha kritik** yapıyor.

### V2 Weight Kullanımı
Roil'un her işlemi için weight parametresini stratejik kullan:
- Basit swap: weight 1
- Multi-leg rebalance (3 swap): weight 3
- DCA + compound: weight 2

### TransferPreapproval Stratejisi
Her Roil kullanıcısı için TransferPreapproval oluştur:
- Yıllık $1/kullanıcı maliyet
- Her gelen CC transferi = featured app reward
- Roil `provider` olarak tüm gelen transferlerden kazanır

### Auto-Top-Up Konfigürasyonu
```
target_throughput = tahmini bytes/saniye
min_topup_interval = saniye
top_up_amount = target_throughput × min_topup_interval
```
Reserve yeterli tutulmalı, deadlock önlenmeli.

---

## 13. KARARLAR VE YAPILACAKLAR

### Karar 1: Featured App (FA) Basvurusu — EN KRITIK

**Neden:** FA olmadan reward SIFIR. FA olduktan sonra her islem 100 CC (~$15) kazandiriyor.

**Basvuru:** [canton.foundation/featured-app-request](https://canton.foundation/featured-app-request/)

**Zamanlama:** MainNet 20 Nisan'da aciliyor. Basvuru MainNet'e ciktiktan sonra 2 hafta icinde yapilmali (4 Mayis'a kadar). Ama erken basvurmakta sakinca yok — TestNet'te calisan app ile simdiden basvurulabilir.

**Sunum:** 5 dakikalik sunum + Q&A gerekebilir. Hazirlanacak:
- Roil ne yapar (treasury management, swap, DCA, portfolio rebalance)
- Kullanici akisi (swap yap → marker olusur → reward kazanilir)
- Teknik entegrasyon (Splice DAR'lar entegre, FeaturedAppRight exercise ediliyor)

**Sonrasi:** 1 aylik istatistik raporu, sonra 3 ayda bir rapor

**Durum:** [ ] YAPILACAK

---

### Karar 2: Dev Fund Hibe Basvurusu — Likidite + Traffic Seed

**Neden:** Iki sey icin baslangic CC'si lazim:
1. Treasury swap likiditesi ($10K degerinde CC/USDCx/CBTC)
2. Traffic fee seed fund (kullanicilarin traffic fee'sini karsilamak icin)

**Basvuru:** [canton-foundation/canton-dev-fund](https://github.com/canton-foundation/canton-dev-fund/)

**Ne kadar:**
- Treasury likiditesi: ~$10,000 degerinde token
- Traffic seed: ~$750 degerinde CC (5,000 CC, 1 ay yeter)
- Toplam talep: ~$10,750

**Neden verilmeli:**
- "DeFi app liquidity seeding" acikca uygun harcama olarak listeleniyor
- Roil calisan bir urun, validator aktif, Splice entegrasyonu tamam
- Milestone bazli: 1. likidite ekle, 2. FA ol, 3. ilk 100 kullanici

**Durum:** [ ] YAPILACAK

---

### Karar 3: Traffic Fee Subsidization — Kullanici Adina Odeme

**Neden:** 12.5x ROI. Her islem icin ~$1.20 traffic fee odeyip ~$15 app reward kazaniyoruz.

**Nasil calisir:**
```
Kullanici swap yapar
    → Islem synchronizer'a gider
    → Roil validator CC yakarak traffic fee oder (~$1.20/swap)
    → FeaturedAppActivityMarker olusur
    → SV otomasyonu → AppRewardCoupon (100 CC = ~$15)
    → + %20 traffic fee iadesi ($0.24)
    → + ValidatorRewardCoupon (orantili)
```

**Maliyet-Gelir Tablosu:**

| Kullanici Sayisi | Gunluk Swap | Traffic Maliyeti | App Reward | Net Kar |
|-----------------|-------------|-----------------|------------|---------|
| 10 | 10 | $12/gun | $150/gun | $138/gun |
| 50 | 50 | $60/gun | $750/gun | $690/gun |
| 100 | 100 | $120/gun | $1,500/gun | $1,380/gun |
| 500 | 500 | $600/gun | $7,500/gun | $6,900/gun |

**Gerekli:**
- Validator cuzdaninda CC bakiyesi (auto-top-up icin)
- Auto-top-up konfigurasyonu (start.sh'da otomatik)
- Baslangic icin ~1,000-5,000 CC ($150-750)
- Zamanla kazanilan CC'lerle kendi kendini fonlar

**Durum:** [ ] MAINNET SONRASI AKTIF EDILECEK

---

### Karar 4: Beneficiary Weight Optimizasyonu

**Neden:** App reward'larini Roil app party + Roil validator party arasinda paylastirarak iki pool'dan da capture yapabiliriz.

**Nasil:**
- FeaturedAppRight_CreateActivityMarker cagrilirken `beneficiaries` listesinde:
  - `{beneficiary: roil-app, weight: 0.8}` → App pool'undan
  - `{beneficiary: roil-validator, weight: 0.2}` → Validator pool'undan
- Toplam weight = 1.0

**Durum:** [ ] FA ONAYI SONRASI KONFIGURE EDILECEK

---

### Karar 5: UTXO Konsolidasyonu

**Neden:** Holding fee yillik $1/UTXO. Kucuk CC parcalari birlestirilmezse erir.

**Nasil:** Duzenli olarak kucuk CC UTXO'larini birlestir (MergeDelegation kullan).

**Durum:** [ ] OTOMATIK KONFIGURASYON YAPILACAK

---

### Zaman Cizelgesi

| Tarih | Aksiyon |
|-------|---------|
| Simdi | FA basvurusu hazirla, TestNet'te test et |
| Simdi | Dev Fund hibe basvurusu hazirla |
| 20 Nisan | MainNet node baslat (Pedro'dan secret al) |
| 20 Nisan - 4 Mayis | FA basvurusunu tamamla |
| FA onayi sonrasi | Traffic subsidization aktif et |
| FA onayi sonrasi | Beneficiary weight konfigure et |
| Surekli | UTXO konsolidasyonu, CIP pipeline takibi |

---

## 14. Kaynaklar

- [Canton Coin Tokenomics](https://www.canton.network/blog/canton-coin-flipping-the-script-on-tokenomics)
- [Cantonomics for App Builders](https://www.canton.network/blog/cantonomics-for-app-builders)
- [Earn with Every Transaction](https://www.canton.network/blog/earn-with-every-transaction-continuous-transaction-based-revenue-for-apps-and-assets-on-canton)
- [Canton Coin: Rewarding Utility](https://www.canton.network/blog/canton-coin-rewarding-utility)
- [Canton Coin FDV Analysis](https://www.canton.network/blog/canton-coin-how-should-we-think-about-fdv)
- [Splice Tokenomics Docs](https://docs.global.canton.network.sync.global/background/tokenomics/overview_tokenomics.html)
- [DevNet Tokenomics](https://docs.digitalasset.com/integrate/devnet/tokenomics-and-rewards/index.html)
- [Traffic Fees Docs](https://docs.sync.global/deployment/traffic.html)
- [Featured App Request](https://canton.foundation/featured-app-request/)
- [Canton CIP Repository](https://github.com/canton-foundation/cips)
- [CIP-0078: Fee Removal](https://github.com/canton-foundation/cips/blob/main/cip-0078/cip-0078.md)
- [CIP-0082: Development Fund](https://github.com/canton-foundation/cips/blob/main/cip-0082/cip-0082.md)
- [CIP-0096: Liveness Phase-out](https://github.com/canton-foundation/cips/blob/main/cip-0096/cip-0096.md)
- [CIP-0098: App Reward Cap](https://github.com/canton-foundation/cips/blob/main/cip-0098/cip-0098.md)
- [CIP-0104: Traffic-Based Rewards](https://github.com/canton-foundation/cips/blob/main/cip-0104/cip-0104.md)
- [CIP-0105: SV Locking](https://github.com/canton-foundation/cips/blob/main/cip-0105/cip-0105.md)
- [Canton Dev Fund](https://github.com/canton-foundation/canton-dev-fund/)
- [Coin Metrics Analysis](https://coinmetrics.substack.com/p/state-of-the-network-issue-321)
- [sawinyh.com Tokenomics Analysis](https://sawinyh.com/blog/canton-coin-tokenomics/)

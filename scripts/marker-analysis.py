"""
Empirical analysis of Activity Markers vs envelope-only strategy on MainNet.
Run via SSH on validator VPS.
"""
import sys, json, urllib.request
from collections import defaultdict

WINDOW = "2026-05-20T10:55:00Z"
SCAN = "https://scan.sv-1.global.canton.network.sync.global"

def fetch():
    req = urllib.request.Request(
        f"{SCAN}/api/scan/v0/updates",
        data=json.dumps({
            "page_size": 500,
            "after": {"after_record_time": WINDOW, "after_migration_id": 4}
        }).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

d = fetch()
markers = defaultdict(lambda: {"count": 0, "total_weight": 0.0})
coupons = defaultdict(lambda: {"count": 0, "total_amount": 0.0})

for t in d.get("transactions", []):
    for e in t.get("events_by_id", {}).values():
        tpl = e.get("template_id", "")
        args = e.get("create_arguments", {})
        prov = args.get("provider", "")
        prov_short = prov.split("::")[0] if prov else ""
        if e.get("event_type") != "created_event":
            continue
        if "FeaturedAppActivityMarker" in tpl:
            w = float(args.get("weight", 0))
            markers[prov_short]["count"] += 1
            markers[prov_short]["total_weight"] += w
        elif "AppRewardCoupon" in tpl:
            a = float(args.get("amount", 0))
            coupons[prov_short]["count"] += 1
            coupons[prov_short]["total_amount"] += a

provs = set(list(markers.keys()) + list(coupons.keys()))
print(f"{'Provider':<35} {'MkrCnt':>7} {'MkrWt':>9} {'CpnCnt':>7} {'CpnSum':>10}  STRATEGY")
print("-" * 95)
for p in sorted(provs, key=lambda x: -(markers[x]["total_weight"] + coupons[x]["total_amount"])):
    if not p:
        continue
    m, c = markers[p], coupons[p]
    if m["count"] == 0 and c["count"] == 0:
        continue
    if c["count"] > 0 and m["count"] == 0:
        strat = "ENVELOPE-ONLY"
    elif m["count"] > 0 and c["count"] == 0:
        strat = "MARKER-ONLY"
    else:
        strat = "BOTH"
    print(f"{p[:35]:<35} {m['count']:>7} {m['total_weight']:>9.1f} {c['count']:>7} {c['total_amount']:>10.2f}  {strat}")

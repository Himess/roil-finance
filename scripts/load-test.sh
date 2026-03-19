#!/usr/bin/env bash
set -euo pipefail

# Canton Rebalancer Load Test
# Requires: curl, bash
# Usage: ./scripts/load-test.sh [base_url] [concurrent] [total]

BASE_URL="${1:-http://localhost:3001}"
CONCURRENT="${2:-10}"
TOTAL="${3:-100}"

echo "=== Canton Rebalancer Load Test ==="
echo "Target:      $BASE_URL"
echo "Concurrent:  $CONCURRENT"
echo "Total:       $TOTAL requests"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL_TIME=0

# Test 1: Health endpoint
echo "--- Test 1: GET /health (${TOTAL} requests, ${CONCURRENT} concurrent) ---"
START=$(date +%s%N)

for i in $(seq 1 $TOTAL); do
  (
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
      echo "PASS"
    else
      echo "FAIL:$STATUS"
    fi
  ) &

  # Limit concurrency
  if (( i % CONCURRENT == 0 )); then
    wait
  fi
done
wait

END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))
echo -e "${GREEN}Health: ${TOTAL} requests in ${DURATION}ms ($(( TOTAL * 1000 / (DURATION + 1) )) req/s)${NC}"
echo ""

# Test 2: Portfolio query
echo "--- Test 2: GET /api/portfolio/test-party (${TOTAL} requests) ---"
START=$(date +%s%N)

for i in $(seq 1 $TOTAL); do
  (
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/portfolio/test-party" 2>/dev/null || echo "000")
    echo "$STATUS"
  ) &

  if (( i % CONCURRENT == 0 )); then
    wait
  fi
done
wait

END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))
echo -e "${GREEN}Portfolio: ${TOTAL} requests in ${DURATION}ms ($(( TOTAL * 1000 / (DURATION + 1) )) req/s)${NC}"
echo ""

# Test 3: Rate limiting verification
echo "--- Test 3: Rate limit verification (110 rapid requests) ---"
RATE_LIMITED=0
for i in $(seq 1 110); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
  if [ "$STATUS" = "429" ]; then
    RATE_LIMITED=$((RATE_LIMITED + 1))
  fi
done

if [ $RATE_LIMITED -gt 0 ]; then
  echo -e "${GREEN}Rate limiting working: ${RATE_LIMITED} requests throttled${NC}"
else
  echo -e "${YELLOW}Warning: No rate limiting detected${NC}"
fi
echo ""

# Test 4: Templates endpoint
echo "--- Test 4: GET /api/portfolio/templates ---"
RESPONSE=$(curl -s "$BASE_URL/api/portfolio/templates" 2>/dev/null || echo '{"error":"failed"}')
if echo "$RESPONSE" | grep -q '"success":true'; then
  TEMPLATE_COUNT=$(echo "$RESPONSE" | grep -o '"id"' | wc -l)
  echo -e "${GREEN}Templates: ${TEMPLATE_COUNT} templates returned${NC}"
else
  echo -e "${RED}Templates: Failed${NC}"
fi
echo ""

# Test 5: Readiness probe
echo "--- Test 5: GET /readyz ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/readyz" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  echo -e "${GREEN}Readiness: OK${NC}"
else
  echo -e "${YELLOW}Readiness: ${STATUS} (backend dependencies may be offline)${NC}"
fi
echo ""

echo "=== Load Test Complete ==="

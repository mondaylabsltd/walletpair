#!/bin/bash
# Stability verification: run build+test cycles across all components
# Usage: ./scripts/stability-check.sh [CYCLES]

CYCLES=${1:-10}
PASS=0
FAIL=0
LOG="cycle-results.log"
> "$LOG"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Check vitest success: "Tests  N passed" with no "failed" anywhere
check_vitest() {
  if echo "$1" | grep -q "failed"; then
    return 1
  fi
  echo "$1" | grep -q "passed"
}

# Check cargo test success: "0 failed" in all test result lines
check_cargo() {
  if echo "$1" | grep -q "FAILED\|panicked"; then
    return 1
  fi
  echo "$1" | grep -q "test result: ok"
}

for i in $(seq 1 "$CYCLES"); do
  echo "── Cycle $i/$CYCLES ──" | tee -a "$LOG"

  # SDK
  OUT=$(cd "$ROOT/walletpair-sdk" && npx vitest run --bail=1 2>&1)
  if check_vitest "$OUT"; then
    echo "  SDK: ✅" | tee -a "$LOG"
  else
    FAIL=$((FAIL+1))
    echo "  SDK: ❌" | tee -a "$LOG"
    echo "$OUT" | grep "FAIL\|Error\|❌" >> "$LOG"
    continue
  fi

  # Extension
  OUT=$(cd "$ROOT/walletpair-extension" && npx vitest run --bail=1 2>&1)
  if check_vitest "$OUT"; then
    echo "  Extension: ✅" | tee -a "$LOG"
  else
    FAIL=$((FAIL+1))
    echo "  Extension: ❌" | tee -a "$LOG"
    echo "$OUT" | grep "FAIL\|Error\|❌" >> "$LOG"
    continue
  fi

  # Relay
  OUT=$(cd "$ROOT/walletpair-websocket-relay" && cargo test 2>&1)
  if check_cargo "$OUT"; then
    echo "  Relay: ✅" | tee -a "$LOG"
  else
    FAIL=$((FAIL+1))
    echo "  Relay: ❌" | tee -a "$LOG"
    echo "$OUT" | grep "FAIL\|Error\|❌\|FAILED\|panicked" >> "$LOG"
    continue
  fi

  PASS=$((PASS+1))
done

echo "" | tee -a "$LOG"
echo "FINAL: $PASS/$CYCLES passed" | tee -a "$LOG"
exit $FAIL

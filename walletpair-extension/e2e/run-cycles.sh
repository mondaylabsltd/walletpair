#!/bin/bash
# Automated E2E test cycle runner
# Runs build + unit tests + E2E tests for N cycles, logs results
set -o pipefail

CYCLES=${1:-30}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
SDK_DIR="$(dirname "$EXT_DIR")/walletpair-sdk"
LOG_FILE="$SCRIPT_DIR/cycle-results.log"

echo "============================================" | tee "$LOG_FILE"
echo "  WalletPair E2E Cycle Runner — $CYCLES cycles" | tee -a "$LOG_FILE"
echo "  Started: $(date)" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

TOTAL_PASS=0
TOTAL_FAIL=0

for i in $(seq 1 "$CYCLES"); do
  echo "" | tee -a "$LOG_FILE"
  echo "── Cycle $i/$CYCLES ──────────────────────────" | tee -a "$LOG_FILE"

  # Step 1: Build
  BUILD_OUT=$(cd "$EXT_DIR" && pnpm build 2>&1)
  if echo "$BUILD_OUT" | grep -q "Built extension"; then
    echo "  Build: ✅" | tee -a "$LOG_FILE"
  else
    echo "  Build: ❌ FAILED" | tee -a "$LOG_FILE"
    echo "$BUILD_OUT" >> "$LOG_FILE"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    continue
  fi

  # Step 2: Unit tests (SDK)
  SDK_OUT=$(cd "$SDK_DIR" && npm test 2>&1)
  SDK_TESTS=$(echo "$SDK_OUT" | grep "Tests" | tail -1)
  if echo "$SDK_OUT" | grep -q "passed"; then
    echo "  SDK tests: ✅ $SDK_TESTS" | tee -a "$LOG_FILE"
  else
    echo "  SDK tests: ❌" | tee -a "$LOG_FILE"
    echo "$SDK_OUT" | tail -5 >> "$LOG_FILE"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    continue
  fi

  # Step 3: Unit tests (Extension)
  EXT_UT_OUT=$(cd "$EXT_DIR" && pnpm exec vitest run 2>&1)
  EXT_TESTS=$(echo "$EXT_UT_OUT" | grep "Tests" | tail -1)
  if echo "$EXT_UT_OUT" | grep -q "passed"; then
    echo "  Ext unit: ✅ $EXT_TESTS" | tee -a "$LOG_FILE"
  else
    echo "  Ext unit: ❌" | tee -a "$LOG_FILE"
    echo "$EXT_UT_OUT" | tail -5 >> "$LOG_FILE"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    continue
  fi

  # Step 4: E2E tests
  rm -rf /tmp/walletpair-e2e-profile 2>/dev/null
  E2E_OUT=$(cd "$EXT_DIR" && pnpm test:e2e 2>&1)
  E2E_RESULT=$(echo "$E2E_OUT" | grep "Results:")
  if echo "$E2E_OUT" | grep -q "0 failed"; then
    echo "  E2E: ✅ $E2E_RESULT" | tee -a "$LOG_FILE"
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    echo "  E2E: ❌ $E2E_RESULT" | tee -a "$LOG_FILE"
    echo "$E2E_OUT" | grep "❌" >> "$LOG_FILE"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
done

echo "" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"
echo "  FINAL: $TOTAL_PASS/$CYCLES passed, $TOTAL_FAIL failed" | tee -a "$LOG_FILE"
echo "  Finished: $(date)" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

exit $TOTAL_FAIL

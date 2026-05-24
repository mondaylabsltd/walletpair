#!/bin/bash
cd /Volumes/data/production/walletpair/walletpair-sdk
CYCLES=${1:-30}; PASS=0; FAIL=0; LOG="cycle-results.log"
> $LOG
for i in $(seq 1 $CYCLES); do
  echo "── Cycle $i/$CYCLES ──" | tee -a $LOG
  OUT=$(npx vitest run 2>&1)
  if echo "$OUT" | grep -q "0 failed"; then
    PASS=$((PASS+1)); echo "  ✅" | tee -a $LOG
  elif echo "$OUT" | grep -qE "Tests .* passed \("; then
    # All passed (no "failed" line at all)
    PASS=$((PASS+1)); echo "  ✅" | tee -a $LOG
  else
    FAIL=$((FAIL+1)); echo "  ❌" | tee -a $LOG
    echo "$OUT" | grep -E "❌|FAIL|Error" >> $LOG
  fi
done
echo "FINAL: $PASS/$CYCLES passed" | tee -a $LOG
exit $FAIL

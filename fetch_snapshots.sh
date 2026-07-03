#!/bin/bash
# Fetch Wayback Machine snapshots of nbarankings.theringer.com
# Timestamps from CDX query earlier - status=200 only
# Pick one per distinct period to avoid redundancy

SNAPSHOTS=(
  "20221214222520"   # Dec 2022 - Season 2022-23
  "20230120195414"   # Jan 2023 - Season 2022-23
  "20230330073422"   # Mar 2023 - Season 2022-23
  "20230413214212"   # Apr 2023 - Season 2022-23
  "20231206000517"   # Dec 2023 - Season 2023-24
  "20240215014418"   # Feb 2024 - Season 2023-24
  "20240518183526"   # May 2024 - Season 2023-24
  "20240527054616"   # May 2024 - Season 2023-24 (later)
  "20240819010352"   # Aug 2024 - Season 2023-24
  "20240916144559"   # Sep 2024 - Season 2023-24
  "20241112061602"   # Nov 2024 - Season 2024-25
  "20250128154605"   # Jan 2025 - Season 2024-25
  "20250327022818"   # Mar 2025 - Season 2024-25
  "20250404003329"   # Apr 2025 - Season 2024-25
  "20250524001339"   # May 2025 - Season 2024-25
  "20250620211439"   # Jun 2025 - Season 2024-25
  "20250724134715"   # Jul 2025 - Season 2025-26
  "20250806171427"   # Aug 2025 - Season 2025-26
  "20250901133647"   # Sep 2025 - Season 2025-26
  "20251005180313"   # Oct 2025 - Season 2025-26
  "20251215145256"   # Dec 2025 - Season 2025-26
  "20260111044941"   # Jan 2026 - Season 2025-26
  "20260226190849"   # Feb 2026 - Season 2025-26
)

OUTDIR="/home/user/ringer100/data/snapshots"
mkdir -p "$OUTDIR"

for ts in "${SNAPSHOTS[@]}"; do
  outfile="$OUTDIR/${ts}.html"
  if [ -f "$outfile" ] && [ -s "$outfile" ]; then
    echo "Already have $ts, skipping"
    continue
  fi
  echo "Fetching $ts..."
  curl -sL --cacert /root/.ccr/ca-bundle.crt --max-time 45 \
    "https://web.archive.org/web/${ts}id_/https://nbarankings.theringer.com/rankings" \
    -o "$outfile"
  size=$(stat -c%s "$outfile" 2>/dev/null || echo 0)
  echo "  Size: $size bytes"
  sleep 2
done

# Also fetch current live page
echo "Fetching live page..."
curl -sL --cacert /root/.ccr/ca-bundle.crt --max-time 45 \
  "https://nbarankings.theringer.com/rankings" \
  -o "$OUTDIR/live.html"
size=$(stat -c%s "$OUTDIR/live.html" 2>/dev/null || echo 0)
echo "  Size: $size bytes"

echo "Done! Files in $OUTDIR:"
ls -la "$OUTDIR"

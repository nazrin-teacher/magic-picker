#!/bin/sh
# Re-creates the card assets from the original sheets with macOS `sips` (no other tools needed).
# Cell centres were measured from the cream gaps between cards in each 5 x 4 sheet.
# Each card is a fixed 264 x 220 px window (ratio 1.2) centred in its cell, which stays
# inside the gold frame: no neighbouring card, white gap or rounded frame corner is included.
set -e
cd "$(dirname "$0")/.."
crop() { sips -s format jpeg -s formatOptions 92 -c "$6" "$5" --cropOffset "$4" "$3" "$1" --out "$2" >/dev/null; }

# Sheet 1 -> Adventure (adv-01 .. adv-20), left-to-right, top-to-bottom
n=0; for cy in 122 374 629 886; do for cx in 155 461 768 1074 1381; do
  n=$((n+1)); crop assets/source/1.webp "assets/cards/adv-$(printf %02d $n).jpg" $((cx-132)) $((cy-110)) 264 220
done; done
# Sheet 4 -> Wonder (won-01 .. won-20)
n=0; for cy in 131 384 638 891; do for cx in 156 462 768 1073 1379; do
  n=$((n+1)); crop assets/source/4.webp "assets/cards/won-$(printf %02d $n).jpg" $((cx-132)) $((cy-110)) 264 220
done; done
# Card back: top-right panel of the design reference (sheet 2), without the drop shadow
crop assets/source/2.webp assets/card-back.jpg 1304 67 343 494
# Stage background: image 3, unchanged
sips -s format jpeg -s formatOptions 88 assets/source/3.webp --out assets/stage.jpg >/dev/null
echo "done"

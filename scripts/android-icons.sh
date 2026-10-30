#!/usr/bin/env bash
# Remplace les icônes Android par défaut de Capacitor par celles de l'application.
set -euo pipefail
RES=mobile/android/app/src/main/res
SRC=www/icons/icon-512.png
rm -rf "$RES/mipmap-anydpi-v26"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  n="${d%%:*}"; s="${d##*:}"
  mkdir -p "$RES/mipmap-$n"
  for f in ic_launcher ic_launcher_round ic_launcher_foreground; do
    convert "$SRC" -resize "${s}x${s}" "$RES/mipmap-$n/$f.png"
  done
done
echo "Icônes Android remplacées."

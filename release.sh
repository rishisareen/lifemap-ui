#!/bin/bash
# Bump the cache-busting version on every internal module URL so a deploy's
# module graph is always self-consistent (no stale-import window on Pages).
# Usage: ./release.sh   (auto-increments the version in .version)
set -e
V=$(( $(cat .version 2>/dev/null || echo 0) + 1 ))
echo "$V" > .version
# static imports:  from "./x.js"  or  from "./x.js?v=N"
for f in js/*.js index.html; do
  perl -0pi -e 's{(from\s+["'\''"]\./[\w.]+\.js)(\?v=\d+)?(["'\''"])}{${1}?v='"$V"'${3}}g' "$f"
  # dynamic imports: import("./x.js")
  perl -0pi -e 's{(import\(\s*["'\''"]\./[\w.]+\.js)(\?v=\d+)?(["'\''"])}{${1}?v='"$V"'${3}}g' "$f"
  # entrypoint + css refs in index.html: src="js/main.js" / href="app.css"
  perl -0pi -e 's{((?:src|href)=["'\''"](?:js/[\w.]+\.js|app\.css))(\?v=\d+)?(["'\''"])}{${1}?v='"$V"'${3}}g' "$f"
done
echo "released v$V"

#!/bin/sh
# Make sure the cube is present, then start the API.
#
# It normally arrives at build time -- from the build context locally, or from
# CUBE_URL. But a host that builds from a git checkout has no cube in the
# context, and not every platform forwards environment variables into the
# Docker build as build arguments. Rather than depend on that, this checks at
# boot and fetches only if the build did not already provide it.
#
# When the build did its job this costs one `test -f` and start-up is instant.
set -e

CUBE="${DATA_DIR:-/srv/backend/data}/nyc311.duckdb"

if [ ! -f "$CUBE" ]; then
    if [ -z "$CUBE_URL" ]; then
        echo "No cube at $CUBE and CUBE_URL is unset. Set CUBE_URL or bake it in." >&2
        exit 1
    fi
    echo "Cube missing; downloading from CUBE_URL..."
    # To a temp name first: an interrupted download must not leave a truncated
    # file that looks present on the next boot and fails as corruption instead.
    curl -fsSL "$CUBE_URL" -o "$CUBE.part"
    mv "$CUBE.part" "$CUBE"
fi

python -c "
import duckdb, sys
con = duckdb.connect('$CUBE', read_only=True)
rows = con.execute('select count(*) from cube').fetchone()[0]
zips = con.execute('select count(*) from zip_board').fetchone()[0]
print(f'cube ready: {rows:,} rows, {zips} zips', flush=True)
if rows == 0:
    sys.exit('cube is empty')
"

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

# Two stages: build the React app with Node, serve everything from Python.
#
# The API serves the built frontend itself rather than putting a static host in
# front. That keeps the app same-origin, which avoids CORS and -- more
# importantly -- satisfies the browser's secure-context requirement for
# microphone access with no extra configuration.

# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# USE_MOCK defaults to off, so this build talks to the real API.
RUN npm run build

# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime
# main.py finds the UI by walking three parents up from app/main.py, so the
# image has to mirror the repo layout (backend/app + frontend/dist) rather than
# flatten it. Flattened, that walk resolves to /frontend and the API silently
# serves nothing at /.
WORKDIR /srv/backend

# 3.12 rather than 3.14: duckdb and shapely both ship prebuilt wheels for it,
# so the image needs no compiler.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# Community district boundaries, the 311 taxonomy, and the recovered form map.
# ~3.9MB, committed, and needed at runtime -- the app must not depend on
# reaching Socrata at boot.
COPY backend/data/reference ./data/reference
COPY --from=frontend /app/dist /srv/frontend/dist

# The 117MB cube is too large for git, so it arrives one of two ways. The
# trailing * makes this COPY optional: with the file built locally
# (python -m app.data.export) it ships in the build context and needs no
# hosting anywhere. Without it, set --build-arg CUBE_URL=... and it is fetched.
#
# Either way it is baked into the image rather than downloaded at boot, so a
# cold start cannot fail on someone else's network.
COPY backend/data/nyc311-slim.duckdb* ./data/
ARG CUBE_URL=""
RUN if [ -f ./data/nyc311-slim.duckdb ]; then \
        mv ./data/nyc311-slim.duckdb ./data/nyc311.duckdb; \
    elif [ -n "$CUBE_URL" ]; then \
        curl -fsSL "$CUBE_URL" -o ./data/nyc311.duckdb; \
    else \
        echo "No cube: build it with 'python -m app.data.export' or pass CUBE_URL" >&2; \
        exit 1; \
    fi \
 && python -c "import duckdb; c=duckdb.connect('data/nyc311.duckdb', read_only=True); \
print('cube rows:', c.execute('select count(*) from cube').fetchone()[0]); \
print('zips:', c.execute('select count(*) from zip_board').fetchone()[0])"

ENV DATA_DIR=/srv/backend/data \
    PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

# $PORT so the platform can pick it; most hosts inject one.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]

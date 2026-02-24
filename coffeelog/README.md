# CoffeeLog MVP (PWA + Offline-First)

CoffeeLog is a private coffee journal that works as:
- a normal web app in the browser
- an installable Progressive Web App (PWA)
- an offline-first journal using IndexedDB

The backend sync API is optional at runtime. If backend sync is unavailable, the app still works fully locally.

## Stack

- Frontend: HTML, CSS, Vanilla JS, IndexedDB, Service Worker, Web App Manifest
- Backend: FastAPI, SQLAlchemy, SQLite

## Project Structure

```text
coffeelog/
  backend/
    main.py
    db.py
    models.py
    schemas.py
    routes.py
  frontend/
    templates/
      base.html
      pages/
        index.html
        create.html
        view.html
        settings.html
      components/
        ...
    static/
      css/
        styles.css
      js/
        app.js
        idb.js
      icons/
        icon-192.png
        icon-512.png
    pwa/
      manifest.json
      sw.js
  requirements.txt
  README.md
```

## Run (macOS)

From the repository root:

```bash
cd coffeelog
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m backend.main
```

Open:

- `http://localhost:8000/`

This is the single main command path (`python -m backend.main`) with FastAPI serving frontend pages and API.

Python note:
- Tested with Python `3.14.x` using SQLAlchemy-backed models for compatibility.

## API (optional sync)

All API calls require header:
- `X-User-Key: <uuid>`

Endpoints:
- `GET /api/entries`
- `POST /api/entries` (single entry or array)
- `GET /api/entry/{id}`

Notes:
- `user_key` is generated on first run in browser localStorage.
- Backend only returns entries that match the caller's `X-User-Key`.

## Offline-First Behavior

- New entries are saved immediately to IndexedDB.
- List and view are rendered from local IndexedDB first.
- If offline, Sync shows: `Offline — saved locally.`
- If backend is unavailable, Sync shows: `Server unavailable. Entries remain local.`

## PWA

Included:
- `frontend/pwa/manifest.json`
- `frontend/pwa/sw.js`
- app icons (`192x192`, `512x512`)

Service worker strategy:
- Cache-first for app shell assets/pages.
- Network-first for `/api/*` requests with cache fallback.

## Smoke Test Checklist

1. Open `http://localhost:8000/`.
2. Create an entry from `/create`.
3. Confirm it appears on list (`/`).
4. Open entry details at `/view?id=<UUID>`.
5. In DevTools, set Network to `Offline` and confirm:
   - list still loads
   - create still saves locally
6. Test install:
   - open site in Chromium-based browser
   - use browser install UI (or in-app install button when prompt is available)
   - launch installed app and confirm it opens standalone

## Notes for Extension

- Current sync is manual (`Sync` button on list/settings).
- Conflict handling is basic upsert by `id`.
- You can add background sync later without changing local storage model.

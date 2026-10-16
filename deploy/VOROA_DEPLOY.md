# Voroa Deploy — web healthgraph.shop + API + Postgres early-access

Ziel: `healthgraph_web` auf `https://healthgraph.shop`, Formular speichert
Name+Gmail+Stadt in Postgres (`early_access_signups`).

## 1) Postgres (Voroa managed)
- Voroa Dashboard → Databases → New Postgres, Region nah an DE.
- `DATABASE_URL` + `ASYNC_DATABASE_URL` kopieren (`?sslmode=require`).

## 2) API Service (Docker, aus diesem Repo)
- New Service → aus GitHub-Repo, Root `Dockerfile`, Branch main.
- Port: `$PORT` (Dockerfile nutzt `${PORT:-8000}` bereits).
- Env (min. für early-access + health):
  `APP_ENV=production`
  `DATABASE_URL=<voroa-postgres>`
  `ASYNC_DATABASE_URL=<voroa-postgres-async>`
  `CORS_ORIGINS=https://healthgraph.shop`
  `secret_key=<lang-zufällig-32+>`
  Firebase erst für App-Login nötig, für early-access nicht.
- Nach Deploy einmalig: `alembic upgrade head` (enthält `ea01earlyaccess`).
  Prüfen: `SELECT count(*) FROM early_access_signups;`

## 3) Web Service (static, healthgraph_web)
- New Static Site → Root `healthgraph_web`, Build `npm run build`, Output `dist`.
- Node 20. Kein Server nötig.
- Wenn Web+API gleiche Domain (Proxy `/api/*` → API): kein Env nötig.
- Wenn getrennt (`healthgraph.shop` + `api.xxx.getvoroa.com`):
  `VITE_API_URL=https://<api-domain>` setzen, neu bauen.
- Custom Domain: `healthgraph.shop` → Voroa DNS (A/CNAME per Dashboard),
  HTTPS auto. `www` → redirect auf apex.

## 4) Test
- `https://healthgraph.shop/` → DE-Titel sichtbar.
- Formular `#early-access` ausfüllen → 201 + DB-Row.
- `https://healthgraph.shop/artikel/index.html` → 50 Artikel (200).
- API-Docs nur intern, nicht öffentlich exponieren.

## Hinweise aus Repo
- `.env.example` oben: Voroa wischt Container-FS bei jedem Deploy,
  Docs gehören in Postgres (`document_blobs`), nicht auf Disk.
- Worker/Beat für early-access NICHT nötig (nur API+DB+Web).

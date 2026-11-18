# RIVA AI — frontend

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · lucide-react · Recharts.
Full setup, usage and troubleshooting live in the [project README](../README.md).

```powershell
npm install
npm run dev          # http://localhost:3000 (expects the API at http://localhost:8100)
npm test             # vitest unit tests (SSE parser, formatting, citations, summaries)
npm run lint
npm run typecheck
npm run build        # production build (output: standalone)
```

`NEXT_PUBLIC_API_URL` (see `.env.example`) is the backend URL as seen from the browser and is inlined at **build** time. Authentication is an httpOnly cookie set by the API, so every request uses `credentials: "include"`; the API's `CORS_ORIGINS` must contain this app's origin.

## Layout

| Path | Contents |
|---|---|
| `app/(auth)` | User portal sign-in `/login` and `/register` |
| `app/(app)` | **User portal** (purple sidebar): `/` and `/c/[id]` (chat), `/library` (read-only list of documents within the user's clearance) |
| `app/admin/(auth)` | Admin portal sign-in `/admin/login` (sends `portal: "admin"`; accounts without `admin_portal` get a 403) |
| `app/admin/(portal)` | **Admin portal** (deep-purple sidebar, guarded by `access.admin_portal`): `/admin` (dashboard), `/admin/documents`, `/admin/users`, `/admin/security`, `/admin/audit`, `/admin/evaluation`, `/admin/settings`. Old `/documents`, `/evaluation`, `/analytics`, `/settings` redirect here (`next.config.ts`) |
| `components/admin`, `components/access` | Admin pages (users, security, audit), portal guard, role / classification badges, `RequirePermission` |
| `components/chat` | Composer, streaming answer card, citation chips, Response Performance / RAGAS / Retrieved Sources panels, context panel |
| `components/documents` | Upload zone, library table with live indexing progress, preview sheet, collections |
| `components/evaluation`, `components/analytics` | Benchmark runs, regression reports, KPI tiles, charts |
| `services/` | Typed API client per area (`http.ts` handles credentials, error envelopes, 401 redirect) |
| `lib/` | Shared types (mirroring the backend Pydantic schemas), SSE parser, formatting helpers, `permissions.ts` (`can(access, perm)`, clearance and portal routing), `typewriter.ts` (word-by-word reveal queue) |
| `tests/` | Vitest unit tests; `tests/e2e/riva_e2e.py` is the Playwright browser end-to-end check |

## Browser end-to-end test

Drives the real UI against the real API (only the chat LLM is scripted), checks for console errors and failed requests, and writes screenshots:

```powershell
# terminal 1 (backend):  python -m tests.e2e_server                 → API on :8101, database riva_e2e
# terminal 2 (frontend): $env:NEXT_PUBLIC_API_URL="http://localhost:8101"; npm run build; npx next start -p 3001
# terminal 3:            python -m pip install playwright
#                        python tests/e2e/riva_e2e.py <folder-with-documents> ../docs/screenshots
```

It uses the installed Microsoft Edge (`channel="msedge"`), so no browser download is needed on Windows. Create the `riva_e2e` database once with `docker exec riva-db psql -U riva -c "CREATE DATABASE riva_e2e"`.

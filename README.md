# RIVA AI

**RIVA — Research, Intelligence & Virtual Assistant**
*Your Intelligent Document Research Partner*

RIVA AI is a document-intelligence chatbot. Upload your PDFs, Word files, spreadsheets, slide decks and web pages, then ask questions in plain language. RIVA finds the relevant passages with **hybrid search** (meaning-based + keyword-based), answers **only from your documents with citations to the exact page**, checks its own answer for unsupported claims, measures how long every step took, and scores answer quality with **RAGAS** — right under each answer.

---

## Contents

- [A. Project introduction](#a-project-introduction)
- [B. Technology stack](#b-technology-stack)
- [C. Prerequisites](#c-prerequisites)
- [D. Installation (Windows)](#d-installation-windows)
- [E. Environment configuration](#e-environment-configuration)
- [F. Database setup](#f-database-setup)
- [G. Running the application](#g-running-the-application)
- [H. How to use RIVA AI](#h-how-to-use-riva-ai)
- [H2. Admin & user portals, RBAC and guardrails](#h2-admin--user-portals-rbac-and-guardrails)
- [I. Understanding hybrid search](#i-understanding-hybrid-search)
- [J. Understanding RAGAS](#j-understanding-ragas)
- [K. Understanding DeepEval](#k-understanding-deepeval)
- [L. LangSmith setup](#l-langsmith-setup)
- [M. Testing](#m-testing)
- [N. Troubleshooting](#n-troubleshooting)
- [O. Deployment](#o-deployment)
- [P. Project status, roadmap and known limitations](#p-project-status-roadmap-and-known-limitations)
- [Appendix: API reference and project structure](#appendix-api-reference-and-project-structure)

---

## A. Project introduction

### What is RIVA AI?

A full-stack application (FastAPI backend + Next.js frontend + PostgreSQL) that turns a folder of documents into a searchable, question-answering research assistant. It is built around **Retrieval-Augmented Generation (RAG)**: instead of letting a language model answer from memory, RIVA first *retrieves* the most relevant passages from your documents and then asks the model to answer *using only those passages*.

### What problem does it solve?

Finding a specific clause, figure or decision spread across dozens of files is slow, and generic chatbots invent answers. RIVA:

- answers from **your** documents and shows **where** each fact came from (document + page);
- says *"I couldn't find sufficient supporting information in your uploaded documents to answer this accurately."* instead of guessing;
- makes quality and speed **visible and measurable** (per-answer latency breakdown, RAGAS scores, DeepEval regression suite, LangSmith traces).

### Core features

| Area | What you get |
|---|---|
| Ingestion | PDF, DOCX, DOC, TXT, Markdown, CSV, XLSX, HTML, PPTX · OCR for scanned PDFs · tables preserved · SHA-256 duplicate detection · version history · automatic retries · zero-downtime re-index |
| Chunking | 5 strategies: structure-aware (default), recursive, token, semantic, parent-child · page numbers and section titles on every chunk |
| Hybrid search | pgvector dense search + **Okapi BM25 computed in PostgreSQL** + Reciprocal Rank Fusion + de-duplication + cross-encoder reranking |
| Corrective RAG | LangGraph workflow: query analysis/rewriting → retrieval → relevance grading → automatic re-search → grounded generation → claim-level verification → citations |
| Evaluation | RAGAS under every answer (asynchronous, N/A when not computable — never fake zeros) · reference-based evaluation · DeepEval benchmark + regression reports · retrieval IR metrics (Recall@K, Precision@K, MRR, nDCG) |
| Observability | LangSmith tracing of every pipeline step with privacy redaction · per-stage latency (monotonic clock) · time-to-first-token · token usage and optional cost |
| Product | **Separate user portal and admin portal** · word-by-word streaming chat · inline citations · document library · evaluation dashboard · analytics · audit log · export · purple & white theme |
| Security | **RBAC** (admin / manager / user) with document **classification & clearance enforced inside the retrieval SQL** · **guardrails**: prompt-injection / jailbreak / privilege-escalation / secret-extraction blocking, indirect-injection quarantine, PII & secret redaction while streaming, system-prompt-leak detection · audit log · tenant isolation · Argon2 · httpOnly cookie · rate limiting · upload validation |

### Architecture overview

```
                       ┌──────────────────────── Next.js frontend (port 3000) ────────────────────────┐
                       │ Chat (SSE streaming) · Document Library · Evaluation · Analytics · Settings  │
                       └───────────────────────────────┬──────────────────────────────────────────────┘
                                                       │ REST + Server-Sent Events (httpOnly cookie)
┌──────────────────────────────────────── FastAPI backend (port 8100) ────────────────────────────────────────┐
│ Auth & workspaces ─ Documents API ─ Chat API ─ Evaluation API ─ Analytics API ─ Health                      │
│                                                                                                             │
│  Ingestion worker (Postgres job queue, SKIP LOCKED)        LangGraph corrective RAG                         │
│  extract → OCR → clean → chunk → embed → index             analyze → retrieve → grade ─┬→ generate → verify │
│                                                                    ↑         rewrite ←─┘        → cite      │
│  Hybrid retriever: dense (pgvector HNSW) + BM25 (SQL) → RRF → dedupe → cross-encoder rerank                 │
│  Evaluation worker: RAGAS online · DeepEval/RAGAS/retrieval benchmarks → JSON/CSV reports                   │
└──────────────┬─────────────────────────────┬───────────────────────────────┬───────────────────────────────┘
               │                             │                               │
     PostgreSQL 17 + pgvector         Redis (optional)                OpenAI API · LangSmith (optional)
     (data, vectors, BM25, jobs)      (rate limits, query cache)
```

### Screenshots

Captured from the production build by the automated browser test (`frontend/tests/e2e/riva_e2e.py`). In that run no OpenAI key was configured, so the answer text comes from the deterministic **scripted test model** and every RAGAS metric correctly shows **N/A** with the reason; everything else (upload, OCR, hybrid search, reranking, streaming, citations, timings, benchmark, analytics) is the real system.

| | |
|---|---|
| ![Chat answer with performance, RAGAS and sources panels](docs/screenshots/04-chat-answer-panels.png) Answer card with RAGAS panel and context sidebar | ![Document library](docs/screenshots/03-document-library.png) Document Library (8 formats incl. an OCR'd scan) |
| ![Evaluation dashboard](docs/screenshots/06-evaluation-dashboard.png) Retrieval benchmark run from the UI | ![Analytics](docs/screenshots/07-analytics.png) Analytics from real records |
| ![Welcome screen](docs/screenshots/02-welcome.png) Welcome screen | ![Mobile](docs/screenshots/09-mobile.png) Mobile layout |
| ![Admin security](docs/screenshots/11-admin-security.png) Admin portal → Security (roles, clearance, guardrails) | ![Admin users](docs/screenshots/10-admin-users.png) Admin portal → Users (RBAC) |
| ![Blocked prompt injection](docs/screenshots/15-user-blocked.png) User portal: prompt injection blocked, confidential contract withheld | ![Redacted PII](docs/screenshots/16-user-redacted.png) User portal: personal data redacted while streaming |
| ![User library](docs/screenshots/14-user-library.png) User portal → Library (only cleared documents) | ![Audit log](docs/screenshots/12-admin-audit.png) Admin portal → Audit log |

---

## B. Technology stack

| Technology | Role in RIVA |
|---|---|
| **Python 3.12** | Backend language (3.11 also works). |
| **FastAPI** | REST API, Server-Sent Events streaming, OpenAPI docs at `/docs`. |
| **LangChain** | Model wrappers (ChatOpenAI, embeddings), text splitters, structured output, callbacks for token usage. |
| **LangGraph** | The corrective RAG workflow as an explicit state graph with conditional edges (retry search, refuse, small-talk). |
| **OpenAI** | Answer generation, query analysis, relevance grading, verification; `text-embedding-3-*` embeddings; RAGAS/DeepEval judges. |
| **FastEmbed (ONNX)** | Optional fully local embeddings (`BAAI/bge-small-en-v1.5`) and the local cross-encoder reranker (`ms-marco-MiniLM-L-6-v2`). |
| **PostgreSQL 17** | All application data, the job queue, full-text index. |
| **pgvector** | Stores embeddings; HNSW index for fast cosine-similarity search. |
| **BM25** | Keyword relevance (exact names, IDs, numbers). Implemented as true Okapi BM25 inside PostgreSQL using `tsvector` term statistics. |
| **Hybrid search** | Dense + BM25 results merged with Reciprocal Rank Fusion, then reranked. |
| **RAGAS 0.4** | Per-answer quality metrics (faithfulness, relevancy, context precision/recall, …). |
| **DeepEval 4** | Benchmark and regression testing of the whole pipeline. |
| **LangSmith** | Tracing, debugging, datasets and experiments. |
| **Next.js 16 + React 19 + TypeScript + Tailwind 4 + shadcn/ui** | The web interface (Recharts for charts, react-markdown for answers). |
| **Redis** | Optional: shared rate limits and query-embedding cache across processes. |
| **RapidOCR** | OCR for scanned PDF pages (pure pip install, no system binaries). |

---

## C. Prerequisites

| Tool | Recommended version | Why | Install |
|---|---|---|---|
| **Python** | 3.12 (3.11 works) | Backend | https://www.python.org/downloads/ — tick *"Add python.exe to PATH"*. On Windows the `py` launcher lets you pick a version: `py -3.12`. |
| **Node.js** | 20 LTS or newer (tested on 26) | Frontend | https://nodejs.org/ |
| **Git** | any recent | Clone the repo | https://git-scm.com/download/win |
| **Docker Desktop** | 4.x / Engine 25+ | Runs PostgreSQL + pgvector and Redis | https://www.docker.com/products/docker-desktop/ — start it once and wait until it says *Engine running*. |
| PostgreSQL (only without Docker) | 16 or 17 **with the pgvector extension** | Database | https://www.postgresql.org/download/ + https://github.com/pgvector/pgvector#installation |

You also need an **OpenAI API key** for answers and RAGAS/DeepEval scoring (https://platform.openai.com/api-keys). Everything else — uploads, OCR, chunking, local embeddings, hybrid search, reranking, the retrieval benchmark — works without any key.

Check your tools:

```powershell
py -3.12 --version
node --version
git --version
docker --version
```

---

## D. Installation (Windows)

All commands are for **Windows PowerShell**. (macOS/Linux: use `python3 -m venv .venv` and `source .venv/bin/activate`; everything else is identical.)

### 1. Get the code

```powershell
git clone YOUR_REPOSITORY_URL riva-ai
cd riva-ai
```

### 2. Create a Python virtual environment for the backend

A *virtual environment* is a private folder of Python packages for this project only, so it cannot conflict with other projects on your computer.

```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
```

Your prompt now starts with `(.venv)`. Run the activation line again in every new terminal.

> **"running scripts is disabled on this system"?** PowerShell blocks activation scripts by default. Allow scripts for your user once, then activate again:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```
> Alternatively, skip activation and call the interpreter directly: `.venv\Scripts\python.exe -m ...`.

### 3. Install backend dependencies

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

This downloads ~1.5 GB (LangChain, RAGAS, DeepEval, ONNX runtime, PDF/Office parsers) and takes a few minutes. `requirements.lock.txt` contains the full, verified set of transitive versions if you need an exact reproduction: `python -m pip install -r requirements.lock.txt`.

### 4. Install frontend dependencies

```powershell
cd ..\frontend
npm install
cd ..
```

---

## E. Environment configuration

Configuration lives in **`backend/.env`** (never commit it — it is in `.gitignore`).

```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```

Minimum to set:

| Variable | What to put | Required? |
|---|---|---|
| `SECRET_KEY` | A long random string. Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"` | **Yes** (mandatory in production) |
| `DATABASE_URL` | Keep the default if you use Docker Compose: `postgresql+asyncpg://riva:riva_dev_password@localhost:5434/riva` | Yes |
| `OPENAI_API_KEY` | `sk-...` from https://platform.openai.com/api-keys | For answers + RAGAS/DeepEval |
| `REDIS_URL` | `redis://localhost:6379/0` (or empty to use in-process memory) | Optional |
| `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT` | See [section L](#l-langsmith-setup) | Optional |

**Embeddings — choose one before you upload documents:**

| Option | Settings | Notes |
|---|---|---|
| OpenAI (default) | `EMBEDDING_PROVIDER=openai`, `EMBEDDING_MODEL=text-embedding-3-small`, `EMBEDDING_DIMENSIONS=1536` | Best multilingual quality; needs the API key; small per-token cost. |
| Local (no key) | `EMBEDDING_PROVIDER=fastembed`, `EMBEDDING_MODEL=BAAI/bge-small-en-v1.5`, `EMBEDDING_DIMENSIONS=384` | Runs on your CPU, free, private; English-focused. First use downloads ~70 MB. |

The vector column is created with `EMBEDDING_DIMENSIONS` when you run the migrations. If you change the embedding provider/model later, run `python -m app.cli reset-embeddings` (resizes the column and re-indexes every document).

Every other option (chunking, retrieval, reranker, OCR, rate limits, evaluation, privacy) is documented inline in [`backend/.env.example`](backend/.env.example). Workspace-level chunking/retrieval/model settings can also be changed in the app under **Settings**.

**Frontend:** `frontend/.env.example` holds `NEXT_PUBLIC_API_URL` (default `http://localhost:8100`). Copy it to `frontend/.env.local` only if your API runs elsewhere. The frontend never sees any API key.

---

## F. Database setup

### Start PostgreSQL (with pgvector) and Redis using Docker

From the project root:

```powershell
docker compose up -d db redis
docker compose ps
```

You should see `riva-db` and `riva-redis` with status `healthy`. PostgreSQL is published on **port 5434** (not 5432, to avoid clashing with a locally installed PostgreSQL) and Redis on **6379**. The first start also creates a separate `riva_test` database used by the automated tests, and enables the `vector` extension.

### Run the migrations (creates all tables, indexes and the BM25 trigger)

```powershell
cd backend
.venv\Scripts\Activate.ps1
python -m alembic upgrade head
```

### Check the connection

```powershell
python -m app.cli check
```

Expected output includes `pgvector: 0.8.x` and `embedding column dimension: 1536 (EMBEDDING_DIMENSIONS=1536)` (or 384 with local embeddings).

### Using your own PostgreSQL instead of Docker

1. Install PostgreSQL 16/17 and the pgvector extension.
2. `CREATE DATABASE riva;` then, connected to it, `CREATE EXTENSION vector;`
3. Set `DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@localhost:5432/riva` and run the migrations.

### Database troubleshooting

| Symptom | Fix |
|---|---|
| `Bind for 0.0.0.0:5434 failed: port is already allocated` | Another program uses the port. Pick another: `$env:RIVA_DB_PORT=5440; docker compose up -d db` and update `DATABASE_URL`. |
| `connection refused` | Docker Desktop is not running, or the container is still starting (`docker compose ps`). |
| `type "vector" does not exist` | pgvector is missing — use the `pgvector/pgvector` image or install the extension. |
| `password authentication failed` | `DATABASE_URL` user/password must match `POSTGRES_USER`/`POSTGRES_PASSWORD` in `docker-compose.yml`. |

### Backups

```powershell
docker exec riva-db pg_dump -U riva -Fc riva > riva_backup.dump          # backup
docker exec -i riva-db pg_restore -U riva -d riva --clean < riva_backup.dump  # restore
```

Back up `backend/storage/` too (original uploaded files). In production use managed PostgreSQL with automated point-in-time recovery.

---

## G. Running the application

Open **three** terminals (or two if you use the embedded worker, which is the default).

**1. Database** (once per boot):

```powershell
docker compose up -d db redis
```

**2. Backend API** (embedded background worker included):

```powershell
cd backend
.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

**3. Frontend:**

```powershell
cd frontend
npm run dev
```

**Optional 4. Separate worker** — for production-style setups set `EMBEDDED_WORKER=false` in `.env` and run one or more workers:

```powershell
cd backend
python -m app.worker
```

| URL | What |
|---|---|
| http://localhost:3000 | RIVA AI web app |
| http://localhost:8100/docs | Interactive API documentation (Swagger UI) |
| http://localhost:8100/redoc | API reference (ReDoc) |
| http://localhost:8100/api/health | Health check (database, pgvector, cache, LLM, LangSmith, evaluation versions) |

> We call `python -m uvicorn` / `python -m alembic` rather than `uvicorn` / `alembic` on purpose: on PCs with Windows Smart App Control, the small `.exe` launchers in `.venv\Scripts` can be blocked, while `python -m` always works.

**Everything in Docker** (API + worker + frontend + database): create `backend/.env` first, then

```powershell
docker compose --profile app up -d --build
```

---

## H. How to use RIVA AI

1. **Open the app** at http://localhost:3000.
2. **Register** an account. The **first account becomes the administrator** of the organization workspace; everyone who signs up later joins as a **user** (the admin can promote people to *manager* or *admin* in **Admin portal → Users**). Admins and managers sign in at **http://localhost:3000/admin/login**, users at **/login**.
3. **Upload documents** (admins/managers): **Admin portal → Documents**, drag files into the drop zone and pick a **classification** (*public*, *internal* — the default —, *confidential* or *restricted*). Users can only ask questions about documents within their clearance and never see the others, not even their titles. Supported: PDF, DOCX, DOC, TXT, MD, CSV, XLSX, HTML, PPTX — up to 50 MB each by default. Exact duplicates are detected and skipped.
4. **Wait for indexing**: each file moves through *Uploaded → Processing (extracting, chunking, embedding, indexing) → Indexed*. Scanned PDFs are OCR'd automatically. Failed files show the reason and can be re-indexed.
5. **Start a new conversation** with *New conversation* in the sidebar.
6. **Choose the scope**: all documents (default), specific documents, or a collection.
7. **Ask a question**, e.g. *"What are the payment terms in the supplier agreement?"*
8. **Read the answer**: it streams in live; small numbered chips like `[1]` are citations — hover or click to see the source document, page and passage.
9. **Expand "Retrieved Sources"** to see every candidate passage with its dense rank, BM25 rank, fused (RRF) rank, reranker score and whether it was used.
10. **Expand "Response Performance"**: total response time, time to first token, and how long each stage took (embedding, dense search, BM25, fusion, reranking, LLM generation, verification…). Evaluation time is shown separately and never added to the response time.
11. **Expand "RAGAS Quality Evaluation"**: scores (0–100) appear a few seconds after the answer. Metrics that need a reference answer show **N/A** until you click *Add reference answer*.
12. **Ask follow-ups** like *"And what happens if they pay late?"* — RIVA rewrites them using the conversation so far.
13. **Manage conversations**: rename, delete, search, export as Markdown or JSON; give thumbs up/down feedback.

Answers stream **word by word**: the backend re-chunks the model's tokens into whole words (redacting secrets on the fly for users) and the UI reveals them with a smooth typewriter effect while the status line shows each pipeline step.

Example questions that show off the features:

- *Summarize my uploaded documents.*
- *Compare the warranty terms in the two contracts.*
- *Find every mention of invoice INV-2024-0042.* (exact identifiers → BM25 shines)
- *Are there contradictions between the handbook and the latest memo about remote work?*
- *Extract all termination clauses with their notice periods.*
- *Generate a research report on the field trial results.*

---

## H2. Admin & user portals, RBAC and guardrails

### Two portals

| | **User portal** (`/`, `/login`) | **Admin portal** (`/admin`, `/admin/login`) |
|---|---|---|
| Who | Everyone with the `user` role (and admins/managers who just want to chat) | `admin` and `manager` roles only — users are refused at sign-in (HTTP 403) |
| What | Chat, conversations, read-only **Library** of the documents you are cleared for, response time | Dashboard (analytics + security summary), Documents (upload, classify, re-index, preview), Users, Security (roles, clearance, guardrails), Audit log, Evaluation, Settings |
| Diagnostics | Answer, citations, response time. Retrieved-source rankings and RAGAS panels are hidden (enable with *Show diagnostics to users*) | Full diagnostics: retrieved sources with dense/BM25/RRF/rerank scores, RAGAS panel, raw evaluation |

### Role-based access control (RBAC)

| Permission | admin | manager | user |
|---|:-:|:-:|:-:|
| Chat over permitted documents | ✓ | ✓ | ✓ |
| See document list (metadata) | ✓ | ✓ | ✓ (own clearance only) |
| Preview chunks / download originals | ✓ | ✓ | – |
| Upload, re-index, delete, classify documents | ✓ | ✓ (up to *confidential*) | – |
| Analytics, evaluation dashboards, run benchmarks | ✓ | ✓ | – |
| Retrieval & RAGAS diagnostics under answers | ✓ | ✓ | optional |
| See un-redacted personal data / secrets | ✓ | – | – |
| Manage users & roles, security settings, audit log | ✓ | – | – |

**Classification & clearance.** Every document is *public*, *internal*, *confidential* or *restricted*. Default clearance: user → internal, manager → confidential, admin → everything (admins can lower/raise user and manager clearance in **Admin → Security**). Enforcement happens **inside the dense (pgvector) and BM25 SQL queries** via a classification column on every chunk — content above a user's clearance is never retrieved, never placed in a prompt and never streamed. Documents above your clearance return *404 Not found* (their existence is not disclosed), and re-classifying a document updates all its chunks instantly. Implementation: `backend/app/core/rbac.py`, `backend/app/api/deps.py`.

### Guardrails (defence in depth)

```
user message ─► [1] input guard ─► query analysis (+ [2] LLM security check) ─► retrieval (RBAC-filtered SQL)
                    │ blocked                         │ blocked                    │
                    ▼                                 ▼                            ▼
              refusal + audit                  refusal + audit          [3] context guard: passages with
                                                                         planted instructions are excluded
                                                                                   │
answer ◄── [5] final check: PII/secret redaction, ◄── [4] word-by-word stream with on-the-fly redaction
            system-prompt-leak detection
```

1. **Input guard** (`app/guardrails/input_guard.py`) — deterministic rules for prompt injection ("ignore previous instructions", "reveal your system prompt", fake `<system>` tags), jailbreaks (DAN, "developer mode", unrestricted role-play), privilege escalation ("I am the admin", "bypass access control"), requests for classified documents (users only) and secret extraction (passwords, API keys, connection strings — while "What is the password policy?" is allowed). Unicode tricks and base64-encoded payloads are normalised/decoded first.
2. **LLM security check** — the query-analysis call that already rewrites the question also returns `is_prompt_attack`, catching paraphrased attacks with **no extra model call**.
3. **Context guard** (`context_guard.py`) — indirect prompt injection: chunks containing instruction-like text (flagged at ingestion and re-checked at query time) are excluded from the prompt (or sanitised, configurable). Passages are additionally wrapped in `<passage>` tags and the system prompt instructs the model to treat them as data.
4. **Streaming redaction** (`output_guard.WordStreamer`) — for users without `pii.view`, emails, phone numbers, Luhn-valid card numbers, IBANs, SSNs, API keys/tokens, private keys and `password: …` values are masked **before** a word leaves the server; a sliding window guarantees a multi-word secret is never half-streamed.
5. **Final checks** — the full answer is redacted again and blocked if it reproduces the system prompt.

Blocked requests get the status **blocked**, a fixed refusal message, no retrieval, and an audit entry. Every guardrail decision, sign-in, failed sign-in, admin-portal denial, role change, user creation/removal, re-classification and security-setting change is written to the **audit log** (`Admin → Audit log`, `GET /api/admin/audit`).

All switches live in **Admin → Security** (`guardrails_enabled`, `block_prompt_injection`, `llm_injection_check`, `exclude_flagged_chunks`, `redact_sensitive_output`, `show_diagnostics_to_users`, `default_classification`, per-role clearance).

**Registration mode** (`REGISTRATION_MODE` in `backend/.env`): `shared` (default) = one organization, first sign-up is admin, later sign-ups are users; `personal` = every sign-up gets a private workspace (multi-tenant SaaS). With `ALLOW_REGISTRATION=false` only admins create accounts (Admin → Users, or `python -m app.cli create-user --email … --role manager`).

---

## I. Understanding hybrid search

Two complementary ways of finding passages:

| | **Dense (semantic) search** | **BM25 (keyword) search** |
|---|---|---|
| How | Text → embedding vector; find passages whose vectors are closest (cosine similarity, pgvector HNSW index) | Score passages by how often your query words occur in them, weighted by how rare the words are |
| Good at | Paraphrases and concepts: *"time off allowance"* finds *"28 days of paid vacation"* | Exact tokens: names, IDs like `MSA-2025-117`, numbers, legal phrases |
| Weak at | Rare identifiers, exact numbers | Synonyms and rephrasing |

**BM25 formula** (computed in SQL over each workspace's chunks):

```
idf(t)   = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))
score(d) = Σ_t idf(t) · tf(t,d)·(k1+1) / (tf(t,d) + k1·(1 − b + b·|d|/avgdl))      k1 = 1.2, b = 0.75
```

**Reciprocal Rank Fusion (RRF)** merges the two ranked lists using only the *ranks* (the raw scores are on incomparable scales, so they are never added):

```
RRF(d) = Σ_lists  weight / (k + rank(d))          k = 60
```

Example: a passage ranked 1st by BM25 and 3rd by dense search scores `1/61 + 1/63 = 0.0323`, beating a passage ranked 1st by dense only (`1/61 = 0.0164`). Agreement between methods wins.

**Reranking**: the fused top-10 is re-scored by a cross-encoder that reads the question and each passage *together* — slower but much more precise than vector similarity. The best `final_k` (default 5) passages become the context.

**The full pipeline:**

```
Question
 → query analysis (classify, rewrite follow-ups into standalone queries)
 → dense retrieval (top-k)  ┐
 → BM25 retrieval  (top-k)  ┴→ RRF fusion → duplicate removal → cross-encoder rerank → context selection
 → relevance grading ── insufficient? → rewrite query & search again (corrective RAG) → still nothing? → refuse
 → grounded answer generation (streamed, cited) → claim-level verification → citations
```

**Measured on the bundled sample benchmark** (`python -m evaluation.cli retrieval`, 19 judged questions, local `bge-small` embeddings, this repository's default settings):

| Mode | Recall@5 | MRR | nDCG@10 | Hit@1 | Avg latency |
|---|---:|---:|---:|---:|---:|
| Dense only | 1.00 | 0.974 | 0.981 | 0.947 | 33 ms |
| BM25 only | 1.00 | 0.873 | 0.901 | 0.789 | 24 ms |
| Hybrid (RRF) | 1.00 | 0.939 | 0.954 | 0.895 | 29 ms |
| Hybrid + rerank | 1.00 | 0.974 | 0.981 | 0.947 | ~600 ms* |

\*CPU cross-encoder on a 12-core laptop, includes the one-time model load. Results are deterministic (identical across repeated runs). The sample corpus is small (6 documents), so every mode finds the right passage within the top 5; the differences show up in *ranking* (MRR/Hit@1). On this corpus plain RRF fusion ranks slightly worse than dense alone, and the reranker recovers the best ordering. Run the benchmark on your own dataset before tuning `DENSE_WEIGHT`/`SPARSE_WEIGHT`.

You can change the retrieval mode (hybrid/dense/BM25), top-k, final-k, RRF k, weights and reranking in **Settings** or per request.

---

## J. Understanding RAGAS

RAGAS uses an LLM as a judge to score each answer. RIVA runs it **asynchronously after the answer is delivered**, so it never slows the chat; the panel shows *Pending → Completed* (or *Failed* / *N/A* with the reason).

| Metric | Measures | Direction | Needs reference answer? |
|---|---|---|---|
| **Faithfulness** | Share of the answer's claims supported by the retrieved context | Higher is better | No |
| **Answer Relevancy** | How directly the answer addresses the question | Higher is better | No |
| **Context Precision** | Whether useful passages are ranked above useless ones (judged against the answer when no reference exists) | Higher is better | No (better with one) |
| **Context Recall** | Share of the reference answer's facts found in the retrieved context | Higher is better | **Yes** |
| **Answer Correctness** | Factual + semantic agreement with the reference answer | Higher is better | **Yes** |
| **Context Entity Recall** | Share of the reference answer's entities (names, dates…) present in the context | Higher is better | **Yes** |
| **Noise Sensitivity** | How often the answer includes wrong claims taken from irrelevant context | **Lower is better** ↓ | **Yes** |

**Why do some metrics show N/A in live chat?** Four metrics compare against a known-correct *reference answer*. In normal chat there is none, so RIVA shows **N/A** with the reason — never a fake 0. Click **Add reference answer** under any answer to run a *reference-based* evaluation (all seven metrics). The mode is labelled **Online**, **Reference-based** or **Offline benchmark**.

Scores are stored as 0–1 and displayed ×100. They are *quality judgements*, not retrieval similarity scores. Click **Raw results** to see the exact inputs and judge outputs.

**Requirements:** `OPENAI_API_KEY` (judge model `EVALUATION_LLM_MODEL`, embeddings `EVALUATION_EMBEDDING_MODEL`). Without a key every metric is recorded as N/A with the explanation.

**Run RAGAS on the benchmark dataset and export results:**

```powershell
cd backend
python -m evaluation.cli ragas --limit 10
python -m evaluation.cli export <run-id> --format csv
```

Reports are written to `backend/evaluation/results/<timestamp>_ragas.json|csv` and are also available in the **Evaluation Dashboard** (download buttons) and `GET /api/evaluation/runs/{id}/export`.

---

## K. Understanding DeepEval

DeepEval is used for **quality assurance and regression testing** of the whole pipeline: a fixed dataset of questions with expected answers is run through RIVA and judged with:

| Metric | Direction | Needs |
|---|---|---|
| Answer Relevancy | higher ↑ | — |
| Faithfulness | higher ↑ | retrieved context |
| Contextual Relevancy | higher ↑ | retrieved context |
| Contextual Precision | higher ↑ | expected answer |
| Contextual Recall | higher ↑ | expected answer |
| Hallucination | **lower ↓** | expected (ground-truth) context |
| Summarization | higher ↑ | summarisation items with source text |

DeepEval and RAGAS use different prompts and formulas — **a "faithfulness" of 0.8 in one is not comparable to 0.8 in the other**. The dashboards keep them separate.

### Dataset

`backend/evaluation/datasets/sample_benchmark.json` — 20 items over an original sample corpus (`datasets/corpus/`: employee handbook, a memo that **contradicts** it, a product spec, a supplier contract, a field-trial report in HTML, service plans in CSV). Each item has `question`, `expected_answer`, `expected_document`, `expected_context` and a `type` (question, contradiction, summarization, unanswerable). Add your own dataset by creating `datasets/<name>.json` with a `corpus_dir`.

### Commands

```powershell
cd backend
python -m evaluation.cli retrieval --baseline        # dense vs BM25 vs hybrid vs hybrid+rerank (no API key needed)
python -m evaluation.cli deepeval --limit 10         # DeepEval metrics (needs OPENAI_API_KEY)
python -m evaluation.cli ragas                       # RAGAS metrics
python -m evaluation.cli all --fail-on-regression    # everything; exit code 1 on regression (for CI)
python -m evaluation.cli compare --framework deepeval  # latest run vs baseline, as JSON
python -m evaluation.cli list                        # recent runs
python -m pytest evaluation/deepeval_suite -q        # DeepEval assert_test regression tests (also: deepeval test run ...)
```

**Regression reports:** every run is compared with the *baseline* run of the same framework and dataset (mark one with `--baseline` or the *Set as baseline* button). A metric regresses when it drops by more than **0.05** (or rises, for lower-is-better metrics). Use this after changing prompts, models, chunking or retrieval settings.

The **hallucination rate** on the Analytics page comes from the latest DeepEval run (share of items failing the Hallucination metric) and names its source run.

---

## L. LangSmith setup

1. Create an account at https://smith.langchain.com.
2. **Settings → API Keys → Create API Key**; copy the `lsv2_...` key.
3. In `backend/.env`:
   ```ini
   LANGCHAIN_TRACING_V2=true
   LANGCHAIN_API_KEY=lsv2_...
   LANGCHAIN_PROJECT=RIVA-AI
   # EU region: LANGCHAIN_ENDPOINT=https://eu.api.smith.langchain.com
   ```
   (`LANGSMITH_TRACING` / `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` are accepted too.)
4. Restart the API. `GET /api/health` shows `"langsmith": {"enabled": true}`.

**Viewing traces.** Open the *RIVA-AI* project. Each chat answer is one trace named `riva_chat` containing the spans `analyze`, `retrieve` (with `embed_query`, `dense_retrieval`, `bm25_retrieval`, `rerank`), `grade`, `rewrite` (if corrective RAG triggered), `answer_generation`, `verify`, `finalize`. Metadata on every trace: `session_id`/`conversation_id`, `message_id`, `workspace_id`, model, retrieval configuration and document scope. The trace's run ID is stored with the message (shown in the answer's metadata), and RAGAS scores and thumbs up/down are attached to the run as **feedback**.

**Debugging failed retrieval.** Filter traces by feedback `ragas.context_precision < 0.5` or open a trace and inspect `dense_retrieval`/`bm25_retrieval` outputs (ranks/scores per chunk) and the `grade` step's `missing_information`.

**Latency and tokens.** LangSmith shows latency per span and token usage per LLM call; RIVA's own per-stage timings are also stored in the database and shown in the UI.

**Privacy.** By default (`TRACE_DOCUMENT_CONTENT=false`) **document text never leaves your server**: chunk contents, retrieved contexts and every passage inside prompts are replaced with `[redacted N chars]` before upload; questions and generated answers are kept for debugging. `TRACE_QA_CONTENT=false` additionally hides questions and answers, keeping only span names, timings, token counts and metadata. (Verified by `tests/test_tracing.py`, which captures what the SDK actually sends.)

**Datasets and experiments.**

```powershell
python -m evaluation.cli langsmith-sync                 # uploads the benchmark as dataset "RIVA-sample_benchmark"
python -m evaluation.cli langsmith-experiment --limit 10  # runs RIVA over it as a LangSmith experiment
```

The experiment records `retrieval_hit`, `correct_refusal`, `grounded` and `latency_s` per example; compare experiments side by side in the LangSmith UI after changing models or settings.

---

## M. Testing

Backend (requires the Docker database to be running — tests use the separate `riva_test` database and never touch your data):

```powershell
cd backend
.venv\Scripts\Activate.ps1
python -m pytest                         # 95 tests: unit, ingestion (all formats + OCR), API end-to-end, RBAC + guardrails, tracing, concurrency
python -m pytest tests/test_performance.py -s    # prints latency percentiles for 16 concurrent chats
python -m pytest evaluation/deepeval_suite -q    # DeepEval quality gates (skipped without OPENAI_API_KEY)
python -m evaluation.cli retrieval               # retrieval benchmark (no key needed)
python -m evaluation.cli all                     # RAGAS + DeepEval + retrieval (needs OPENAI_API_KEY)
```

`tests/test_security.py` (27 tests) proves the security model end-to-end: users/managers/admins see different document sets; the stored retrieval candidates of a user's question never contain a confidential or restricted chunk; managers cannot classify above their clearance; re-classification takes effect immediately and is audited; non-admins get 403 on admin, analytics, evaluation and settings endpoints; users are refused at the admin portal; deactivation revokes access at once; the last admin cannot be demoted; prompt-injection, base64-encoded and paraphrased (LLM-detected) attacks are blocked and audited; a document with planted instructions is quarantined; e-mail/phone numbers are redacted from the **streamed tokens** for users but visible to admins; tokens arrive one word at a time; diagnostics are hidden from users unless enabled; shared registration puts later sign-ups in the organization as users.

What the automated tests cover (with real PostgreSQL, real embeddings, real BM25, real reranker; only the chat LLM is replaced by a deterministic scripted model because CI has no API key): upload of every format incl. a scanned PDF (OCR), duplicates and rejections, size limits, dense vs BM25 vs hybrid behaviour, streaming chat event order, citations mapping to real chunks, corrective RAG refusal, follow-up rewriting, multi-document answers, scope restriction, regenerate, export, feedback, **tenant isolation**, document versions/re-index/delete, failed-document handling, collections and settings, RAGAS persistence incl. N/A semantics and reference-based evaluation, evaluator failures not breaking chat, analytics from real records, health, rate limiting, the four-mode retrieval benchmark, LangSmith payload redaction, and 16 concurrent streams.

Frontend:

```powershell
cd frontend
npm test            # 93 vitest unit tests (SSE parser, typewriter queue, permissions, guardrail UI, formatting, citations)
npm run lint
npm run typecheck
npm run build
```

**Browser end-to-end test** (real UI + real API; only the chat LLM is scripted): registers a user, uploads 8 files (incl. a scanned PDF), waits for indexing, asks questions and checks streamed answers and citations, opens all three answer panels, verifies the view follows new turns, runs the retrieval benchmark from the Evaluation Dashboard, opens Analytics/Settings, checks the 390 px mobile layout for horizontal overflow, and fails on any console error or failed API request. Instructions: [`frontend/README.md`](frontend/README.md#browser-end-to-end-test).

---

## N. Troubleshooting

| Problem | Solution |
|---|---|
| **"The language model is not configured"** (HTTP 503 in chat) | Set `OPENAI_API_KEY` in `backend/.env` and restart the API. |
| **Invalid API key** (`The OpenAI API key was rejected`) | Copy the key again (no spaces/quotes); check it is active at platform.openai.com. |
| **OpenAI rate limits** (`rate limit was reached`) | Wait and retry; lower usage tier limits apply to new accounts. Reduce `RATE_LIMIT_CHAT_PER_MINUTE` or use a smaller `FAST_LLM_MODEL`. |
| **Model not available** | Your key may not have access to a model in `AVAILABLE_MODELS`; remove it or pick another. |
| **`ModuleNotFoundError`** | Activate the venv (`.venv\Scripts\Activate.ps1`) and run `python -m pip install -r requirements.txt`. |
| **Python version conflicts** | Use Python 3.11 or 3.12. Newer versions (3.13+) may lack wheels for some dependencies. Recreate the venv with `py -3.12 -m venv .venv`. |
| **"An Application Control policy has blocked this file"** (Windows) | Windows Smart App Control/WDAC blocks some brand-new unsigned binaries. `requirements.txt` already pins verified versions of numpy, pyarrow, pandas, xxhash and ormsgpack. If another package is blocked, install its previous release; use `python -m <tool>` instead of `.exe` launchers. |
| **Port already in use** | API: `python -m uvicorn app.main:app --port 8200` and set `NEXT_PUBLIC_API_URL`. DB: `$env:RIVA_DB_PORT=5440` before `docker compose up`, update `DATABASE_URL`. Frontend: `npm run dev -- -p 3001` and add the origin to `CORS_ORIGINS`. |
| **PostgreSQL connection errors** | See [F](#database-troubleshooting). |
| **pgvector extension issues** | Use the `pgvector/pgvector:pg17` image; `python -m app.cli check` must print a pgvector version. |
| **`EmbeddingDimensionMismatch`** | `EMBEDDING_DIMENSIONS` must match the model (1536 small, 3072 large, 384 bge-small). Fix it, then `python -m app.cli reset-embeddings`. |
| **PDF extraction errors / "No extractable text"** | The PDF may be image-only: keep `OCR_ENABLED=true`. Encrypted PDFs must be decrypted first. Corrupt files show the parser error on the document card. |
| **Legacy .doc quality** | Without LibreOffice, `.doc` text is read from the binary piece table (no headings/tables). Install LibreOffice (`soffice` on PATH) for full fidelity, or save as .docx. |
| **Embedding failures** | Check the key/quotas; failed jobs retry automatically 3× with backoff, then show *Failed* with *Re-index*. |
| **Empty retrieval / "couldn't find sufficient information"** | Confirm documents are *Indexed* and in the selected scope; try BM25 terms from the document; check *Retrieved Sources* ranks; increase `top_k`. |
| **LangSmith tracing errors** | Check `LANGCHAIN_API_KEY`, region endpoint, and network egress; tracing failures never break chat (see API logs). |
| **RAGAS evaluation failures** | The panel shows the reason. Usually a missing/invalid key or judge timeout (`EVALUATION_TIMEOUT_SECONDS`). Click *Re-run*. |
| **DeepEval model configuration problems** | DeepEval uses `EVALUATION_LLM_MODEL` with your `OPENAI_API_KEY`; telemetry is disabled by RIVA (`DEEPEVAL_TELEMETRY_OPT_OUT`). |
| **Frontend build errors** | Delete `frontend/node_modules` and `.next`, run `npm install` again; use Node 20+. |
| **"This account does not have access to the admin portal"** | The account has the *user* role. Sign in at `/login`, or ask an admin to promote you (Admin → Users). |
| **A user says a document is missing / RIVA "couldn't find" an answer an admin gets** | Working as designed: the document's classification is above the user's clearance. Re-classify it (Admin → Documents) or raise the role's clearance (Admin → Security). |
| **A legitimate question was blocked** | Check *Admin → Audit log* for the matched rule; rephrase, or (admins) disable `block_prompt_injection` / `llm_injection_check` temporarily. Please report false positives. |
| **Frontend says "Failed to fetch"** | The API is not running or `NEXT_PUBLIC_API_URL`/`CORS_ORIGINS` don't match the URLs you use. |

---

## O. Deployment

**Containers.** `backend/Dockerfile` builds one image used for both the API and the worker; `frontend/Dockerfile` builds a standalone Next.js server. `docker compose --profile app up -d --build` runs the whole stack on one host.

**Recommended production layout**

| Component | Recommendation |
|---|---|
| Frontend | Vercel, or the container behind your reverse proxy. Set `NEXT_PUBLIC_API_URL` at build time to your API URL. |
| Backend API | Container platform (Azure Container Apps, AWS ECS/Fargate, Cloud Run, Kubernetes). Run 2+ replicas behind HTTPS. Set `EMBEDDED_WORKER=false`. |
| Worker | Same image with `python -m app.worker`; scale horizontally (jobs are claimed with `FOR UPDATE SKIP LOCKED`). |
| PostgreSQL | Managed service with pgvector (Azure Database for PostgreSQL, AWS RDS/Aurora, Supabase, Neon, Cloud SQL) with automated backups/PITR. Run `python -m alembic upgrade head` on deploy. |
| Redis | Managed Redis (needed for consistent rate limiting across replicas). |
| File storage | Mount a persistent volume at `STORAGE_DIR` (or implement the `LocalStorage` interface for S3/Blob). |
| Monitoring | LangSmith for traces, `/api/health` for liveness, JSON logs (`LOG_JSON=true`) to your log platform. |

**Environment variables:** everything from `.env.example`; store secrets (`SECRET_KEY`, `OPENAI_API_KEY`, `LANGCHAIN_API_KEY`, `DATABASE_URL`) in your platform's secret manager.

**Production security checklist**

- `ENVIRONMENT=production` (the API refuses to start with the default `SECRET_KEY`), `COOKIE_SECURE=true`, HTTPS everywhere.
- Serve frontend and API on the same site (e.g. `app.example.com` + `api.example.com`) so the `SameSite=Lax` session cookie works; set `CORS_ORIGINS` to exactly your frontend origin.
- `ALLOW_REGISTRATION=false` for private deployments; create users with `python -m app.cli create-user --email ... --admin`.
- Keep `TRACE_DOCUMENT_CONTENT=false` unless policy allows sending documents to LangSmith.
- Put the API behind a reverse proxy/WAF with request-size limits ≥ `MAX_UPLOAD_MB`.
- Use a least-privilege database user; enable encryption at rest; rotate keys.
- Regularly run `python -m evaluation.cli all --fail-on-regression` in CI before releasing prompt/model/retrieval changes.

---

## P. Project status, roadmap and known limitations

### Implemented and verified

- Full backend (38 REST endpoints + SSE), PostgreSQL schema with migrations, tenant isolation, auth, rate limiting.
- Ingestion of all 9 formats incl. OCR — verified by tests on generated files of each type.
- Hybrid retrieval (pgvector + SQL BM25 + RRF + dedupe + cross-encoder) — verified by tests and the retrieval benchmark.
- LangGraph corrective RAG with grading, query rewriting, refusal, verification and citations — verified end-to-end with a scripted LLM.
- Online RAGAS lifecycle (pending → completed/failed/N/A), reference-based evaluation, persistence and display contract — verified with a patched evaluator.
- Benchmarks, regression comparison and JSON/CSV export — verified (retrieval benchmark ran for real).
- LangSmith tracing with redaction — verified against a local capture server (spans, metadata, privacy).
- Analytics computed from real records — verified.
- Frontend: production build, type-check, lint and 93 unit tests pass; the browser end-to-end test passes against the production build with zero console errors or failed requests, covering both portals (admin upload/classify/users/security/audit, and a plain user who is refused at the admin portal, cannot retrieve a confidential contract, gets a prompt-injection blocked and sees PII redacted).
- Docker: the backend image builds and runs (`python -m app.cli check` inside the container connects to the Compose database).

### Requires your API keys to verify live

These are implemented against the installed library APIs (RAGAS 0.4.4, DeepEval 4.3.4, LangSmith 0.14.17, langchain-openai 1.8) but could not be exercised against the real services in the development environment, because no keys were available:

- Real OpenAI answer generation, query analysis, grading and verification quality.
- Real RAGAS and DeepEval scores (LLM-as-judge calls).
- Real LangSmith ingestion, datasets and experiments (the payloads were verified locally).

After adding `OPENAI_API_KEY`, run `python -m evaluation.cli all --limit 5` to confirm the full evaluation stack on your machine.

### Security notes

- Guardrail rules are heuristics plus an LLM check; they substantially raise the bar but no filter catches every possible attack. The **hard guarantee is RBAC**: documents above a user's clearance are excluded in SQL and can never reach the model, whatever the prompt says.
- PII redaction is pattern-based (emails, phones, cards, IBANs, SSNs, keys, passwords); names and free-text personal data are not detected.

### Known limitations

- **Small sample benchmark**: 6 documents / 20 questions — good for regression checks, not for claims about absolute quality.
- **BM25 language**: the full-text configuration is English (`to_tsvector('english', …)`); other languages still work through dense search but get weaker keyword matching.
- **Page numbers**: exact for PDF/PPTX (slides)/XLSX (sheets); DOCX page numbers are estimated from page breaks; TXT/MD/HTML/CSV have no pages (citations show the section instead).
- **Legacy .doc** without LibreOffice loses headings and tables.
- **Reranker latency** on CPU is ~250–700 ms per question; disable it (`RERANKER_ENABLED=false`) or use a GPU host if latency matters more than precision.
- **Workspaces** are single-owner in the UI (the data model supports members/roles; there is no invite flow yet).
- **File storage** is the local filesystem (an interface for object storage is provided but not implemented).

### Roadmap

- Workspace invitations and shared collections; SSO (OIDC).
- Object storage (S3/Azure Blob) backend; virus scanning hook for uploads.
- Multilingual BM25 (per-document language detection) and multilingual embeddings by default.
- GPU/remote reranker option (e.g. Cohere/Voyage rerank APIs) behind the same interface.
- Scheduled benchmark runs in CI with automatic LangSmith experiment comparison.

---

## Appendix: API reference and project structure

Interactive docs: http://localhost:8100/docs. Main endpoints:

```
POST /api/auth/register · POST /api/auth/login · POST /api/auth/logout · GET /api/auth/me
GET  /api/system · GET|PUT /api/settings
GET|POST /api/collections · DELETE /api/collections/{id}
POST /api/documents/upload · GET /api/documents · GET|PATCH|DELETE /api/documents/{id}
POST /api/documents/{id}/reindex · POST /api/documents/{id}/versions
GET  /api/documents/{id}/chunks · GET /api/documents/{id}/file
POST /api/chat · POST /api/chat/stream (SSE: meta, status, retrieval, token, done, error) · GET /api/chat/suggestions
GET  /api/conversations · GET|PATCH|DELETE /api/conversations/{id} · GET /api/conversations/{id}/export
GET  /api/messages/{id} · POST /api/messages/{id}/feedback
GET  /api/evaluations/{message_id} · GET /api/evaluations/{message_id}/raw
POST /api/evaluations/{message_id}/reference · POST /api/evaluations/{message_id}/rerun
POST /api/evaluation/ragas/run · POST /api/evaluation/deepeval/run · POST /api/evaluation/retrieval/run
GET  /api/evaluation/reports · GET /api/evaluation/runs/{id} · GET /api/evaluation/runs/{id}/export · POST /api/evaluation/runs/{id}/baseline
GET  /api/analytics/overview · GET /api/analytics/performance · GET /api/analytics/evaluations
POST /api/auth/login  {email, password, portal: "user" | "admin"}  → access: {role, permissions, clearance, admin_portal}
GET|POST /api/admin/users · PATCH|DELETE /api/admin/users/{id} · GET /api/admin/audit · GET /api/admin/security
GET  /api/health
```

Errors always have the shape `{"error": {"code", "message", "details", "request_id"}}`; stack traces are never returned.

```
riva-ai/
├── backend/
│   ├── app/
│   │   ├── api/            deps.py (auth, tenant + RBAC context) · routes/ (auth, admin, documents, chat, conversations, evaluations, analytics, settings, health)
│   │   ├── core/           config, rbac (roles/permissions/clearance), security (Argon2/JWT), errors, logging, rate limiting, cache, timing
│   │   ├── guardrails/     input_guard (injection/jailbreak/escalation) · context_guard (indirect injection) · output_guard (redaction, leak check, word streamer)
│   │   ├── database/       async engine/session, declarative base
│   │   ├── models/         users/workspaces · documents/versions/chunks/jobs · conversations/messages/retrieval/performance/feedback · evaluations/benchmarks
│   │   ├── schemas/        Pydantic API contracts
│   │   ├── ingestion/      validators, extractors (9 formats), OCR, cleaning, pipeline
│   │   ├── chunking/       5 chunking strategies
│   │   ├── embeddings/     OpenAI / FastEmbed providers
│   │   ├── llm/            chat model factory, token usage tracking
│   │   ├── retrieval/      dense.py · bm25.py · fusion.py · reranker.py · hybrid.py
│   │   ├── rag/            prompts.py · chain.py · corrective_rag.py · graph.py · citations.py
│   │   ├── evaluation/     ragas_evaluator.py · deepeval_evaluator.py · evaluation_service.py · benchmark.py · retrieval_metrics.py
│   │   ├── observability/  LangSmith tracing + redaction
│   │   ├── analytics/      analytics queries
│   │   ├── services/       document, chat, serializers, storage
│   │   ├── worker.py       background worker (python -m app.worker)
│   │   ├── cli.py          admin commands (python -m app.cli)
│   │   └── main.py         FastAPI app
│   ├── alembic/            migrations (0001: schema, HNSW + GIN indexes, BM25 trigger)
│   ├── evaluation/         cli.py · langsmith_sync.py · datasets/ (+corpus/) · results/ · deepeval_suite/
│   ├── tests/              pytest suite
│   ├── requirements.txt · requirements.lock.txt · Dockerfile · .env.example
├── frontend/               Next.js app (app/, components/, hooks/, services/, lib/)
├── infra/postgres/init.sql
├── docker-compose.yml
├── README.md · LICENSE · .gitignore
```

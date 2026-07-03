# Build prompt: Loan document requirements-check pipeline (SQLite + frontend)

Copy everything below into Antigravity / Kiro as your task prompt.

---

## What to build

A full-stack app implementing the **first step of a loan processing pipeline**: checking whether an applicant has uploaded all required documents for their loan type, and routing incomplete applications to a human ops queue instead of retrying automatically.

Pipeline:

```
LOAN_RECEIVED
  -> CHECK_REQUIRED_DOCUMENTS
      -> all present   -> DOCUMENTS_COMPLETE   -> ready for downstream OCR pipeline (out of scope, just show a "ready" state)
      -> missing docs  -> DOCUMENTS_INCOMPLETE -> raised to a human ops queue (NO auto-chase, NO retry loop)
```

This is a **config-driven** check, not hardcoded: required documents per loan type live in a database table that non-engineers can edit.

## Tech stack

- Database: **SQLite** (single file, e.g. `loanops.db`)
- Backend: Node.js + Express, using `better-sqlite3` (synchronous, simple, no ORM required) — or Python + FastAPI with the built-in `sqlite3` module if you prefer Python
- Frontend: React + TypeScript (Vite), plain CSS — no Tailwind requirement, but fine if the tool defaults to it
- No auth needed — single ops-user assumption
- Run backend and frontend as two processes locally (backend on e.g. `:4000`, frontend dev server on `:5173`, frontend calls backend via `fetch`)

## Database schema (SQLite syntax)

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE applicants (
    applicant_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name      TEXT NOT NULL,
    email          TEXT NOT NULL,
    phone          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE loan_types (
    loan_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT NOT NULL UNIQUE,       -- 'PERSONAL', 'AUTO', 'HOME'
    display_name   TEXT NOT NULL
);

-- Config table: required document types per loan type. Must be editable
-- without a code deploy (e.g. via an admin screen, or direct edits to this table).
CREATE TABLE required_documents (
    required_document_id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_type_id   INTEGER NOT NULL REFERENCES loan_types(loan_type_id),
    document_type  TEXT NOT NULL,               -- 'ID_PROOF', 'PAYSLIP_3M', etc
    display_name   TEXT NOT NULL,
    is_active      INTEGER NOT NULL DEFAULT 1,  -- boolean: 1 = active, 0 = inactive
    UNIQUE (loan_type_id, document_type)
);

CREATE TABLE applications (
    applicant_id   INTEGER PRIMARY KEY REFERENCES applicants(applicant_id),
    loan_type_id   INTEGER NOT NULL REFERENCES loan_types(loan_type_id),
    status         TEXT NOT NULL DEFAULT 'LOAN_RECEIVED'
                   CHECK (status IN ('LOAN_RECEIVED','DOCUMENTS_COMPLETE','DOCUMENTS_INCOMPLETE','OCR_IN_PROGRESS','OCR_COMPLETE')),
    missing_documents TEXT,                     -- JSON array stored as text, e.g. '["ID_PROOF","PAYSLIP_3M"]'
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE uploaded_documents (
    uploaded_document_id INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id   INTEGER NOT NULL REFERENCES applicants(applicant_id),
    document_type  TEXT NOT NULL,
    file_url       TEXT NOT NULL,
    uploaded_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only audit trail. Application code must never UPDATE or DELETE rows here.
CREATE TABLE status_history (
    status_history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id   INTEGER NOT NULL REFERENCES applicants(applicant_id),
    from_status    TEXT,
    to_status      TEXT NOT NULL,
    reason         TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Human ops queue. Only a human action (via the resolve endpoint) may set resolved_at.
-- No scheduled job, cron, or retry worker may write to this table.
CREATE TABLE ops_queue (
    ops_queue_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id      INTEGER NOT NULL REFERENCES applicants(applicant_id),
    missing_documents TEXT NOT NULL,            -- JSON array stored as text
    raised_at         TEXT NOT NULL DEFAULT (datetime('now')),
    assigned_to       TEXT,
    resolved_at       TEXT,
    resolution_note   TEXT
);

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_ops_queue_unresolved ON ops_queue(applicant_id) WHERE resolved_at IS NULL;
```

Note: SQLite has no native `JSONB`/`JSON` type or boolean type — store JSON as `TEXT` (stringify/parse in application code) and booleans as `INTEGER` (0/1), as shown above.

### Seed data

Seed on first run (check if `loan_types` is empty, then insert):

```sql
INSERT INTO loan_types (code, display_name) VALUES
  ('PERSONAL', 'Personal loan'),
  ('AUTO', 'Auto loan'),
  ('HOME', 'Home loan');

INSERT INTO required_documents (loan_type_id, document_type, display_name) VALUES
  (1, 'ID_PROOF', 'Government ID'),
  (1, 'PAYSLIP_3M', 'Last 3 months payslips'),
  (1, 'BANK_STATEMENT_3M', 'Last 3 months bank statement'),
  (2, 'ID_PROOF', 'Government ID'),
  (2, 'PAYSLIP_3M', 'Last 3 months payslips'),
  (2, 'VEHICLE_QUOTE', 'Vehicle purchase quote'),
  (3, 'ID_PROOF', 'Government ID'),
  (3, 'PAYSLIP_3M', 'Last 3 months payslips'),
  (3, 'BANK_STATEMENT_6M', 'Last 6 months bank statement'),
  (3, 'PROPERTY_VALUATION', 'Property valuation report');
```

Also seed 5-6 example applicants with varying upload states (some complete, some missing 1-2 docs) so the UI has realistic data to show immediately.

## Core business logic

Implement this exact function server-side — this is the source of truth, do not change the behavior:

```python
def check_required_documents(applicant_id, loan_type):
    required = db.get_required_documents(loan_type)       # from required_documents config table, is_active = 1 only
    uploaded = db.get_uploaded_document_types(applicant_id)
    missing = [d for d in required if d not in uploaded]
    if missing:
        db.set_application_status(applicant_id, "DOCUMENTS_INCOMPLETE", missing=missing)
        return False
    db.set_application_status(applicant_id, "DOCUMENTS_COMPLETE")
    return True
```

Hard rules (do not deviate):

1. A missing-document gap is **not a retryable technical failure**. It must never trigger an automatic retry, a scheduled re-check, or an automated reminder to the applicant. The only trigger for re-running the check is an explicit API call.
2. Every call to `set_application_status` must insert a row into `status_history` with `from_status`, `to_status`, and a `reason` (comma-joined list of missing doc types when incomplete, `null` when complete).
3. Every transition into `DOCUMENTS_INCOMPLETE` must ensure exactly one open (`resolved_at IS NULL`) row exists in `ops_queue` for that applicant — don't insert a duplicate if one is already open; update its `missing_documents` instead if the missing list changed.
4. Resolving an ops queue item (setting `resolved_at`) does **not** automatically flip the application back to `DOCUMENTS_COMPLETE`. A human resolves the queue item after contacting the applicant; a separate re-check call (triggered after new documents are uploaded) is what updates status.
5. `required_documents` must be read from the database on every check — never hardcode document lists in application code.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/applications` | List all applications: applicant name, id, loan type, status, missing-doc count |
| GET | `/applications/:id` | Full detail: applicant info, loan type, required docs with present/missing flags, status, pipeline stage |
| POST | `/applications/:id/check` | Re-run `check_required_documents` for that applicant |
| POST | `/applications/:id/documents` | Record a newly uploaded document: body `{ document_type, file_url }` |
| GET | `/ops-queue` | List open (unresolved) ops queue items: applicant name, loan type, missing docs, time raised |
| POST | `/ops-queue/:id/resolve` | Mark an ops queue item resolved: body `{ resolution_note }` — does not touch application status |
| GET | `/config/required-documents` | List required documents grouped by loan type, for the config screen |
| GET | `/loan-types` | List loan types (for dropdowns) |

Return JSON. Use proper HTTP status codes (404 for unknown applicant/queue id, 400 for bad body, 200/201 on success).

## Frontend UI (React + TypeScript)

Build a single-page app with client-side routing (or simple view-state switching) across four screens:

**1. Applications list** (`/`)
- Table: applicant name, applicant id, loan type, status badge, missing-doc count
- Status badge: `DOCUMENTS_COMPLETE` styled green/mint, `DOCUMENTS_INCOMPLETE` styled amber — not red, since this is a routine/expected state, not an error
- Clicking a row navigates to the detail view
- Fetches from `GET /applications` on mount

**2. Application detail** (`/applications/:id`)
- A horizontal pipeline/status rail with three stages: `loan_received -> check_required_documents -> documents_complete / documents_incomplete`. The current stage is visually highlighted; an incomplete result should read as "stalled, waiting on a human" rather than as an error/failure
- Document checklist: every required document for that applicant's loan type, each marked received or missing, sourced from `GET /applications/:id`
- If complete: show a message that the application is ready for the downstream OCR pipeline
- If incomplete: show a clearly worded callout stating the application is held for human review and will **not** auto-chase or auto-retry — the only way it changes is a human triggering a re-check
- Include a "re-check documents" button that calls `POST /applications/:id/check` and refreshes the view

**3. Ops queue** (`/ops-queue`)
- List of open items: applicant name, loan type, missing documents, time since raised (relative, e.g. "2h ago"), and actions to open the application or resolve the item (with a text note) via `POST /ops-queue/:id/resolve`
- Empty state: a calm message that the queue is clear, not an error state
- Fetches from `GET /ops-queue`

**4. Document config** (`/config`)
- Read-only list of required documents grouped by loan type, from `GET /config/required-documents`

## Design direction

Internal ops-tool aesthetic for a loan processing team — dense, dark, functional, not a consumer marketing page.

- Font: a monospace face (e.g. IBM Plex Mono) for statuses, applicant ids, and document type codes; a clean sans-serif (e.g. IBM Plex Sans) for names and prose
- Color: two semantic colors only — mint/green for complete, amber for incomplete/needs-attention. Do not use red for the incomplete state; missing documents are a routine, expected outcome of the check, not a system error
- Layout: left sidebar with nav (Applications / Ops queue / Document config) and a nav badge showing the open ops-queue count; main content area with the table or detail panel
- Keep it responsive down to a reasonably narrow window, but this is an internal tool — desktop-first is fine

## File/project structure (suggested)

```
/backend
  server.js (or main.py)
  db.js (or db.py)          # sqlite connection + schema init + seed
  loanops.db                # generated SQLite file, gitignored
  routes/
    applications.js
    opsQueue.js
    config.js
/frontend
  src/
    App.tsx
    pages/
      ApplicationsList.tsx
      ApplicationDetail.tsx
      OpsQueue.tsx
      Config.tsx
    api.ts                  # fetch wrappers to backend
```

## Acceptance criteria

- [ ] Backend uses SQLite (a single `.db` file), with schema and seed data created automatically on first run if the database doesn't exist
- [ ] Required documents are read from the `required_documents` table, never hardcoded in application logic
- [ ] An application with all required docs uploaded shows `DOCUMENTS_COMPLETE` and has no open ops queue entry
- [ ] An application missing any doc shows `DOCUMENTS_INCOMPLETE`, lists exactly which docs are missing, and has exactly one open ops queue entry
- [ ] No code path automatically re-checks, retries, or notifies the applicant on an incomplete result — the only way status changes is via `POST /applications/:id/check`
- [ ] Every status change is recorded in `status_history`, and that table is never updated or deleted from
- [ ] Resolving an ops queue item does not by itself change application status
- [ ] Frontend runs against the backend API (not hardcoded/mock data) and reflects all four screens described above
- [ ] Incomplete status is styled as a routine "needs a human" state (amber), not as an error (not red)

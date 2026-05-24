# KoinX — Transaction Reconciliation Engine

A production-grade Node.js service that ingests crypto transaction data from two sources (user-exported and exchange-exported), matches them using configurable tolerances, and produces a structured reconciliation report.

---

## Tech Stack

- **Node.js** — runtime
- **Express** — REST API
- **MongoDB + Mongoose** — persistent storage
- **csv-parse / csv-stringify** — CSV ingestion and report generation
- **Winston** — structured logging
- **dotenv** — environment-based configuration

---

## Project Structure

```
koinx-reconciliation/
├── data/                          # Input CSV files
│   ├── user_transactions.csv
│   └── exchange_transactions.csv
├── logs/                          # Winston log output
├── src/
│   ├── config/index.js            # Config loader (env vars)
│   ├── utils/
│   │   ├── logger.js              # Winston logger
│   │   └── normalize.js          # Asset alias + type normalization
│   ├── models.js                  # Mongoose schemas
│   ├── ingestion/ingest.js        # CSV parsing, validation, deduplication
│   ├── matching/engine.js         # Core matching algorithm
│   ├── report/report.js           # Entry persistence + CSV export
│   ├── reconciler.js              # Orchestrator (ties everything together)
│   ├── api/routes.js              # Express route handlers
│   └── server.js                  # Entry point
├── .env                           # Environment variables
├── package.json
└── README.md
```

---

## Setup

### Prerequisites

- Node.js >= 18
- MongoDB running locally (or provide a remote URI)

### Install

```bash
npm install
```

### Configure

Edit `.env` or set environment variables:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/koinx_reconciliation
TIMESTAMP_TOLERANCE_SECONDS=300
QUANTITY_TOLERANCE_PCT=0.01
```

### Run

```bash
npm start
# or for development with auto-reload:
npm run dev
```

---

## API Reference

### `POST /reconcile`

Triggers a full reconciliation run. Accepts optional tolerance overrides in JSON body.

**Request:**
```json
{
  "timestampToleranceSeconds": 120,
  "quantityTolerancePct": 0.05
}
```

**Response:**
```json
{
  "message": "Reconciliation completed",
  "runId": "uuid-v4-string"
}
```

---

### `GET /report/:runId`

Returns the full reconciliation report for a run as JSON.

Add `?format=csv` to download as a CSV file.

---

### `GET /report/:runId/summary`

Returns just the counts:

```json
{
  "runId": "...",
  "status": "completed",
  "config": { "timestampToleranceSeconds": 300, "quantityTolerancePct": 0.01 },
  "summary": {
    "matched": 18,
    "conflicting": 2,
    "unmatchedUser": 4,
    "unmatchedExchange": 2,
    "totalUser": 27,
    "totalExchange": 25,
    "invalidRows": 3,
    "duplicateRows": 1
  }
}
```

---

### `GET /report/:runId/unmatched`

Returns only unmatched rows (user-only and exchange-only) with reasons.

---

## How Matching Works

### Asset Normalization

Common aliases are resolved before matching:
- `bitcoin` → `BTC`
- `ethereum` → `ETH`
- `polygon` → `MATIC`
- Comparison is case-insensitive

### Type Normalization

`TRANSFER_IN` (exchange perspective) and `TRANSFER_OUT` (user perspective) represent the **same transaction** from opposite sides. Both are normalized to `TRANSFER` before matching.

### Matching Algorithm

For each valid user transaction, the engine:

1. Finds all exchange transactions with the same **asset** and **normalized type**
2. Filters to those within the **timestamp tolerance window**
3. Picks the **closest match** by smallest timestamp delta
4. Checks if quantity is within **quantity tolerance (%)**
5. If all fields match → `matched`; if quantity/timestamp conflict → `conflicting`

Remaining unmatched rows on either side → `unmatched_user` / `unmatched_exchange`

### Tolerances (configurable)

| Parameter | Default | Description |
|---|---|---|
| `TIMESTAMP_TOLERANCE_SECONDS` | 300 (5 min) | Max allowed timestamp gap |
| `QUANTITY_TOLERANCE_PCT` | 0.01 | Max allowed quantity difference (%) |

Can be overridden via `.env`, environment variables, or per-request body parameters on `POST /reconcile`.

---

## Data Quality Handling

The ingestion layer **never silently drops bad rows**. Every row is stored with:
- `isValid: false` if it fails validation
- `isDuplicate: true` if the same `transaction_id` appears more than once
- `qualityIssues: [...]` — array of human-readable reasons

### Issues detected in the provided sample data

| Row | Source | Issue |
|---|---|---|
| USR-001 (row 17) | User | Duplicate transaction_id |
| USR-018 | User | Malformed timestamp (`2024-03-09T`) |
| USR-019 | User | Negative quantity (`-0.1`) |
| USR-024 | User | Missing timestamp entirely |
| USR-005 | User | Asset `bitcoin` normalized to `BTC` |
| USR-004 / EXC-1004 | Both | `TRANSFER_OUT` ↔ `TRANSFER_IN` — handled by type normalization |

---

## Key Design Decisions

### 1. Never drop bad rows
Invalid rows are stored with `isValid: false` and flagged reasons. This ensures full audit traceability — a core requirement in financial data systems.

### 2. Greedy closest-match algorithm
Rather than exact ID matching (impossible across systems), the engine uses proximity matching with configurable windows. The best candidate is chosen by minimum timestamp delta, preventing double-matching.

### 3. Conflicting vs Unmatched
A `conflicting` entry means we found a likely match by time/type/asset proximity but the quantities or timestamps are outside tolerance. This is distinct from `unmatched`, which means no candidate was found at all.

### 4. Configurable tolerances at multiple levels
Tolerances can be set via env vars (system-wide defaults), or overridden per request body (per-run). This makes the engine flexible for different exchange data quality levels.

### 5. runId scoping
Every ingestion and report is scoped to a `runId` (UUID). This allows multiple runs to coexist in the database, making the system replayable and auditable.

### 6. CSV report format
The output CSV includes both sides of the transaction (user + exchange columns) side by side, plus `category`, `reason`, and `conflict_details`. This makes it immediately readable by non-technical stakeholders.

---

## Example Usage

```bash
# Start server
npm start

# Trigger reconciliation with default tolerances
curl -X POST http://localhost:3000/reconcile

# Trigger with custom tolerances
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -d '{"timestampToleranceSeconds": 120, "quantityTolerancePct": 0.05}'

# Get summary
curl http://localhost:3000/report/<runId>/summary

# Get full report as CSV
curl http://localhost:3000/report/<runId>?format=csv -o report.csv

# Get only unmatched rows
curl http://localhost:3000/report/<runId>/unmatched
```

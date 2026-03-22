# AI Tools Platform

A monorepo containing two AI-powered tools: an **Inventory Organizer** that normalises supplier spreadsheets into a standard business template, and a **BD Agent** that automates business development lead generation and outreach drafting.

Both tools share a single FastAPI backend and a React frontend hub.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Inventory Organizer](#inventory-organizer)
- [BD Agent](#bd-agent)
- [Project Structure](#project-structure)
- [Configuration Reference](#configuration-reference)

---

## Overview

| Tool | What it does |
|------|-------------|
| **Inventory Organizer** | Upload any CSV or Excel inventory file — the AI analyses the structure, maps columns to a fixed business schema, lets you correct mappings via chat, and exports a normalised CSV |
| **BD Agent** | Config-driven lead generation: searches the web (LinkedIn, Reddit, news, etc.) for matching prospects, qualifies each with an LLM, drafts outreach emails, deduplicates, and surfaces results in a live dashboard |

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.9+ | system |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Ollama | latest | `brew install ollama` |
| llama3.2 model | — | `ollama pull llama3.2` |

A **Serper API key** is required for the BD Agent web search. Get one at [serper.dev](https://serper.dev).

---

## Setup

### 1. Start Ollama

```bash
ollama serve          # starts the Ollama server on port 11434
ollama pull llama3.2  # one-time model download (~2 GB)
```

### 2. Backend

```bash
cd "Inventory Parsing"

# Create and activate virtual environment (repo root — used by both tools)
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate         # Windows

# Install backend dependencies
pip install -r backend/requirements.txt

# Start the API server
cd backend
uvicorn main:app --reload --port 8000
```

API available at `http://localhost:8000` — interactive docs at `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd "Inventory Parsing/frontend"
npm install
npm run dev
```

Open `http://localhost:5173` in your browser to access the tool hub.

### 4. BD Agent API key (optional but required for live search)

```bash
cp pollen-bd-agent/.env.example pollen-bd-agent/.env
# Edit .env and set SERPER_API_KEY=<your key>
```

If the key is missing the agent falls back to mock search results for testing.

---

## Inventory Organizer

### What it does

Turns any supplier inventory spreadsheet — regardless of layout, column names, or format — into a standardised output CSV ready for downstream systems. The AI agent handles the entire normalisation pipeline:

1. **Upload** a CSV, XLSX, XLS, or XLSM file
2. **Sheet selection** if the workbook contains multiple sheets
3. **Feasibility check** — rejects non-inventory files early
4. **Wide-format detection** — sizes as columns are automatically unpivoted to rows
5. **Supplementary block extraction** — pricing notes, reference rates, and seller hints are separated and summarised
6. **AI column mapping** — columns are matched to the standard schema with a confidence score; review and edit in the UI or by chatting
7. **Apply mapping** — auto-calculates discount percentage and carton quantities where possible
8. **Optional enrichment** — provide seller/brand/market context and the LLM fills missing `category` / `sub_category` using a built-in FMCG taxonomy
9. **CSV download** — download the normalised data at any point after preview (cleaned data + full template CSV); session archived to SQLite

### Standard output fields

| Field | Description |
|-------|-------------|
| `sku` | Product / item code |
| `description` | Product name |
| `size` | Size, variant, or colour |
| `quantity` | Stock quantity |
| `retail_price` | RRP / list price |
| `offer_price` | Sale / trade price |
| `discount_pct` | Calculated discount percentage |
| `barcode` | EAN, UPC, or internal barcode |
| `cartons` | Carton count (auto-derived where possible) |
| `warehouse` | Warehouse or location |
| `category` | AI-assigned product category |
| `sub_category` | AI-assigned sub-category |
| `brand` | Brand name |
| `amazon_link` | Amazon product URL |
| `shipping_details` | Weight, dimensions, or carrier info |

### Usage

1. Open `http://localhost:5173` and select **Inventory Organizer**
2. Drag-and-drop or click to upload a file
3. Select a sheet if prompted
4. Review the AI's proposed column mapping — correct any field via the dropdowns or by typing in the chat (e.g. *"use column D for the retail price"*)
5. Click **Confirm Mapping** (or type *"yes"*)
6. The normalised data appears as a paginated preview table
7. Click **Download CSV** to save the output (available as soon as the preview appears)

### Changing the AI model

Edit `backend/agent.py`:

```python
OLLAMA_MODEL = "llama3.2"   # change to e.g. "mistral", "llama3.1", "gemma2"
```

Then pull the model: `ollama pull mistral`

---

## BD Agent

### What it does

A config-driven business development agent that continuously searches the web for qualified leads matching your target profile, scores them with an LLM, writes draft outreach emails, and deduplicates the results.

**Multi-project:** each project has its own configuration (search queries, geography, scoring thresholds) and isolated lead database stored as JSON under `pollen-bd-agent/projects/<id>/`.

### How it works

1. **Onboarding** — set up a new project through the UI (guided chat) or by editing `config.json` directly
2. **Search** — uses Serper to query LinkedIn, Reddit, Instagram, Facebook, news feeds, and Google; configurable per channel and geography
3. **Qualification** — each result is evaluated by Ollama: fit score, priority (hot / warm / cold), category, country, signal type, and a draft outreach email are generated for each lead
4. **Deduplication** — URL and name normalisation plus LLM-assisted semantic grouping remove redundant entries
5. **Persistence** — qualified leads (above the configured `save_min` threshold) are saved to `data/leads.json` per project
6. **Monitoring** — a live dashboard in the React frontend shows leads, stats, run/stop controls, and cleanup actions

### Usage

1. Open `http://localhost:5173` and select **BD Agent**
2. Create a new project and complete the onboarding chat (describes target market, queries, geography)
3. Click **Run Agent** — the agent runs as a background subprocess and streams status
4. View leads as they arrive; filter by priority (hot / warm / cold), star important ones
5. Use **Cleanup** to remove duplicates from accumulated runs
6. Stop the agent at any time with **Stop Agent**
7. **Download CSV** — export visible leads as a CSV file named after the project
8. **Delete project** — hover over a project card and click the trash icon to permanently remove it

### Per-project config

The key fields in `pollen-bd-agent/projects/<id>/config.json` (see `config.example.json` for a full template):

| Field | Description |
|-------|-------------|
| `search_queries` | List of search strings to run |
| `search_channels` | Channels to search: `linkedin`, `reddit`, `instagram`, `facebook`, `news`, `google` |
| `search_geo` | Target geography (e.g. `"UK"`, `"US"`) |
| `max_results_per_query` | How many results to fetch per query |
| `save_min` | Minimum fit score (0–10) to save a lead |
| `signals` | Keywords that flag a lead as high-priority |
| `target_schema` | What fields to extract per lead |

---

## Project Structure

```
Inventory Parsing/
├── backend/
│   ├── main.py              # FastAPI app — REST endpoints + WebSockets for both tools
│   ├── agent.py             # LangChain + Ollama inventory AI agent
│   ├── parser.py            # CSV/Excel parsing, wide-format handling, mapping logic
│   ├── database.py          # SQLAlchemy + SQLite session/row models
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── requirements.txt
│   ├── uploads/             # temporary uploaded files (gitignored)
│   └── outputs/             # normalised output CSVs (gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Tool hub — routes to each tool
│   │   ├── api/client.ts    # REST + WebSocket client
│   │   ├── components/      # Shared UI components
│   │   ├── tools/
│   │   │   ├── registry.ts          # Tool registry
│   │   │   ├── InventoryTool.tsx    # Inventory Organizer UI
│   │   │   └── PollenBDTool.tsx     # BD Agent UI
│   └── package.json
├── pollen-bd-agent/
│   ├── agent.py             # BD agent subprocess — search, qualify, save leads
│   ├── search.py            # Serper multi-channel web search
│   ├── cleanup.py           # Deduplication pipeline (exact + LLM semantic)
│   ├── config_loader.py     # Loads per-project config.json
│   ├── dashboard.py         # Standalone Flask dashboard (port 5050, legacy)
│   ├── run_agent.sh         # Cron-friendly wrapper script
│   ├── requirements.txt
│   ├── config.example.json  # Template for project configuration
│   ├── .env.example         # API key template
│   ├── projects.json        # Registry of all projects
│   └── projects/
│       └── <project-id>/
│           ├── config.json
│           └── data/
│               ├── leads.json
│               ├── status.json
│               └── cleanup_summary.json
├── sample_inventory.csv
├── UI_DESIGN_SPEC.md
└── venv/                    # Shared Python venv (gitignored)
```

---

## Configuration Reference

### Environment variables (`pollen-bd-agent/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SERPER_API_KEY` | Yes (for live search) | Serper.dev API key for web search |

### Ports

| Service | Port |
|---------|------|
| FastAPI backend | 8000 |
| React frontend (dev) | 5173 |
| Ollama | 11434 |

### Ollama model

Both tools use `llama3.2` by default. This can be changed independently:

- **Inventory Organizer:** `backend/agent.py` → `OLLAMA_MODEL`
- **BD Agent qualify/cleanup:** `pollen-bd-agent/agent.py` and `pollen-bd-agent/cleanup.py` → the model name in the Ollama API call

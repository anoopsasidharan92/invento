# Inventory Parser AI

An AI-powered inventory parsing tool with a chat-based UI. Upload any Excel or CSV file and the agent will automatically detect the structure, map columns to standard product fields, preview the normalised data, and save to a database.

## Features

- Drag-and-drop upload for CSV, XLSX, XLS, XLSM
- Multi-sheet Excel support (select which sheet to parse)
- AI agent (Ollama / llama3.2) analyses the file and maps columns to:
  - SKU, Description, Size, Quantity, Retail Price, Offer Price, Barcode, Shipping Details
- Interactive mapping card — edit any mapping directly in the UI or via chat
- Paginated data preview table embedded in the chat
- Normalised data saved to SQLite and downloadable as CSV
- Auto-reconnecting WebSocket chat

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.9+ | system |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Ollama | latest | `brew install ollama` |
| llama3.2 model | — | `ollama pull llama3.2` |

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

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r backend/requirements.txt

# Start the API server
cd backend
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

### 3. Frontend

```bash
cd "Inventory Parsing/frontend"
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Usage

1. Open `http://localhost:5173`
2. Drag and drop (or click to upload) any Excel or CSV inventory file
3. The agent analyses the file and proposes a column mapping
4. Review the mapping card — use the dropdowns to correct any field, or type corrections in the chat (e.g. *"use column D for the retail price"*)
5. Click **Confirm Mapping** (or type *"yes"* / *"confirm"*)
6. The normalised data appears as a preview table in the chat
7. Click **Download CSV** to save the output

---

## Project Structure

```
Inventory Parsing/
├── backend/
│   ├── main.py          # FastAPI app — REST + WebSocket
│   ├── agent.py         # LangChain + Ollama AI agent
│   ├── parser.py        # Excel/CSV parsing & column mapping
│   ├── database.py      # SQLAlchemy SQLite models
│   ├── schemas.py       # Pydantic request/response models
│   ├── requirements.txt
│   ├── uploads/         # temporary uploaded files
│   └── outputs/         # normalised output files
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── FileUpload.tsx
│   │   │   ├── MappingCard.tsx
│   │   │   └── DataPreview.tsx
│   │   └── api/client.ts
│   └── package.json
└── venv/
```

---

## Standard Fields Mapped

| Field | Description |
|-------|-------------|
| `sku` | Product / item code |
| `description` | Product name / description |
| `size` | Size, variant, or colour |
| `quantity` | Stock quantity |
| `retail_price` | RRP / list price |
| `offer_price` | Sale / trade price |
| `barcode` | EAN, UPC, or internal barcode |
| `shipping_details` | Weight, dimensions, carrier info |

---

## Changing the AI Model

Edit `backend/agent.py` and update:

```python
OLLAMA_MODEL = "llama3.2"   # change to e.g. "mistral", "llama3.1", "gemma2"
```

Then pull the model: `ollama pull mistral`

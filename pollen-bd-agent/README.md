# Pollen BD Agent 🌱

An LLM-powered business development agent that runs 24/7 on your laptop,
finding FMCG brands with excess inventory signals and drafting outreach emails.

## What it does

Every 6 hours (or however often you schedule it):
1. Searches the web for FMCG brands showing clearance, overstock, or funding signals
2. Sends each result to Claude to score fit (1–10) and draft a personalised email
3. Saves qualified leads (score ≥ 4) to a local JSON file
4. You review them in a web dashboard at http://localhost:5050

---

## Setup (one time)

### 1. Install Python dependencies

```bash
cd pollen-bd-agent
pip install -r requirements.txt
```

### 2. Get your API keys

**Anthropic API key** (for LLM qualification)
- Go to https://console.anthropic.com
- Create an API key

**Serper.dev API key** (for web search — 2,500 free searches/month)
- Go to https://serper.dev
- Sign up and copy your API key

### 3. Set up your environment file

```bash
cp .env.example .env
# Edit .env and add your keys
```

Your `.env` should look like:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxx
SERPER_API_KEY=xxxxxxxxxxxxxxxxx
```

---

## Running

### Manual run (test it first)

```bash
cd pollen-bd-agent
python agent.py
```

You should see it searching and qualifying leads in the terminal.

### Start the dashboard

```bash
python dashboard.py
```

Open http://localhost:5050 in your browser.

---

## Scheduling (runs automatically every 6 hours)

### Mac / Linux (cron)

```bash
chmod +x run_agent.sh

# Open crontab
crontab -e

# Add this line (runs at 6am, 12pm, 6pm, midnight):
0 6,12,18,0 * * * /path/to/pollen-bd-agent/run_agent.sh >> /path/to/pollen-bd-agent/data/cron.log 2>&1
```

Replace `/path/to/pollen-bd-agent` with the actual path (run `pwd` inside the folder).

### Windows (Task Scheduler)

1. Open Task Scheduler → Create Basic Task
2. Name: "Pollen BD Agent"
3. Trigger: Daily, repeat every 6 hours
4. Action: Start a program
   - Program: `python`
   - Arguments: `agent.py`
   - Start in: `C:\path\to\pollen-bd-agent`
5. Finish

---

## File structure

```
pollen-bd-agent/
├── agent.py          ← Main agent (qualification loop)
├── search.py         ← Search query definitions
├── dashboard.py      ← Flask web dashboard
├── run_agent.sh      ← Cron wrapper script (Mac/Linux)
├── requirements.txt
├── .env.example      ← Copy to .env and add keys
├── data/
│   ├── leads.json    ← All discovered leads (auto-created)
│   └── agent.log     ← Run history (auto-created)
└── templates/
    └── dashboard.html
```

---

## Customising search queries

Edit `search.py` → `SEARCH_QUERIES` to add/remove search terms.
The three signal types are:
- `clearance` — discount/clearance sale signals
- `overstock_news` — inventory write-off/glut news
- `funded_brand` — recently funded FMCG startups

---

## Costs

| Service | Free tier | Estimated monthly cost |
|---------|-----------|----------------------|
| Anthropic Claude | Pay-per-use | ~$2–5/month (100 leads/week) |
| Serper.dev | 2,500 searches/month free | $0 |

---

## Dashboard features

- **Filter by priority**: Hot / Warm / Cold
- **Filter by status**: New / Reviewed / Contacted
- **View draft email**: Click any lead → copy the pre-drafted outreach
- **Update status**: Mark as Reviewed or Contacted
- **Add notes**: Internal notes per lead
- **Agent log**: See when the agent ran and what it found

---

## Tips

- Run `python agent.py` manually first to confirm keys work
- The agent skips duplicates — same brand/URL won't be scored twice
- Leads with score < 4 are automatically filtered out
- Increase `MAX_RESULTS_PER_QUERY` in search.py to cast a wider net
- Add geography-specific queries for India, Indonesia, Malaysia in search.py

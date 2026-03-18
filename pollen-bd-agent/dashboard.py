"""
dashboard.py — Local web dashboard for reviewing Pollen BD leads
Run: python dashboard.py
Open: http://localhost:5050
"""

import os
import json
from flask import Flask, render_template, jsonify, request, send_from_directory

app = Flask(__name__, template_folder="templates")
DATA_FILE = "data/leads.json"
LOG_FILE  = "data/agent.log"


def load_leads() -> dict:
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            return json.load(f)
    return {}


def save_leads(leads: dict):
    with open(DATA_FILE, "w") as f:
        json.dump(leads, f, indent=2)


@app.route("/")
def index():
    return render_template("dashboard.html")


@app.route("/api/leads")
def api_leads():
    leads = load_leads()
    status_filter = request.args.get("status", "")
    priority_filter = request.args.get("priority", "")

    items = list(leads.values())

    if status_filter:
        items = [l for l in items if l.get("status") == status_filter]
    if priority_filter:
        items = [l for l in items if l.get("priority") == priority_filter]

    # Sort: hot first, then by found_at desc
    priority_order = {"hot": 0, "warm": 1, "cold": 2}
    items.sort(key=lambda x: (
        priority_order.get(x.get("priority", "cold"), 2),
        x.get("found_at", ""),
    ), reverse=False)
    items.sort(key=lambda x: priority_order.get(x.get("priority", "cold"), 2))

    return jsonify(items)


@app.route("/api/leads/<lid>", methods=["PATCH"])
def update_lead(lid):
    leads = load_leads()
    if lid not in leads:
        return jsonify({"error": "Not found"}), 404

    data = request.json
    allowed_fields = ["status", "notes"]
    for field in allowed_fields:
        if field in data:
            leads[lid][field] = data[field]

    save_leads(leads)
    return jsonify(leads[lid])


@app.route("/api/stats")
def api_stats():
    leads = load_leads()
    items = list(leads.values())
    return jsonify({
        "total":     len(items),
        "new":       sum(1 for l in items if l.get("status") == "new"),
        "hot":       sum(1 for l in items if l.get("priority") == "hot"),
        "contacted": sum(1 for l in items if l.get("status") == "contacted"),
        "reviewed":  sum(1 for l in items if l.get("status") == "reviewed"),
    })


@app.route("/api/log")
def api_log():
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE) as f:
            lines = f.readlines()[-50:]  # Last 50 lines
        return jsonify({"log": "".join(lines)})
    return jsonify({"log": "No log yet."})


if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    print("Pollen BD Dashboard running at http://localhost:5050")
    app.run(host="127.0.0.1", port=5050, debug=False)

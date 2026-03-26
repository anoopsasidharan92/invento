from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from langchain_ollama import OllamaLLM

# ─── Output template fields (match the user's desired Excel output) ────────────
# Split into PRIMARY (essential product identity) and SECONDARY (logistics / meta)

PRIMARY_FIELDS = [
    "sku",
    "product_name",
    "quantity_in_units",
    "barcode",
    "barcode_key",
    "unit_size",
    "color",
    "gender",
    "brand",
    "category",
    "sub_category",
    "retail_price_local",
    "asking_price_local",
    "discount",
    "image_url",
    "amazon_links",
]

SECONDARY_FIELDS = [
    "batch_code",
    "units_per_carton",
    "total_carton",
    "local_currency",
    "warehouse_location",
    "expiry_date",
    "manufacturing_date",
    "weight_per_unit",
    "net_weight_of_carton",
    "cbm_per_carton",
    "remarks",
    "other_notes",
]

ALL_FIELDS = PRIMARY_FIELDS + SECONDARY_FIELDS

OLLAMA_MODEL = "llama3.2"
LLM_TIMEOUT_SECONDS = 40
LOW_CONFIDENCE_THRESHOLD = 0.65

# ─── Heuristic aliases for fallback mapping ────────────────────────────────────

FIELD_ALIASES: Dict[str, List[str]] = {
    "sku": ["sku", "item code", "product code", "style code", "part number", "article number", "style number"],
    "product_name": ["product name", "description", "title", "item name", "item description", "product description"],
    "quantity_in_units": ["qty", "quantity", "stock", "on hand", "inventory", "units", "quantity in units", "_qty"],
    "barcode": ["barcode", "barcode number"],
    "barcode_key": ["ean", "upc", "gtin", "barcode key", "barcode type"],
    "unit_size": ["size", "unit size", "variant", "pack size", "weight", "volume", "oz", "ml", "gm", "_size"],
    "color": ["color", "colour", "shade"],
    "gender": ["gender", "sex", "men women", "mens womens", "male female", "unisex", "boys girls"],
    "brand": ["brand", "brand name", "manufacturer"],
    "category": ["category", "product category", "dept", "department", "product type"],
    "sub_category": ["sub category", "subcategory", "sub cat", "product sub type", "sub type"],
    "retail_price_local": ["retail", "rrp", "msrp", "list price", "retail price", "mrp"],
    "asking_price_local": ["asking price", "offer", "trade price", "sale price", "wholesale", "net price", "fob", "cost"],
    "discount": ["discount", "disc", "markdown", "reduction"],
    "image_url": ["image", "photo", "picture", "image url", "thumbnail", "img"],
    "amazon_links": ["amazon", "amazon link", "product url", "url", "link", "product page"],
    "batch_code": ["batch", "lot", "batch code", "batch id", "lot number", "batch no"],
    "units_per_carton": ["units per carton", "units per box", "carton qty", "case qty", "inner qty", "pcs per carton", "packing", "ctn packing", "ctn working packing", "pack size carton"],
    "total_carton": ["total carton", "total cartons", "carton count", "number of cartons", "ctns", "no of cartons", "cartons", "ctn", "qty in cartons", "quantity in cartons", "qty carton", "carton total"],
    "local_currency": ["currency", "local currency", "curr"],
    "warehouse_location": ["warehouse", "location", "warehouse location", "storage"],
    "expiry_date": ["expiry", "expiry date", "exp date", "best before", "use by"],
    "manufacturing_date": ["manufacturing date", "mfg date", "production date", "date of manufacture"],
    "weight_per_unit": ["weight per unit", "unit weight", "weight", "net weight", "wt"],
    "net_weight_of_carton": ["net weight of carton", "carton weight", "gross weight", "carton net weight"],
    "cbm_per_carton": ["cbm", "cbm per carton", "cubic meter", "volume per carton"],
    "remarks": ["remarks", "remark", "notes", "comment", "comments"],
    "other_notes": ["other notes", "other", "additional notes", "extra info", "misc"],
}

# ─── Category taxonomy ─────────────────────────────────────────────────────────

CATEGORY_TAXONOMY = {
    "FMCG - Personal Care": [
        "Skin Care", "Face Cleansing", "Body Cleansing", "Hand & Body Care",
        "Skin Care - Others", "Hair Care", "Shampoo", "Conditioner",
        "Hair Colour", "Hair Spray", "Hair Care - Others", "Styling",
        "Hair Color", "Makeup", "Face Makeup", "Eye Makeup", "Lip Makeup",
        "Makeup - Others", "Nail", "Deodorants", "Fragrances",
        "Oral Care", "Toothpaste", "Mouthwash", "Oral Care - Others", "Toothbrush",
    ],
    "FMCG - Home Care": [
        "Home and Kitchen", "Laundry", "Dishwash", "Cleaning", "Furniture",
        "Home Improvement and Tools", "Large Appliances", "Air Freshener",
        "Household Cleaning", "Wash & Care", "Fabric Cleaning",
        "Home & Hygiene", "Fabrics & Fashion", "Fabric Enhancers",
        "Toiletries", "Fabric Shampooch",
    ],
    "FMCG - Food & Beverage": [
        "Food and Bakery", "Condiments", "Snacks", "Pet Food",
        "Instant Noodles", "Ice Cream", "Fruit", "Sweets", "Sugar Base",
        "Fruits & Nuts", "Snack Mix", "Cookies and Jarred",
        "Pasta", "Frozen Foods", "Sauces", "Chocolates", "Fruits",
        "Grocery", "Gourmet", "Rice", "Ready to Cook", "Other Foods",
        "Beverages", "Soft Drinks", "Carbonated Drinks", "Water",
        "Zero - Alcohol Drinks", "Coffee and Beverages",
        "Health Drinks", "Alcohol", "Beer", "Wine", "Liquor",
        "Scotch Cooking Aids", "Dressing",
    ],
    "Fashion & Apparel": [
        "Apparel, Footwear, Accessories", "Footwear", "Accessories",
        "Clothing", "Luxury", "Jewellery",
    ],
    "Electronics": [
        "TV, Audio and Video", "Computers and Peripherals", "Appliances",
        "Mobile Phones", "Mobile Accessories",
    ],
    "Health & Supplements": [
        "Nutrition", "Health Supplement",
    ],
    "Sports, Fitness & Outdoors": [
        "Fitness and Training", "Winter Sports", "Nature and Hiking",
        "Team & Individual Sports", "Shoes",
    ],
    "Toys, Games, Crafts": [
        "Toys", "Collectible", "Action Vehicles", "Figures",
        "Toy Cars", "Prestige Toys", "Soft Toys", "Learning & Educational",
        "Board Games", "Musical", "Sports", "Toddler", "Action",
        "Miscellaneous", "Good Earth Dolls", "Card Types",
    ],
    "Home": [
        "Home Accessories", "Bedsheet", "Curtains",
    ],
    "Baby": [
        "Baby Products", "Baby Care", "Baby Food",
    ],
    "Pet": [],
    "Stationery, Books & Supplies": [
        "Office Supplies and Equipments", "Stationery", "Office Consumables",
        "Lab and Scientific",
    ],
    "Raw Materials & Commodities": [
        "Industrial", "Industrial Equipments", "Industrial Consumables",
        "Safety Equipments", "Packaging",
    ],
    "Conveyances & Machinery": [
        "Automotive Supplies", "Wheels, Bellows", "Others",
    ],
    "Other": [
        "Medicaments", "Toys, Blinds and Baby",
    ],
}

TAXONOMY_TEXT = "\n".join(
    f"- {cat}: {', '.join(subs)}" if subs else f"- {cat}: (no sub-categories)"
    for cat, subs in CATEGORY_TAXONOMY.items()
)

# ─── Prompts ───────────────────────────────────────────────────────────────────

MAPPING_PROMPT = """\
You are an expert inventory data analyst. Map spreadsheet columns to the output template fields below.

Spreadsheet columns with sample values:
{columns_with_samples}

PRIMARY FIELDS (essential product identity):
{primary_fields}

SECONDARY FIELDS (logistics, dates, shipping):
{secondary_fields}

Rules:
- Return ONLY a valid JSON object. No explanation, no markdown fences.
- Keys must be from the field list above. Only include fields you found a match for.
- Values must be the EXACT column name from the spreadsheet.
- Do not assign one column to multiple fields.
- Skip fields that have no matching column (do NOT include them with null).
- For barcode_key: determine if barcodes are EAN or UPC based on digit count in samples.
- If you see "_size" and "_qty" columns, map them to "unit_size" and "quantity_in_units" respectively (these come from an automatic unpivot of wide-format data).
- IMPORTANT: If the spreadsheet has quantity given in cartons (not individual units), map that column to "total_carton" (NOT "quantity_in_units").
  Clues: column name contains "ctn", "carton", "cartons", "cases", or the unit column says "CTN"/"carton".
  If both unit qty and carton qty exist as separate columns, map each to its correct field.
- "units_per_carton" should be the packing ratio (how many units fit in one carton/case).
"""

MAPPING_CONFIDENCE_PROMPT = """\
You are an expert inventory data analyst. Map spreadsheet columns to output fields and score confidence.

Spreadsheet columns with sample values:
{columns_with_samples}

PRIMARY FIELDS:
{primary_fields}

SECONDARY FIELDS:
{secondary_fields}

Return ONLY valid JSON in this exact shape:
{{
  "mappings": [
    {{"field": "sku", "column": "Item Code", "confidence": 0.94}},
    {{"field": "product_name", "column": "Product Name", "confidence": 0.98}}
  ]
}}

Rules:
- confidence must be a number between 0 and 1.
- Only include fields you can map to an exact spreadsheet column.
- Prefer semantic meaning over just similar words.
- If you see "_size" and "_qty", map them to "unit_size" and "quantity_in_units".
- If quantity is in cartons (column has "ctn", "carton", "cases"), map to "total_carton" NOT "quantity_in_units".
- "units_per_carton" is the packing ratio (units per carton/case).
- Do not map the same column to multiple fields.
"""

ENRICHMENT_BATCH_PROMPT = """\
You are a product taxonomy enrichment assistant.
Your PRIMARY signal is the **product_name** field. Read each product name carefully and classify accordingly.

CRITICAL: The product name is the most important signal. "FANTA GRAPE 320ML" is a beverage, \
"COKE ZERO 12×320ML" is a beverage, "Nike Air Max" is footwear, "L'Oreal Shampoo" is hair care. \
Always trust what the product actually IS over any business context.

Taxonomy:
{taxonomy}

Rows to classify:
{rows_json}

Enrichment context (business/account level — use as a secondary hint only, NEVER override obvious product names):
{context_json}

Return ONLY valid JSON in this exact shape:
{{
  "results": [
    {{"row_id": 0, "category": "FMCG - Food & Beverage", "sub_category": "Beverages", "brand": "Coca-Cola", "confidence": 0.95}},
    {{"row_id": 1, "category": "Fashion & Apparel", "sub_category": "Footwear", "brand": "Nike", "confidence": 0.91}},
    {{"row_id": 2, "category": "FMCG - Personal Care", "sub_category": "Shampoo", "brand": "L'Oreal", "confidence": 0.88}}
  ]
}}

Rules:
- Keep row_id exactly as provided.
- confidence must be 0..1.
- **brand**: Manufacturer or brand name for the product line (not the distributor). Use the **brand** field from the row if it is already correct; if it is blank or clearly wrong, infer from product_name, SKU, and remarks. Use Title Case where appropriate. Use "" only if you cannot infer a brand.
- ALWAYS classify based on what the product actually is (from product_name, brand, description).
- Do NOT let business context override clear product evidence.
  e.g. a beverage is ALWAYS "FMCG - Food & Beverage" even if the seller mainly sells cosmetics.
- If uncertain, choose best taxonomy fit and use lower confidence.
"""

CATEGORY_PROMPT = """\
You are a product classification expert. Based on the product names and descriptions below, \
assign a category and sub-category from this taxonomy:

{taxonomy}

Product samples from the inventory:
{product_samples}

Return ONLY a valid JSON object with exactly two keys:
{{"category": "Best matching category", "sub_category": "Best matching sub-category"}}

If no sub-category fits, use the most relevant one or "Other".
If no category fits at all, use "Other".
"""

FILE_ANALYSIS_PROMPT = """\
You are an inventory data analyst. A user uploaded a spreadsheet.

File details:
- File type: {file_type}
- Sheets: {sheet_names}
- Active sheet: {sheet_name}
- Columns: {headers}
- Row count: {row_count}

Write 2-3 short friendly sentences about what kind of inventory this is. \
Mention you'll now map primary product fields first, then secondary details.
"""

CORRECTION_PROMPT = """\
User wants to update the column mapping.

Current mapping:
{current_mapping}

Available columns:
{available_columns}

All valid fields:
{all_fields}

User request: "{user_message}"

Apply ONLY the requested changes. Return ONLY valid JSON with the updated mapping.
"""

WIDE_FORMAT_PROMPT = """\
You are an expert inventory data analyst. Examine these spreadsheet columns and determine if sizes \
are spread horizontally as separate columns (wide format), where each size column contains a quantity.

Spreadsheet columns:
{headers}

Sample data (first rows):
{samples}

Common wide-format patterns:
- Shoe sizes as columns: 6, 7, 8, 9, 10, 11 (with qty values in cells)
- Apparel sizes as columns: XS, S, M, L, XL, XXL
- Weight/volume sizes as columns: 100ml, 200ml, 500ml
- Size ranges mixed with other columns like "Product Name", "MRP", "Total Qty"

Respond with ONLY a valid JSON object:
If wide format is detected:
{{"is_wide": true, "size_columns": ["col1", "col2", ...], "size_type": "shoe_size|apparel_size|weight|other"}}

If NOT wide format (each row already represents one item):
{{"is_wide": false}}

Only return the JSON, nothing else.
"""

INVENTORY_FEASIBILITY_PROMPT = """\
Decide whether this spreadsheet looks like an inventory/product list that can be normalized.

Headers:
{headers}

Sample rows:
{samples}

Return ONLY valid JSON:
{{"is_inventory": true/false, "reason": "short reason"}}

Use false for documents that are clearly not inventory (notes, reports, calendars, free text, non-product tables).
"""


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _build_columns_with_samples(headers: List[str], sample_rows: List[dict]) -> str:
    lines = []
    for col in headers:
        samples = [str(row.get(col, "")).strip() for row in sample_rows if row.get(col)]
        sample_str = ", ".join(samples[:3]) if samples else "(empty)"
        lines.append(f'  "{col}": [{sample_str}]')
    return "{\n" + "\n".join(lines) + "\n}"


def _extract_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    return json.loads(text)


def _get_llm() -> OllamaLLM:
    return OllamaLLM(model=OLLAMA_MODEL, temperature=0)


async def _invoke_with_timeout(llm: OllamaLLM, prompt: str, timeout_s: int = LLM_TIMEOUT_SECONDS) -> str:
    loop = asyncio.get_event_loop()
    return await asyncio.wait_for(loop.run_in_executor(None, llm.invoke, prompt), timeout=timeout_s)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _heuristic_inventory_feasibility(sheet_info: dict) -> Tuple[bool, str, float]:
    headers = [str(h) for h in sheet_info.get("headers", [])]
    if not headers:
        return False, "No headers detected in the selected sheet.", 0.0

    nheaders = [_norm(h) for h in headers]
    inventory_tokens = [
        "sku", "item", "product", "name", "desc", "quantity", "qty", "stock", "price",
        "mrp", "offer", "cost", "barcode", "ean", "upc", "brand", "size", "variant",
    ]
    hits = 0
    for h in nheaders:
        if any(t in h for t in inventory_tokens):
            hits += 1

    score = hits / max(1, len(headers))
    has_rows = int(sheet_info.get("row_count", 0)) > 0
    if not has_rows:
        return False, "No data rows found in the selected sheet.", 0.0

    if hits >= 2 and score >= 0.12:
        return True, "Sheet appears to have product/inventory structure.", min(1.0, round(0.5 + score, 2))
    return False, "Headers do not resemble inventory/product fields.", round(score, 2)


# ─── Heuristic fallback ───────────────────────────────────────────────────────

def _heuristic_mapping(sheet_info: dict) -> Dict[str, str]:
    headers: List[str] = sheet_info["headers"]
    samples: List[dict] = sheet_info.get("sample_rows", [])
    mapping: Dict[str, str] = {}
    used = set()

    for field in ALL_FIELDS:
        aliases = FIELD_ALIASES.get(field, [])
        best_col = None
        best_score = 0
        for col in headers:
            if col in used:
                continue
            ncol = _norm(col)
            for a in aliases:
                na = _norm(a)
                if na and na in ncol:
                    score = len(na)
                    if score > best_score:
                        best_score = score
                        best_col = col
        if best_col and best_score > 0:
            mapping[field] = best_col
            used.add(best_col)

    return mapping


def _heuristic_field_confidence(field: str, col: str, sample_rows: List[dict]) -> float:
    """Estimate confidence for a mapped field/column pair."""
    aliases = FIELD_ALIASES.get(field, [])
    ncol = _norm(col)
    score = 0.45

    for alias in aliases:
        na = _norm(alias)
        if not na:
            continue
        if na == ncol:
            score = max(score, 0.95)
        elif na in ncol:
            score = max(score, 0.8)

    vals = [str(r.get(col, "")).strip() for r in sample_rows]
    non_empty_ratio = (sum(1 for v in vals if v) / len(vals)) if vals else 0
    score += min(0.12, non_empty_ratio * 0.12)

    ncol = _norm(col)
    price_tokens = ["mrp", "price", "retail", "offer", "cost", "amount", "value"]
    qty_tokens = ["qty", "quantity", "stock", "units", "pcs", "piece"]
    size_tokens = ["size", "variant", "pack", "ml", "gm", "kg", "oz", "_size"]
    name_tokens = ["name", "description", "title", "item"]

    # Field/column semantic compatibility adjustments.
    if field == "unit_size":
        if any(t in ncol for t in price_tokens + qty_tokens):
            score -= 0.30
        if any(t in ncol for t in size_tokens):
            score += 0.08
    elif field == "quantity_in_units":
        if any(t in ncol for t in qty_tokens + ["_qty"]):
            score += 0.08
        elif any(t in ncol for t in price_tokens + size_tokens):
            score -= 0.25
    elif field in ("retail_price_local", "asking_price_local"):
        if any(t in ncol for t in price_tokens):
            score += 0.08
        elif any(t in ncol for t in qty_tokens + size_tokens):
            score -= 0.25
    elif field == "product_name":
        if any(t in ncol for t in name_tokens):
            score += 0.08
        elif any(t in ncol for t in price_tokens + qty_tokens):
            score -= 0.25

    return max(0.0, min(1.0, round(score, 2)))


def estimate_mapping_confidence(
    mapping: Dict[str, str], sheet_info: dict
) -> Tuple[Dict[str, float], List[str]]:
    """Compute confidence and low-confidence fields for an existing mapping."""
    sample_rows: List[dict] = sheet_info.get("sample_rows", [])
    confidence: Dict[str, float] = {}
    low_fields: List[str] = []
    for field, col in mapping.items():
        c = _heuristic_field_confidence(field, col, sample_rows)
        confidence[field] = c
        if c < LOW_CONFIDENCE_THRESHOLD:
            low_fields.append(field)
    return confidence, low_fields


def _heuristic_category(sheet_info: dict) -> Tuple[str, str]:
    """Best-effort keyword-based category classification."""
    samples = sheet_info.get("sample_rows", [])
    text = " ".join(
        str(v).lower()
        for row in samples[:5]
        for v in row.values()
    )

    best_cat = "Other"
    best_sub = "Other"
    best_score = 0

    for cat, subs in CATEGORY_TAXONOMY.items():
        cat_words = [w for w in _norm(cat).split() if w not in _TAXONOMY_STOPWORDS and len(w) > 2]
        cat_score = sum(1 for w in cat_words if w in text)
        for sub in subs:
            sub_words = [w for w in _norm(sub).split() if w not in _TAXONOMY_STOPWORDS and len(w) > 2]
            sub_score = sum(1 for w in sub_words if w in text)
            total = cat_score + sub_score
            if total > best_score:
                best_score = total
                best_cat = cat
                best_sub = sub

    return best_cat, best_sub


_TAXONOMY_STOPWORDS = {
    "zero", "free", "light", "ice", "max", "mini", "new", "pro",
    "plus", "ultra", "super", "fresh", "pure", "natural", "original",
    "classic", "extra", "dry", "raw", "good", "others", "base",
    "and", "the", "for", "per",
}


_KNOWN_BEVERAGE_TOKENS = [
    "fanta", "coke", "coca cola", "pepsi", "sprite", "schweppes",
    "swhweppes", "redbull", "red bull", "gatorade", "7up", "mirinda",
    "mountain dew", "soda", "tonic", "lemonade", "juice", "mineral water",
    "energy drink", "cold drink", "soft drink", "beer", "wine", "whisky",
    "vodka", "rum", "gin", "liquor", "cola", "fizz", "sparkling",
    "carbonated", "water bottle",
]

_KNOWN_FOOD_TOKENS = [
    "noodle", "pasta", "rice", "cookie", "biscuit", "chocolate",
    "candy", "chips", "snack", "cereal", "sauce", "ketchup",
    "mayo", "condiment", "sugar", "honey", "jam",
]

_KNOWN_FOOTWEAR_TOKENS = [
    "shoe", "shoes", "sandal", "slipper", "sneaker", "boot", "footwear",
]

_KNOWN_APPAREL_TOKENS = [
    "shirt", "tshirt", "t-shirt", "jeans", "pant", "dress", "jacket",
    "hoodie", "sweater", "skirt",
]


def _heuristic_category_from_text(text: str) -> Tuple[str, str]:
    """Best-effort category match for a single product text."""
    norm_text = _norm(text)
    if not norm_text:
        return "Other", "Other"

    # Fast-path: known brand/product-type keywords override generic taxonomy matching.
    if any(t in norm_text for t in _KNOWN_BEVERAGE_TOKENS):
        return "FMCG - Food & Beverage", "Beverages"
    if any(t in norm_text for t in _KNOWN_FOOD_TOKENS):
        return "FMCG - Food & Beverage", "Snacks"
    if any(t in norm_text for t in _KNOWN_FOOTWEAR_TOKENS):
        return "Fashion & Apparel", "Footwear"
    if any(t in norm_text for t in _KNOWN_APPAREL_TOKENS):
        return "Fashion & Apparel", "Clothing"

    best_cat = "Other"
    best_sub = "Other"
    best_score = 0

    for cat, subs in CATEGORY_TAXONOMY.items():
        cat_tokens = [w for w in _norm(cat).split() if len(w) > 2 and w not in _TAXONOMY_STOPWORDS]
        cat_score = sum(2 for w in cat_tokens if w in norm_text)

        if not subs:
            if cat_score > best_score:
                best_score = cat_score
                best_cat = cat
                best_sub = "Other"
            continue

        for sub in subs:
            sub_tokens = [w for w in _norm(sub).split() if len(w) > 2 and w not in _TAXONOMY_STOPWORDS]
            sub_score = sum(3 for w in sub_tokens if w in norm_text)
            total = cat_score + sub_score
            if total > best_score:
                best_score = total
                best_cat = cat
                best_sub = sub

    return best_cat, best_sub


async def classify_rows(rows: List[Dict[str, str]]) -> List[Tuple[str, str]]:
    """
    Per-row category classification.
    Uses deterministic taxonomy keyword matching with dedupe by product text.
    """
    text_cache: Dict[str, Tuple[str, str]] = {}
    result: List[Tuple[str, str]] = []

    for row in rows:
        text_parts = [
            str(row.get("product_name", "")).strip(),
            str(row.get("brand", "")).strip(),
            str(row.get("remarks", "")).strip(),
            str(row.get("other_notes", "")).strip(),
            str(row.get("sku", "")).strip(),
        ]
        product_text = " | ".join([p for p in text_parts if p])
        key = _norm(product_text)

        if key not in text_cache:
            text_cache[key] = _heuristic_category_from_text(product_text)
        result.append(text_cache[key])

    return result


def _expected_categories_from_context(context: Dict[str, str]) -> List[str]:
    text = _norm(
        " ".join(
            [
                str(context.get("seller_name", "")),
                str(context.get("brand_hint", "")),
                str(context.get("domain_hint", "")),
                str(context.get("market_hint", "")),
            ]
        )
    )
    expected: List[str] = []
    if any(t in text for t in ["loreal", "cosmetic", "beauty", "skin", "hair", "makeup", "fragrance", "personal care"]):
        expected.append("FMCG - Personal Care")
    if any(t in text for t in ["food", "snack", "beverage", "drink", "grocery"]):
        expected.append("FMCG - Food & Beverage")
    if any(t in text for t in ["shoe", "footwear", "apparel", "fashion", "clothing"]):
        expected.append("Fashion & Apparel")
    return expected


def _best_sub_from_context(cat: str, row_text: str) -> str:
    t = _norm(row_text)
    if cat == "FMCG - Personal Care":
        if "shampoo" in t:
            return "Shampoo"
        if "conditioner" in t:
            return "Conditioner"
        if "toothpaste" in t:
            return "Toothpaste"
        if "deodorant" in t:
            return "Deodorants"
        if any(x in t for x in ["perfume", "fragrance", "parfum"]):
            return "Fragrances"
        if any(x in t for x in ["lip", "mascara", "foundation", "makeup"]):
            return "Makeup"
        if any(x in t for x in ["hair", "styling", "gel"]):
            return "Hair Care"
        if any(x in t for x in ["soap", "wash", "cleanser", "scrub"]):
            return "Body Cleansing"
        return "Skin Care - Others"
    if cat == "Fashion & Apparel":
        if any(x in t for x in ["shoe", "sneaker", "boot", "sandal", "slipper"]):
            return "Footwear"
        if any(x in t for x in ["bag", "watch", "belt", "wallet", "sunglasses"]):
            return "Accessories"
        return "Clothing"
    if cat == "FMCG - Food & Beverage":
        beverage_kw = [
            "drink", "juice", "coffee", "tea", "soda", "water", "cola",
            "coke", "pepsi", "fanta", "sprite", "schweppes", "tonic",
            "lemonade", "energy", "redbull", "gatorade", "beer", "wine",
            "alcohol", "liquor", "ml", "ltr", "can", "bottle",
        ]
        if any(x in t for x in beverage_kw):
            return "Beverages"
        if any(x in t for x in ["snack", "chip", "cookie", "choco", "biscuit", "cracker"]):
            return "Snacks"
        if any(x in t for x in ["sauce", "ketchup", "mayo", "dressing", "condiment"]):
            return "Condiments"
        if any(x in t for x in ["noodle", "pasta", "rice"]):
            return "Instant Noodles"
        return "Other Foods"
    return "Other"


def _apply_context_bias(
    cat: str, sub: str, conf: float, row_payload: Dict[str, str], context: Dict[str, str]
) -> Tuple[str, str, float]:
    expected = _expected_categories_from_context(context)
    if not expected:
        return cat, sub, conf
    if cat in expected:
        return cat, sub, conf

    product_name = _norm(str(row_payload.get("product_name", "")))
    # Never override if product name gives a clear signal about what the product is.
    if product_name and len(product_name) > 2:
        return cat, sub, conf

    # Only bias when there's essentially no product info at all.
    row_text = " ".join(
        [
            str(row_payload.get("product_name", "")),
            str(row_payload.get("brand", "")),
            str(row_payload.get("remarks", "")),
            str(row_payload.get("seller_name", "")),
        ]
    )
    if conf <= 0.40 and _norm(row_text).strip() == "":
        biased_cat = expected[0]
        biased_sub = _best_sub_from_context(biased_cat, row_text)
        return biased_cat, biased_sub, max(0.30, min(0.50, conf))
    return cat, sub, conf


def _validate_classification(cat: str, sub: str, conf: float, row_payload: Dict[str, str]) -> Tuple[str, str, float]:
    """Override obviously wrong LLM classifications using known product keywords."""
    product_text = _norm(
        " ".join([
            str(row_payload.get("product_name", "")),
            str(row_payload.get("brand", "")),
        ])
    )
    if not product_text:
        return cat, sub, conf

    heur_cat, heur_sub = _heuristic_category_from_text(product_text)
    if heur_cat != "Other" and heur_cat != cat:
        return heur_cat, heur_sub, max(conf, 0.85)
    return cat, sub, conf


async def classify_rows_enriched(
    rows: List[Dict[str, str]], context: Optional[Dict[str, str]] = None
) -> List[Tuple[str, str, float, str]]:
    """
    LLM-first enrichment classification for a row batch.
    Returns list of (category, sub_category, confidence, brand) in input order.
    The brand value is intended to fill missing brand cells; callers may ignore it when brand is already set.
    """
    if not rows:
        return []

    llm = _get_llm()
    context = context or {}
    payload = []
    for i, row in enumerate(rows):
        entry: Dict[str, str] = {"row_id": str(i)}
        entry["product_name"] = str(row.get("product_name", ""))
        entry["barcode"] = str(row.get("barcode", ""))
        entry["barcode_key"] = str(row.get("barcode_key", ""))
        entry["sku"] = str(row.get("sku", ""))
        entry["brand"] = str(row.get("brand", ""))
        entry["seller_name"] = str(
            row.get("seller_name")
            or row.get("sqname")
            or row.get("vendor")
            or row.get("supplier")
            or ""
        )
        entry["remarks"] = str(row.get("remarks", ""))
        entry["other_notes"] = str(row.get("other_notes", ""))
        for k, v in row.items():
            if k not in entry and str(v).strip():
                entry[k] = str(v).strip()
        payload.append(entry)

    try:
        prompt = ENRICHMENT_BATCH_PROMPT.format(
            taxonomy=TAXONOMY_TEXT,
            rows_json=json.dumps(payload, ensure_ascii=True),
            context_json=json.dumps(context, ensure_ascii=True),
        )
        raw = await _invoke_with_timeout(llm, prompt, timeout_s=35)
        parsed = _extract_json(raw)
        results = parsed.get("results", [])

        by_id: Dict[int, Tuple[str, str, float, str]] = {}
        for r in results:
            if not isinstance(r, dict):
                continue
            row_id = r.get("row_id")
            if not isinstance(row_id, int):
                continue
            cat = str(r.get("category", "Other"))
            sub = str(r.get("sub_category", "Other"))
            conf = float(r.get("confidence", 0.6))
            brand_guess = str(r.get("brand", "")).strip()
            if cat not in CATEGORY_TAXONOMY:
                cat, sub = _heuristic_category_from_text(
                    " ".join(
                        [
                            str(payload[row_id].get("product_name", "")),
                            str(payload[row_id].get("brand", "")),
                            str(payload[row_id].get("remarks", "")),
                            str(payload[row_id].get("seller_name", "")),
                        ]
                    )
                )
                conf = min(conf, 0.7)
            cat, sub, conf = _apply_context_bias(cat, sub, conf, payload[row_id], context)
            cat, sub, conf = _validate_classification(cat, sub, conf, payload[row_id])
            hint = context.get("brand_hint", "") if context else ""
            if not brand_guess and hint:
                brand_guess = str(hint).strip()
            by_id[row_id] = (cat, sub, max(0.0, min(1.0, round(conf, 2))), brand_guess)

        output: List[Tuple[str, str, float, str]] = []
        for i, row in enumerate(payload):
            if i in by_id:
                output.append(by_id[i])
            else:
                cat, sub = _heuristic_category_from_text(
                    " ".join(
                        [
                            str(row.get("product_name", "")),
                            str(row.get("brand", "")),
                            str(row.get("remarks", "")),
                            str(row.get("seller_name", "")),
                        ]
                    )
                )
                cat, sub, conf = _apply_context_bias(cat, sub, 0.55, row, context)
                cat, sub, conf = _validate_classification(cat, sub, conf, row)
                hint = context.get("brand_hint", "") if context else ""
                b = str(row.get("brand", "")).strip() or (str(hint).strip() if hint else "")
                output.append((cat, sub, conf, b))
        return output
    except Exception:
        fallback: List[Tuple[str, str, float, str]] = []
        for row in payload:
            cat, sub = _heuristic_category_from_text(
                " ".join(
                    [
                        str(row.get("product_name", "")),
                        str(row.get("brand", "")),
                        str(row.get("remarks", "")),
                        str(row.get("seller_name", "")),
                    ]
                )
            )
            cat, sub, conf = _apply_context_bias(cat, sub, 0.55, row, context)
            cat, sub, conf = _validate_classification(cat, sub, conf, row)
            hint = context.get("brand_hint", "") if context else ""
            b = str(row.get("brand", "")).strip() or (str(hint).strip() if hint else "")
            fallback.append((cat, sub, conf, b))
        return fallback


# ─── Supplementary context analysis ────────────────────────────────────────────


def summarize_supplementary_context(supplementary: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deterministically extract useful context from supplementary sections
    (pre-header text, reference tables, legends).  No LLM call needed.
    """
    if not supplementary:
        return {}

    summary: Dict[str, Any] = {
        "seller_name": "",
        "data_sources": "",
        "reference_rates": [],
        "pricing_notes": [],
    }

    _COMPANY_INDICATORS = [
        "limited", "ltd", "inc", "corp", "sdn", "bhd",
        "llc", "co.", "pte", "gmbh", "s.a.", "plc",
    ]

    for line in supplementary.get("pre_header_text", []):
        ll = line.lower()
        if not summary["seller_name"] and any(
            ind in ll for ind in _COMPANY_INDICATORS
        ):
            name = line.split("\u2014")[0].split("|")[0].split("\u2013")[0].strip()
            if name:
                summary["seller_name"] = name
        if not summary["data_sources"] and any(
            kw in ll
            for kw in ["source", "borong", "supply", "grocer", "market ref"]
        ):
            summary["data_sources"] = line.strip()

    for section in supplementary.get("sections", []):
        if section.get("type") == "reference_table" and section.get("table_data"):
            summary["reference_rates"] = section["table_data"]
            title = section.get("title", "")
            if "source" in title.lower() and not summary["data_sources"]:
                summary["data_sources"] = title
        elif section.get("type") in ("legend", "notes"):
            summary["pricing_notes"].extend(section.get("raw_text", []))

    return summary


# ─── Agent functions ───────────────────────────────────────────────────────────

async def detect_wide_format_llm(sheet_info: dict) -> Optional[Dict]:
    """
    Detect wide-format layouts where sizes are spread as columns.
    Uses LLM first, falls back to heuristic detection from parser.
    """
    from parser import detect_wide_format as heuristic_detect

    heuristic_result = heuristic_detect(sheet_info)

    llm = _get_llm()
    headers = sheet_info["headers"]
    samples = sheet_info.get("sample_rows", [])
    sample_text = ""
    for i, row in enumerate(samples[:3]):
        vals = [f'{k}: {v}' for k, v in row.items() if str(v).strip()]
        sample_text += f"  Row {i+1}: {', '.join(vals[:12])}\n"

    try:
        prompt = WIDE_FORMAT_PROMPT.format(
            headers=json.dumps(headers),
            samples=sample_text,
        )
        raw = await _invoke_with_timeout(llm, prompt, timeout_s=20)
        parsed = _extract_json(raw)

        if parsed.get("is_wide") and parsed.get("size_columns"):
            llm_cols = [c for c in parsed["size_columns"] if c in headers]
            if len(llm_cols) >= 2:
                return {
                    "is_wide": True,
                    "size_columns": llm_cols,
                    "size_type": parsed.get("size_type", "other"),
                    "source": "llm",
                }
    except Exception:
        pass

    if heuristic_result:
        heuristic_result["source"] = "heuristic"
    return heuristic_result


async def analyze_file(sheet_info: dict, file_meta: dict, sheet_name: str) -> str:
    llm = _get_llm()
    prompt = FILE_ANALYSIS_PROMPT.format(
        file_type=file_meta.get("file_type", "unknown"),
        sheet_names=", ".join(file_meta.get("sheet_names", [sheet_name])),
        sheet_name=sheet_name,
        headers=", ".join(f'"{h}"' for h in sheet_info["headers"]),
        row_count=sheet_info["row_count"],
    )
    try:
        response = await _invoke_with_timeout(llm, prompt, timeout_s=20)
        return str(response).strip()
    except Exception:
        return (
            "I've reviewed the file structure. "
            "I'll now map primary product fields (SKU, name, price, barcode) first, "
            "then secondary details (shipping, dates, warehouse)."
        )


async def assess_inventory_feasibility(sheet_info: dict) -> Tuple[bool, str, float]:
    """
    Check whether the uploaded sheet is likely a usable inventory file.
    Returns (is_inventory, reason, confidence).
    """
    llm = _get_llm()
    headers = sheet_info.get("headers", [])
    samples = sheet_info.get("sample_rows", [])[:5]
    try:
        prompt = INVENTORY_FEASIBILITY_PROMPT.format(
            headers=json.dumps(headers, ensure_ascii=True),
            samples=json.dumps(samples, ensure_ascii=True),
        )
        raw = await _invoke_with_timeout(llm, prompt, timeout_s=20)
        parsed = _extract_json(raw)
        is_inv = bool(parsed.get("is_inventory", False))
        reason = str(parsed.get("reason", "")).strip() or "No reason returned."
        # Confidence from heuristic calibration.
        _, _, heur = _heuristic_inventory_feasibility(sheet_info)
        conf = max(0.0, min(1.0, round(0.6 if is_inv else 0.4 + 0.4 * heur, 2)))
        return is_inv, reason, conf
    except Exception:
        return _heuristic_inventory_feasibility(sheet_info)


async def map_columns(sheet_info: dict) -> Dict[str, str]:
    """
    Map spreadsheet columns to output template fields.
    Returns only fields that have a match (missing fields are skipped).
    """
    llm = _get_llm()
    headers = sheet_info["headers"]

    try:
        columns_with_samples = _build_columns_with_samples(headers, sheet_info["sample_rows"])
        prompt = MAPPING_PROMPT.format(
            columns_with_samples=columns_with_samples,
            primary_fields="\n".join(f"- {f}" for f in PRIMARY_FIELDS),
            secondary_fields="\n".join(f"- {f}" for f in SECONDARY_FIELDS),
        )
        raw = await _invoke_with_timeout(llm, prompt)
        parsed = _extract_json(raw)

        mapping: Dict[str, str] = {}
        used = set()
        for field in ALL_FIELDS:
            val = parsed.get(field)
            if val and val in headers and val not in used:
                mapping[field] = val
                used.add(val)
        return mapping
    except Exception:
        return _heuristic_mapping(sheet_info)


async def map_columns_with_confidence(
    sheet_info: dict,
) -> Tuple[Dict[str, str], Dict[str, float], List[str]]:
    """
    Map spreadsheet columns and provide per-field confidence.
    Returns (mapping, confidence_by_field, low_confidence_fields).
    """
    llm = _get_llm()
    headers = sheet_info["headers"]
    sample_rows = sheet_info.get("sample_rows", [])

    try:
        columns_with_samples = _build_columns_with_samples(headers, sample_rows)
        prompt = MAPPING_CONFIDENCE_PROMPT.format(
            columns_with_samples=columns_with_samples,
            primary_fields="\n".join(f"- {f}" for f in PRIMARY_FIELDS),
            secondary_fields="\n".join(f"- {f}" for f in SECONDARY_FIELDS),
        )
        raw = await _invoke_with_timeout(llm, prompt)
        parsed = _extract_json(raw)
        entries = parsed.get("mappings", [])

        mapping: Dict[str, str] = {}
        confidence: Dict[str, float] = {}
        used = set()

        for item in entries:
            if not isinstance(item, dict):
                continue
            field = item.get("field")
            col = item.get("column")
            if not field or not col:
                continue
            if field not in ALL_FIELDS or col not in headers or col in used:
                continue
            mapping[field] = col
            used.add(col)

            raw_conf = item.get("confidence", 0.7)
            try:
                llm_conf = float(raw_conf)
            except Exception:
                llm_conf = 0.7

            heuristic_conf = _heuristic_field_confidence(field, col, sample_rows)
            # Blend model confidence with deterministic column-compatibility confidence.
            conf = 0.55 * llm_conf + 0.45 * heuristic_conf
            confidence[field] = max(0.0, min(1.0, round(conf, 2)))

        # Ensure confidence exists for every mapped field.
        for field, col in mapping.items():
            if field not in confidence:
                confidence[field] = _heuristic_field_confidence(field, col, sample_rows)

        low_fields = [f for f, c in confidence.items() if c < LOW_CONFIDENCE_THRESHOLD]
        return mapping, confidence, low_fields
    except Exception:
        fallback_mapping = _heuristic_mapping(sheet_info)
        fallback_confidence, low_fields = estimate_mapping_confidence(fallback_mapping, sheet_info)
        return fallback_mapping, fallback_confidence, low_fields


async def classify_category(sheet_info: dict) -> Tuple[str, str]:
    """Use LLM to classify products into the taxonomy. Falls back to heuristics."""
    llm = _get_llm()
    samples = sheet_info.get("sample_rows", [])
    product_lines = []
    for row in samples[:5]:
        parts = [str(v).strip() for v in row.values() if str(v).strip()]
        product_lines.append(" | ".join(parts[:4]))
    product_text = "\n".join(f"  - {l}" for l in product_lines)

    try:
        prompt = CATEGORY_PROMPT.format(
            taxonomy=TAXONOMY_TEXT,
            product_samples=product_text,
        )
        raw = await _invoke_with_timeout(llm, prompt, timeout_s=20)
        parsed = _extract_json(raw)
        cat = str(parsed.get("category", "Other"))
        sub = str(parsed.get("sub_category", "Other"))
        # Validate against taxonomy
        if cat not in CATEGORY_TAXONOMY:
            cat, sub = _heuristic_category(sheet_info)
        return cat, sub
    except Exception:
        return _heuristic_category(sheet_info)


async def apply_correction(
    current_mapping: Dict[str, str],
    available_columns: List[str],
    user_message: str,
) -> Dict[str, str]:
    llm = _get_llm()
    try:
        prompt = CORRECTION_PROMPT.format(
            current_mapping=json.dumps(current_mapping, indent=2),
            available_columns=json.dumps(available_columns),
            all_fields=json.dumps(ALL_FIELDS),
            user_message=user_message,
        )
        raw = await _invoke_with_timeout(llm, prompt, timeout_s=25)
        updated = _extract_json(raw)
    except Exception:
        return current_mapping

    result: Dict[str, str] = {}
    used = set()
    for field in ALL_FIELDS:
        val = updated.get(field, current_mapping.get(field))
        if val and val in available_columns and val not in used:
            result[field] = val
            used.add(val)
    return result


def generate_mapping_summary(mapping: Dict[str, str], row_count: int) -> str:
    primary_mapped = [f for f in PRIMARY_FIELDS if f in mapping]
    secondary_mapped = [f for f in SECONDARY_FIELDS if f in mapping]
    primary_missing = [f for f in PRIMARY_FIELDS if f not in mapping]

    parts = [
        f"Mapping confirmed. **{len(primary_mapped)}** primary and "
        f"**{len(secondary_mapped)}** secondary fields matched.",
    ]
    if primary_missing:
        parts.append(f"Skipped primary fields (not found): {', '.join(primary_missing)}.")
    parts.append(f"Applying to all **{row_count}** rows...")
    return " ".join(parts)

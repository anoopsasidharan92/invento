import { ComponentType } from "react";
import InventoryTool from "./InventoryTool";
import PollenBDTool from "./PollenBDTool";
import RealEstateTool from "./RealEstateTool";
import SalesDealTool from "./SalesDealTool";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  /** Emoji or single glyph shown on the card */
  icon: string;
  /** Tailwind bg class for the icon tile */
  color: string;
  status: "live" | "coming-soon";
  component: ComponentType;
}

const tools: ToolDefinition[] = [
  {
    id: "inventory",
    name: "Inventory Organizer",
    description: "Upload supplier sheets and normalize them into a clean, structured inventory template.",
    icon: "📦",
    color: "bg-gray-900",
    status: "live",
    component: InventoryTool,
  },
  {
    id: "pollen-bd",
    name: "BD Agent",
    description: "AI-powered lead finder for brands with excess inventory. Review, score, and draft outreach.",
    icon: "🌱",
    color: "bg-green-900",
    status: "live",
    component: PollenBDTool,
  },
  {
    id: "real-estate",
    name: "Real Estate Agent",
    description: "Chat-based property finder for rent or buy. Searches portals, ranks by your criteria, and organizes results.",
    icon: "🏠",
    color: "bg-blue-900",
    status: "live",
    component: RealEstateTool,
  },
  {
    id: "sales-deals",
    name: "Sales Deal Agent",
    description: "Find and rank the best product deals from the web — prices, promos, availability — and track them in one place.",
    icon: "🏷️",
    color: "bg-violet-900",
    status: "live",
    component: SalesDealTool,
  },
  // ── Add new tools below ────────────────────────────────────────────────────
];

export default tools;

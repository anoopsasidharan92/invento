import { ComponentType } from "react";
import InventoryTool from "./InventoryTool";
import PollenBDTool from "./PollenBDTool";

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
  // ── Add new tools below ────────────────────────────────────────────────────
];

export default tools;

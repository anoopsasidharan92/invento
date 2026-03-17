import { ComponentType } from "react";
import InventoryTool from "./InventoryTool";

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
  // ── Add new tools below ────────────────────────────────────────────────────
  // {
  //   id: "price-checker",
  //   name: "Price Checker",
  //   description: "Compare product prices across supplier sheets and flag anomalies.",
  //   icon: "💰",
  //   color: "bg-emerald-700",
  //   status: "coming-soon",
  //   component: () => null,
  // },
];

export default tools;

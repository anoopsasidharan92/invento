# Minimal Chat-Based AI Inventory Tool

## UI Design Specification (Luma-Inspired Minimalism)

---

## Overview

This document defines the UI design principles and layout structure for redesigning an existing AI-powered inventory management tool into a minimal chat-based interface inspired by the visual simplicity of Luma.

The goal is to move away from dashboard-heavy inventory software toward a conversation-first interface where users interact with an AI agent that manages inventory operations.

This document focuses only on design, UX, and interface structure. Backend functionality already exists.

---

## 1. Design Philosophy

The interface should feel calm, intelligent, and minimal.

Users should feel like they are talking to an AI assistant that handles inventory tasks rather than navigating a traditional enterprise tool.

**Core ideas:**
- Chat-first interaction
- Minimal cognitive load
- Progressive information display
- Calm visual design
- AI-driven workflows

---

### Minimal Cognitive Load

The interface should only show what the user needs at that moment.

**Avoid:**
- Dense dashboards
- Multiple sidebars
- Spreadsheet-heavy layouts
- Complex navigation

**Prefer:**
- Conversational interaction
- Contextual information
- Progressive disclosure
- AI-guided workflows

---

### Chat as the Primary Interface

The chat interface becomes the central control layer of the application.

Users interact with the system through natural language.

**Example prompts:**
```
Upload this inventory file
Clean this sheet
Show low stock SKUs
Find duplicate products
Generate reorder suggestions
Export cleaned catalog
```

The AI interprets the request and presents structured outputs and actions.

---

### Invisible Complexity

Operational complexity should remain hidden until necessary.

**Example:**

> User: Clean this inventory file
>
> AI: I analyzed the file.
>
> Issues detected:
> - Duplicate SKUs
> - Missing brand fields
> - Inconsistent size formatting
>
> Suggested actions:
> - Clean Data
> - Preview Changes
> - Download Issue Report

Advanced controls appear only after issues are detected.

---

### Calm Interface

Inspired by Luma's design philosophy, the UI should feel:

- Spacious
- Quiet
- Elegant
- Distraction-free

**Avoid:**
- Bright colors
- Heavy borders
- Aggressive shadows
- Noisy animations

---

## 2. Core Layout Structure

The interface is composed of three structural layers:

1. **Chat Interface**
2. **Context Panel** (dynamic content)
3. **Command Input Bar**

There should be no traditional dashboard homepage. The chat remains the primary workspace.

---

## 3. Primary Interface Components

### Chat Window

The chat interface occupies roughly 70–80% of the screen.

**Purpose:**
- User conversation
- AI responses
- Workflow suggestions
- System feedback
- Action prompts

**Example interaction:**

> User: Upload this inventory sheet
>
> AI: I analyzed the file.
>
> Issues detected:
> - Duplicate SKUs
> - Missing brand fields
> - Inconsistent size formatting
>
> Suggested actions:
> - Clean Data
> - Preview Changes
> - Download Report

Messages should appear as clean structured blocks rather than heavy chat bubbles.

---

### Context Panel

A dynamic panel appears when additional information is needed.

It slides in from the right side.

**Use cases:**
- File upload → Table preview
- Data cleaning → Before vs After comparison
- SKU search → Product details
- Reorder analysis → Demand insights
- Duplicate detection → SKU conflict table

The panel should remain temporary and dismissible.

---

### Command Input Bar

The command input bar is anchored at the bottom of the screen.

**Example structure:**
```
[Upload]  Ask AI anything about your inventory...
```

**Features:**
- Natural language input
- Drag-and-drop upload
- Slash commands
- Suggested prompts

**Example commands:**
```
/upload   /clean   /duplicates   /low-stock   /reorder   /export
```

---

## 4. UI Elements

### Buttons

Buttons should follow a minimal soft style.

**Characteristics:**
- Rounded edges
- Soft background
- Subtle hover state
- Low contrast

**Examples:**
```
Clean Data    Generate Reorder Plan    Export Clean File
```

---

### Tables

Tables should only appear inside the context panel.

**Design rules:**
- Lightweight layout
- Minimal borders
- Generous row spacing
- Simplified headers

Avoid spreadsheet-style dense grids.

---

### File Upload Interaction

When a file is uploaded:
```
Inventory_Jan.xlsx
Processing...
```

After analysis:
```
File analyzed.
4 issues detected.
```

The AI then suggests actions.

---

### Inline AI Suggestions

**Example:**
```
You have 37 SKUs with low stock.

Suggested actions:
- Generate Purchase Order
- View SKUs
- Export Report
```

These appear as lightweight action buttons.

---

## 5. Visual Style Guide

### Color Palette

**Primary:**
| Role       | Value     |
|------------|-----------|
| Text       | `#111111` |
| Background | `#F7F7F7` |
| Cards      | `#FFFFFF` |
| Borders    | `#EAEAEA` |

**Accent:**
| Role        | Value     |
|-------------|-----------|
| Muted gray  | `#6B7280` |

Avoid bright colors except for alerts.

---

### Typography

**Recommended fonts:**
- Inter
- SF Pro
- Satoshi

**Typography scale:**

| Element     | Size  |
|-------------|-------|
| Title       | 20px  |
| Chat text   | 15px  |
| Meta text   | 13px  |
| Button text | 14px  |

---

### Spacing System

Use a consistent spacing scale:

```
8px
16px
24px
32px
48px
```

Whitespace is important for calm visual rhythm.

---

## 6. Interaction Patterns

### AI Workflow

**Typical flow:**
```
User request → AI interpretation → System analysis → Suggested actions → User confirmation → Execution → Result preview
```

**Example:**
> User: Clean this sheet
>
> AI: Detected issues.
>
> [Preview Changes]  [Auto Fix]
>
> User selects an action and the system executes.

---

### Progressive Reveal

Information should appear step by step.

**Example:**
```
Step 1: File analyzed
Step 2: Issues found
Step 3: Suggested fixes
Step 4: Apply fixes
```

---

### Smart Defaults

The AI should suggest the most likely action.

**Example:**
```
Recommended: Clean and standardize all SKUs
[Apply Fix]
```

This reduces decision friction.

---

## 7. AI Tone and Personality

The AI should feel:

- **Concise**
- **Confident**
- **Helpful**

**Example:**

> ✓ Good: "I found duplicate SKUs in your file. Would you like me to remove them?"

Avoid overly verbose or uncertain language.

---

## 8. Micro Interactions

Subtle interactions improve quality.

**Examples:**
- Message fade-in
- Typing indicator
- Panel slide-in
- File processing animation

**Recommended animation duration:** 120–200ms

---

## 9. Empty State Design

**First-time screen example:**
```
Welcome.

You can ask me to:
- Clean inventory sheets
- Detect duplicate SKUs
- Find low stock products
- Generate reorder plans

Upload a file to begin.

[Upload Inventory]
```

---

## 10. Example User Journey

**Step 1 — Upload File**
```
Inventory_March.xlsx
```

**Step 2 — AI Analysis**
```
File analyzed.

Issues found:
- 32 duplicate SKUs
- 18 missing brands
- Inconsistent pack sizes
```

**Step 3 — Suggested Actions**
```
[Clean Automatically]  [Review Issues]
```

**Step 4 — User Confirmation**

AI processes the request.

**Step 5 — Result**
```
Changes applied successfully.
Download the cleaned inventory file.
```

---

## Key UX Goal

The experience should feel like:

> **ChatGPT + Luma + Notion simplicity.**

Users should feel:

> *"I just talk to the AI and my inventory gets fixed."*

---
name: html-plan
description: |
  Generate a polished, self-contained HTML document from the current plan.
  Use when the user wants the plan saved as styled HTML, mentions "html plan",
  "plan as html", or "export plan". Works in plan mode. Saves under
  julsemaan-tmp/html-plans/.
---

# html-plan

Generate a visually polished, self-contained HTML version of the current plan. Make it look like something a designer would create, not a markdown dump.

## When to use

- User asks to save/export the current plan as HTML
- User mentions "html plan", "plan as html", or "export plan"

## Output rules

- **Always** use `write_tmp_document` — never `write`
- Path: `html-plans/YYYY-MM-DD-HHMM-<slug>.html` (slug from plan title, fallback `plan`)
- All CSS inline — no external stylesheets, JS, fonts, or images
- Escape all plan text before inserting into HTML

## Design direction

Be creative. Think visual hierarchy, thoughtful spacing, subtle color accents, maybe a gradient header or card-based layout. The goal is an HTML document that feels crafted, not converted.

Some ideas (use what fits, invent your own):
- Hero header with gradient background
- Card grid for task phases or decision blocks
- Color-coded status badges or progress indicators
- Subtle shadows and rounded corners for depth
- Pull quotes or callout boxes for key decisions
- A clean table of contents with smooth scroll

## Structure

Standard document: `<!doctype html>`, `<html lang="en">`, `<head>` with meta tags and inline `<style>`, `<body>` with `<main>`.

Include sections for: overview, architecture decisions, task plan, validation steps, risks, files to change, open questions, and a generated timestamp footer.

## Readability

- System font stack
- Comfortable line height (~1.6)
- Content width that breathes (not cramped)
- Responsive — works on mobile and desktop
- Print-friendly with `@media print` rules
- Semantic HTML: proper headings, `<nav>` for TOC, `<table>` with scope where appropriate

## Process

1. Extract plan from session context
2. Pick a title/slug, generate timestamp
3. Design the layout — make choices, don't just render markdown
4. Write with `write_tmp_document`
5. Confirm path to user

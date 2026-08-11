---
name: clean-code
description: Applies Clean Code rules to every implementation task: readable names, small units, explicit intent, simple control flow, and no avoidable duplication.
---

# Clean Code

Use this skill on every code-writing task.

## Rules

- Use intention-revealing names for files, symbols, variables, tests, and modules.
- Keep functions, components, services, and modules small enough to understand without scrolling through unrelated concerns.
- Prefer simple control flow over clever abstractions.
- Remove duplication. If the shared abstraction does not have a stable meaning yet, do not invent a bad one — but do not leave the repetition silent either: **name it and report it** with the files and lines, so the decision is made on purpose instead of by omission.
- Make invalid states hard to represent when the language or framework allows it.
- Keep comments for non-obvious decisions; do not narrate obvious code.
- Do not mix UI, domain rules, data access, and framework plumbing without an explicit architectural reason.
- Prefer boring, predictable code over surprising cleverness.

## Review Checklist

- Can a teammate understand the intent from names and structure?
- Is each unit doing one clear thing?
- Are errors and edge cases visible?
- Can this code be tested without excessive setup?

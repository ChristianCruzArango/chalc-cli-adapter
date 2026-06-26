---
name: modular-architecture
description: Guides every project toward modular architecture with explicit boundaries, cohesive features, limited shared code, and dependency rules.
---

# Modular Architecture

Use this skill when creating or changing project structure.

## Rules

- Organize code around features, domains, or capabilities, not only technical file types.
- Keep module boundaries explicit: public API in one place, internals private by convention.
- Shared code must be genuinely reusable and stable; do not create a dumping ground.
- Dependencies point inward or sideways according to the selected architecture; avoid cycles.
- Infrastructure and framework adapters must not leak into domain rules.
- Tests live near the behavior they protect unless the project has a stronger convention.

## Boundary Checklist

- What owns this behavior?
- Who is allowed to import it?
- What can change without touching unrelated modules?
- Is this shared because it is stable, or merely because two files currently look similar?

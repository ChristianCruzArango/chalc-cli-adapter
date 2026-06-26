---
name: solid-principles
description: Applies SOLID principles to every project so code remains cohesive, loosely coupled, replaceable, and testable.
---

# SOLID Principles

Use this skill on every design and implementation task.

## Non-Negotiables

- **S**ingle Responsibility: each component, class, service, function, and module has one reason to change.
- **O**pen/Closed: extend behavior through composition, configuration, or new collaborators before editing stable code.
- **L**iskov Substitution: abstractions must not surprise callers with stricter preconditions or weaker guarantees.
- **I**nterface Segregation: keep contracts focused; do not force consumers to depend on methods or data they do not use.
- **D**ependency Inversion: domain/application logic depends on abstractions, not framework or infrastructure details, when boundaries matter.

## Practical Guidance

- Do not introduce interfaces mechanically. Add them when they protect a boundary, enable testing, or represent a real contract.
- Keep framework-specific details near the framework edge.
- Prefer constructor injection or explicit parameters over service locators and hidden globals.
- If a design intentionally bends SOLID, document why.

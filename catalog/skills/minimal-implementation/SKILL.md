---
name: minimal-implementation
description: Keeps implementation tasks small and direct by reusing existing code, avoiding speculative abstractions, and writing only the code required by the approved requirement or failing test.
---

# Minimal Implementation

Use this skill on every code-writing task before creating files, abstractions, helpers, DTOs, services, or configuration.

## Scope

This operates WITHIN the project's rules, and those rules come from two places:

1. **`specs/constitution.md`** — always present in an SDD project, and the higher authority. Its
   Article 4 (**one thing per file**) is not optional: interfaces, DTOs, types and enums live in
   **their own file** and are imported. Never declared inside a service, component or controller.
2. **`docs/architecture.md`** — present only when the project declared an architecture. It adds
   layers and dependency rules on top.

**That rule holds even if there is no `docs/architecture.md`.** Most repos equipped with `chalc
spec-ia` have no architecture document, and its absence is not permission to inline a type: the
constitution still applies, and the quality gate reports every type declared inside a service or
component as a finding.

Minimalism means not adding structure BEYOND what the rules and the current requirement call for —
never flattening them or skipping the files they mandate. When this skill and `modular-architecture`
seem to disagree, the architecture decision wins; minimalism applies to what you add inside it.

## Non-Negotiables

- Implement the smallest change that satisfies the current approved requirement or failing test.
- Reuse existing framework APIs, project helpers, components, services, and patterns before adding new code.
- Do not create wrappers, base classes, factories, interfaces, mappers, DTOs, utilities, modules, or configuration unless they remove current duplication, protect a real boundary, or are required by the framework — **or the constitution mandates the file**. Deciding a type is unnecessary and declaring it inline are different things: if the type exists in your code, it needs its **own file**. Article 4 is not an abstraction you are adding; it is where an existing one belongs.
- Prefer changing an existing cohesive unit over creating a new file when the behavior clearly belongs there.
- Keep generated examples, placeholder data, demo states, and comments out of production code unless the requirement asks for them.
- Do not add dependencies, build tooling, state libraries, folders, or architecture layers without explicit need.

## Before Coding

- Name the exact requirement, bug, or failing test being addressed.
- Identify the smallest existing location that can own the change.
- Check whether the project already has a helper, component, service, pipe, hook, extension, or test utility for the job.
- If you think a new abstraction is needed, state the current duplication or boundary it solves.

## Review Checklist

- Did this change add the fewest files and symbols that keep the code clear?
- Is every new abstraction used now, not reserved for a possible future?
- Could a standard library or framework feature replace custom code?
- Are tests focused on observable behavior instead of mirroring implementation details?

---
name: minimal-implementation
description: Keeps implementation tasks small and direct by reusing existing code, avoiding speculative abstractions, and writing only the code required by the approved requirement or failing test.
---

# Minimal Implementation

Use this skill on every code-writing task before creating files, abstractions, helpers, DTOs, services, or configuration.

## Scope

This operates WITHIN the project's chosen architecture (see `docs/architecture.md`): respect its layers and its "one thing per file" rule. Minimalism means not adding structure BEYOND what the architecture and the current requirement call for — never flattening the architecture or skipping the files it mandates (e.g. interfaces, DTOs, and types in their own file when the architecture requires it). When this skill and `modular-architecture` seem to disagree, the architecture decision wins; minimalism applies to what you add inside it.

## Non-Negotiables

- Implement the smallest change that satisfies the current approved requirement or failing test.
- Reuse existing framework APIs, project helpers, components, services, and patterns before adding new code.
- Do not create wrappers, base classes, factories, interfaces, mappers, DTOs, utilities, modules, or configuration unless they remove current duplication, protect a real boundary, or are required by the framework.
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

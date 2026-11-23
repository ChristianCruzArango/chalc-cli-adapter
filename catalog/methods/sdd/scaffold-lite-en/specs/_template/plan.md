# Plan: <feature>

> **Plan** phase — the HOW. Derives from `spec.md`. Ask for approval before generating tasks.
> Still **no** code is written.

## Technical approach
<overall strategy to meet the requirements>

## Architecture / Components
- `path/to/file` — <responsibility>  _(one thing per file)_

## Data model
| Entity | Fields | Notes |
|---|---|---|
| ... | ... | ... |

## Contracts / Interfaces
- <endpoint, service signature, input/output type>  _(each interface/DTO in its own file)_

## Decisions
- <decision> — <why> (covers R?)

## Risks / Questions
- ...

## Scope (what this spec may touch)
Paths or globs the implementation may modify: anything outside blocks the delivery, and two specs whose
scope overlaps are not worked on at the same time. `Depends on:` names the specs that must be integrated first.

Surface: <ui | api | cli | none>

Touches:
- <path/or/glob/**>

Depends on: <none>

## Traceability
Every requirement in the spec is covered by at least one component:
- R1 → ...
- R2 → ...

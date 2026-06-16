# Project constitution

**Non-negotiable** principles. Every spec, plan, task and piece of code must respect them.
They only change via an explicit amendment recorded here.

## Article 1 — The spec is the source of truth
System behavior is defined in the spec, not in the code. On conflict, the spec wins.
If scope changes, the spec is updated **before** the code.

## Article 2 — Test-First (strict TDD)
No implementation code is written before:
1. Writing the tests derived from the acceptance criteria.
2. The user approving them.
3. Confirming they **fail** (Red phase).
Only then is the minimum code written to pass them (Green) and refactored.

## Article 3 — Full traceability
Every requirement has an id (`R1`, `R2`…). Every test and every task references the requirement it fulfills.
No "orphan" code without a requirement that justifies it.

## Article 4 — One thing per file
Interfaces, DTOs, types and enums live in their **own file** and are imported.
Never declared inside services, components or controllers.

## Article 5 — Simplicity first
Solve the requirement with the simplest solution that works. No abstractions
or "just in case" layers that no requirement asks for.

## Article 6 — Testable requirements (EARS)
Acceptance criteria are written in EARS notation so they are verifiable:
`WHEN <condition> THE SYSTEM SHALL <behavior>`. If it can't become a test, it isn't a requirement.

## Article 7 — Test quality (mutation testing)
Tests must not only **pass**: they must **catch real bugs**. After Green/refactor, run **mutation testing**
(Stryker for JS/TS and .NET; mutmut/cosmic-ray for Python): the tool introduces mutations in the code
and the tests MUST "kill" them. If a mutant survives, the test is weak → strengthen it until killed.
Target: **mutation score ≥ 80%** on critical logic. No feature is closed with surviving mutants there.

---
_Amendments:_
- (none)

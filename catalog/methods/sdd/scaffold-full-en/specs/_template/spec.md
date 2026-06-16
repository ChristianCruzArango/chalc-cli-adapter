# Spec: <feature name>

> **Specify** phase — the WHAT and the WHY. No implementation details.
> Mark anything uncertain with `[NEEDS CLARIFICATION: ...]` and resolve it before planning.

## Context / Problem
<what problem we solve and why it matters>

## Goal
<expected outcome, in one sentence>

## User stories
- As a <role> I want <action> so that <benefit>.

## Requirements (acceptance criteria, EARS notation)
Each requirement has an id and must be convertible into a test.

- **R1** — WHEN <condition/event> THE SYSTEM SHALL <expected behavior>.
- **R2** — IF <unwanted condition> THEN THE SYSTEM SHALL <response>.
- **R3** — WHILE <state> THE SYSTEM SHALL <behavior>.
- **R4** — WHERE <feature present> THE SYSTEM SHALL <behavior>.

_Example:_ **R1** — WHEN a user submits the form with invalid data THE SYSTEM SHALL show the validation error next to the relevant field.

## Out of scope
- <what is NOT part of this feature>

## Open questions
- [NEEDS CLARIFICATION: ...]

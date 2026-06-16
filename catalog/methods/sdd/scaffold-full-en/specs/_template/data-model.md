# Data model: <feature>

> **Full mode** only. Detail entities, fields, types and relations. Derives from the spec and the plan.
> Each interface/DTO/type then goes in **its own file** (one thing per file).

## Entities

### <Entity>
| Field | Type | Required | Notes |
|---|---|---|---|
| id | string (uuid) | yes | PK |
| ... | ... | ... | ... |

## Relations
- <Entity A> 1—N <Entity B> — <rule>

## Validation rules
- <field> — <rule>  (covers R?)

## States / Transitions (if any)
- <state A> → <state B> when <event>

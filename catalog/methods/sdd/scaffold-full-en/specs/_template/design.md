# Design: <feature>

> Only if the plan declares `Surface: ui`. The composition of each screen is decided HERE and approved with the
> spec, before coding. The numbers (gaps, sizes, contrast) are not repeated: they come from the contract,
> `.chalc/design.contract.json`. If this spec needs others, they go in `design.contract.json` in this folder.

## Screen: <name> (covers R?)
- **Purpose:** <what the user comes here to do, in one sentence>
- **Primary:** <the single main action of the view>
- **Secondary:** <the other actions, in order of importance>
- **Composition:** <which blocks there are and in what order, top to bottom; what goes together and what apart>
- **States:** empty · loading · with data · error · no permission — <what is shown in each>
- **On a narrow screen:** <what stacks, what hides, what happens to tables>

## Existing components that are reused
- `<path/to/component>` — <what for>

## Open questions
- [NEEDS CLARIFICATION: ...]

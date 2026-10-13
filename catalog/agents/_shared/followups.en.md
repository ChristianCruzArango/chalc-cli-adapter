## Your findings from the previous pass

If you already reviewed this task and left `FINDINGS`, the advisor hands you those findings with their
number. Before looking for anything new, **check each one** and leave one line for each in your entry,
under the heading:

- `- Finding <n>: fixed — <file:line>` (where you see the fix),
- `- Finding <n>: not fixed — <file:line>` (where it still is; it also goes in your numbered list),
- `- Finding <n>: n/a — <reason>` (at least three words saying why: the code was removed, the spec changed…).

`<n>` is the number the finding had in your previous entry. If you received a finding and do not leave
its line, the task does not close: a finding you do not look at again is not fixed, it is forgotten.
And an `OK` with a `not fixed` finding contradicts itself: if it is still open, the verdict is
`FINDINGS`.

**Form your judgement before reading the author.** Read the diff, the spec and the gate evidence, and
decide what you see. Only then read the commit messages, the comments or the explanations of whoever
made the change: reading them first makes you review what you were told, not what is there.

# Automatic check when a turn ends (optional)

Claude Code can run the gate as soon as a turn ends and tell you if something broke, without you
having to remember.

**chalc does not install it.** A hook runs on its own, and `.claude/settings.json` is committed:
enabling it from here would impose it on everyone who clones this repo, who asked for nothing. So the
block stays here and you paste it yourself if you want it.

## How to enable it

Paste this block into one of these two files:

- `.claude/settings.local.json` — just for you, not committed. **Start here.**
- `.claude/settings.json` — for the whole team. Agree it with them first: it will run a command on
  every turn of theirs.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node .chalc/gate.mjs --fast" }
        ]
      }
    ]
  }
}
```

If you already have hooks in that file, add the entry inside the existing `Stop` array instead of
replacing the whole block.

## Why `--fast`

`--fast` runs the quick stages — tests, one-thing-per-file, boundaries, traceability and contract —
and **skips mutation**, which takes minutes. A hook that launched it on every turn would make the
session unusable, and you would end up removing the hook or, worse, closing tasks without it.

That is why a `--fast` run **does not close a task**: it is there to tell you early that something
broke, not to sign the task off. Closing is the full gate:

```
node .chalc/gate.mjs
```

## If you don't enable it

Nothing breaks: the hand-off's task-closing cycle already asks for it, and the reviewer agent refuses
to review when `.chalc/gate.md` is missing or older than the last change. The hook only makes the
warning arrive sooner.

# Gate hooks (optional)

Two hooks, and the second one matters more than it looks:

1. **Record what you write** — so the gate reviews **your task** and not the whole tree.
2. **Check when a turn ends** — run the gate as soon as a turn is over, without you remembering.

**chalc does not install them.** A hook runs on its own, and `.claude/settings.json` is committed:
enabling it from here would impose it on everyone who clones this repo, who asked for nothing. So the
blocks stay here and you paste them yourself.

## Where they go

Into one of these two files:

- `.claude/settings.local.json` — just for you, not committed. **Start here.**
- `.claude/settings.json` — for the whole team. Agree it with them first: it will run a command on
  every turn of theirs.

If you already have hooks there, add the entries inside the arrays that already exist instead of
replacing the whole block.

## 1. Record what you write (recommended)

The gate reviews **the files the task changed**, not the project. The most reliable way to know which
ones those are is for whoever writes them to say so: this hook records every file Claude Code writes
into `.chalc/task.files`, and the gate clears it on its own when each task closes.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "node .chalc/gate/record.mjs" }
        ]
      }
    ]
  }
}
```

**The gate still works without this hook**, but it falls back to measuring the diff since the last
closed task. That fallback reviews more than it should, and in a flow where you commit at the end of
the feature — not task by task — it reviews quite a lot more: the baseline is a commit, so with no
commits in between the diff cannot tell one task from the previous one.

The recorder does one thing: it takes the path and writes it down. It decides nothing, it does not
read your code, it writes nothing outside `.chalc/`, and if it fails it exits 0 — a hook that breaks
the turn is worse than no hook.

## 2. Automatic check when a turn ends

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

## Why `--fast`

`--fast` runs the quick stages — tests, one-thing-per-file, boundaries, traceability and contract —
and **skips mutation**, which takes minutes. A hook that launched it on every turn would make the
session unusable, and you would end up removing the hook or, worse, closing tasks without it.

That is why a `--fast` run **does not close a task**: it is there to tell you early that something
broke, not to sign the task off. Closing is the full gate:

```
node .chalc/gate.mjs
```

## If you don't enable them

The check one is not needed: the hand-off's task-closing cycle already asks for the gate, and the
reviewer agent refuses to review when `.chalc/gate.md` is missing or older than the last change. That
hook only makes the warning arrive sooner.

The recording one is not mandatory either, but it is the one that changes what you see in the report:
with it, the scope is exactly your files; without it, everything that changed since the last closed
task. The evidence always says which of the two it used, in the "Task scope" section, so there is no
way to get confused.

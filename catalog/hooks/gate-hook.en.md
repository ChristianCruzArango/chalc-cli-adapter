# Gate hooks (optional)

Three hooks, and the second one matters more than it looks:

1. **Record what you write** — so the gate reviews **your task** and not the whole tree.
2. **Check when a turn ends** — run the gate as soon as a turn is over, without you remembering.
3. **Guards** — the assistant asks before committing or pushing, and cannot read credentials or
   delete outside the project.

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

The record **informs, it does not narrow**: with git, the gate always reviews the full diff since the
last closed task, and the record only flags which changes were not written down. This hook listens to
`Write|Edit|MultiEdit|NotebookEdit`; what Bash writes (`sed -i`, `cat >`, generators) is not recorded,
but it is still reviewed through the diff.

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

## 3. Guards: what the assistant does not do without you

Rules like "do not commit without my go-ahead" or "do not read the `.env`" live as text in
`CLAUDE.md`, and an assistant that forgets them finds nothing in its way. This hook turns them into a
barrier: before each action, the guard looks at it and decides.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Grep|Glob|NotebookRead",
        "hooks": [
          { "type": "command", "command": "node .chalc/gate/guard.mjs" }
        ]
      }
    ]
  }
}
```

| Action | What happens |
| --- | --- |
| `git commit`, `git push` | **It asks you.** The go-ahead is yours, at the exact moment. |
| `git push --force`, `-f`, `--force-with-lease`, `+branch` | **Blocked.** It rewrites history others already have. |
| Reading `.env`, SSH keys, `.npmrc`, `.pypirc`, `.netrc`, `*.pem`… (`Read`, `Grep`, or any command naming them) | **Blocked.** Their contents would enter the model's context. Value-less templates (`.env.example`, `.env.sample`, `.env.template`) can be read. |
| `rm`, `rmdir` or `find … -delete` outside the project, on the whole project, or on a target that cannot be resolved (`$VAR`, `$(…)`, `~`, `{a,b}`) | **Blocked.** Inside the project, deleting works as usual. |

The reason for each question or block comes in the repo's language (`.chalc/gate.json`) and names the
command or file that caused it. If a blocked action is the one you wanted, run it yourself.

When the action passes, the guard **answers nothing**: answering `allow` would approve the action
bypassing the permissions you already have configured. And if the event cannot be read or something
fails, it exits silently: a hook that breaks the turn is worse than no hook.

**Limit, plainly:** it raises the bar, it is not unbreakable. It reads commands without running
them —it does not expand variables or aliases, nor resolve symbolic links— and a deliberately
obfuscated command can get past it. It is a net for the assistant's slips, not a security boundary.

## If you don't enable them

The check one is not needed: the hand-off's task-closing cycle already asks for the gate, and the
reviewer agent refuses to review when `.chalc/gate.md` is missing or older than the last change. That
hook only makes the warning arrive sooner.

Without the guards, the rules in `CLAUDE.md` are still instructions: the assistant reads them, but
nothing stops it from skipping them. Enabling them changes nothing else.

The recording one is not mandatory either, but it is the one that changes what you see in the report:
with it, the scope is exactly your files; without it, everything that changed since the last closed
task. The evidence always says which of the two it used, in the "Task scope" section, so there is no
way to get confused.

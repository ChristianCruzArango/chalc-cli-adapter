# Gate hooks (optional)

Four hooks, and the second one matters more than it looks:

1. **Record what you write** — so the gate reviews **your task** and not the whole tree.
2. **Check when a turn ends** — run the gate as soon as a turn is over, without you remembering.
3. **Guards** — the assistant asks before committing or pushing, and cannot read credentials or
   delete outside the project.
4. **Activity** — the live board (`node .chalc/live.mjs`) shows what each agent is doing.

**chalc does not install them.** A hook runs on its own, and `.claude/settings.json` is committed:
enabling it from here would impose it on everyone who clones this repo, who asked for nothing. So the
blocks stay here and you paste them yourself. The only exception is the guard, and only if you ask for it
(`chalc --guard`, section 3): it goes to your local file, never to the shared one.

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

## When a gate command changes

The gate runs `test.command`, `build.command` and `mutation.command` from `.chalc/gate.json` through the
shell, and this hook runs it on every turn. If any of them changed since the last closed task —a PR, someone
else's branch—, the gate **blocks without running anything** until you review it and accept it:

```
node .chalc/gate.mjs --seal
```

`--seal` only re-seals the watched config in `.chalc/task.json`; it does not run the gate nor move the task.

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
| The same inside a shell: `bash -c "git push"`, `sh -c`, `zsh -c`, `dash -c` (up to three levels) | **Same as typed directly.** The guard reads the command in the string. |
| Reading `.env`, `.envrc`, SSH keys, `.npmrc`, `.pypirc`, `.netrc`, `*.pem`, `*.tfvars`, `kubeconfig`, `.docker/config.json`… when they are NAMED: `Read`, the path or `glob` of `Grep`/`Glob`, or a word of a shell command | **Blocked.** Their contents would enter the model's context. Value-less templates (`.env.example`, `.env.sample`, `.env.template`) can be read. |
| `Grep` with `output_mode: content` over a folder (no path, `.`, `src/`…) not narrowed by `glob` or `type` | **Asks you.** It could dump lines of a `.env` it does not name. |
| `rm`, `rmdir` or `find … -delete` outside the project, on the whole project, or on a target that cannot be resolved (`$VAR`, `$(…)`, `~`, `{a,b}`) | **Blocked.** Inside the project, deleting works as usual. |

The reason for each question or block comes in the repo's language (`.chalc/gate.json`) and names the
command or file that caused it. If a blocked action is the one you wanted, run it yourself.

When the action passes, the guard **answers nothing**: answering `allow` would approve the action
bypassing the permissions you already have configured. And if the event cannot be read or something
fails, it exits silently: a hook that breaks the turn is worse than no hook.

**Limit, plainly:** it raises the bar, it is not unbreakable. It reads commands without running
them —it does not expand variables or aliases, nor resolve symbolic links— and a deliberately
obfuscated command can get past it. It is a net for the assistant's slips, not a security boundary.

What it does **not** cover: a command that reads a secret without naming it (`grep -r PASSWORD .`,
`cat $(ls -a)`), a `Grep` that only lists files or counts matches, and any credentials file whose name is
not in the list above. Nor what reaches git another way: `eval "git push"`, `xargs git push` or a script
in a file (`bash deploy.sh`). And the delete rule does not look inside `bash -c`.

### Enable it with `--guard`

Instead of pasting the block, `chalc --guard` puts it in `.claude/settings.local.json` —yours only, never
`.claude/settings.json`—. `chalc init` asks you (with **yes** by default); without a terminal, only with
`--guard`. Next to the hook it writes two `ask` permissions:

```json
{
  "permissions": {
    "ask": ["Bash(git commit *)", "Bash(git push *)"]
  }
}
```

They are two layers outside the model: Claude Code applies `ask` permissions even if a hook says `allow`,
also inside a chain (`npm test && git push`); the hook sees what a prefix permission does not
(`git -C . push`, `/usr/bin/git push`, `bash -c "git push"`). When you tell it to commit or push, you accept
the prompt and it happens; if you did not tell it to, you reject it.

- Whatever you already have in the file is kept; running it again duplicates nothing. If it is not valid
  JSON, chalc leaves it untouched and warns you.
- It adds `.claude/settings.local.json` to the `.gitignore`.
- `chalc --no-guard` removes only what chalc added; if nothing else is left, the file goes away.
- `--dry-run` lists it without writing. Claude Code only: with another assistant it warns and writes nothing.

## 4. Activity for the live board

`node .chalc/live.mjs` starts a local page with the project's state. With this hook it also shows, live,
what each one is doing: the main agent and each role (`seguridad`, `revisor`, `endurecedor`) —which tool,
on which file or with which command, and when each role starts and finishes—.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }
    ],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }]
  }
}
```

What is recorded in `.chalc/activity.jsonl` is **who, what and where**, never the contents: not what is
written to a file, not what a tool answers, not a role's prompt. Anything that could be a secret is
redacted, and the file keeps only the last 500 actions. If something fails, the hook exits silently. If you
already have a `PreToolUse` (the guard), add this entry to the same array.

With the same hook the board counts the **tokens and time of each task**: on each event it reads only what
is new in the session transcript (and, when a role finishes, its own), counts each message once and charges
it to the task in progress, in `.chalc/usage.json`. Numbers only, never text from the transcript.

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

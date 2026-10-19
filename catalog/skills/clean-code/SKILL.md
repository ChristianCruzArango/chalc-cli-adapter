---
name: clean-code
description: Applies Clean Code rules to every implementation task: names derived from the repo's own conventions and the domain vocabulary, small units, explicit intent, simple control flow, visible errors, and no avoidable duplication.
---

# Clean Code

Use this skill on every code-writing task: new files, new symbols, edits, tests and refactors.

## 1. Before writing: discover the conventions, never invent them

This skill does NOT prescribe a casing style or a file-naming scheme. Those come from the project. Before
creating any file, folder, class, function, variable, constant or test, establish the convention in this
order and follow the first source that answers:

1. **The repo's existing code.** Open 2–3 neighbouring files of the same kind (another service, another
   component, another test) and copy how they name the file, the folder, the type, its members and its
   tests: casing, suffixes (`.service`, `Controller`, `_test`), singular/plural, word order.
2. **The repo's explicit rules.** Linter/formatter config, `specs/constitution.md`, the project's
   instruction file, and the stack's skill if one is installed.
3. **The framework's generator.** If the stack has an official CLI that generates code (scaffolders,
   `generate` commands), the names it would produce are the convention: name by hand exactly as it would.
4. **The language's official style guide.** Only when the three sources above say nothing.

Rules that follow from this:

- **One convention per kind of thing.** If the repo names files one way, every new file uses it. Never
  mix two styles for the same kind of artifact, even if the other one is "better".
- **If the repo is inconsistent**, follow the majority in the folder you are touching and report the
  inconsistency; do not "fix" files outside the task.
- **The file name matches its main symbol.** The file that holds the class/component/module that does X is
  named after X, in the file-naming convention found above. A reader must find the class from the file
  name and the file from the class name.

## 2. Vocabulary: one concept, one word

Incoherent names usually come from the vocabulary, not the casing.

- **Use the domain terms of the spec.** If the spec says `invoice`, the code says `invoice` — not `bill`,
  `receipt` or `doc`. The names in the code, the tests and the spec are the same words.
- **One concept = one word across the whole codebase.** Do not alternate `user`/`client`/`customer`,
  `fetch`/`get`/`retrieve`/`load`, `remove`/`delete`, `create`/`add`/`new` for the same operation. Before
  naming, search the repo for the concept and reuse the word already in use.
- **One word = one concept.** Do not use the same word for two different things (e.g. `order` as a
  purchase and as a sort direction).
- **A new term** (not in the spec nor the repo) is a decision: say it in your report so it can be added to
  the spec.

## 3. What a name must say

A name is correct when a teammate understands what the thing is or does **without reading its body**.

- **Functions and methods** say what they do or return: an action plus its object (`calculateTotal`,
  `sendInvoice`), or the value they return. A function that returns a boolean reads as a question
  (`isExpired`, `hasPermission`, `canRetry`).
- **Classes, types and modules** are nouns that name ONE responsibility (`InvoiceRepository`,
  `PaymentGateway`). If the honest name needs "And" or "Manager/Helper/Util/Processor/Handler" with no
  further meaning, the unit does too much or has no clear purpose: split it or name what it actually does.
- **Variables** name the content, not its type or container: `activeUsers`, not `list`, `arr`, `data`.
  Collections are plural, single items singular. Booleans read as a true/false statement.
- **Constants and magic values** get a name that explains WHY that value: `MAX_LOGIN_ATTEMPTS`, not `5`.
- **Units and formats go in the name** when the type does not carry them: `timeoutMs`, `priceCents`,
  `createdAtUtc`.
- **Tests** describe the behavior and the condition, matching the requirement they cover: what happens,
  when. Not `test1`, `works`, `shouldWork`.
- **Length follows scope.** A loop index can be short; anything visible across files must be fully
  descriptive.

**Precise, not redundant.** Every word in a name must add meaning; if removing a word loses nothing, remove it.

- **Do not repeat the context.** A member does not repeat its class, a function does not repeat its module,
  a file does not repeat its folder: `user.name`, not `user.userName`; `invoiceRepository.findById`, not
  `invoiceRepository.findInvoiceById`.
- **No noise words** that add length but not meaning: `Data`, `Info`, `Object`, `Class`, `Value`,
  `Variable`, `The`, `My`, `Actual`, `Real` (`InvoiceData` vs `Invoice`: if they differ, say how).
- **No type words already given by the type** (`nameString`, `usersList`, `isActiveBoolean`).
- **Distinguishable names.** Two names in the same scope must differ in meaning, not just in spelling
  (`invoice` vs `theInvoice`, `account` vs `accountInfo`).
- Shortening never wins over clarity: precise means "only words that carry meaning", not "fewest letters".

Forbidden as a full name (allowed only as part of a more specific one):
`data`, `info`, `item`, `obj`, `value`, `val`, `result`, `res`, `temp`, `tmp`, `stuff`, `thing`, `foo`,
`bar`, `x`/`y` outside math, `manager`, `helper`, `util(s)`, `misc`, `common`, `process`, `handle`,
`doIt`, `run` without object, and numbered variants (`user2`, `newData`, `finalResult`, `handleClick2`).

Also never:

- **Invented abbreviations** (`usrCnt`, `calcTtl`, `mgr`). Only abbreviations that the domain or the
  language already uses universally (`id`, `url`, `http`).
- **Type or scope encoding** (`strName`, `arrUsers`, `iCount`, `m_value`) unless the repo already does it.
- **Names that lie.** A `getX` that also writes, a `validate` that also saves, a `users` that holds one
  user. Fix the name or the code — never leave a name that promises something different.
- **Mixing human languages** in identifiers. Use the language the codebase already uses.

When you cannot find an honest name, the design is unclear: the unit is doing two things or you do not yet
know what it is for. Fix that first.

## 4. Units: small and single-purpose

- Functions, components, services and modules are small enough to understand without scrolling through
  unrelated concerns. One function does one thing at one level of abstraction.
- Few parameters. When several always travel together, they are a concept: give it a type with a name.
- No boolean flag parameters that switch behavior (`render(true)`): two functions with honest names.
- No hidden side effects: a function that reads does not write; a query does not change state.
- Do not mix UI, domain rules, data access and framework plumbing without an explicit architectural reason.

## 5. Control flow and errors

- Prefer simple control flow over clever abstractions. Early returns over deep nesting.
- Make invalid states hard to represent when the language or framework allows it.
- Errors are visible: never swallow an exception or return a silent default that hides a failure. Error
  messages say what failed and with which input.
- Prefer boring, predictable code over surprising cleverness.

## 6. Duplication and comments

- Remove duplication. If the shared abstraction does not have a stable meaning yet, do not invent a bad
  one — but do not leave the repetition silent either: **name it and report it** with the files and lines,
  so the decision is made on purpose instead of by omission.
- Keep comments for non-obvious decisions (the WHY); do not narrate obvious code. A comment that explains
  WHAT the code does is a sign that a name is missing: extract and name it instead.
- No commented-out code, no stale TODOs without an owner or a reason.

## 7. Renaming

- If a name you touch is wrong, rename it everywhere it is used (code, tests, docs), in the same change.
- Do not rename outside the task's scope; report it instead.

## Review checklist

- Did I check how neighbouring files name the same kind of thing, and follow it?
- Does every new file name match its main symbol, in the repo's file-naming convention?
- Are the names the spec's domain words, with one word per concept across the change?
- Can a teammate tell what each name is or does without reading the body? Is any name generic, numbered,
  abbreviated or lying?
- Is each unit doing one clear thing? Are errors and edge cases visible?
- Can this code be tested without excessive setup?

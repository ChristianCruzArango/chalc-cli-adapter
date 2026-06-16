# contracts/ — Contracts / interfaces (full mode)

One file per contract. Every endpoint, service or message defines its **input/output** here before being implemented.
They are the basis for the tests (Test-First): the test verifies the contract.

## File convention
`<resource>.<action>.contract.md` — e.g. `user.create.contract.md`

## Contract template
```
# Contract: <resource>.<action>   (covers R?)

Input:
  <field>: <type>   // required?

Output (success):
  <field>: <type>

Errors:
  <code> — <when>
```

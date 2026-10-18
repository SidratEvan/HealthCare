"""Port of `shared/domain` (the queue engine and the rules every module shares).

Each module here names the TypeScript file it mirrors. Behaviour is held to
the TypeScript original by the parity vectors in `tests/domain/` (CLAUDE.md
§7: the reducer exists once; with two languages it exists twice, and the
vectors are what keep the two the same).
"""

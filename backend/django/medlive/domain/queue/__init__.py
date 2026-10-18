"""The live queue engine (port of `shared/domain/src/queue`).

States, events and etas are JSON-shaped dicts with the TypeScript's own
camelCase keys, so a state from either side compares equal to the other's
(`tests/domain/test_queue_parity.py`).
"""

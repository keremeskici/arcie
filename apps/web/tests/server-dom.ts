// Install the DOM before importing React. The Node test environment provides the
// file-based module URLs needed by SQLite migrations in the in-process server.
import { afterAll } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

const dom = await builtinEnvironments["happy-dom"].setup(globalThis, {});
afterAll(async () => { await dom.teardown(globalThis); });

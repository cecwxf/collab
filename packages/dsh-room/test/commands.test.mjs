import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundle just the command grammar (no host deps) for a fast Node test.
const outfile = new URL("./.commands.bundle.mjs", import.meta.url).pathname;
await build({
  entryPoints: ["src/commands.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  write: true,
  logLevel: "silent",
});
const { parseCollabCommand, extractMentions, HELP } = await import(pathToFileURL(outfile).href);

test("parse create public with tags", () => {
  const c = parseCollabCommand("create public release-crew -- ship it #demo #review");
  assert.equal(c.op, "create");
  assert.equal(c.public, true);
  assert.equal(c.name, "release-crew");
  assert.equal(c.description, "ship it");
  assert.deepEqual(c.tags, ["demo", "review"]);
});

test("parse join by invite and by search index", () => {
  assert.equal(parseCollabCommand("join collab://join/r#k").op, "join");
  assert.deepEqual(parseCollabCommand("join 2"), { op: "join-result", index: 2 });
});

test("parse search and say with mentions", () => {
  assert.deepEqual(parseCollabCommand("search release #demo"), { op: "search", query: "release", tag: "demo" });
  const say = parseCollabCommand("say hi @box-dsh please");
  assert.equal(say.op, "say");
  assert.deepEqual(say.mentions, ["box-dsh"]);
  assert.deepEqual(extractMentions("@a @b."), ["a", "b"]);
});

test("help is non-empty", () => assert.match(HELP, /\/collab create/));

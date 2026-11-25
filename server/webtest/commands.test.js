"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./harness.js");

const catalog = {
  commands: [
    { name: "compact", source: "builtin", description: "Compact" },
    { name: "model", source: "builtin" },
    { name: "recompile", source: "prompt" },
  ],
  models: ["acme/small", "acme/large"],
  thinkingLevels: ["low", "high"],
};

const suggest = (text, from = catalog) => {
  const { window } = load("commands.js");
  return Array.from(window.PiCommands.suggest(text, from), (item) => item.insert);
};

test("suggests command names, prefix matches first", () => {
  assert.deepEqual(suggest("/"), ["/compact ", "/model ", "/recompile "]);
  assert.deepEqual(suggest("/comp"), ["/compact ", "/recompile "]);
});

test("suggests arguments until one is fully typed", () => {
  assert.deepEqual(suggest("/model lar"), ["/model acme/large"]);
  assert.deepEqual(suggest("/model acme/large"), []);
  assert.deepEqual(suggest("/thinking "), ["/thinking low", "/thinking high"]);
});

test("stays out of ordinary and escaped text", () => {
  for (const text of ["hello", "//model", "/compact\nmore", "/recompile file"]) assert.deepEqual(suggest(text), [], text);
  assert.deepEqual(suggest("/", null), []);
});

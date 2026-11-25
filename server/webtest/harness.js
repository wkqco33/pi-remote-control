"use strict";

// Loads the embedded Web UI scripts into a sandbox with the few DOM features they use.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const STATIC_DIR = join(__dirname, "..", "internal", "httpserver", "static");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.open = false;
    const classes = () => this.className.split(" ").filter(Boolean);
    this.classList = {
      contains: (name) => classes().includes(name),
      add: (name) => this.classList.toggle(name, true),
      toggle: (name, force = !classes().includes(name)) => {
        const rest = classes().filter((item) => item !== name);
        this.className = (force ? [...rest, name] : rest).join(" ");
        return force;
      },
    };
  }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  hasChildNodes() { return this.children.length > 0; }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child, reference) {
    child.parentElement = this;
    this.children.splice(this.children.indexOf(reference), 0, child);
    return child;
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  querySelectorAll(selector) {
    const name = selector.replace(/^\./, "");
    return this.children.flatMap((child) => [
      ...(child.classList.contains(name) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function load(...files) {
  const frames = [];
  const sandbox = {
    document: { createElement: (tag) => new Element(tag) },
    requestAnimationFrame: (callback) => frames.push(callback),
    PiMarkdown: { render: (text) => text || "" },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of files) vm.runInContext(readFileSync(join(STATIC_DIR, file), "utf8"), sandbox, { filename: file });
  return {
    window: sandbox,
    element: (tag) => new Element(tag),
    flushFrames: () => frames.splice(0).forEach((frame) => frame()),
  };
}

module.exports = { load };

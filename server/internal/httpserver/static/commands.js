(function (global) {
  "use strict";

  // Slash command autocomplete for the composer. The agent supplies the catalog
  // and decides what may run; this menu only helps with typing.

  function suggest(text, catalog) {
    if (!catalog || !text.startsWith("/") || text.startsWith("//") || text.includes("\n")) return [];
    const space = text.indexOf(" ");
    if (space < 0) {
      const typed = text.slice(1).toLowerCase();
      return (catalog.commands || [])
        .filter((command) => command.name.toLowerCase().includes(typed))
        .sort((a, b) => Number(b.name.startsWith(typed)) - Number(a.name.startsWith(typed)))
        .map((command) => ({
          insert: `/${command.name} `,
          label: `/${command.name}`,
          description: command.description || command.source,
        }));
    }
    const name = text.slice(1, space);
    const options = { model: catalog.models, thinking: catalog.thinkingLevels }[name] || [];
    const typed = text.slice(space + 1).trim().toLowerCase();
    return options
      .filter((value) => value.toLowerCase().includes(typed) && value.toLowerCase() !== typed)
      .map((value) => ({ insert: `/${name} ${value}`, label: value, description: "" }));
  }

  function createMenu({ input, list, catalog, onNeedCatalog }) {
    let items = [];
    let selected = 0;
    let dismissed = null;
    let wasCommand = false;

    function close() {
      items = [];
      list.classList.add("hidden");
      list.replaceChildren();
      input.removeAttribute("aria-activedescendant");
    }

    function draw() {
      list.replaceChildren(...items.map((item, index) => {
        const option = document.createElement("li");
        option.id = `command-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === selected));
        const label = document.createElement("strong");
        label.textContent = item.label;
        const description = document.createElement("span");
        description.className = "muted";
        description.textContent = item.description;
        option.append(label, description);
        // Keep the focus in the textarea while choosing with a pointer.
        option.addEventListener("pointerdown", (event) => event.preventDefault());
        option.addEventListener("click", () => accept(item));
        return option;
      }));
      list.classList.remove("hidden");
      input.setAttribute("aria-activedescendant", `command-option-${selected}`);
      list.children[selected]?.scrollIntoView({ block: "nearest" });
    }

    function update() {
      const text = input.value;
      const isCommand = text.startsWith("/") && !text.startsWith("//");
      // Ask once per command, so that a reloaded agent is picked up.
      if (isCommand && !wasCommand) onNeedCatalog();
      wasCommand = isCommand;
      items = text === dismissed || input.disabled ? [] : suggest(text, catalog());
      selected = 0;
      if (items.length) draw();
      else close();
    }

    function accept(item) {
      input.value = item.insert;
      input.dispatchEvent(new Event("input"));
      input.focus();
    }

    // Returns true when the menu consumed the key.
    function handleKey(event) {
      if (!items.length || event.isComposing) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        selected = (selected + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        draw();
      } else if (event.key === "Escape") {
        dismissed = input.value;
        close();
      } else if (event.key === "Tab" && !event.shiftKey) {
        accept(items[selected]);
      } else if (event.key === "Enter" && !event.shiftKey && items[selected].insert.trim() !== input.value.trim()) {
        // A fully typed command is submitted instead of being completed again.
        accept(items[selected]);
      } else {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    function reset() {
      wasCommand = false;
      dismissed = null;
      close();
    }

    input.addEventListener("blur", close);
    return { update, handleKey, reset };
  }

  global.PiCommands = { suggest, createMenu };
})(window);

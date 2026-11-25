(function (global) {
  "use strict";

  function title(session) {
    return session.sessionName || session.cwd?.split("/").filter(Boolean).pop() || session.sessionId.slice(0, 8);
  }

  function filter(sessions, query) {
    const needle = query.trim().toLowerCase();
    return sessions.filter((s) =>
      [s.sessionName, s.sessionId, s.host, s.cwd, s.branch, s.model].some((part) => part?.toLowerCase().includes(needle)));
  }

  function item(session, active, onSelect) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sessionId = session.sessionId;
    button.className = "session-item";
    if (active) {
      button.classList.add("active");
      button.setAttribute("aria-current", "true");
    }
    const top = document.createElement("div");
    top.className = "session-item-top";
    const name = document.createElement("strong");
    name.textContent = title(session);
    const state = document.createElement("span");
    state.className = session.state === "busy" ? "badge busy" : "badge idle";
    state.textContent = session.state === "busy" ? "Busy" : "Idle";
    top.append(name, state);
    const meta = document.createElement("div");
    meta.className = "session-item-meta";
    meta.textContent = [session.host, session.cwd].filter(Boolean).join(" · ");
    button.title = meta.textContent;
    button.append(top, meta);
    button.addEventListener("click", () => onSelect(session));
    return button;
  }

  function render(list, { sessions, activeId, emptyMessage, onSelect }) {
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.sessionId : null;
    list.replaceChildren();
    if (sessions.length === 0) {
      const message = document.createElement("p");
      message.className = "session-list-empty muted";
      message.textContent = emptyMessage;
      list.appendChild(message);
      return;
    }
    for (const session of sessions) {
      const button = item(session, session.sessionId === activeId, onSelect);
      list.appendChild(button);
      if (focused === session.sessionId) button.focus({ preventScroll: true });
    }
  }

  global.PiSessionList = { title, filter, render };
})(window);

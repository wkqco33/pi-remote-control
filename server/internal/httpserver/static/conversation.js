(function (global) {
  "use strict";

  function appendMessage(view, role, text) {
    const message = document.createElement("div");
    const safeRole = ["user", "assistant", "system"].includes(role) ? role : "assistant";
    message.className = `msg ${safeRole}`;
    const label = document.createElement("div");
    label.className = "msg-role";
    label.textContent = { user: "You", assistant: "pi", system: "Session" }[safeRole];
    const body = document.createElement("div");
    body.className = "markdown-body";
    body.innerHTML = global.PiMarkdown.render(text);
    message.append(label, body);
    view.thread.appendChild(message);
    return message;
  }

  function startReply(view) {
    view.thinking = "";
    view.reply = "";
    view.assistant = appendMessage(view, "assistant", "");
  }

  function updateReply(view) {
    if (view.thinking) {
      let thinking = view.assistant.querySelector(".thinking-box");
      if (!thinking) {
        thinking = document.createElement("div");
        thinking.className = "thinking-box";
        view.assistant.insertBefore(thinking, view.assistant.querySelector(".markdown-body"));
      }
      thinking.textContent = view.thinking;
    }
    view.assistant.querySelector(".markdown-body").innerHTML = global.PiMarkdown.render(view.reply);
  }

  function applyEvent(view, { type, payload = {} }) {
    switch (type) {
      case "history.snapshot":
        view.thread.replaceChildren();
        view.assistant = null;
        for (const item of payload.items || []) appendMessage(view, item.role, item.text);
        break;
      case "stream.start":
        startReply(view);
        break;
      case "stream.delta":
        if (!view.assistant) startReply(view);
        if (payload.kind === "thinking") view.thinking += payload.delta || "";
        else view.reply += payload.delta || "";
        updateReply(view);
        break;
      case "stream.end":
        if (payload.text) {
          if (!view.assistant) startReply(view);
          view.reply = payload.text;
          updateReply(view);
        }
        view.assistant = null;
        break;
      case "tool.start": {
        const card = document.createElement("div");
        card.className = "tool-card";
        card.dataset.toolCallId = payload.toolCallId || "";
        const name = document.createElement("span");
        name.textContent = payload.toolName || "Tool";
        const status = document.createElement("span");
        status.className = "muted";
        status.textContent = "Running…";
        card.append(name, status);
        view.thread.appendChild(card);
        break;
      }
      case "tool.end": {
        const card = Array.from(view.thread.querySelectorAll(".tool-card"))
          .find((item) => item.dataset.toolCallId === payload.toolCallId);
        const status = payload.isError ? "Failed" : "Done";
        const duration = typeof payload.durationMs === "number" ? ` · ${payload.durationMs} ms` : "";
        if (card) card.lastElementChild.textContent = status + duration;
        else appendMessage(view, "system", `${payload.toolName || "Tool"} · ${status}${duration}`);
        break;
      }
      default:
        return false;
    }
    return true;
  }

  global.PiConversation = { appendMessage, applyEvent };
})(window);

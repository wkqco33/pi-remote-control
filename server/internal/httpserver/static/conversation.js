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

  // A segment is the assistant text between two tool calls, so that
  // the timeline stays in chronological order.
  function openSegment(view) {
    if (view.segment) return view.segment;
    view.segment = { element: appendMessage(view, "assistant", ""), reply: "", thinking: "", dirty: false };
    return view.segment;
  }

  function renderSegment(segment) {
    if (!segment.dirty) return;
    segment.dirty = false;
    const body = segment.element.querySelector(".markdown-body");
    if (segment.thinking) {
      let thinking = segment.element.querySelector(".thinking-box");
      if (!thinking) {
        thinking = document.createElement("div");
        thinking.className = "thinking-box";
        segment.element.insertBefore(thinking, body);
      }
      thinking.textContent = segment.thinking;
    }
    body.innerHTML = global.PiMarkdown.render(segment.reply);
  }

  // Render at most once per frame. Hidden tabs get no frames, so they
  // only accumulate text until they become visible again.
  function scheduleRender(view, segment) {
    if (segment.dirty) return;
    segment.dirty = true;
    global.requestAnimationFrame(() => {
      const render = () => renderSegment(segment);
      if (view.onRender) view.onRender(render);
      else render();
    });
  }

  function closeSegment(view) {
    if (view.segment) renderSegment(view.segment);
    view.segment = null;
  }

  function openToolGroup(view) {
    const last = view.thread.lastElementChild;
    if (last?.classList.contains("tool-group")) return last;
    const group = document.createElement("details");
    group.className = "tool-group";
    group.appendChild(document.createElement("summary"));
    view.thread.appendChild(group);
    return group;
  }

  function summarizeToolGroup(group) {
    const cards = Array.from(group.querySelectorAll(".tool-card"));
    const names = new Map();
    const states = { running: 0, done: 0, failed: 0, interrupted: 0 };
    for (const card of cards) {
      names.set(card.dataset.toolName, (names.get(card.dataset.toolName) || 0) + 1);
      states[card.dataset.state] += 1;
    }
    const parts = [Array.from(names, ([name, count]) => `${name} ×${count}`).join(", ")];
    for (const [state, count] of Object.entries(states)) {
      if (count) parts.push(`${count} ${state}`);
    }
    group.firstElementChild.textContent = parts.join(" · ");
    group.classList.toggle("has-error", states.failed > 0);
  }

  function findToolCard(view, toolCallId) {
    return Array.from(view.thread.querySelectorAll(".tool-card"))
      .find((item) => item.dataset.toolCallId === toolCallId);
  }

  function startTool(view, payload) {
    closeSegment(view);
    // A history snapshot may already show the call that is starting.
    if (payload.toolCallId && findToolCard(view, payload.toolCallId)) return;
    const group = openToolGroup(view);
    const card = document.createElement("div");
    card.className = "tool-card";
    card.dataset.toolCallId = payload.toolCallId || "";
    card.dataset.toolName = payload.toolName || "Tool";
    card.dataset.state = "running";
    const name = document.createElement("span");
    name.textContent = card.dataset.toolName;
    const status = document.createElement("span");
    status.className = "muted";
    status.textContent = "Running…";
    card.append(name, status);
    group.appendChild(card);
    summarizeToolGroup(group);
  }

  function endTool(view, payload) {
    const card = findToolCard(view, payload.toolCallId);
    const status = payload.isError ? "Failed" : "Done";
    const duration = typeof payload.durationMs === "number" ? ` · ${payload.durationMs} ms` : "";
    if (!card) {
      appendMessage(view, "system", `${payload.toolName || "Tool"} · ${status}${duration}`);
      return;
    }
    card.dataset.state = payload.isError ? "failed" : "done";
    card.lastElementChild.textContent = status + duration;
    if (payload.isError) card.parentElement.open = true;
    summarizeToolGroup(card.parentElement);
  }

  function restoreTool(view, item) {
    const call = { toolCallId: item.toolCallId, toolName: item.text };
    startTool(view, call);
    if (item.status === "done" || item.status === "failed") {
      endTool(view, { ...call, isError: item.status === "failed", durationMs: item.durationMs });
    } else if (item.status === "interrupted") {
      const card = findToolCard(view, item.toolCallId);
      card.dataset.state = "interrupted";
      card.lastElementChild.textContent = "Interrupted";
      summarizeToolGroup(card.parentElement);
    }
  }

  function applyEvent(view, { type, payload = {} }) {
    switch (type) {
      case "history.snapshot":
        view.thread.replaceChildren();
        view.segment = null;
        view.turnHasText = false;
        for (const item of payload.items || []) {
          if (item.role === "tool") restoreTool(view, item);
          else appendMessage(view, item.role, item.text);
        }
        break;
      case "stream.start":
        closeSegment(view);
        view.turnHasText = false;
        break;
      case "stream.delta": {
        if (!payload.delta) break;
        const segment = openSegment(view);
        if (payload.kind === "thinking") {
          segment.thinking += payload.delta;
        } else {
          segment.reply += payload.delta;
          view.turnHasText = true;
        }
        scheduleRender(view, segment);
        break;
      }
      case "stream.end":
        // The text is the last reply of the turn. Apply it to the open text
        // segment, or add it only if no delta of this turn was received.
        if (payload.text && (view.segment?.reply || !view.turnHasText)) {
          const segment = openSegment(view);
          segment.reply = payload.text;
          segment.dirty = true;
          view.turnHasText = true;
        }
        closeSegment(view);
        break;
      case "tool.start":
        startTool(view, payload);
        break;
      case "tool.end":
        endTool(view, payload);
        break;
      default:
        return false;
    }
    return true;
  }

  // Auto-scroll that never pulls a reader away from older messages.
  function createFollower(timeline, button) {
    const atLatest = () => timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 96;
    const update = () => button.classList.toggle("hidden", timeline.classList.contains("hidden") || atLatest());
    const jump = () => {
      timeline.scrollTop = timeline.scrollHeight;
      update();
    };
    const keep = (change) => {
      const follow = atLatest();
      change();
      if (follow) jump();
      else update();
    };
    timeline.addEventListener("scroll", update, { passive: true });
    button.addEventListener("click", jump);
    return { atLatest, update, jump, keep };
  }

  global.PiConversation = { appendMessage, applyEvent, createFollower };
})(window);

(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const hide = (id, hidden) => byId(id).classList.toggle("hidden", hidden);
  function label(id, value) {
    const element = byId(id);
    if (element.textContent !== String(value)) element.textContent = value;
  }
  const clientIdKey = "pi_remote_tab_id";
  const activeKey = "pi_remote_active_session";
  const authDialog = byId("auth-dialog");
  const prompt = byId("prompt-input");
  const timeline = byId("timeline");
  const fileInput = byId("file-input");
  const mode = byId("deliver-mode");
  const pairInput = byId("pair-code-input");
  const views = new Map();
  let sessions = [];
  let active = null;
  let connection = "connecting";
  let lastSession = sessionStorage.getItem(activeKey);

  function browserClientId() {
    let id = sessionStorage.getItem(clientIdKey);
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      id = "web-" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    sessionStorage.setItem(clientIdKey, id);
    return id;
  }

  const client = new window.PiRelayClient({
    clientId: browserClientId(),
    onStatus: updateConnection,
    onEnvelope: (env) => {
      handleEnvelope(env);
      if (env.type.startsWith("approval.")) notifier.refresh();
    },
  });
  const conversation = window.PiConversation;
  const approvals = window.PiApproval;
  const sessionList = window.PiSessionList;
  const notifier = window.PiNotifier.create({
    approvals,
    views: () => views.values(),
    button: byId("btn-enable-alerts"),
    onOpen: (view) => { if (view.summary) selectSession(view.summary); },
  });
  const follower = window.PiConversation.createFollower(timeline, byId("btn-jump-latest"));
  const updateAuth = window.PiBrowserAuth({
    connect: () => client.connect(),
    signedOut: resetWorkspace,
    status: () => connection,
  });

  function updateConnection(status) {
    connection = status;
    label("conn-status-text", {
      connecting: "Connecting",
      connected: "Connected",
      disconnected: "Reconnecting",
      unauthorized: "Sign in required",
    }[status]);
    byId("conn-dot").classList.toggle("online", client.ready);
    if (status === "unauthorized") clearWorkspace();
    updateAuth(status);
    renderSessions();
    renderActive();
  }

  function renderSessions() {
    label("session-count", sessions.length);
    sessionList.render(byId("session-list"), {
      sessions: sessionList.filter(sessions, byId("session-filter").value),
      activeId: active?.id,
      emptyMessage: connection === "connected" ?
        (sessions.length ? "No matching sessions." : "No sessions online.") :
        labelForConnection(),
      onSelect: selectSession,
    });
  }

  function labelForConnection() {
    return connection === "unauthorized" ? "Sign in to see sessions." : "Waiting for the relay…";
  }

  function updateSessions(next) {
    sessions = next;
    for (const view of views.values()) {
      const summary = sessions.find((s) => s.sessionId === view.id);
      if (view.summary?.connectedAt !== summary?.connectedAt || !summary) {
        client.unsubscribe(view.id);
        view.paired = undefined;
        view.challenge = null;
        view.pairError = "";
        view.awaitingPair = false;
        view.approvals = [];
        view.digest = "";
        view.digestOpen = false;
        view.loading = Boolean(summary);
        if (summary) client.subscribe(view.id);
      }
      view.summary = summary;
    }
    if (!active && sessions.length > 0) {
      selectSession(sessions.find((s) => s.sessionId === lastSession) || sessions[0]);
    } else {
      renderSessions();
      renderActive();
    }
  }

  function selectSession(summary) {
    const sidebarWasOpen = byId("sidebar").classList.contains("open");
    closeSidebar();
    if (active) active.scroll = follower.atLatest() ? null : timeline.scrollTop;
    let view = views.get(summary.sessionId);
    if (!view) {
      const thread = document.createElement("div");
      thread.className = "conversation-thread";
      view = {
        id: summary.sessionId, summary, thread, scroll: null, draft: "",
        mode: "followUp", images: [], loading: true, approvals: [], localAuto: false,
      };
      view.onRender = (render) => {
        if (view === active) follower.keep(render);
        else render();
      };
      views.set(view.id, view);
      client.subscribe(view.id);
    }
    if (active !== view) {
      active = view;
      lastSession = active.id;
      sessionStorage.setItem(activeKey, lastSession);
      prompt.value = active.draft;
      mode.value = active.mode;
      pairInput.value = "";
      timeline.replaceChildren(active.thread);
      renderAttachments();
    }
    renderSessions();
    renderActive();
    timeline.scrollTop = active.scroll ?? timeline.scrollHeight;
    follower.update();
    if (sidebarWasOpen) byId("btn-toggle-sidebar").focus();
  }

  function controllable(view) {
    return client.ready && Boolean(view?.summary) && !view.loading && (!view.summary.requirePairing || view.paired === true);
  }

  function renderActive() {
    const summary = active?.summary;
    const enabled = controllable(active);
    const title = summary && sessionList.title(summary);
    label("active-session-title", title || (active ? "Session offline" : "No session selected"));
    label("active-session-sub", summary ?
      [summary.host, summary.cwd, summary.branch, summary.model, summary.runningTool].filter(Boolean).join(" · ") :
      "Running pi sessions appear in the sidebar.");
    prompt.disabled = !enabled;
    fileInput.disabled = !enabled;
    mode.disabled = !enabled;
    const autoBtn = byId("btn-auto-approve");
    const autoOn = approvals.isAuto(active);
    autoBtn.disabled = !enabled;
    autoBtn.setAttribute("aria-pressed", String(autoOn));
    autoBtn.classList.toggle("is-active", autoOn);
    autoBtn.textContent = autoOn ? "Auto-approve: On" : "Auto-approve: Off";
    byId("btn-send").disabled = !enabled;
    byId("btn-digest").disabled = !enabled;
    byId("btn-abort").disabled = !enabled || summary.state !== "busy";

    const empty = !active?.thread.hasChildNodes();
    hide("empty-state", !empty);
    hide("timeline", empty);
    if (empty) {
      let heading = "No messages yet";
      let description = "Send a message to start working in this pi session.";
      if (!client.ready) {
        heading = connection === "unauthorized" ? "Connect to the relay" : "Connecting to the relay";
        description = labelForConnection();
      } else if (!active) {
        heading = "No sessions online";
        description = "Start pi with the remote-control extension to connect a session.";
      } else if (!summary) {
        heading = "Session offline";
        description = "Choose another session or wait for pi to reconnect.";
      } else if (active.loading) {
        heading = "Loading conversation";
        description = "Waiting for pi to send its recent history.";
      } else if (!enabled) {
        heading = "Pair this session to send a message";
        description = "Use the code shown in the pi terminal.";
      }
      label("empty-title", heading);
      label("empty-description", description);
    }
    renderBanners();
    hide("digest-panel", !active?.digestOpen);
    if (active?.digestOpen && byId("digest-body").dataset.sessionId !== active.id) renderDigest();
  }

  function renderBanners() {
    notifier.refresh();
    const pair = client.ready && active?.summary?.requirePairing && active.paired === false;
    const challenge = pair && active.challenge;
    const validCode = challenge && challenge.expiresAt > Date.now();
    hide("pairing-banner", !pair);
    if (pair) {
      label("pair-description", validCode ?
        `Enter the ${challenge.digits}-digit code shown in the local pi terminal.` :
        (challenge ? "The code expired. Request a new code from the pi terminal." : "Request a pairing code from the local pi terminal."));
      label("pair-error", active.pairError || "");
      hide("pair-error", !active.pairError);
      hide("pair-form", !validCode);
      hide("btn-retry-pairing", Boolean(validCode));
      pairInput.disabled = active.awaitingPair === true;
      byId("pair-form").querySelector("button").disabled = pairInput.disabled;
    }
    const approval = controllable(active) && !approvals.isAuto(active) && approvals.current(active);
    const seconds = approval ? Math.ceil((approval.expiresAt - Date.now()) / 1000) : 0;
    hide("approval-banner", seconds <= 0);
    if (seconds > 0) {
      label("approval-tool-name", approval.toolName || "Tool");
      label("approval-countdown", `(${seconds}s)`);
    }
  }

  function renderDigest() {
    const body = byId("digest-body");
    body.dataset.sessionId = active?.id || "";
    body.innerHTML = window.PiMarkdown.render(active?.digest);
  }

  function handleEnvelope(env) {
    const payload = env.payload || {};
    if (env.type === "client.welcome" || env.type === "sessions.update") {
      updateSessions(payload.sessions || []);
      return;
    }
    const view = views.get(env.sessionId);
    if (env.type === "error") {
      if (view) conversation.appendMessage(view, "system", payload.message || "Relay error");
      if (view === active) renderActive();
      return;
    }
    if (!view) return;
    const nearBottom = view === active && follower.atLatest();
    switch (env.type) {
      case "history.snapshot":
        view.loading = false;
        // Older agents omit paired. Only token-only sessions can skip the check.
        view.paired = payload.paired ?? !view.summary?.requirePairing;
        if (view.paired) clearPairing(view);
        conversation.applyEvent(view, env);
        break;
      case "pair.status":
        view.paired = payload.paired;
        if (view.paired) clearPairing(view);
        break;
      case "pair.required":
        view.paired = false;
        view.challenge = payload;
        view.awaitingPair = false;
        if (view === active) pairInput.value = "";
        break;
      case "pair.result":
        view.paired = payload.ok === true;
        view.awaitingPair = false;
        if (view.paired) clearPairing(view);
        else {
          view.pairError = payload.error === "mismatch" ?
            "That code did not match. Check the pi terminal and try again." :
            "Request a new code and try again.";
          if (payload.error !== "mismatch") view.challenge = null;
        }
        if (view === active) pairInput.value = "";
        break;
      case "approval.request":
        approvals.add(view, env);
        if (controllable(view)) approvals.answerLegacyAuto(view, sendTo);
        break;
      case "approval.resolved":
        approvals.resolve(view, payload.requestId);
        break;
      case "digest.snapshot":
        view.digest = payload.markdown || "";
        view.digestOpen = true;
        if (view === active) renderDigest();
        break;
      case "session.offline":
        updateSessions(sessions.filter((s) => s.sessionId !== view.id));
        return;
      default:
        if (!conversation.applyEvent(view, env)) return;
    }
    if (view === active) {
      renderActive();
      if (nearBottom || env.type === "history.snapshot") follower.jump();
      else follower.update();
    }
  }

  function clearPairing(view) {
    view.challenge = null;
    view.pairError = "";
    view.awaitingPair = false;
  }

  function sendTo(view, type, fields = {}) {
    return client.send({ type, sessionId: view.id, payload: { sessionId: view.id, ...fields } });
  }

  function respondApproval(approved) {
    const pending = approvals.current(active);
    if (!controllable(active) || !pending) return;
    if (approvals.respond(active, pending.requestId, approved, sendTo)) renderBanners();
  }

  function setAutoApprove(enabled) {
    if (!controllable(active)) return;
    approvals.setAuto(active, enabled, sendTo);
    renderActive();
  }

  byId("btn-approve-tool").onclick = () => respondApproval(true);
  byId("btn-auto-approve-tool").onclick = () => setAutoApprove(true);
  byId("btn-reject-tool").onclick = () => respondApproval(false);
  byId("btn-auto-approve").onclick = () => setAutoApprove(!approvals.isAuto(active));
  byId("pair-form").onsubmit = (event) => {
    event.preventDefault();
    const code = pairInput.value.replace(/[\s-]+/g, "");
    if (!client.ready || !active?.challenge || active.awaitingPair || active.challenge.expiresAt <= Date.now()) return;
    if (!/^\d+$/.test(code) || code.length !== active.challenge.digits) {
      active.pairError = `Enter all ${active.challenge.digits} digits from the pi terminal.`;
    } else if (sendTo(active, "pair.submit", { code })) {
      active.pairError = "";
      active.awaitingPair = true;
    }
    renderBanners();
  };
  byId("btn-retry-pairing").onclick = () => {
    if (client.ready && active) client.requestHistory(active.id);
  };
  byId("btn-digest").onclick = () => { if (controllable(active)) sendTo(active, "digest.request"); };
  byId("btn-close-digest").onclick = () => { active.digestOpen = false; renderActive(); };
  byId("btn-abort").onclick = () => { if (controllable(active)) sendTo(active, "turn.abort"); };
  byId("session-filter").oninput = renderSessions;
  prompt.oninput = () => { if (active) active.draft = prompt.value; };
  mode.onchange = () => { if (active) active.mode = mode.value; };

  fileInput.onchange = async () => {
    const owner = active;
    const files = Array.from(fileInput.files || []).slice(0, 4);
    fileInput.value = "";
    if (!controllable(owner)) return;
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024 || owner.images.length >= 4) continue;
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (data && owner.images.length < 4) owner.images.push({ mediaType: file.type || "image/png", data, name: file.name });
    }
    if (owner === active) renderAttachments();
  };

  function renderAttachments() {
    const preview = byId("attachment-preview");
    preview.replaceChildren();
    hide("attachment-preview", !active?.images.length);
    active?.images.forEach((image, index) => {
      const chip = document.createElement("span");
      chip.className = "att-chip";
      chip.textContent = image.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost btn-sm";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${image.name}`);
      remove.onclick = () => { active.images.splice(index, 1); renderAttachments(); };
      chip.appendChild(remove);
      preview.appendChild(chip);
    });
  }

  function submitPrompt() {
    if (!controllable(active)) return;
    const text = prompt.value.trim();
    if (!text && !active.images.length) return;
    const images = active.images.map(({ mediaType, data }) => ({ mediaType, data }));
    const deliverAs = active.summary.state === "busy" ? active.mode : undefined;
    if (sendTo(active, "prompt.send", { text, images, deliverAs })) {
      conversation.appendMessage(active, "user", text || "[Image]");
      prompt.value = active.draft = "";
      active.images = [];
      renderAttachments();
      renderActive();
      follower.jump();
    }
  }

  byId("composer").onsubmit = (event) => { event.preventDefault(); submitPrompt(); };
  prompt.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitPrompt();
    }
  };

  function closeSidebar() {
    byId("sidebar").classList.remove("open");
    byId("btn-toggle-sidebar").setAttribute("aria-expanded", "false");
  }

  byId("btn-toggle-sidebar").onclick = () => {
    const open = byId("sidebar").classList.toggle("open");
    byId("btn-toggle-sidebar").setAttribute("aria-expanded", String(open));
    if (open) byId("session-filter").focus();
  };
  byId("sidebar-overlay").onclick = () => { closeSidebar(); byId("btn-toggle-sidebar").focus(); };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !authDialog.open && byId("sidebar").classList.contains("open")) {
      closeSidebar();
      byId("btn-toggle-sidebar").focus();
    }
  });

  function clearWorkspace() {
    client.subscriptions.clear();
    views.clear();
    sessions = [];
    active = null;
    prompt.value = "";
    pairInput.value = "";
    timeline.replaceChildren();
    byId("digest-body").replaceChildren();
    byId("session-filter").value = "";
    renderAttachments();
  }

  function resetWorkspace() {
    client.close();
    sessionStorage.removeItem(activeKey);
    sessionStorage.removeItem(clientIdKey);
    lastSession = null;
    client.clientId = browserClientId();
    updateConnection("unauthorized");
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) client.resume(); });
  window.addEventListener("online", () => client.resume());
  window.addEventListener("pageshow", () => client.resume());

  setInterval(renderBanners, 1000);
  client.connect();
})();

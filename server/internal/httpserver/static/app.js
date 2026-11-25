(function () {
  "use strict";

  const { byId, hide, label } = window.PiDom;
  const sessionView = window.PiSessionView;
  const clientIdKey = "pi_remote_tab_id";
  const activeKey = "pi_remote_active_session";
  const authDialog = byId("auth-dialog");
  const prompt = byId("prompt-input");
  const timeline = byId("timeline");
  const fileInput = byId("file-input");
  const mode = byId("deliver-mode");
  const views = new Map();
  let sessions = [];
  let active = null;
  let connection = "connecting";
  let lastSession = sessionStorage.getItem(activeKey);

  const commandMenu = window.PiCommands.createMenu({
    input: prompt,
    list: byId("command-menu"),
    catalog: () => active?.catalog,
    onNeedCatalog: () => { if (controllable(active)) sendTo(active, "commands.request"); },
  });

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
  const follower = conversation.createFollower(timeline, byId("btn-jump-latest"));
  const sidebar = window.PiSidebar.create({ blocked: () => authDialog.open });
  const attachments = window.PiAttachments.create({ input: fileInput, current: () => active, canAttach: controllable });
  const pairing = window.PiPairingPanel.create({ client, current: () => active, send: sendTo, onChange: renderBanners });
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
        sessionView.connectionHint(connection),
      onSelect: selectSession,
    });
  }

  function updateSessions(next) {
    sessions = next;
    for (const view of views.values()) {
      const summary = sessions.find((s) => s.sessionId === view.id);
      if (!sessionView.updateSummary(view, summary)) continue;
      client.unsubscribe(view.id);
      if (summary) client.subscribe(view.id);
    }
    if (!active && sessions.length > 0) {
      selectSession(sessions.find((s) => s.sessionId === lastSession) || sessions[0]);
    } else {
      renderSessions();
      renderActive();
    }
  }

  function selectSession(summary) {
    const sidebarWasOpen = sidebar.isOpen();
    sidebar.close();
    if (active) active.scroll = follower.atLatest() ? null : timeline.scrollTop;
    let view = views.get(summary.sessionId);
    if (!view) {
      const thread = document.createElement("div");
      thread.className = "conversation-thread";
      view = sessionView.create(summary, thread);
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
      commandMenu.reset();
      mode.value = active.mode;
      pairing.clearInput();
      timeline.replaceChildren(active.thread);
      attachments.render();
    }
    renderSessions();
    renderActive();
    timeline.scrollTop = active.scroll ?? timeline.scrollHeight;
    follower.update();
    if (sidebarWasOpen) sidebar.focusToggle();
  }

  function controllable(view) {
    return sessionView.isControllable(view, client.ready);
  }

  function renderHeader() {
    const summary = active?.summary;
    const title = summary && sessionList.title(summary);
    label("active-session-title", title || (active ? "Session offline" : "No session selected"));
    label("active-session-sub", summary ? sessionView.subtitle(summary) : "Running pi sessions appear in the sidebar.");
  }

  function renderControls() {
    const enabled = controllable(active);
    for (const control of [prompt, fileInput, mode]) control.disabled = !enabled;
    const autoButton = byId("btn-auto-approve");
    const autoOn = approvals.isAuto(active);
    autoButton.setAttribute("aria-pressed", String(autoOn));
    autoButton.classList.toggle("is-active", autoOn);
    autoButton.textContent = autoOn ? "Auto-approve: On" : "Auto-approve: Off";
    autoButton.disabled = !enabled;
    byId("btn-send").disabled = !enabled;
    byId("btn-digest").disabled = !enabled;
    byId("btn-abort").disabled = !enabled || active.summary.state !== "busy";
  }

  function renderEmptyState() {
    const empty = !active?.thread.hasChildNodes();
    hide("empty-state", !empty);
    hide("timeline", empty);
    if (!empty) return;
    const { title, description } = sessionView.emptyState({ ready: client.ready, connection, view: active });
    label("empty-title", title);
    label("empty-description", description);
  }

  function renderActive() {
    renderHeader();
    renderControls();
    renderEmptyState();
    renderBanners();
    hide("digest-panel", !active?.digestOpen);
    if (active?.digestOpen && byId("digest-body").dataset.sessionId !== active.id) renderDigest();
  }

  function renderApprovalBanner() {
    const approval = controllable(active) && !approvals.isAuto(active) && approvals.current(active);
    const seconds = approval ? Math.ceil((approval.expiresAt - Date.now()) / 1000) : 0;
    hide("approval-banner", seconds <= 0);
    if (seconds > 0) {
      label("approval-tool-name", approval.toolName || "Tool");
      label("approval-countdown", `(${seconds}s)`);
    }
  }

  // Banners also run on a timer because codes and approvals expire.
  function renderBanners() {
    notifier.refresh();
    pairing.render();
    renderApprovalBanner();
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
        sessionView.applyHistory(view, payload);
        conversation.applyEvent(view, env);
        break;
      case "pair.status":
        sessionView.applyPairStatus(view, payload);
        break;
      case "pair.required":
        sessionView.applyPairRequired(view, payload);
        if (view === active) pairing.clearInput();
        break;
      case "pair.result":
        sessionView.applyPairResult(view, payload);
        if (view === active) pairing.clearInput();
        break;
      case "approval.request":
        approvals.add(view, env);
        if (controllable(view)) approvals.answerLegacyAuto(view, sendTo);
        break;
      case "approval.resolved":
        approvals.resolve(view, payload.requestId);
        break;
      case "commands.snapshot":
        view.catalog = payload;
        if (view === active && document.activeElement === prompt) commandMenu.update();
        return;
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
  byId("btn-digest").onclick = () => { if (controllable(active)) sendTo(active, "digest.request"); };
  byId("btn-close-digest").onclick = () => { active.digestOpen = false; renderActive(); };
  byId("btn-abort").onclick = () => { if (controllable(active)) sendTo(active, "turn.abort"); };
  byId("session-filter").oninput = renderSessions;
  prompt.oninput = () => {
    if (active) active.draft = prompt.value;
    commandMenu.update();
  };
  mode.onchange = () => { if (active) active.mode = mode.value; };

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
      commandMenu.reset();
      attachments.render();
      renderActive();
      follower.jump();
    }
  }

  byId("composer").onsubmit = (event) => { event.preventDefault(); submitPrompt(); };
  prompt.onkeydown = (event) => {
    if (commandMenu.handleKey(event)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitPrompt();
    }
  };

  function clearWorkspace() {
    client.subscriptions.clear();
    views.clear();
    sessions = [];
    active = null;
    prompt.value = "";
    pairing.clearInput();
    commandMenu.reset();
    timeline.replaceChildren();
    byId("digest-body").replaceChildren();
    byId("session-filter").value = "";
    attachments.render();
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

(function () {
  "use strict";

  const TOKEN_KEY = "pi_remote_server_token";
  const CLIENT_ID_KEY = "pi_remote_client_id";

  function getOrCreateClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = "web-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  const els = {
    sidebar: document.getElementById("sidebar"),
    connDot: document.getElementById("conn-dot"),
    connText: document.getElementById("conn-status-text"),
    sessionList: document.getElementById("session-list"),
    activeTitle: document.getElementById("active-session-title"),
    activeSub: document.getElementById("active-session-sub"),
    btnDigest: document.getElementById("btn-digest"),
    btnAbort: document.getElementById("btn-abort"),
    pairingBanner: document.getElementById("pairing-banner"),
    pairForm: document.getElementById("pair-form"),
    pairInput: document.getElementById("pair-code-input"),
    approvalBanner: document.getElementById("approval-banner"),
    approvalTool: document.getElementById("approval-tool-name"),
    approvalCountdown: document.getElementById("approval-countdown"),
    btnApprove: document.getElementById("btn-approve-tool"),
    btnReject: document.getElementById("btn-reject-tool"),
    digestPanel: document.getElementById("digest-panel"),
    digestBody: document.getElementById("digest-body"),
    btnCloseDigest: document.getElementById("btn-close-digest"),
    timeline: document.getElementById("timeline"),
    composer: document.getElementById("composer"),
    promptInput: document.getElementById("prompt-input"),
    deliverMode: document.getElementById("deliver-mode"),
    btnSend: document.getElementById("btn-send"),
    fileInput: document.getElementById("file-input"),
    attPreview: document.getElementById("attachment-preview"),
    authDialog: document.getElementById("auth-dialog"),
    authForm: document.getElementById("auth-form"),
    tokenInput: document.getElementById("server-token-input"),
    btnAuthSettings: document.getElementById("btn-auth-settings"),
    btnAuthCancel: document.getElementById("btn-auth-cancel"),
    btnToggleSidebar: document.getElementById("btn-toggle-sidebar"),
  };

  let sessions = [];
  let activeSessionId = null;
  let pendingApproval = null;
  let approvalTimer = null;
  let pendingImages = [];
  let activeAssistantEl = null;
  let activeThinkingText = "";
  let activeReplyText = "";

  const client = new window.PiRelayClient({
    clientId: getOrCreateClientId(),
    getToken: () => sessionStorage.getItem(TOKEN_KEY) || "",
    onStatus: (status) => {
      els.connText.textContent = status;
      els.connDot.classList.toggle("online", status === "connected");
    },
    onEnvelope: handleEnvelope,
  });

  function renderSessions() {
    els.sessionList.innerHTML = "";
    if (sessions.length === 0) {
      els.sessionList.innerHTML = '<div class="muted" style="padding:8px;">No active pi sessions.</div>';
      return;
    }
    for (const s of sessions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "session-item" + (s.sessionId === activeSessionId ? " active" : "");
      const title = s.sessionName || s.sessionId.slice(0, 8);
      btn.innerHTML = `
        <div class="session-item-top">
          <strong>${window.PiMarkdown.escapeHtml(title)}</strong>
          <span class="badge ${s.state === "busy" ? "busy" : "idle"}">${window.PiMarkdown.escapeHtml(s.state || "idle")}</span>
        </div>
        <div class="session-item-meta">${window.PiMarkdown.escapeHtml(s.host)} · ${window.PiMarkdown.escapeHtml(s.cwd)}</div>
      `;
      btn.addEventListener("click", () => selectSession(s.sessionId));
      els.sessionList.appendChild(btn);
    }
    updateActiveHeader();
  }

  function updateActiveHeader() {
    const s = sessions.find((x) => x.sessionId === activeSessionId);
    const enabled = Boolean(s);
    els.promptInput.disabled = !enabled;
    els.btnSend.disabled = !enabled;
    els.btnDigest.disabled = !enabled;
    els.btnAbort.disabled = !enabled || s.state !== "busy";
    if (!s) {
      els.activeTitle.textContent = "No session selected";
      els.activeSub.textContent = "Connect to a running pi session from the sidebar.";
      return;
    }
    els.activeTitle.textContent = s.sessionName || s.sessionId;
    const parts = [s.host, s.cwd];
    if (s.branch) parts.push(`branch:${s.branch}`);
    if (s.model) parts.push(s.model);
    if (s.runningTool) parts.push(`tool:${s.runningTool}`);
    els.activeSub.textContent = parts.join(" · ");
  }

  function selectSession(sessionId) {
    activeSessionId = sessionId;
    els.sidebar.classList.remove("open");
    els.timeline.innerHTML = "";
    activeAssistantEl = null;
    activeThinkingText = "";
    activeReplyText = "";
    els.pairingBanner.classList.add("hidden");
    clearApproval();
    renderSessions();
    client.subscribe(sessionId);
  }

  function appendMessage(role, text, thinking) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    const roleEl = document.createElement("div");
    roleEl.className = "msg-role";
    roleEl.textContent = role;
    div.appendChild(roleEl);
    if (thinking) {
      const th = document.createElement("div");
      th.className = "thinking-box";
      th.textContent = thinking;
      div.appendChild(th);
    }
    const body = document.createElement("div");
    body.className = "markdown-body";
    body.innerHTML = window.PiMarkdown.render(text);
    div.appendChild(body);
    els.timeline.appendChild(div);
    els.timeline.scrollTop = els.timeline.scrollHeight;
    return div;
  }

  function ensureActiveAssistant() {
    if (activeAssistantEl) return activeAssistantEl;
    activeThinkingText = "";
    activeReplyText = "";
    activeAssistantEl = appendMessage("assistant", "", "");
    return activeAssistantEl;
  }

  function refreshActiveAssistant() {
    if (!activeAssistantEl) return;
    let th = activeAssistantEl.querySelector(".thinking-box");
    if (activeThinkingText) {
      if (!th) {
        th = document.createElement("div");
        th.className = "thinking-box";
        activeAssistantEl.insertBefore(th, activeAssistantEl.querySelector(".markdown-body"));
      }
      th.textContent = activeThinkingText;
    }
    const body = activeAssistantEl.querySelector(".markdown-body");
    body.innerHTML = window.PiMarkdown.render(activeReplyText);
    els.timeline.scrollTop = els.timeline.scrollHeight;
  }

  function handleEnvelope(env) {
    if (env.type === "client.welcome" || env.type === "sessions.update") {
      sessions = (env.payload && env.payload.sessions) || [];
      if (!activeSessionId && sessions.length > 0) {
        selectSession(sessions[0].sessionId);
      } else {
        renderSessions();
      }
      return;
    }

    if (env.type === "error") {
      const msg = (env.payload && env.payload.message) || "Server error";
      appendMessage("system", `Error: ${msg}`);
      if (env.payload && env.payload.code === "unauthorized") {
        els.authDialog.showModal();
      }
      return;
    }

    if (env.sessionId && env.sessionId !== activeSessionId) return;

    switch (env.type) {
      case "history.snapshot": {
        els.timeline.innerHTML = "";
        activeAssistantEl = null;
        const items = (env.payload && env.payload.items) || [];
        for (const item of items) {
          appendMessage(item.role || "assistant", item.text || "");
        }
        break;
      }
      case "stream.start":
        activeAssistantEl = null;
        ensureActiveAssistant();
        break;
      case "stream.delta":
        ensureActiveAssistant();
        if (env.payload && env.payload.kind === "thinking") {
          activeThinkingText += env.payload.delta || "";
        } else if (env.payload) {
          activeReplyText += env.payload.delta || "";
        }
        refreshActiveAssistant();
        break;
      case "stream.end":
        if (env.payload && typeof env.payload.text === "string" && env.payload.text.length > 0) {
          ensureActiveAssistant();
          activeReplyText = env.payload.text;
          refreshActiveAssistant();
        }
        activeAssistantEl = null;
        break;
      case "tool.start": {
        const card = document.createElement("details");
        card.className = "tool-card";
        card.dataset.toolCallId = env.payload.toolCallId || "";
        card.innerHTML = `<summary><span>⚙ ${window.PiMarkdown.escapeHtml(env.payload.toolName || "tool")}</span><span class="muted">running…</span></summary>`;
        els.timeline.appendChild(card);
        els.timeline.scrollTop = els.timeline.scrollHeight;
        break;
      }
      case "tool.end": {
        const cards = els.timeline.querySelectorAll(".tool-card");
        const target = Array.from(cards).find((c) => c.dataset.toolCallId === (env.payload && env.payload.toolCallId));
        const status = env.payload && env.payload.isError ? "failed" : "done";
        const dur = env.payload && typeof env.payload.durationMs === "number" ? ` (${env.payload.durationMs}ms)` : "";
        if (target) {
          const span = target.querySelector("summary span:last-child");
          if (span) span.textContent = `${status}${dur}`;
        } else {
          appendMessage("system", `Tool ${env.payload.toolName}: ${status}${dur}`);
        }
        break;
      }
      case "pair.required":
        els.pairingBanner.classList.remove("hidden");
        break;
      case "pair.result":
        if (env.payload && env.payload.ok) {
          els.pairingBanner.classList.add("hidden");
          appendMessage("system", "Paired successfully with session.");
        } else {
          appendMessage("system", `Pairing failed: ${(env.payload && env.payload.error) || "invalid code"}`);
        }
        break;
      case "approval.request":
        showApproval(env.payload);
        break;
      case "digest.snapshot":
        els.digestBody.innerHTML = window.PiMarkdown.render((env.payload && env.payload.markdown) || "");
        els.digestPanel.classList.remove("hidden");
        break;
      case "session.offline":
        appendMessage("system", "Session went offline.");
        break;
    }
  }

  function showApproval(req) {
    clearApproval();
    if (!req) return;
    pendingApproval = req;
    els.approvalTool.textContent = req.toolName || "tool";
    let left = Math.ceil((req.timeoutMs || 60000) / 1000);
    els.approvalCountdown.textContent = `(${left}s)`;
    els.approvalBanner.classList.remove("hidden");
    approvalTimer = setInterval(() => {
      left -= 1;
      els.approvalCountdown.textContent = `(${Math.max(0, left)}s)`;
      if (left <= 0) clearApproval();
    }, 1000);
  }

  function clearApproval() {
    pendingApproval = null;
    if (approvalTimer) {
      clearInterval(approvalTimer);
      approvalTimer = null;
    }
    els.approvalBanner.classList.add("hidden");
  }

  function respondApproval(approved) {
    if (!pendingApproval || !activeSessionId) return;
    client.send({
      type: "approval.response",
      sessionId: activeSessionId,
      payload: {
        sessionId: activeSessionId,
        requestId: pendingApproval.requestId,
        approved,
      },
    });
    clearApproval();
  }

  els.btnApprove.addEventListener("click", () => respondApproval(true));
  els.btnReject.addEventListener("click", () => respondApproval(false));

  els.pairForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeSessionId) return;
    const code = els.pairInput.value.trim();
    if (!code) return;
    client.send({
      type: "pair.submit",
      sessionId: activeSessionId,
      payload: { sessionId: activeSessionId, code },
    });
    els.pairInput.value = "";
  });

  els.btnDigest.addEventListener("click", () => {
    if (!activeSessionId) return;
    client.send({ type: "digest.request", sessionId: activeSessionId, payload: { sessionId: activeSessionId } });
  });
  els.btnCloseDigest.addEventListener("click", () => els.digestPanel.classList.add("hidden"));
  els.btnAbort.addEventListener("click", () => {
    if (!activeSessionId) return;
    client.send({ type: "turn.abort", sessionId: activeSessionId, payload: { sessionId: activeSessionId } });
  });

  els.fileInput.addEventListener("change", async () => {
    const files = Array.from(els.fileInput.files || []).slice(0, 4);
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024 || pendingImages.length >= 4) continue;
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1];
      if (base64) {
        pendingImages.push({ mediaType: file.type || "image/png", data: base64, name: file.name });
      }
    }
    els.fileInput.value = "";
    renderAttachments();
  });

  function renderAttachments() {
    els.attPreview.innerHTML = "";
    els.attPreview.classList.toggle("hidden", pendingImages.length === 0);
    pendingImages.forEach((img, idx) => {
      const chip = document.createElement("span");
      chip.className = "att-chip";
      chip.textContent = img.name;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-ghost btn-sm";
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        pendingImages.splice(idx, 1);
        renderAttachments();
      });
      chip.appendChild(rm);
      els.attPreview.appendChild(chip);
    });
  }

  function submitPrompt() {
    if (!activeSessionId) return;
    const text = els.promptInput.value.trim();
    if (!text && pendingImages.length === 0) return;
    const active = sessions.find((s) => s.sessionId === activeSessionId);
    const payload = {
      sessionId: activeSessionId,
      text,
      images: pendingImages.map(({ mediaType, data }) => ({ mediaType, data })),
    };
    if (active && active.state === "busy") {
      payload.deliverAs = els.deliverMode.value;
    }
    if (client.send({ type: "prompt.send", sessionId: activeSessionId, payload })) {
      appendMessage("user", text || "[image]");
      els.promptInput.value = "";
      pendingImages = [];
      renderAttachments();
    }
  }

  els.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    submitPrompt();
  });

  els.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  });

  els.btnAuthSettings.addEventListener("click", () => {
    els.tokenInput.value = sessionStorage.getItem(TOKEN_KEY) || "";
    els.authDialog.showModal();
  });
  els.btnAuthCancel.addEventListener("click", () => els.authDialog.close());
  els.authForm.addEventListener("submit", () => {
    sessionStorage.setItem(TOKEN_KEY, els.tokenInput.value.trim());
    client.connect();
  });
  els.btnToggleSidebar.addEventListener("click", () => els.sidebar.classList.toggle("open"));

  client.connect();
})();

(function (global) {
  "use strict";

  // State of one session as seen by this tab: its transitions and the texts
  // derived from it. Nothing here touches the DOM or the network.

  function create(summary, thread) {
    return {
      id: summary.sessionId, summary, thread, scroll: null, draft: "",
      mode: "followUp", images: [], loading: true, approvals: [], localAuto: false,
    };
  }

  function clearPairing(view) {
    view.challenge = null;
    view.pairError = "";
    view.awaitingPair = false;
  }

  // Applies a new session list entry and returns true if the agent went away or
  // reconnected, which makes everything learned from it stale.
  function updateSummary(view, summary) {
    const stale = !summary || view.summary?.connectedAt !== summary.connectedAt;
    if (stale) {
      view.paired = undefined;
      clearPairing(view);
      view.approvals = [];
      view.digest = "";
      view.digestOpen = false;
      view.loading = Boolean(summary);
    }
    view.summary = summary;
    return stale;
  }

  function applyHistory(view, payload) {
    view.loading = false;
    // Older agents omit paired. Only token-only sessions can skip the check.
    view.paired = payload.paired ?? !view.summary?.requirePairing;
    if (view.paired) clearPairing(view);
  }

  function applyPairStatus(view, payload) {
    view.paired = payload.paired;
    if (view.paired) clearPairing(view);
  }

  function applyPairRequired(view, challenge) {
    view.paired = false;
    view.challenge = challenge;
    view.awaitingPair = false;
  }

  function applyPairResult(view, payload) {
    view.paired = payload.ok === true;
    view.awaitingPair = false;
    if (view.paired) {
      clearPairing(view);
      return;
    }
    const mismatch = payload.error === "mismatch";
    view.pairError = mismatch ?
      "That code did not match. Check the pi terminal and try again." :
      "Request a new code and try again.";
    if (!mismatch) view.challenge = null;
  }

  // send(code) reports whether the code left this tab.
  function submitPairCode(view, input, send, now = Date.now()) {
    const { challenge } = view;
    if (!challenge || view.awaitingPair || challenge.expiresAt <= now) return false;
    const code = input.replace(/[\s-]+/g, "");
    if (!/^\d+$/.test(code) || code.length !== challenge.digits) {
      view.pairError = `Enter all ${challenge.digits} digits from the pi terminal.`;
    } else if (send(code)) {
      view.pairError = "";
      view.awaitingPair = true;
    }
    return true;
  }

  function pairingPrompt(challenge, now = Date.now()) {
    if (!challenge) return { codeValid: false, text: "Request a pairing code from the local pi terminal." };
    if (challenge.expiresAt <= now) {
      return { codeValid: false, text: "The code expired. Request a new code from the pi terminal." };
    }
    return { codeValid: true, text: `Enter the ${challenge.digits}-digit code shown in the local pi terminal.` };
  }

  function isControllable(view, ready) {
    return ready && Boolean(view?.summary) && !view.loading && (!view.summary.requirePairing || view.paired === true);
  }

  function subtitle(summary) {
    return [summary.host, summary.cwd, summary.branch, summary.model, summary.runningTool,
      summary.extensionVersion && `ext ${summary.extensionVersion}`].filter(Boolean).join(" · ");
  }

  function connectionHint(connection) {
    return connection === "unauthorized" ? "Sign in to see sessions." : "Waiting for the relay…";
  }

  // Explains why the timeline of the selected session has nothing to show.
  function emptyState({ ready, connection, view }) {
    const state = (title, description) => ({ title, description });
    if (!ready) {
      const title = connection === "unauthorized" ? "Connect to the relay" : "Connecting to the relay";
      return state(title, connectionHint(connection));
    }
    if (!view) return state("No sessions online", "Start pi with the remote-control extension to connect a session.");
    if (!view.summary) return state("Session offline", "Choose another session or wait for pi to reconnect.");
    if (view.loading) return state("Loading conversation", "Waiting for pi to send its recent history.");
    if (!isControllable(view, ready)) {
      return state("Pair this session to send a message", "Use the code shown in the pi terminal.");
    }
    return state("No messages yet", "Send a message to start working in this pi session.");
  }

  global.PiSessionView = {
    create, updateSummary, applyHistory, applyPairStatus, applyPairRequired, applyPairResult,
    submitPairCode, pairingPrompt, isControllable, subtitle, connectionHint, emptyState,
  };
})(window);

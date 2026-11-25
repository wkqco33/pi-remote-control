(function (global) {
  "use strict";

  // Pending tool approvals per session view, plus the auto-approve mode.
  // The agent owns the mode; view.localAuto only serves agents that do not report it.

  function agentOwnsMode(view) {
    return typeof view?.summary?.autoApprove === "boolean";
  }

  function isAuto(view) {
    if (!view) return false;
    return agentOwnsMode(view) ? view.summary.autoApprove : view.localAuto === true;
  }

  function add(view, { ts, payload = {} }) {
    if (!payload.requestId) return;
    const expiresAt = (ts || Date.now()) + (payload.timeoutMs || 60000);
    if (expiresAt <= Date.now()) return;
    resolve(view, payload.requestId);
    view.approvals.push({ ...payload, expiresAt });
  }

  function resolve(view, requestId) {
    view.approvals = view.approvals.filter((item) => item.requestId !== requestId);
  }

  function current(view) {
    return view?.approvals.find((item) => item.expiresAt > Date.now()) || null;
  }

  function respond(view, requestId, approved, send) {
    if (!send(view, "approval.response", { requestId, approved })) return false;
    resolve(view, requestId);
    return true;
  }

  function answerLegacyAuto(view, send) {
    if (agentOwnsMode(view) || !view.localAuto) return;
    for (const item of [...view.approvals]) respond(view, item.requestId, true, send);
  }

  function setAuto(view, enabled, send) {
    if (agentOwnsMode(view)) {
      send(view, "approval.mode", { autoApprove: enabled });
      return;
    }
    view.localAuto = enabled;
    answerLegacyAuto(view, send);
  }

  global.PiApproval = { isAuto, add, resolve, current, respond, answerLegacyAuto, setAuto };
})(window);

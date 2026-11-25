(function (global) {
  "use strict";

  const { byId, hide, label } = global.PiDom;
  const sessionView = global.PiSessionView;

  // The banner that pairs this tab with the selected session.
  function createPairingPanel({ client, current, send, onChange }) {
    const input = byId("pair-code-input");

    function render() {
      const view = current();
      const visible = client.ready && view?.summary?.requirePairing && view.paired === false;
      hide("pairing-banner", !visible);
      if (!visible) return;
      const { codeValid, text } = sessionView.pairingPrompt(view.challenge);
      label("pair-description", text);
      label("pair-error", view.pairError || "");
      hide("pair-error", !view.pairError);
      hide("pair-form", !codeValid);
      hide("btn-retry-pairing", codeValid);
      input.disabled = view.awaitingPair === true;
      byId("pair-form").querySelector("button").disabled = input.disabled;
    }

    function clearInput() {
      input.value = "";
    }

    byId("pair-form").onsubmit = (event) => {
      event.preventDefault();
      const view = current();
      if (!client.ready || !view) return;
      const submit = (code) => send(view, "pair.submit", { code });
      if (sessionView.submitPairCode(view, input.value, submit)) onChange();
    };
    byId("btn-retry-pairing").onclick = () => {
      const view = current();
      if (client.ready && view) client.requestHistory(view.id);
    };

    return { render, clearInput };
  }

  global.PiPairingPanel = { create: createPairingPanel };
})(window);

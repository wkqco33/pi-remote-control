(function (global) {
  "use strict";

  function browserAuth({ connect, signedOut, status }) {
    const dialog = document.getElementById("auth-dialog");
    const form = document.getElementById("auth-form");
    const tokenInput = document.getElementById("server-token-input");
    const signOut = document.getElementById("btn-sign-out");
    const submit = form.querySelector('button[type="submit"]');
    const error = document.getElementById("auth-error");
    const secureTransport = location.protocol === "https:" ||
      ["localhost", "[::1]"].includes(location.hostname) || /^127(?:\.\d{1,3}){3}$/.test(location.hostname);
    const legacyTokenKey = "pi_remote_server_token";
    const sync = typeof BroadcastChannel === "function" ? new BroadcastChannel("pi-remote-auth") : null;
    let busy = false;

    function showError(message) {
      error.textContent = message;
      error.classList.toggle("hidden", !message);
    }

    function showDialog(message = "") {
      if (!dialog.open) {
        tokenInput.value = "";
        dialog.showModal();
      }
      signOut.classList.toggle("hidden", status() !== "connected");
      showError(secureTransport ? message : "Open the HTTPS address to sign in to this relay.");
    }

    function setBusy(value) {
      busy = value;
      submit.disabled = busy || !secureTransport;
      signOut.disabled = busy;
    }

    async function signIn(token) {
      if (busy || !secureTransport) return;
      showError("");
      setBusy(true);
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch("/api/browser-auth", { method: "POST", headers });
        if (response.status !== 204) {
          showDialog(response.status === 401 ? "Check your server token and try again." : "The relay could not sign you in. Try again.");
          return;
        }
        tokenInput.value = "";
        dialog.close();
        connect();
        sync?.postMessage("signed-in");
      } catch {
        showDialog("The relay could not be reached. Try again.");
      } finally {
        setBusy(false);
      }
    }

    signOut.onclick = async () => {
      if (busy) return;
      setBusy(true);
      try {
        const response = await fetch("/api/browser-auth", { method: "DELETE" });
        if (response.status !== 204) throw new Error("Sign-out failed");
        signedOut();
        sync?.postMessage("signed-out");
        showDialog();
      } catch {
        showError("Could not sign out. Try again.");
      } finally {
        setBusy(false);
      }
    };
    document.getElementById("btn-auth-settings").onclick = () => showDialog();
    document.getElementById("btn-auth-cancel").onclick = () => dialog.close();
    form.onsubmit = (event) => {
      event.preventDefault();
      void signIn(tokenInput.value.trim());
    };
    sync?.addEventListener("message", ({ data }) => {
      if (data === "signed-out") {
        signedOut();
        showDialog();
      } else if (data === "signed-in" && status() === "unauthorized" && !busy) {
        dialog.close();
        connect();
      }
    });
    tokenInput.disabled = !secureTransport;
    setBusy(false);
    return (state) => {
      if (state !== "connected" && state !== "unauthorized") return;
      const legacyToken = sessionStorage.getItem(legacyTokenKey);
      sessionStorage.removeItem(legacyTokenKey);
      if (state === "unauthorized" && !busy) {
        if (legacyToken && secureTransport) void signIn(legacyToken);
        else showDialog();
      }
    };
  }

  global.PiBrowserAuth = browserAuth;
})(window);

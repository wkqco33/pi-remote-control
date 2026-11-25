(function (global) {
  "use strict";

  // Tells the user about approvals that are waiting while the tab is hidden.
  // Only sessions opened in this tab are subscribed, so only they are reported.

  function waiting(views, approvals) {
    const found = [];
    for (const view of views) {
      const request = !approvals.isAuto(view) && approvals.current(view);
      if (request) found.push({ view, request });
    }
    return found;
  }

  function createNotifier({ approvals, views, button, onOpen }) {
    const baseTitle = document.title;
    const announced = new Set();
    const supported = () => "Notification" in global;

    function announce({ view, request }) {
      if (announced.has(request.requestId) || !supported() || global.Notification.permission !== "granted") return;
      try {
        const notification = new global.Notification("Tool approval requested", {
          body: `${request.toolName || "Tool"} is waiting in pi remote.`,
          tag: request.requestId,
        });
        notification.onclick = () => {
          global.focus();
          onOpen(view);
          notification.close();
        };
        announced.add(request.requestId);
      } catch (_) {
        // Some mobile browsers only allow notifications from a service worker.
      }
    }

    function refresh() {
      const pending = waiting(views(), approvals);
      const hidden = document.hidden;
      const next = hidden && pending.length ? `(${pending.length}) Approval needed · ${baseTitle}` : baseTitle;
      if (document.title !== next) document.title = next;
      if (hidden) pending.forEach(announce);
      button.classList.toggle("hidden", !supported() || global.Notification.permission !== "default");
    }

    button.addEventListener("click", async () => {
      await global.Notification.requestPermission();
      refresh();
    });
    document.addEventListener("visibilitychange", refresh);
    return { refresh };
  }

  global.PiNotifier = { waiting, create: createNotifier };
})(window);

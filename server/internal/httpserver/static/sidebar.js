(function (global) {
  "use strict";

  const { byId } = global.PiDom;

  // The session list drawer used on narrow screens.
  function createSidebar({ blocked }) {
    const sidebar = byId("sidebar");
    const toggle = byId("btn-toggle-sidebar");
    const isOpen = () => sidebar.classList.contains("open");
    const focusToggle = () => toggle.focus();

    function close() {
      sidebar.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }

    function dismiss() {
      close();
      focusToggle();
    }

    toggle.onclick = () => {
      const open = sidebar.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      if (open) byId("session-filter").focus();
    };
    byId("sidebar-overlay").onclick = dismiss;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !blocked() && isOpen()) dismiss();
    });

    return { isOpen, close, focusToggle };
  }

  global.PiSidebar = { create: createSidebar };
})(window);

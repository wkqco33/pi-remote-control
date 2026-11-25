(function (global) {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const hide = (id, hidden) => byId(id).classList.toggle("hidden", hidden);

  // Unchanged text is left alone so that live regions are not announced again.
  function label(id, value) {
    const element = byId(id);
    if (element.textContent !== String(value)) element.textContent = value;
  }

  global.PiDom = { byId, hide, label };
})(window);

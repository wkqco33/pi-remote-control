(function (global) {
  "use strict";

  const { byId, hide } = global.PiDom;
  const MAX_IMAGES = 4;
  const MAX_BYTES = 8 * 1024 * 1024;

  // Resolves to the base64 body of the file, or null if it cannot be read.
  function readBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // Images waiting to be sent with the next prompt, kept per session view.
  function createAttachments({ input, current, canAttach }) {
    function chip(view, image, index) {
      const element = document.createElement("span");
      element.className = "att-chip";
      element.textContent = image.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost btn-sm";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${image.name}`);
      remove.onclick = () => { view.images.splice(index, 1); render(); };
      element.appendChild(remove);
      return element;
    }

    function render() {
      const view = current();
      hide("attachment-preview", !view?.images.length);
      byId("attachment-preview").replaceChildren(...(view?.images || []).map((image, index) => chip(view, image, index)));
    }

    input.onchange = async () => {
      // The user may switch sessions while files are being read.
      const owner = current();
      const files = Array.from(input.files || []).slice(0, MAX_IMAGES);
      input.value = "";
      if (!canAttach(owner)) return;
      for (const file of files) {
        if (file.size > MAX_BYTES || owner.images.length >= MAX_IMAGES) continue;
        const data = await readBase64(file);
        if (data && owner.images.length < MAX_IMAGES) {
          owner.images.push({ mediaType: file.type || "image/png", data, name: file.name });
        }
      }
      if (owner === current()) render();
    };

    return { render };
  }

  global.PiAttachments = { create: createAttachments };
})(window);

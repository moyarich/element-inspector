import styleSheet from "./demo-cursor-overlay-element-style.css" with { type: "css" };

export class DemoCursorOverlay extends HTMLElement {
  static tagName = "demo-cursor-overlay";
  static styleSheets = [styleSheet];

  #cursor;

  #handleMouseMove = (event) => {
    this.#cursor.style.translate = `${event.clientX}px ${event.clientY}px`;
  };

  #handleMouseDown = () => {
    this.#cursor.classList.remove("click");

    void this.#cursor.offsetWidth;

    this.#cursor.classList.add("click");
  };

  constructor() {
    super();

    const shadowRoot = this.attachShadow({
      mode: "open",
    });

    shadowRoot.adoptedStyleSheets = DemoCursorOverlay.styleSheets;

    this.#cursor = document.createElement("div");
    this.#cursor.className = "cursor";

    const halo = document.createElement("span");
    halo.className = "cursor__halo";
    this.#cursor.append(halo);
    shadowRoot.append(this.#cursor);
  }

  connectedCallback() {
    this.setAttribute("popover", "manual");

    if (!this.matches(":popover-open")) {
      this.showPopover();
    }

    document.addEventListener("mousemove", this.#handleMouseMove, true);

    document.addEventListener("mousedown", this.#handleMouseDown, true);
  }

  disconnectedCallback() {
    document.removeEventListener("mousemove", this.#handleMouseMove, true);

    document.removeEventListener("mousedown", this.#handleMouseDown, true);
  }
}

if (!customElements.get(DemoCursorOverlay.tagName)) {
  customElements.define(DemoCursorOverlay.tagName, DemoCursorOverlay);
}

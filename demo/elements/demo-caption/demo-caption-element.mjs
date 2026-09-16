/** @typedef {"bubble" | "arrow"} DemoCaptionPointer */

/** @typedef {"top-left" | "top-right" | "bottom-left" | "bottom-right"} DemoCaptionPlacementName */

/** @typedef {"top" | "right" | "bottom" | "left"} DemoCaptionSide */

/**
 * @typedef {
 *   DemoCaptionPlacementName
 *   | string
 *   | {top?: string, right?: string, bottom?: string, left?: string}
 *   | {x: number, y: number, side: DemoCaptionSide, offset?: number}
 *   | null
 * } DemoCaptionPlacement
 */

/**
 * @typedef {object} DemoCaption
 * @property {string} [title]
 * @property {string} [description]
 * @property {DemoCaptionPlacement} [placement]
 * @property {DemoCaptionPointer} [pointer]
 * @property {boolean} [visible]
 */

import styleSheet from "./demo-caption-element-style.css" with { type: "css" };

export class DemoCaptionElement extends HTMLElement {
  static tagName = "demo-caption";

  static styleSheets = [styleSheet];

  static defaults = Object.freeze({
    title: "",
    description: "",
    placement: "bottom-right",
    pointer: "bubble",
    visible: false,
  });

  static placements = new Map([
    ["top-left", "46px auto auto 24px"],
    ["top-right", "46px 24px auto auto"],
    ["bottom-left", "auto auto 46px 24px"],
    ["bottom-right", "auto 24px 46px auto"],
  ]);

  static pointers = new Set(["bubble", "arrow"]);

  #caption = { ...DemoCaptionElement.defaults };

  #pointer;

  #heading;

  #description;

  constructor() {
    super();

    const shadowRoot = this.attachShadow({ mode: "open" });

    shadowRoot.adoptedStyleSheets = DemoCaptionElement.styleSheets;

    const body = document.createElement("div");
    body.className = "caption__body";

    this.#pointer = document.createElement("div");
    this.#pointer.className = "caption__pointer";
    this.#pointer.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "caption__content";

    this.#heading = document.createElement("div");
    this.#heading.className = "caption-heading";

    this.#description = document.createElement("div");
    this.#description.className = "caption-description";

    content.append(this.#heading, this.#description);

    body.append(this.#pointer, content);

    shadowRoot.append(body);
  }

  connectedCallback() {
    this.setAttribute("aria-live", "polite");
    this.#render();
  }

  /** @param {DemoCaption} value */
  set caption(value) {
    const caption = {
      ...DemoCaptionElement.defaults,
      ...value,
    };

    this.#caption = {
      ...caption,
      title: String(caption.title),
      description: String(caption.description),
      pointer: DemoCaptionElement.pointers.has(caption.pointer)
        ? caption.pointer
        : DemoCaptionElement.defaults.pointer,
    };

    this.#render();
  }

  /** @returns {DemoCaption} */
  get caption() {
    const { placement } = this.#caption;

    return {
      ...this.#caption,
      placement:
        placement && typeof placement === "object"
          ? { ...placement }
          : placement,
    };
  }

  #render() {
    this.#heading.textContent = this.#caption.title;
    this.#description.textContent = this.#caption.description;

    this.style.inset = this.#resolveInset(this.#caption.placement);

    this.#pointer.className = `caption__pointer ${this.#caption.pointer}`;

    const side = this.#resolveSide(this.#caption.placement);

    this.#pointer.dataset.side = side;

    if (side) {
      this.dataset.side = side;
    } else {
      delete this.dataset.side;
    }

    this.#containerVisible(this.#caption.visible);
  }

  /**
   * @param {boolean} visible
   */
  #containerVisible(visible) {
    this.shadowRoot
      ?.querySelector(".caption__body")
      ?.classList.toggle("visible", visible);
  }

  /**
   * @param {DemoCaptionPlacement} placement
   * @returns {DemoCaptionSide | ""}
   */
  #resolveSide(placement) {
    return placement && typeof placement === "object" && "side" in placement
      ? placement.side
      : "";
  }

  /**
   * @param {DemoCaptionPlacement} placement
   * @returns {string}
   */
  #resolveInset(placement) {
    if (typeof placement === "string") {
      const value = placement.trim();

      return DemoCaptionElement.placements.get(value) ?? value;
    }

    if (placement && typeof placement === "object") {
      if ("x" in placement && "y" in placement && "side" in placement) {
        const offset = Number(placement.offset ?? 28);

        const positions = {
          top: `${placement.y - offset}px auto auto ${placement.x}px`,
          right: `${placement.y}px auto auto ${placement.x + offset}px`,
          bottom: `${placement.y + offset}px auto auto ${placement.x}px`,
          left: `${placement.y}px auto auto ${placement.x - offset}px`,
        };

        return positions[placement.side] ?? positions.top;
      }

      return [
        placement.top ?? "auto",
        placement.right ?? "auto",
        placement.bottom ?? "auto",
        placement.left ?? "auto",
      ].join(" ");
    }

    return (
      DemoCaptionElement.placements.get(
        DemoCaptionElement.defaults.placement,
      ) ?? "auto"
    );
  }
}

if (!customElements.get(DemoCaptionElement.tagName)) {
  customElements.define(DemoCaptionElement.tagName, DemoCaptionElement);
}

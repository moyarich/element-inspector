import DOCK_CSS from "./dock.css?raw";
import THEME_CSS from "../../theme.css?raw";

export type DockPosition = "float" | "left" | "right" | "bottom";
export type PanelSlot = string | HTMLElement;
export type PanelSlotRenderer = () => PanelSlot;

export type PanelVisibilityAction = "show" | "hide" | "close";

export interface PanelOptions {
  title?: PanelSlot;
  selectorText?: string;
  dockPosition?: DockPosition;
  panelSize?: { width: number; height: number };
  floatPos?: { left: number; bottom: number } | null;
  renderContent: PanelSlotRenderer;
  onDockChange?: (position: DockPosition) => void;
  onAfterRender?: (panelRoot: HTMLElement, panel: Panel) => void;
  onOpen?: (panel: Panel) => void;
  onHide?: (panel: Panel) => void;
  onClose?: (panel: Panel) => void;
  onVisibilityChange?: (
    isOpen: boolean,
    panel: Panel,
    action: PanelVisibilityAction,
  ) => void;
}

const DOCK_ICONS: Record<DockPosition, string> = {
  float: `<svg viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="3.5" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M8.5 1.5L11 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M11 1.5H8.5V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  left: `<svg viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="0.5" width="4.5" height="12" stroke="currentColor" stroke-width="1.2"/><rect x="5" y="0.5" width="7.5" height="12" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/></svg>`,
  right: `<svg viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="0.5" width="4.5" height="12" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="0.5" width="7.5" height="12" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/></svg>`,
  bottom: `<svg viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="8.5" width="12" height="4" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="0.5" width="12" height="8" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/></svg>`,
};

const CLOSE_ICON = `<svg viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L11 11M11 2L2 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

type ResizeMode = "" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export class Panel {
  private static readonly panelsByMount = new WeakMap<HTMLElement, Panel>();
  private static nextZIndex = 2147483648;

  private mountEl: HTMLElement;
  private rootEl: HTMLDivElement;
  private panelEl: HTMLDivElement;
  private snapPreviewEl: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private contentEl: HTMLDivElement;
  private resizeEdgeEl: HTMLDivElement;
  private resizeCornerEl: HTMLDivElement;
  private options: PanelOptions;

  public dockPosition: DockPosition;
  public panelSize: { width: number; height: number };
  public floatPos: { left: number; bottom: number } | null;

  private readonly SNAP_THRESHOLD = 72;
  private readonly SNAP_RELEASE = 96;
  private readonly RESIZE_HIT = 6;
  private readonly VIEWPORT_MARGIN = 12;
  private readonly MIN_VISIBLE_HEADER = 40;
  private readonly MIN_VISIBLE_WIDTH = 120;
  private readonly DEFAULT_FLOAT_POS = { left: 16, bottom: 16 };

  private eventsWired = false;
  private isDragging = false;
  private isResizing = false;
  private isHidden = true;

  private minPanelSize = {
    width: 320,
    height: 340,
  };

  private activePointerId: number | null = null;
  private activeCaptureEl: HTMLElement | null = null;

  private dragState: {
    startX: number;
    startY: number;
    startLeft: number;
    startBottom: number;
  } | null = null;

  private resizeState: {
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startLeft: number;
    startBottom: number;
    maxWidth: number;
    maxHeight: number;
    mode: ResizeMode;
  } | null = null;

  constructor(mountEl: HTMLElement, options: PanelOptions) {
    Panel.panelsByMount.get(mountEl)?.close();

    this.mountEl = mountEl;
    this.options = options;
    this.dockPosition = options.dockPosition ?? "float";
    this.panelSize = options.panelSize ?? { width: 780, height: 580 };
    this.floatPos = options.floatPos ?? { ...this.DEFAULT_FLOAT_POS };

    this.rootEl = document.createElement("div");
    this.rootEl.className = "docking-panel-root";
    this.rootEl.dataset.role = "root";

    this.rootEl.innerHTML = `
      <style>${THEME_CSS}\n${DOCK_CSS}</style>

      <div class="snap-preview" data-role="snap-preview"></div>

      <div class="panel dock-${this.dockPosition}" data-role="panel">
        <div class="drag-strip drag-strip-top" data-role="drag-strip-top" data-panel-drag-handle></div>
        <div class="header" data-role="header"></div>
        <div class="content" data-role="content"></div>
        <div class="drag-strip drag-strip-bottom" data-role="drag-strip-bottom" data-panel-drag-handle></div>
        <div class="resize-edge" data-role="resize-edge"></div>
        <div class="resize-corner" data-role="resize-corner"></div>
      </div>
    `;

    this.mountEl.replaceChildren(this.rootEl);
    Panel.panelsByMount.set(this.mountEl, this);

    this.snapPreviewEl = this.getRequiredElement<HTMLDivElement>(
      '[data-role="snap-preview"]',
    );

    this.panelEl = this.getRequiredElement<HTMLDivElement>(
      '[data-role="panel"]',
    );

    this.headerEl = this.getRequiredElement<HTMLDivElement>(
      '[data-role="header"]',
    );

    this.contentEl = this.getRequiredElement<HTMLDivElement>(
      '[data-role="content"]',
    );

    this.resizeEdgeEl = this.getRequiredElement<HTMLDivElement>(
      '[data-role="resize-edge"]',
    );

    this.resizeCornerEl = this.getRequiredElement<HTMLDivElement>(
      '[data-role="resize-corner"]',
    );

    this.render();
  }

  render(): void {
    this.renderHeader();
    this.renderContent();
    this.updateMinPanelSize();
    this.applyDockClass();
    this.wireEvents();

    if (this.isHidden) {
      this.panelEl.style.display = "none";
    } else if (this.dockPosition === "float") {
      this.normalizeFloatPosition();
    }
  }

  setOptions(next: Partial<PanelOptions>): void {
    this.options = { ...this.options, ...next };
  }

  refresh(): void {
    this.render();
  }

  setContent(renderContent: PanelSlotRenderer): void {
    this.options.renderContent = renderContent;
    this.renderContent();
    this.updateMinPanelSize();

    if (!this.isHidden && this.dockPosition === "float") {
      this.normalizeFloatPosition();
    }
  }

  setTitle(title: PanelSlot): void {
    this.options.title = title;
    this.renderHeader();
  }

  setSelectorText(selectorText: string): void {
    this.options.selectorText = selectorText;

    const el = this.headerEl.querySelector(".selector");

    if (el) {
      el.textContent = selectorText;
    }
  }

  isOpen(): boolean {
    return !this.isHidden;
  }

  show(): void {
    if (!this.isHidden) {
      return;
    }

    this.isHidden = false;
    this.panelEl.style.display = "block";
    this.bringToFront();

    if (this.dockPosition === "float") {
      this.normalizeFloatPosition();
    }

    this.options.onOpen?.(this);
    this.options.onVisibilityChange?.(true, this, "show");
  }

  hide(): void {
    if (this.isHidden) {
      return;
    }

    this.isHidden = true;
    this.panelEl.style.display = "none";
    this.endDragOrResize();

    this.options.onHide?.(this);
    this.options.onVisibilityChange?.(false, this, "hide");
  }

  close(): void {
    const wasOpen = !this.isHidden;

    this.isHidden = true;
    this.endDragOrResize();

    if (this.eventsWired) {
      this.panelEl.removeEventListener("pointerdown", this.onPanelPointerDown);
      this.panelEl.removeEventListener("pointermove", this.onPanelPointerMove);
      this.panelEl.removeEventListener(
        "pointerdown",
        this.onDragHandlePointerDown,
      );
      this.resizeEdgeEl.removeEventListener(
        "pointerdown",
        this.onEdgePointerDown,
      );
      this.resizeCornerEl.removeEventListener(
        "pointerdown",
        this.onCornerPointerDown,
      );
      this.rootEl.removeEventListener("click", this.onRootClick);
      window.removeEventListener("resize", this.onWindowResize);

      this.eventsWired = false;
    }

    if (Panel.panelsByMount.get(this.mountEl) === this) {
      Panel.panelsByMount.delete(this.mountEl);
    }

    this.rootEl.remove();

    this.options.onClose?.(this);

    if (wasOpen) {
      this.options.onVisibilityChange?.(false, this, "close");
    }
  }

  getElement(): HTMLDivElement {
    return this.panelEl;
  }

  syncPanelSize(): void {
    this.panelEl.style.setProperty("--panel-w", `${this.panelSize.width}px`);
    this.panelEl.style.setProperty("--panel-h", `${this.panelSize.height}px`);
    this.panelEl.style.setProperty(
      "--float-left",
      `${this.floatPos?.left ?? this.DEFAULT_FLOAT_POS.left}px`,
    );
    this.panelEl.style.setProperty(
      "--float-bottom",
      `${this.floatPos?.bottom ?? this.DEFAULT_FLOAT_POS.bottom}px`,
    );
  }

  applyDockClass(): void {
    this.panelEl.classList.remove(
      "dock-float",
      "dock-left",
      "dock-right",
      "dock-bottom",
    );

    this.panelEl.classList.add(`dock-${this.dockPosition}`);
    this.syncPanelSize();
  }

  setDock(position: DockPosition): void {
    if (this.dockPosition === position) {
      return;
    }

    this.dockPosition = position;

    if (position === "float" && !this.floatPos) {
      this.floatPos = {
        ...this.DEFAULT_FLOAT_POS,
      };
    }

    this.updateMinPanelSize();

    this.applyDockClass();
    this.renderHeader();

    if (position === "float" && !this.isHidden) {
      this.normalizeFloatPosition();
    }

    this.options.onDockChange?.(position);
  }

  private renderHeader(): void {
    const selectorText = this.options.selectorText ?? "";

    this.headerEl.innerHTML = `
      <div class="dot"></div>

      <div class="header-title-slot" data-role="header-title-slot"></div>

      <div class="selector">${this.escapeHtml(selectorText)}</div>

      <div class="dock-picker">
        ${(["float", "left", "right", "bottom"] as DockPosition[])
          .map(
            (position) => `
              <button
                class="dock-btn"
                data-state="${this.dockPosition === position ? "active" : "inactive"}"
                data-dock="${position}"
                title="Dock ${position}"
                aria-label="Dock ${position}"
                aria-pressed="${this.dockPosition === position}"
              >
                ${DOCK_ICONS[position]}
              </button>
            `,
          )
          .join("")}

        <button
          class="dock-btn close-btn"
          data-role="close-btn"
          title="Close"
          aria-label="Close panel"
        >
          ${CLOSE_ICON}
        </button>
      </div>
    `;

    const titleSlot = this.headerEl.querySelector<HTMLElement>(
      '[data-role="header-title-slot"]',
    );

    if (!titleSlot) {
      return;
    }

    const title = this.options.title ?? "Panel";
    titleSlot.replaceChildren();

    if (typeof title === "string") {
      const titleEl = document.createElement("p");
      titleEl.className = "title";
      titleEl.textContent = title;
      titleSlot.appendChild(titleEl);
      return;
    }

    titleSlot.appendChild(title);
  }

  private renderContent(): void {
    const content = this.options.renderContent();

    this.contentEl.replaceChildren();

    if (typeof content === "string") {
      this.contentEl.innerHTML = content;
    } else {
      this.contentEl.appendChild(content);
    }

    this.options.onAfterRender?.(this.contentEl, this);
  }

  private updateMinPanelSize(): void {
    switch (this.dockPosition) {
      case "float":
        this.minPanelSize = {
          width: 320,
          height: 340,
        };
        break;

      case "left":
      case "right":
        this.minPanelSize = {
          width: 120,
          height: 0,
        };
        break;

      case "bottom":
        this.minPanelSize = {
          width: 0,
          height: 140,
        };
        break;
    }
  }

  private wireEvents(): void {
    if (this.eventsWired) {
      return;
    }

    this.eventsWired = true;

    this.panelEl.addEventListener("pointerdown", this.onPanelPointerDown);
    this.panelEl.addEventListener("pointermove", this.onPanelPointerMove);
    this.panelEl.addEventListener("pointerdown", this.onDragHandlePointerDown);
    this.resizeEdgeEl.addEventListener("pointerdown", this.onEdgePointerDown);
    this.resizeCornerEl.addEventListener(
      "pointerdown",
      this.onCornerPointerDown,
    );
    this.rootEl.addEventListener("click", this.onRootClick);
    window.addEventListener("resize", this.onWindowResize);
  }

  private onRootClick = (e: MouseEvent): void => {
    const target = e.target;

    if (!(target instanceof Element)) {
      return;
    }

    const dockButton = target.closest<HTMLElement>("[data-dock]");

    if (dockButton) {
      const pos = dockButton.getAttribute("data-dock") as DockPosition | null;

      if (pos) {
        this.setDock(pos);
      }

      return;
    }

    const closeButton = target.closest<HTMLElement>('[data-role="close-btn"]');

    if (closeButton) {
      this.close();
    }
  };

  private onPanelPointerDown = (e: PointerEvent): void => {
    this.bringToFront();

    if (this.dockPosition !== "float") {
      return;
    }

    if (this.isDragging || this.isResizing) {
      return;
    }

    const mode = this.getFloatResizeModeFromPointer(e);

    if (!mode) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    this.beginResize(e, mode, this.panelEl);
  };

  private onPanelPointerMove = (e: PointerEvent): void => {
    if (this.isDragging || this.isResizing) {
      return;
    }

    if (this.dockPosition !== "float") {
      return;
    }

    const mode = this.getFloatResizeModeFromPointer(e);
    this.panelEl.style.cursor = this.cursorFor(mode);
  };

  private onDragHandlePointerDown = (e: PointerEvent): void => {
    if (this.dockPosition !== "float") {
      return;
    }

    if (this.isDragging || this.isResizing) {
      return;
    }

    const handle = this.getDragHandleFromTarget(e.target);

    if (!handle || this.shouldIgnore(e.target, handle)) {
      return;
    }

    const mode = this.getFloatResizeModeFromPointer(e);

    if (mode) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    this.startDrag(e, handle);
  };

  private startDrag(e: PointerEvent, captureEl: HTMLElement): void {
    this.bringToFront();

    const rect = this.panelEl.getBoundingClientRect();

    this.isDragging = true;
    this.activePointerId = e.pointerId;
    this.activeCaptureEl = captureEl;

    this.dragState = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startBottom: window.innerHeight - rect.bottom,
    };

    this.safeSetPointerCapture(captureEl, e.pointerId);

    window.addEventListener("pointermove", this.onDragMove);
    window.addEventListener("pointerup", this.onDragEnd, { once: true });
    window.addEventListener("pointercancel", this.onDragEnd, { once: true });
  }

  private onDragMove = (e: PointerEvent): void => {
    if (!this.isDragging || !this.dragState) {
      return;
    }

    const panelWidth = this.panelEl.offsetWidth || this.panelSize.width;
    const headerHeight = Math.max(
      this.headerEl.offsetHeight || 48,
      this.MIN_VISIBLE_HEADER,
    );

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const rawLeft =
      this.dragState.startLeft + (e.clientX - this.dragState.startX);
    const rawBottom =
      this.dragState.startBottom - (e.clientY - this.dragState.startY);

    const minLeft = Math.min(
      this.VIEWPORT_MARGIN,
      Math.max(this.VIEWPORT_MARGIN - (panelWidth - this.MIN_VISIBLE_WIDTH), 0),
    );

    const maxLeft = Math.max(
      this.VIEWPORT_MARGIN,
      viewportWidth -
        this.VIEWPORT_MARGIN -
        Math.min(panelWidth, viewportWidth),
    );

    const minBottom = 0;
    const maxBottom = Math.max(0, viewportHeight - headerHeight);

    this.floatPos = {
      left: Math.round(this.clamp(rawLeft, minLeft, maxLeft)),
      bottom: Math.round(this.clamp(rawBottom, minBottom, maxBottom)),
    };

    this.syncPanelSize();
    this.showSnapPreview(e.clientX, e.clientY);
  };

  private onDragEnd = (e: PointerEvent): void => {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.dragState = null;

    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointercancel", this.onDragEnd);

    this.safeReleasePointerCapture();
    this.hideSnapPreview();

    const zone = this.getSnapZone(e.clientX, e.clientY);

    if (zone) {
      const committed =
        (zone === "left" && e.clientX <= this.SNAP_RELEASE) ||
        (zone === "right" &&
          e.clientX >= window.innerWidth - this.SNAP_RELEASE) ||
        (zone === "bottom" &&
          e.clientY >= window.innerHeight - this.SNAP_RELEASE);

      if (committed) {
        this.setDock(zone);
      } else {
        this.normalizeFloatPosition();
      }
    } else {
      this.normalizeFloatPosition();
    }

    this.activePointerId = null;
    this.activeCaptureEl = null;
  };

  private onEdgePointerDown = (e: PointerEvent): void => {
    if (this.isDragging || this.isResizing) {
      return;
    }

    const mode = this.getDockResizeMode();

    if (!mode) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    this.bringToFront();
    this.beginResize(e, mode, this.resizeEdgeEl);
  };

  private onCornerPointerDown = (e: PointerEvent): void => {
    if (this.dockPosition !== "float") {
      return;
    }

    if (this.isDragging || this.isResizing) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    this.bringToFront();
    this.beginResize(e, "se", this.resizeCornerEl);
  };

  private beginResize(
    e: PointerEvent,
    mode: ResizeMode,
    captureEl: HTMLElement,
  ): void {
    const rect = this.panelEl.getBoundingClientRect();
    const { maxWidth, maxHeight } = this.getViewportBounds();

    this.isResizing = true;
    this.activePointerId = e.pointerId;
    this.activeCaptureEl = captureEl;

    this.resizeState = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
      startLeft: rect.left,
      startBottom: window.innerHeight - rect.bottom,
      maxWidth,
      maxHeight,
      mode,
    };

    this.safeSetPointerCapture(captureEl, e.pointerId);

    window.addEventListener("pointermove", this.onResizeMove);
    window.addEventListener("pointerup", this.onResizeEnd, { once: true });
    window.addEventListener("pointercancel", this.onResizeEnd, { once: true });
  }

  private onResizeMove = (e: PointerEvent): void => {
    if (!this.isResizing || !this.resizeState) {
      return;
    }

    const s = this.resizeState;

    const dx = e.clientX - s.startX;

    const dy = e.clientY - s.startY;

    const minW = this.minPanelSize.width;

    const minH = this.minPanelSize.height;

    let w = s.startW;
    let h = s.startH;
    let left = s.startLeft;
    let bottom = s.startBottom;

    if (s.mode.includes("e")) {
      w = this.clamp(s.startW + dx, minW, s.maxWidth - s.startLeft);
    }

    if (s.mode.includes("w")) {
      const newLeft = this.clamp(
        s.startLeft + dx,
        0,
        s.startLeft + s.startW - minW,
      );

      w = s.startW + (s.startLeft - newLeft);

      left = newLeft;
    }

    if (s.mode.includes("s")) {
      const topOffset = window.innerHeight - s.startBottom - s.startH;

      h = this.clamp(s.startH + dy, minH, s.maxHeight - topOffset);
    }

    if (s.mode.includes("n")) {
      const currentTop = window.innerHeight - s.startBottom - s.startH;

      const newTop = this.clamp(
        currentTop + dy,
        0,
        currentTop + s.startH - minH,
      );

      h = s.startH + (currentTop - newTop);

      bottom = window.innerHeight - (newTop + h);
    }

    this.panelSize = {
      width: Math.round(w),
      height: Math.round(h),
    };

    if (this.dockPosition === "float") {
      this.floatPos = {
        left: Math.round(left),
        bottom: Math.round(Math.max(0, bottom)),
      };
    }

    this.syncPanelSize();
  };

  private onResizeEnd = (): void => {
    if (!this.isResizing) {
      return;
    }

    this.isResizing = false;
    this.resizeState = null;
    this.panelEl.style.cursor = "";

    window.removeEventListener("pointermove", this.onResizeMove);
    window.removeEventListener("pointercancel", this.onResizeEnd);

    this.safeReleasePointerCapture();

    if (this.dockPosition === "float") {
      this.normalizeFloatPosition();
    }

    this.activePointerId = null;
    this.activeCaptureEl = null;
  };

  private endDragOrResize(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragState = null;

      window.removeEventListener("pointermove", this.onDragMove);
      window.removeEventListener("pointercancel", this.onDragEnd);

      this.hideSnapPreview();
    }

    if (this.isResizing) {
      this.isResizing = false;
      this.resizeState = null;

      window.removeEventListener("pointermove", this.onResizeMove);
      window.removeEventListener("pointercancel", this.onResizeEnd);

      this.panelEl.style.cursor = "";
    }

    this.safeReleasePointerCapture();

    this.activePointerId = null;
    this.activeCaptureEl = null;
  }

  private onWindowResize = (): void => {
    if (this.isHidden || this.dockPosition !== "float") {
      return;
    }

    this.normalizeFloatPosition();
  };

  private getFloatResizeModeFromPointer(e: PointerEvent): ResizeMode {
    const rect = this.panelEl.getBoundingClientRect();
    const H = this.RESIZE_HIT;

    const top = e.clientY <= rect.top + H;
    const bottom = e.clientY >= rect.bottom - H;
    const left = e.clientX <= rect.left + H;
    const right = e.clientX >= rect.right - H;

    if (top && left) {
      return "nw";
    }

    if (top && right) {
      return "ne";
    }

    if (bottom && left) {
      return "sw";
    }

    if (bottom && right) {
      return "se";
    }

    if (top) {
      return "n";
    }

    if (bottom) {
      return "s";
    }

    if (left) {
      return "w";
    }

    if (right) {
      return "e";
    }

    return "";
  }

  private getDockResizeMode(): ResizeMode {
    if (this.dockPosition === "left") {
      return "e";
    }

    if (this.dockPosition === "right") {
      return "w";
    }

    if (this.dockPosition === "bottom") {
      return "n";
    }

    return "";
  }

  private cursorFor(mode: ResizeMode): string {
    if (mode === "n" || mode === "s") {
      return "ns-resize";
    }

    if (mode === "e" || mode === "w") {
      return "ew-resize";
    }

    if (mode === "ne" || mode === "sw") {
      return "nesw-resize";
    }

    if (mode === "nw" || mode === "se") {
      return "nwse-resize";
    }

    return "";
  }

  private getSnapZone(x: number, y: number): DockPosition | null {
    if (x <= this.SNAP_THRESHOLD) {
      return "left";
    }

    if (x >= window.innerWidth - this.SNAP_THRESHOLD) {
      return "right";
    }

    if (y >= window.innerHeight - this.SNAP_THRESHOLD) {
      return "bottom";
    }

    return null;
  }

  private showSnapPreview(x: number, y: number): void {
    const zone = this.getSnapZone(x, y);

    this.snapPreviewEl.className = "snap-preview";

    if (!zone) {
      this.snapPreviewEl.style.display = "none";
      return;
    }

    this.snapPreviewEl.classList.add(zone);
    this.snapPreviewEl.style.display = "block";
  }

  private hideSnapPreview(): void {
    this.snapPreviewEl.style.display = "none";
  }

  private normalizeFloatPosition(): void {
    if (this.dockPosition !== "float") {
      return;
    }

    const panelWidth = this.panelEl.offsetWidth || this.panelSize.width;
    const headerHeight = Math.max(
      this.headerEl.offsetHeight || 48,
      this.MIN_VISIBLE_HEADER,
    );

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const currentLeft = this.floatPos?.left ?? this.DEFAULT_FLOAT_POS.left;
    const currentBottom =
      this.floatPos?.bottom ?? this.DEFAULT_FLOAT_POS.bottom;

    const minLeft = Math.min(
      this.VIEWPORT_MARGIN,
      Math.max(this.VIEWPORT_MARGIN - (panelWidth - this.MIN_VISIBLE_WIDTH), 0),
    );

    const maxLeft = Math.max(
      this.VIEWPORT_MARGIN,
      viewportWidth -
        this.VIEWPORT_MARGIN -
        Math.min(panelWidth, viewportWidth),
    );

    const minBottom = 0;
    const maxBottom = Math.max(0, viewportHeight - headerHeight);

    this.floatPos = {
      left: Math.round(this.clamp(currentLeft, minLeft, maxLeft)),
      bottom: Math.round(this.clamp(currentBottom, minBottom, maxBottom)),
    };

    this.syncPanelSize();
  }

  private safeSetPointerCapture(el: HTMLElement, pointerId: number): void {
    try {
      if (el.isConnected) {
        el.setPointerCapture(pointerId);
      }
    } catch {
      // Some embedded contexts can throw if capture is unavailable.
    }
  }

  private safeReleasePointerCapture(): void {
    if (!this.activeCaptureEl || this.activePointerId === null) {
      return;
    }

    try {
      if (
        this.activeCaptureEl.isConnected &&
        this.activeCaptureEl.hasPointerCapture(this.activePointerId)
      ) {
        this.activeCaptureEl.releasePointerCapture(this.activePointerId);
      }
    } catch {
      // Ignore release errors caused by detached nodes or completed captures.
    }
  }

  private bringToFront(): void {
    this.panelEl.style.zIndex = String(++Panel.nextZIndex);
  }

  private getViewportBounds(): { maxWidth: number; maxHeight: number } {
    return {
      maxWidth: window.innerWidth,
      maxHeight: window.innerHeight,
    };
  }

  private getDragHandleFromTarget(
    target: EventTarget | null,
  ): HTMLElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest<HTMLElement>("[data-panel-drag-handle]");
  }

  private shouldIgnore(
    target: EventTarget | null,
    dragHandle?: HTMLElement | null,
  ): boolean {
    if (!(target instanceof Element)) {
      return false;
    }

    const interactive = target.closest(
      "[data-dock], button, select, input, textarea, a, [contenteditable='true']",
    );

    return Boolean(interactive && interactive !== dragHandle);
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }

  private escapeHtml(s: string): string {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  private getRequiredElement<T extends HTMLElement>(selector: string): T {
    const el = this.rootEl.querySelector<T>(selector);

    if (!el) {
      throw new Error(`Panel markup missing required element: ${selector}`);
    }

    return el;
  }
}

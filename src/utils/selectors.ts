import { cssEscape } from "./cssEscape";

export function getElementSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();

  const id = el.id ? `#${cssEscape(el.id)}` : "";

  const classes = Array.from(el.classList)
    .slice(0, 4)
    .map((className) => `.${cssEscape(className)}`)
    .join("");

  return `${tag}${id}${classes}`;
}

export function getSelectorPath(el: Element): string {
  if (el.id) {
    return `#${cssEscape(el.id)}`;
  }

  const path: string[] = [];
  let current: Element | null = el;

  while (current !== null && current.tagName !== "HTML") {
    const element: Element = current;
    const tag = element.tagName.toLowerCase();
    const parent: Element | null = element.parentElement;

    if (parent === null) {
      break;
    }

    const siblings: Element[] = Array.from(parent.children).filter(
      (child): child is Element => child.tagName === element.tagName,
    );

    const index = siblings.indexOf(element) + 1;

    path.unshift(siblings.length === 1 ? tag : `${tag}:nth-of-type(${index})`);

    current = parent;
  }

  return path.join(" > ");
}

export function getShortSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();

  const id = el.id ? `#${cssEscape(el.id)}` : "";

  const className = el.classList.item(0);
  const cls = className ? `.${cssEscape(className)}` : "";

  return `${tag}${id}${cls}`;
}

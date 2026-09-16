import type { PageColor } from "../../../../utils/types";

export function getPageColors(): PageColor[] {
  const colors = new Map<string, number>();

  document.querySelectorAll("*").forEach((el) => {
    const styles = getComputedStyle(el);

    [
      styles.color,
      styles.backgroundColor,
      styles.borderColor,
      styles.fill,
      styles.stroke,
    ].forEach((value) => {
      if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") {
        colors.set(value, (colors.get(value) || 0) + 1);
      }
    });
  });

  return [...colors.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color, count]) => ({ color, count }));
}

import type { DomTreeRow } from "../../../../utils/types";

export type DomTreeDepthOption = {
  depth: number;
  exactCount: number;
  visibleCount: number;
};

export type DomTreeSnapshot = {
  allRows: DomTreeRow[];
  maxDepth: number;
  depthOptions: DomTreeDepthOption[];
  totalCount: number;
};

function collectAllDescendants(
  element: Element,
  currentDepth: number,
): DomTreeRow[] {
  return Array.from(element.children).flatMap((child) => [
    {
      element: child,
      depth: currentDepth,
      isTarget: false,
    },
    ...collectAllDescendants(child, currentDepth + 1),
  ]);
}

export function buildDomTreeSnapshot(targetElement: Element): DomTreeSnapshot {
  const allRows: DomTreeRow[] = [
    {
      element: targetElement,
      depth: 0,
      isTarget: true,
    },
    ...collectAllDescendants(targetElement, 1),
  ];

  const maxDepth = allRows.reduce((max, row) => Math.max(max, row.depth), 0);

  const optionCount = Math.max(maxDepth, 1);

  const depthOptions: DomTreeDepthOption[] = Array.from(
    { length: optionCount },
    (_, index) => {
      const depth = index + 1;

      return {
        depth,
        exactCount: allRows.filter((row) => row.depth === depth).length,
        visibleCount: allRows.filter((row) => row.depth <= depth).length,
      };
    },
  );

  return {
    allRows,
    maxDepth,
    depthOptions,
    totalCount: allRows.length,
  };
}

export function getDomTreeRowsFromSnapshot(
  snapshot: DomTreeSnapshot,
  depthLimit: number,
  includeChildren: boolean,
): DomTreeRow[] {
  if (!includeChildren) {
    return snapshot.allRows.filter((row) => row.depth === 0);
  }

  return snapshot.allRows.filter((row) => row.depth <= depthLimit);
}

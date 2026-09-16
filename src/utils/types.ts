export type CodeLanguage = "html" | "css" | "javascript";

export type ElementInfo = {
  selector: string;
  selectorPath: string;
  tag: string;
  id: string;
  classes: string;
  text: string;
  size: string;
  position: string;
  childCount: number;
  attrCount: number;
};

export type CssMatch = {
  selectorText: string;
  cssText: string;
  sourceOrder: number;
  wrapperPrefixes: string[];
  specificity: number;
};

export type DomTreeRow = {
  element: Element;
  depth: number;
  isTarget: boolean;
};

export type PageColor = {
  color: string;
  count: number;
};

import {
  getMatchingCssRules,
  type CssRuleMatch,
} from "../css/cssRules";
import { getElementSelector } from "../../../../utils/selectors";
import { absolutizeCssUrls } from "../css/cssUrls";

type VariableCandidate = {
  rawValue: string;
  absoluteValue: string;
};

function normalizeCssValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getStyleDeclaration(cssText: string): CSSStyleDeclaration {
  const declaration = document.createElement("div").style;
  declaration.cssText = cssText;
  return declaration;
}

function collectVariableCandidates(
  rawCssText: string,
  baseUrl: string,
  names: Set<string>,
  candidates: Map<string, VariableCandidate[]>,
): void {
  const declaration = getStyleDeclaration(rawCssText);

  for (const property of Array.from(declaration)) {
    if (!property.startsWith("--")) {
      continue;
    }

    const rawValue = declaration.getPropertyValue(property).trim();

    if (!rawValue) {
      continue;
    }

    names.add(property);

    const list = candidates.get(property) ?? [];
    list.push({
      rawValue,
      absoluteValue: absolutizeCssUrls(rawValue, baseUrl),
    });
    candidates.set(property, list);
  }
}

function collectFromMatchedRule(
  rule: CssRuleMatch,
  names: Set<string>,
  candidates: Map<string, VariableCandidate[]>,
): void {
  collectVariableCandidates(
    rule.rawCssText,
    rule.baseUrl,
    names,
    candidates,
  );
}

export function getResolvedCssVariableEntries(
  el: Element,
): Array<{ name: string; value: string }> {
  const names = new Set<string>();
  const candidates = new Map<string, VariableCandidate[]>();
  const computedStyle = window.getComputedStyle(el);
  const baseUrl = el.ownerDocument.baseURI;

  const chain: Element[] = [];
  let current: Element | null = el;

  while (current) {
    chain.unshift(current);
    current = current.parentElement;
  }

  for (const node of chain) {
    const inlineStyle = node.getAttribute("style");

    if (inlineStyle) {
      collectVariableCandidates(
        inlineStyle,
        node.ownerDocument.baseURI,
        names,
        candidates,
      );
    }

    for (const rule of getMatchingCssRules(node)) {
      collectFromMatchedRule(rule, names, candidates);
    }
  }

  return Array.from(names)
    .sort()
    .map((name) => {
      const computedValue = computedStyle.getPropertyValue(name).trim();
      const normalizedComputedValue = normalizeCssValue(computedValue);
      const matchingCandidate = (candidates.get(name) ?? [])
        .slice()
        .reverse()
        .find(
          (candidate) =>
            normalizeCssValue(candidate.rawValue) === normalizedComputedValue,
        );

      return {
        name,
        value: matchingCandidate
          ? matchingCandidate.absoluteValue
          : absolutizeCssUrls(computedValue, baseUrl),
      };
    })
    .filter((entry) => entry.value);
}

export function getCssVariableText(el: Element): string {
  const entries = getResolvedCssVariableEntries(el);

  if (!entries.length) {
    return "/* No CSS custom properties found for this element context. */";
  }

  return [
    `/* ${entries.length} resolved CSS custom properties */`,
    `${getElementSelector(el)} {`,
    ...entries.map(({ name, value }) => `  ${name}: ${value};`),
    "}",
  ].join("\n");
}

import type { CssMatch } from "../../../../utils/types";
import { absolutizeCssUrls, getCssRuleBaseUrl } from "./cssUrls";

const ID_SELECTOR_RE = /#[\w-]+/g;
const CLASS_ATTRIBUTE_PSEUDO_RE = /[.[:][\w-]+/g;
const TAG_SELECTOR_RE = /(^|[\s>+~])[\w-]+/g;

export type CssRuleMatch = CssMatch & {
  rawCssText: string;
  baseUrl: string;
  sourceHref: string | null;
};

export type CssKeyframesMatch = {
  name: string;
  cssText: string;
  wrapperPrefixes: string[];
  baseUrl: string;
  sourceHref: string | null;
};

export type CssFontFaceMatch = {
  family: string;
  cssText: string;
  wrapperPrefixes: string[];
  baseUrl: string;
  sourceHref: string | null;
};

export type CssPropertyRuleMatch = {
  name: string;
  cssText: string;
  wrapperPrefixes: string[];
};

type CssGroupingRuleLike = CSSRule & {
  cssRules: CSSRuleList;
};

type CSSImportRuleLike = CSSRule & {
  href: string;
  layerName?: string | null;
  media: MediaList;
  styleSheet: CSSStyleSheet | null;
  supportsText?: string | null;
};

type CSSFontFaceRuleLike = CSSRule & {
  style: CSSStyleDeclaration;
};

type CSSScopeRuleLike = CssGroupingRuleLike & {
  end?: string | null;
  start?: string | null;
};

type CSSContainerCondition = { name: string; query: string };

type CSSContainerRuleLike = CssGroupingRuleLike & {
  conditions?: CSSContainerCondition[];
  containerName?: string;
  containerQuery?: string;
};

type MatchingContext = {
  parentSelectors: string[];
  scopeRoots: Element[] | null;
  wrapperPrefixes: string[];
};

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return rule.type === CSSRule.STYLE_RULE;
}

function isMediaRule(rule: CSSRule): rule is CSSMediaRule {
  return rule.type === CSSRule.MEDIA_RULE;
}

function isSupportsRule(rule: CSSRule): rule is CSSSupportsRule {
  return rule.type === CSSRule.SUPPORTS_RULE;
}

function isImportRule(rule: CSSRule): rule is CSSImportRuleLike {
  if (typeof CSSImportRule !== "undefined" && rule instanceof CSSImportRule) {
    return true;
  }

  return rule.type === CSSRule.IMPORT_RULE;
}

function isGroupingRule(rule: CSSRule): rule is CssGroupingRuleLike {
  return "cssRules" in rule;
}

function isKeyframesRule(rule: CSSRule): rule is CSSKeyframesRule {
  if (
    typeof CSSKeyframesRule !== "undefined" &&
    rule instanceof CSSKeyframesRule
  ) {
    return true;
  }

  return /^@(?:-[a-z]+-)?keyframes\s+/i.test(rule.cssText);
}

function isFontFaceRule(rule: CSSRule): rule is CSSFontFaceRuleLike {
  if (
    typeof CSSFontFaceRule !== "undefined" &&
    rule instanceof CSSFontFaceRule
  ) {
    return true;
  }

  return /^@font-face\s*\{/i.test(rule.cssText);
}

function isPropertyRule(rule: CSSRule): boolean {
  return /^@property\s+--/i.test(rule.cssText);
}

function isScopeRule(rule: CSSRule): rule is CSSScopeRuleLike {
  return rule.constructor.name === "CSSScopeRule";
}

function isContainerRule(rule: CSSRule): rule is CSSContainerRuleLike {
  return rule.constructor.name === "CSSContainerRule";
}

function isNestedDeclarationsRule(
  rule: CSSRule,
): rule is CSSRule & { style: CSSStyleDeclaration } {
  return rule.constructor.name === "CSSNestedDeclarations";
}

function getKeyframesName(rule: CSSRule): string | null {
  if (isKeyframesRule(rule) && typeof rule.name === "string") {
    return rule.name;
  }

  const match = rule.cssText.match(
    /^@(?:-[a-z]+-)?keyframes\s+(?:"([^"]+)"|'([^']+)'|([^\s{]+))/i,
  );

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function normalizeFamilyName(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim().toLowerCase();
  }

  return trimmed.toLowerCase();
}

function getFontFaceFamily(rule: CSSFontFaceRuleLike): string | null {
  const family = rule.style.getPropertyValue("font-family");
  const normalized = normalizeFamilyName(family);

  return normalized || null;
}

function getGroupingRulePrefix(rule: CSSRule): string | null {
  if (isMediaRule(rule)) {
    return `@media ${rule.conditionText}`;
  }

  if (isSupportsRule(rule)) {
    return `@supports ${rule.conditionText}`;
  }

  const openingBrace = findAtRuleBlockStart(rule.cssText);

  if (openingBrace === -1) {
    return null;
  }

  const prefix = rule.cssText.slice(0, openingBrace).trim();

  return prefix.startsWith("@") ? prefix : null;
}

/** Finds an at-rule block without mistaking braces in strings or functions. */
function findAtRuleBlockStart(cssText: string): number {
  let quote: '"' | "'" | null = null;
  let comment = false;
  let parenthesisDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < cssText.length; index += 1) {
    const character = cssText[index];
    const nextCharacter = cssText[index + 1];

    if (comment) {
      if (character === "*" && nextCharacter === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      parenthesisDepth += 1;
    } else if (character === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (
      character === "{" &&
      parenthesisDepth === 0 &&
      bracketDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function shouldTraverseMedia(mediaText: string, ownerDocument = document): boolean {
  return (
    !mediaText ||
    Boolean(ownerDocument.defaultView?.matchMedia(mediaText).matches)
  );
}

function shouldTraverseSupports(conditionText: string): boolean {
  return typeof CSS.supports !== "function" || CSS.supports(conditionText);
}

/** Converts @import modifiers into the wrappers they represent after inlining. */
function getImportWrapperPrefixes(rule: CSSImportRuleLike): string[] {
  const prefixes: string[] = [];

  if (rule.layerName !== null && rule.layerName !== undefined) {
    prefixes.push(`@layer${rule.layerName ? ` ${rule.layerName}` : ""}`);
  }

  if (rule.supportsText) {
    prefixes.push(`@supports ${rule.supportsText}`);
  }

  const mediaText = rule.media?.mediaText ?? "";

  if (mediaText) {
    prefixes.push(`@media ${mediaText}`);
  }

  return prefixes;
}

export function calcSpecificity(selector: string): number {
  const ids = selector.match(ID_SELECTOR_RE)?.length ?? 0;
  const classes = selector.match(CLASS_ATTRIBUTE_PSEUDO_RE)?.length ?? 0;
  const tags = selector.match(TAG_SELECTOR_RE)?.length ?? 0;

  return ids * 100 + classes * 10 + tags;
}

/**
 * Splits a selector list without treating escaped commas or commas inside
 * functional selectors and attribute selectors as separators.
 */
function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (let index = 0; index < selectorText.length; index += 1) {
    const character = selectorText[index];

    if (character === "\\") {
      current += character;

      if (selectorText[index + 1] !== undefined) {
        current += selectorText[index + 1];
        index += 1;
      }

      continue;
    }

    if (quote) {
      current += character;

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    }

    if (character === "," && depth === 0) {
      if (current.trim()) {
        selectors.push(current.trim());
      }

      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    selectors.push(current.trim());
  }

  return selectors;
}

const DYNAMIC_PSEUDO_CLASS_RE =
  /:(?:active|any-link|checked|disabled|enabled|focus(?:-visible|-within)?|hover|indeterminate|link|open|popover-open|target|visited)\b/g;
const PSEUDO_ELEMENT_RE = /::[\w-]+(?:\([^)]*\))?/g;

function getAssociationSelector(selector: string): string {
  return selector
    .replace(PSEUDO_ELEMENT_RE, "")
    .replace(DYNAMIC_PSEUDO_CLASS_RE, "");
}

function resolveNestedSelectors({
  parentSelectors,
  selectorText,
}: {
  parentSelectors: string[];
  selectorText: string;
}): string[] {
  const selectors = splitSelectorList(selectorText);

  if (!parentSelectors.length) {
    return selectors;
  }

  return selectors.flatMap((selector) =>
    parentSelectors.map((parentSelector) =>
      selector.includes("&")
        ? selector.replaceAll("&", `:is(${parentSelector})`)
        : `:is(${parentSelector}) ${selector}`,
    ),
  );
}

function isInsideScopeLimit({
  el,
  root,
  limitSelector,
}: {
  el: Element;
  root: Element;
  limitSelector: string | null | undefined;
}): boolean {
  if (!limitSelector) return false;

  for (let current: Element | null = el; current && current !== root; ) {
    try {
      if (current.matches(limitSelector)) return true;
    } catch {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function getApplicableScopeRoots({
  el,
  rule,
  parentScopeRoots,
}: {
  el: Element;
  rule: CSSScopeRuleLike;
  parentScopeRoots: Element[] | null;
}): Element[] {
  const roots: Element[] = [];
  const candidates = parentScopeRoots ?? [el.ownerDocument.documentElement];

  if (!rule.start) {
    return candidates.filter(
      (root) => !isInsideScopeLimit({ el, root, limitSelector: rule.end }),
    );
  }

  for (let current: Element | null = el; current; current = current.parentElement) {
    if (!candidates.some((root) => root.contains(current))) continue;

    try {
      if (
        current.matches(rule.start) &&
        !isInsideScopeLimit({ el, root: current, limitSelector: rule.end })
      ) {
        roots.push(current);
      }
    } catch {
      return [];
    }
  }

  return roots;
}

function matchesSelector({
  el,
  selector,
  scopeRoots,
}: {
  el: Element;
  selector: string;
  scopeRoots: Element[] | null;
}): boolean {
  const associationSelector = getAssociationSelector(selector);

  try {
    if (!scopeRoots) return el.matches(associationSelector);

    return scopeRoots.some(
      (root) =>
        (root === el && root.matches(associationSelector)) ||
        Array.from(root.querySelectorAll(associationSelector)).includes(el),
    );
  } catch {
    return false;
  }
}

function getContainerConditions(
  rule: CSSContainerRuleLike,
): CSSContainerCondition[] {
  if (rule.conditions?.length) return Array.from(rule.conditions);

  return [
    {
      name: rule.containerName ?? "",
      query: rule.containerQuery ?? "",
    },
  ];
}

function hasApplicableQueryContainer({
  el,
  rule,
}: {
  el: Element;
  rule: CSSContainerRuleLike;
}): boolean {
  return getContainerConditions(rule).some(({ name, query }) => {
    const needsSizeContainer =
      !/^\s*(?:style|scroll-state)\s*\(/i.test(query);

    for (
      let container = el.parentElement;
      container;
      container = container.parentElement
    ) {
      const style = container.ownerDocument.defaultView?.getComputedStyle(container);
      if (!style) continue;

      const names = style.containerName.split(/\s+/).filter(Boolean);
      if (name && !names.includes(name)) continue;
      if (needsSizeContainer && style.containerType === "normal") continue;

      return true;
    }

    return false;
  });
}

function collectDeclarationRuleIfMatches({
  el,
  rule,
  selectors,
  context,
  sourceOrder,
}: {
  el: Element;
  rule: CSSRule & { style: CSSStyleDeclaration };
  selectors: string[];
  context: MatchingContext;
  sourceOrder: number;
}): CssRuleMatch[] {
  const matchingSelectors = selectors.filter((selector) =>
    matchesSelector({ el, selector, scopeRoots: context.scopeRoots }),
  );

  if (matchingSelectors.length === 0) {
    return [];
  }

  const rawCssText = rule.style.cssText;
  const baseUrl = getCssRuleBaseUrl(rule, el.ownerDocument.baseURI);

  return [
    {
      selectorText: matchingSelectors.join(", "),
      cssText: absolutizeCssUrls(rawCssText, baseUrl),
      rawCssText,
      baseUrl,
      sourceHref: rule.parentStyleSheet?.href ?? null,
      sourceOrder,
      wrapperPrefixes: [...context.wrapperPrefixes],
      specificity: Math.max(...matchingSelectors.map(calcSpecificity)),
    },
  ];
}

export function collectStyleRuleIfMatches({
  el,
  rule,
  context,
  sourceOrder = 0,
}: {
  el: Element;
  rule: CSSStyleRule;
  context: MatchingContext;
  sourceOrder?: number;
}): CssRuleMatch[] {
  return collectDeclarationRuleIfMatches({
    el,
    rule,
    selectors: resolveNestedSelectors({
      parentSelectors: context.parentSelectors,
      selectorText: rule.selectorText,
    }),
    context,
    sourceOrder,
  });
}

function collectMatchingCssRulesFromRuleList(
  el: Element,
  rules: CSSRuleList,
  context: MatchingContext,
  activeSheets: Set<CSSStyleSheet>,
  order: { value: number },
): CssRuleMatch[] {
  const matches: CssRuleMatch[] = [];

  for (const rule of Array.from(rules)) {
    const sourceOrder = order.value;
    order.value += 1;

    if (isImportRule(rule)) {
      const importedSheet = rule.styleSheet;
      const mediaText = rule.media?.mediaText ?? "";

      if (
        !importedSheet ||
        !shouldTraverseMedia(mediaText, el.ownerDocument) ||
        (rule.supportsText && !shouldTraverseSupports(rule.supportsText))
      ) {
        continue;
      }

      if (activeSheets.has(importedSheet)) {
        continue;
      }

      activeSheets.add(importedSheet);

      try {
        matches.push(
          ...collectMatchingCssRulesFromRuleList(
            el,
            importedSheet.cssRules,
            {
              ...context,
              wrapperPrefixes: [
                ...context.wrapperPrefixes,
                ...getImportWrapperPrefixes(rule),
              ],
            },
            activeSheets,
            order,
          ),
        );
      } catch {
        // Imported cross-origin stylesheets can still be inaccessible.
      } finally {
        activeSheets.delete(importedSheet);
      }

      continue;
    }

    if (isStyleRule(rule)) {
      const selectors = resolveNestedSelectors({
        parentSelectors: context.parentSelectors,
        selectorText: rule.selectorText,
      });
      matches.push(
        ...collectDeclarationRuleIfMatches({
          el,
          rule,
          selectors,
          context,
          sourceOrder,
        }),
      );

      if (isGroupingRule(rule)) {
        matches.push(
          ...collectMatchingCssRulesFromRuleList(
            el,
            rule.cssRules,
            { ...context, parentSelectors: selectors },
            activeSheets,
            order,
          ),
        );
      }

      continue;
    }

    if (isNestedDeclarationsRule(rule)) {
      matches.push(
        ...collectDeclarationRuleIfMatches({
          el,
          rule,
          selectors: context.parentSelectors,
          context,
          sourceOrder,
        }),
      );
      continue;
    }

    if (isMediaRule(rule)) {
      if (!shouldTraverseMedia(rule.conditionText, el.ownerDocument)) {
        continue;
      }

      matches.push(
        ...collectMatchingCssRulesFromRuleList(
          el,
          rule.cssRules,
          {
            ...context,
            wrapperPrefixes: [
              ...context.wrapperPrefixes,
              `@media ${rule.conditionText}`,
            ],
          },
          activeSheets,
          order,
        ),
      );

      continue;
    }

    if (isSupportsRule(rule)) {
      if (!shouldTraverseSupports(rule.conditionText)) {
        continue;
      }

      matches.push(
        ...collectMatchingCssRulesFromRuleList(
          el,
          rule.cssRules,
          {
            ...context,
            wrapperPrefixes: [
              ...context.wrapperPrefixes,
              `@supports ${rule.conditionText}`,
            ],
          },
          activeSheets,
          order,
        ),
      );

      continue;
    }

    if (isGroupingRule(rule)) {
      const groupingPrefix = getGroupingRulePrefix(rule);
      let scopeRoots = context.scopeRoots;

      if (isScopeRule(rule)) {
        scopeRoots = getApplicableScopeRoots({
          el,
          rule,
          parentScopeRoots: context.scopeRoots,
        });
        if (!scopeRoots.length) continue;
      }

      if (isContainerRule(rule) && !hasApplicableQueryContainer({ el, rule })) {
        continue;
      }

      matches.push(
        ...collectMatchingCssRulesFromRuleList(
          el,
          rule.cssRules,
          {
            ...context,
            scopeRoots,
            wrapperPrefixes: groupingPrefix
              ? [...context.wrapperPrefixes, groupingPrefix]
              : context.wrapperPrefixes,
          },
          activeSheets,
          order,
        ),
      );
    }
  }

  return matches;
}

export function getMatchingCssRulesFromRuleList(
  el: Element,
  rules: CSSRuleList,
  wrapperPrefixes: string[] = [],
): CssRuleMatch[] {
  return collectMatchingCssRulesFromRuleList(
    el,
    rules,
    { parentSelectors: [], scopeRoots: null, wrapperPrefixes },
    new Set<CSSStyleSheet>(),
    { value: 0 },
  );
}

export function getMatchingCssRules(el: Element): CssRuleMatch[] {
  const matches: CssRuleMatch[] = [];
  const order = { value: 0 };

  for (const sheet of Array.from(el.ownerDocument.styleSheets)) {
    try {
      matches.push(
        ...collectMatchingCssRulesFromRuleList(
          el,
          sheet.cssRules,
          { parentSelectors: [], scopeRoots: null, wrapperPrefixes: [] },
          new Set([sheet]),
          order,
        ),
      );
    } catch {
      // Cross-origin stylesheets can throw when accessing cssRules.
    }
  }

  return matches;
}

function walkRuleList(
  rules: CSSRuleList,
  wrapperPrefixes: string[],
  activeSheets: Set<CSSStyleSheet>,
  onRule: (rule: CSSRule, wrapperPrefixes: string[]) => void,
): void {
  for (const rule of Array.from(rules)) {
    if (isImportRule(rule)) {
      const importedSheet = rule.styleSheet;
      const mediaText = rule.media?.mediaText ?? "";

      if (
        !importedSheet ||
        !shouldTraverseMedia(mediaText) ||
        (rule.supportsText && !shouldTraverseSupports(rule.supportsText)) ||
        activeSheets.has(importedSheet)
      ) {
        continue;
      }

      activeSheets.add(importedSheet);

      try {
        walkRuleList(
          importedSheet.cssRules,
          [...wrapperPrefixes, ...getImportWrapperPrefixes(rule)],
          activeSheets,
          onRule,
        );
      } catch {
        // Imported cross-origin stylesheets can be inaccessible.
      } finally {
        activeSheets.delete(importedSheet);
      }

      continue;
    }

    onRule(rule, wrapperPrefixes);

    if (!isGroupingRule(rule) || isKeyframesRule(rule)) {
      continue;
    }

    if (isMediaRule(rule) && !shouldTraverseMedia(rule.conditionText)) {
      continue;
    }

    if (isSupportsRule(rule) && !shouldTraverseSupports(rule.conditionText)) {
      continue;
    }

    const prefix = getGroupingRulePrefix(rule);

    walkRuleList(
      rule.cssRules,
      prefix ? [...wrapperPrefixes, prefix] : wrapperPrefixes,
      activeSheets,
      onRule,
    );
  }
}

function walkAccessibleStyleSheets(
  ownerDocument: Document,
  onRule: (rule: CSSRule, wrapperPrefixes: string[]) => void,
): void {
  for (const sheet of Array.from(ownerDocument.styleSheets)) {
    try {
      walkRuleList(sheet.cssRules, [], new Set([sheet]), onRule);
    } catch {
      // Cross-origin stylesheets can throw when accessing cssRules.
    }
  }
}

/**
 * Returns only the @property registrations required by referenced custom
 * properties. Copying every framework registration adds substantial noise to
 * otherwise small component previews.
 */
export function getCssPropertyRulesByNames(
  names: Iterable<string>,
  ownerDocument: Document = document,
): CssPropertyRuleMatch[] {
  const wantedNames = new Set(names);
  const matches: CssPropertyRuleMatch[] = [];
  const seen = new Set<string>();

  if (!wantedNames.size) {
    return matches;
  }

  walkAccessibleStyleSheets(ownerDocument, (rule, wrapperPrefixes) => {
    if (!isPropertyRule(rule)) {
      return;
    }

    const name = rule.cssText.match(/^@property\s+(--[^\s{]+)/i)?.[1];

    if (!name || !wantedNames.has(name)) {
      return;
    }

    const key = `${wrapperPrefixes.join("|||")}|||${rule.cssText}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    matches.push({ name, cssText: rule.cssText, wrapperPrefixes });
  });

  return matches;
}

/**
 * Returns accessible @keyframes rules referenced by the inspected content.
 * Asset URLs inside keyframes are rewritten against the owning stylesheet.
 */
export function getKeyframesRulesByNames(
  names: Iterable<string>,
  ownerDocument: Document = document,
): CssKeyframesMatch[] {
  const wantedNames = new Set(
    Array.from(names)
      .map((name) => name.trim())
      .filter(Boolean),
  );

  if (wantedNames.size === 0) {
    return [];
  }

  const matches: CssKeyframesMatch[] = [];

  walkAccessibleStyleSheets(ownerDocument, (rule, wrapperPrefixes) => {
    if (!isKeyframesRule(rule)) {
      return;
    }

    const name = getKeyframesName(rule);

    if (!name || !wantedNames.has(name)) {
      return;
    }

    const baseUrl = getCssRuleBaseUrl(rule, ownerDocument.baseURI);

    matches.push({
      name,
      cssText: absolutizeCssUrls(rule.cssText, baseUrl),
      wrapperPrefixes: [...wrapperPrefixes],
      baseUrl,
      sourceHref: rule.parentStyleSheet?.href ?? null,
    });
  });

  const seen = new Set<string>();

  return matches.filter((match) => {
    const key = `${match.wrapperPrefixes.join("|||")}|||${match.cssText}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * Returns accessible @font-face rules used by the inspected content.
 * Font src URLs are emitted as full absolute URLs.
 */
export function getFontFaceRulesByFamilies(
  families: Iterable<string>,
  ownerDocument: Document = document,
): CssFontFaceMatch[] {
  const wantedFamilies = new Set(
    Array.from(families)
      .map(normalizeFamilyName)
      .filter(Boolean),
  );

  if (wantedFamilies.size === 0) {
    return [];
  }

  const matches: CssFontFaceMatch[] = [];

  walkAccessibleStyleSheets(ownerDocument, (rule, wrapperPrefixes) => {
    if (!isFontFaceRule(rule)) {
      return;
    }

    const family = getFontFaceFamily(rule);

    if (!family || !wantedFamilies.has(family)) {
      return;
    }

    const baseUrl = getCssRuleBaseUrl(rule, ownerDocument.baseURI);

    matches.push({
      family,
      cssText: absolutizeCssUrls(rule.cssText, baseUrl),
      wrapperPrefixes: [...wrapperPrefixes],
      baseUrl,
      sourceHref: rule.parentStyleSheet?.href ?? null,
    });
  });

  const seen = new Set<string>();

  return matches.filter((match) => {
    const key = `${match.wrapperPrefixes.join("|||")}|||${match.cssText}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

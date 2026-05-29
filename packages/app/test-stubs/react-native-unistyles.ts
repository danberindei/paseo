import { createElement, type ElementType } from "react";
import { lightTheme } from "@/styles/theme";

const testTheme = lightTheme;

type StyleFactory<T> = (theme: typeof testTheme) => T;

function isStyleFactory<T>(styles: T | StyleFactory<T>): styles is StyleFactory<T> {
  return typeof styles === "function";
}

// The app's breakpoints (src/styles/unistyles.ts), widest first.
const BREAKPOINTS: [string, number][] = [
  ["xl", 1200],
  ["lg", 992],
  ["md", 600],
  ["sm", 576],
  ["xs", 0],
];
const BREAKPOINT_NAMES = new Set(BREAKPOINTS.map(([name]) => name));

function isBreakpointValue(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => BREAKPOINT_NAMES.has(key));
}

/** Picks a breakpoint value for the window's width, the way Unistyles does at runtime. */
function resolveBreakpointValue(value: Record<string, unknown>): unknown {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  for (const [name, minWidth] of BREAKPOINTS) {
    if (width >= minWidth && name in value) return value[name];
  }
  return undefined;
}

function resolveStyle(style: unknown): unknown {
  if (typeof style === "function") {
    return (...args: unknown[]) => resolveStyle(style(...args));
  }
  if (typeof style !== "object" || style === null || Array.isArray(style)) return style;
  return Object.fromEntries(
    Object.entries(style).map(([key, value]) => [
      key,
      isBreakpointValue(value) ? resolveBreakpointValue(value) : value,
    ]),
  );
}

function resolveStyles<T>(styles: T): T {
  if (typeof styles !== "object" || styles === null) return styles;
  return Object.fromEntries(
    Object.entries(styles).map(([name, style]) => [name, resolveStyle(style)]),
  ) as T;
}

export const StyleSheet = {
  create: <T>(styles: T | StyleFactory<T>): T =>
    resolveStyles(isStyleFactory(styles) ? styles(testTheme) : styles),
};

type UniPropsMapping = (theme: typeof testTheme, runtime: object) => Record<string, unknown>;

/**
 * Applies the theme mapping and `uniProps` with the test theme, the way Unistyles maps theme values
 * onto props: mapped props first, then `uniProps`, then the props the caller passed.
 */
export const withUnistyles = <T>(Component: T, mapping?: UniPropsMapping): T => {
  function ThemedComponent({ uniProps, ...props }: { uniProps?: UniPropsMapping }) {
    // Explicit props win over mapped ones, as in Unistyles' `deepMergeObjects(mappings, uniProps, props)`.
    return createElement(Component as ElementType, {
      ...mapping?.(testTheme, {}),
      ...uniProps?.(testTheme, {}),
      ...props,
    });
  }
  return ThemedComponent as T;
};

export const useUnistyles = () => ({
  theme: testTheme,
  rt: {},
  breakpoint: undefined,
});

export const UnistylesRuntime = {
  setTheme: () => undefined,
  themeName: "light",
};

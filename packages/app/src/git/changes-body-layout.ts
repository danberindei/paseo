export type ChangesPresentation = "combined" | "tree" | "diff";

export function resolveChangesBodyLayout(presentation: ChangesPresentation): "direct" | "split" {
  return presentation === "diff" ? "direct" : "split";
}

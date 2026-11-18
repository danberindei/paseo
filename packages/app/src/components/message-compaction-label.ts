import { i18n } from "@/i18n/i18next";

export interface CompactionMarkerLabelInput {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
  error?: string | null;
}

export function getCompactionMarkerLabel({
  status,
  trigger,
  preTokens,
  error,
}: CompactionMarkerLabelInput): string {
  if (status === "loading") return i18n.t("message.compaction.loading");
  if (error != null) return i18n.t("message.compaction.failed");
  if (trigger === "auto") return i18n.t("message.compaction.auto");
  if (trigger === "manual") return i18n.t("message.compaction.manual");
  if (preTokens) {
    return i18n.t("message.compaction.withTokens", {
      tokens: Math.round(preTokens / 1000),
    });
  }
  return i18n.t("message.compaction.completed");
}

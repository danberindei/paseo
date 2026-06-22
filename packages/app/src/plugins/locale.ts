import { useTranslation } from "react-i18next";

export function useLocale(): string {
  return useTranslation().i18n.language;
}

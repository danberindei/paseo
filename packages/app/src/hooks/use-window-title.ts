import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
import { formatWindowTitle, type WindowTitleInput } from "@/utils/window-title";

export function useWindowTitle(input: WindowTitleInput) {
  const title = formatWindowTitle(input);
  useEffect(() => {
    if (isWeb) {
      document.title = title;
    }
  }, [title]);
}

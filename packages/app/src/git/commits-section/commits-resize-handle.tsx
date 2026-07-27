import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { isWeb } from "@/constants/platform";
import { computeCommitsSplitRatio } from "./commits-split";

interface CommitsResizeHandleProps {
  ratio: number;
  containerHeight: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: (ratio: number) => void;
}

const HIT_AREA_WEB_STYLE = isWeb ? ({ cursor: "row-resize", touchAction: "none" } as object) : null;

export function CommitsResizeHandle({
  ratio,
  containerHeight,
  onRatioChange,
  onRatioCommit,
}: CommitsResizeHandleProps) {
  const { t } = useTranslation();
  const startRatioRef = useRef(ratio);
  const latestRatioRef = useRef(ratio);
  const [dragging, setDragging] = useState(false);

  const handleBegin = useCallback(() => {
    startRatioRef.current = ratio;
    latestRatioRef.current = ratio;
    setDragging(true);
  }, [ratio]);

  const handleUpdate = useCallback(
    (translationY: number) => {
      const next = computeCommitsSplitRatio({
        startRatio: startRatioRef.current,
        translationY,
        containerHeight,
      });
      latestRatioRef.current = next;
      onRatioChange(next);
    },
    [containerHeight, onRatioChange],
  );

  const handleFinalize = useCallback(() => {
    setDragging(false);
    onRatioCommit(latestRatioRef.current);
  }, [onRatioCommit]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin(handleBegin)
        .onUpdate((event) => handleUpdate(event.translationY))
        .onFinalize(handleFinalize),
    [handleBegin, handleFinalize, handleUpdate],
  );

  const hitAreaStyle = useMemo(() => [styles.hitArea, HIT_AREA_WEB_STYLE], []);

  return (
    <View style={styles.handle}>
      {dragging ? <View pointerEvents="none" style={styles.highlight} /> : null}
      <GestureDetector gesture={gesture}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={t("workspace.git.diff.commits.resizeHandle")}
          testID="commits-section-resize-handle"
          style={hitAreaStyle}
        />
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  handle: {
    position: "relative",
    height: theme.borderWidth[1],
    width: "100%",
    flexShrink: 0,
    backgroundColor: theme.colors.border,
  },
  highlight: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -1,
    height: 3,
    zIndex: 5,
    backgroundColor: theme.colors.accent,
  },
  hitArea: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -5,
    height: 11,
    zIndex: 10,
  },
}));

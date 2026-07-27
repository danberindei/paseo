import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCheckoutCommitsCapability } from "@/git/use-commits-query";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { clampCommitsSplitRatio } from "./commits-split";
import { CommitsResizeHandle } from "./commits-resize-handle";
import { CommitsSection } from "./commits-section";

interface ChangesCommitsSplitProps {
  serverId: string;
  cwd: string;
  onCommitPress: (sha: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  ratio: number;
  onRatioCommit: (ratio: number) => void;
  /** The changes list, rendered in the upper pane. */
  children: ReactNode;
}

export function ChangesCommitsSplit({
  serverId,
  cwd,
  onCommitPress,
  collapsed,
  onCollapsedChange,
  ratio: committedRatio,
  onRatioCommit,
  children,
}: ChangesCommitsSplitProps) {
  const commitsSupported = useCheckoutCommitsCapability(serverId);
  const splitEnabled = commitsSupported && !collapsed;
  const [stackHeight, setStackHeight] = useState(0);
  const [draggedRatio, setDraggedRatio] = useState<number | null>(null);
  const ratio = draggedRatio ?? clampCommitsSplitRatio(committedRatio);

  const handleStackLayout = useCallback((event: LayoutChangeEvent) => {
    setStackHeight(event.nativeEvent.layout.height);
  }, []);

  const handleRatioCommit = useCallback(
    (nextRatio: number) => {
      onRatioCommit(clampCommitsSplitRatio(nextRatio));
      setDraggedRatio(null);
    },
    [onRatioCommit],
  );

  const changesPaneStyle = useMemo(
    () =>
      splitEnabled
        ? [styles.changesPane, styles.splitPane, inlineUnistylesStyle({ flexGrow: 1 - ratio })]
        : styles.changesPane,
    [ratio, splitEnabled],
  );
  const commitsPaneStyle = useMemo(
    () =>
      splitEnabled
        ? [styles.splitPane, styles.commitsSplitPane, inlineUnistylesStyle({ flexGrow: ratio })]
        : undefined,
    [ratio, splitEnabled],
  );

  return (
    <View style={styles.stack} onLayout={handleStackLayout}>
      <View style={changesPaneStyle}>{children}</View>

      {splitEnabled ? (
        <CommitsResizeHandle
          ratio={ratio}
          containerHeight={stackHeight}
          onRatioChange={setDraggedRatio}
          onRatioCommit={handleRatioCommit}
        />
      ) : null}

      <CommitsSection
        serverId={serverId}
        cwd={cwd}
        onCommitPress={onCommitPress}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        style={commitsPaneStyle}
      />
    </View>
  );
}

const styles = StyleSheet.create((_theme) => ({
  stack: {
    flex: 1,
    minHeight: 0,
  },
  changesPane: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  splitPane: {
    flexBasis: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  commitsSplitPane: {
    // The resize handle already draws the divider above the commits header.
    borderTopWidth: 0,
  },
}));

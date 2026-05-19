import {
  BottomSheetModal as GorhomBottomSheetModal,
  type BottomSheetModalProps,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDismissibleOverlay } from "@/components/ui/overlay-dismissal";
import type { ElementRef, ReactNode } from "react";
import { systemBackPress } from "./back-press";
import {
  type BottomSheetController,
  createBottomSheetVisibilityTracker,
} from "./visibility-tracker";
import {
  BottomSheetScope,
  type AttachSheetContentDrag,
  type SheetContentDragGesture,
} from "@/components/ui/bottom-sheet-scope";
import { usePresentationRegistration } from "@/keyboard";
import { OverlayLayerProvider, useGlobalOverlayLayer } from "@/lib/overlay-root";
import { SheetBackdrop } from "./sheet-backdrop";

type GorhomBottomSheetModalMethods = ElementRef<typeof GorhomBottomSheetModal>;

/**
 * Re-establishes React context on the far side of the portal.
 *
 * `@gorhom/portal` is not a React portal. It stores the element and a host elsewhere in the tree
 * renders it, so context resolves at the *host's* position: everything provided between
 * `PortalProvider` (see `app/_layout.tsx`) and this sheet is invisible to its content. React
 * cannot copy contexts reflectively, so the only way across is to render the providers again —
 * with values captured out here, where they are still readable.
 *
 * Write it as a closure over what you already have:
 *
 * ```tsx
 * const contextBridge = useCallback<ContextBridge>(
 *   (content) => <ThingContext.Provider value={thing}>{content}</ThingContext.Provider>,
 *   [thing],
 * );
 * ```
 */
export type ContextBridge = (children: ReactNode) => ReactNode;

type IsolatedBottomSheetModalProps = Omit<
  BottomSheetModalProps,
  "enableDismissOnClose" | "stackBehavior" | "children" | "backdropComponent"
> & {
  /**
   * Whether closing (drag, backdrop, Back) also dismisses, which unmounts the content. Default
   * true: the owner hears `onDismiss` and drops its state. Pass `false` for a sheet whose close the
   * owner may veto: it parks at index -1 with its content mounted, the owner hears `onChange(-1)`,
   * and either snaps it back or unmounts it, which dismisses it from the stack.
   */
  enableDismissOnClose?: boolean;
  /**
   * Nodes only. Gorhom also accepts a render function, but nothing here uses it and a bridge
   * would have to reach around it.
   */
  children?: ReactNode;
  presentation?: "push" | "replace";
  /** Show a dismissible backdrop. Its interaction belongs to the modal stack. */
  backdropOpacity?: number;
  /**
   * Required, and `null` is a real answer: a sheet that needs nothing from its call site should
   * have to say so. The failure it prevents is invisible until someone adds a `useContext` deep
   * inside the sheet and it throws on device only.
   */
  contextBridge: ContextBridge | null;
  /**
   * Which workspace and pane this sheet covers. A workspace sheet names the tab it hosts so that
   * tab's permission card can answer shortcuts; a sheet with no hosted tab blocks the panes under
   * it.
   */
  presentationScope?: {
    workspaceKey: string | null;
    hostedTabId?: string | null;
  };
};

export type IsolatedBottomSheetModalRef = GorhomBottomSheetModalMethods;

export const IsolatedBottomSheetModal = forwardRef<
  IsolatedBottomSheetModalRef,
  IsolatedBottomSheetModalProps
>(function IsolatedBottomSheetModal(props, ref) {
  // Gorhom puts this ref into its provider queue and reads `.current` for stack operations.
  // A callback ref accepts the handle but leaves that queue unable to dismiss or restore it.
  const modalRef = useRef<GorhomBottomSheetModalMethods>(null);
  const {
    children,
    presentation = "push",
    contextBridge,
    presentationScope,
    backdropOpacity,
    enableDismissOnClose = true,
    waitFor,
    simultaneousHandlers,
    onChange,
    onDismiss,
    ...bottomSheetProps
  } = props;
  // State, not a ref the child fills in: Gorhom builds its pan once per `waitFor`, and RNGH reads
  // the ref's handler tag only then. Registering hands Gorhom a new `waitFor`, so a drag that
  // mounts after the sheet (content still loading) still gets the relation.
  const [contentDragGesture, setContentDragGesture] = useState<SheetContentDragGesture>();
  const attachContentDrag = useCallback<AttachSheetContentDrag>((gesture) => {
    setContentDragGesture(gesture);
    return () => setContentDragGesture((current) => (current === gesture ? undefined : current));
  }, []);
  // RNGH Android's shouldBeCancelledByActiveHandler treats a waiting ancestor's raw ACTIVE
  // state as ownership and cancels its child at activation. Simultaneity lets the child activate;
  // waitFor still keeps the sheet stationary until the child fails.
  const contentDragHandlers = useMemo(() => {
    if (!contentDragGesture) return { waitFor, simultaneousHandlers };
    return {
      waitFor: [...(waitFor ? [waitFor].flat() : []), contentDragGesture],
      simultaneousHandlers: [
        ...(simultaneousHandlers ? [simultaneousHandlers].flat() : []),
        contentDragGesture,
      ],
    };
  }, [contentDragGesture, waitFor, simultaneousHandlers]);
  // A sheet is presented through the ref (or reports its first snap) and stays registered until
  // Gorhom actually unmounts it. `onChange(-1)` alone is not a dismissal: a vetoed close parks
  // the sheet at -1 and can bring it back.
  const [isPresented, setIsPresented] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const presentationLayer = useGlobalOverlayLayer("modal", isPresented);
  usePresentationRegistration({
    active: isPresented,
    layer: presentationLayer,
    workspaceKey: presentationScope?.workspaceKey ?? null,
    hostedTabId: presentationScope?.hostedTabId ?? null,
  });
  const markPresented = useCallback(() => {
    if (mountedRef.current) setIsPresented(true);
  }, []);
  const handleSheetChange = useCallback(
    (...args: Parameters<NonNullable<BottomSheetModalProps["onChange"]>>) => {
      if (args[0] >= 0) markPresented();
      onChange?.(...args);
    },
    [markPresented, onChange],
  );
  const handleSheetDismiss = useCallback(() => {
    if (mountedRef.current) setIsPresented(false);
    onDismiss?.();
  }, [onDismiss]);
  useImperativeHandle(
    ref,
    () => ({
      present: (...args) => {
        markPresented();
        modalRef.current?.present(...args);
      },
      dismiss: (...args) => modalRef.current?.dismiss(...args),
      snapToIndex: (...args) => {
        markPresented();
        modalRef.current?.snapToIndex(...args);
      },
      snapToPosition: (...args) => modalRef.current?.snapToPosition(...args),
      expand: (...args) => {
        markPresented();
        modalRef.current?.expand(...args);
      },
      collapse: (...args) => modalRef.current?.collapse(...args),
      close: (...args) => modalRef.current?.close(...args),
      forceClose: (...args) => modalRef.current?.forceClose(...args),
    }),
    [markPresented],
  );
  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <SheetBackdrop
        {...backdropProps}
        opacity={backdropOpacity}
        pressBehavior={enableDismissOnClose ? "dismiss" : "close"}
      />
    ),
    [backdropOpacity, enableDismissOnClose],
  );
  const modal = (
    <GorhomBottomSheetModal
      {...bottomSheetProps}
      ref={modalRef}
      enableDismissOnClose={enableDismissOnClose}
      stackBehavior={presentation}
      onChange={handleSheetChange}
      onDismiss={handleSheetDismiss}
      backdropComponent={backdropOpacity === undefined ? undefined : renderBackdrop}
      waitFor={contentDragHandlers.waitFor}
      simultaneousHandlers={contentDragHandlers.simultaneousHandlers}
    >
      <BottomSheetScope attachContentDrag={attachContentDrag}>
        <OverlayLayerProvider layer={presentationLayer}>
          {contextBridge ? contextBridge(children) : children}
        </OverlayLayerProvider>
      </BottomSheetScope>
    </GorhomBottomSheetModal>
  );

  return modal;
});

export function useIsolatedBottomSheetVisibility({
  visible,
  isEnabled,
  onClose,
  onBack,
}: {
  visible: boolean;
  isEnabled?: boolean;
  onClose: () => void;
  /** Offered Android Back before it closes the sheet; returns true when it handled the press. */
  onBack?: () => boolean;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const tracker = useMemo(
    () =>
      createBottomSheetVisibilityTracker({
        onClose: () => onCloseRef.current(),
        backPress: systemBackPress,
        onBack: () => onBackRef.current?.() ?? false,
      }),
    [],
  );

  const setSheetRef = useCallback(
    (instance: IsolatedBottomSheetModalRef | null) => {
      tracker.attachController(instance as BottomSheetController | null);
    },
    [tracker],
  );

  const handleSheetChange = useCallback(
    (index: number) => tracker.handleSheetIndexChange(index),
    [tracker],
  );

  const handleSheetDismiss = useCallback(() => tracker.handleSheetDismiss(), [tracker]);

  useEffect(() => {
    tracker.syncDesired({ visible, isEnabled });
  }, [isEnabled, tracker, visible]);
  useDismissibleOverlay(visible && isEnabled !== false, onClose);

  return {
    sheetRef: setSheetRef,
    handleSheetChange,
    handleSheetDismiss,
  };
}

export { SheetVisibleFrame } from "./visible-frame";
export { systemBackPress } from "./back-press";
export { SheetHostScope } from "./host-scope";

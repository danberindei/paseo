import { useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getIdleMessage, IDLE_MESSAGE_LABEL } from "@getpaseo/protocol/agent-labels";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export interface UseAgentIdleMessageToggleInput {
  serverId: string;
  agentId: string;
}

export interface UseAgentIdleMessageToggleResult {
  isEnabled: boolean;
  isPending: boolean;
  selectedMessage: string | null;
  selectMessage: (message: string) => void;
  disable: () => void;
}

export function useAgentIdleMessageToggle(
  input: UseAgentIdleMessageToggleInput,
): UseAgentIdleMessageToggleResult {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(input.serverId);
  const selectedMessage = useSessionStore(
    useCallback(
      (state) => {
        const agent = state.sessions[input.serverId]?.agents.get(input.agentId);
        return getIdleMessage(agent?.labels);
      },
      [input.serverId, input.agentId],
    ),
  );
  const isEnabled = selectedMessage !== null;

  const mutation = useMutation({
    mutationFn: async (message: string | null) => {
      if (!client) {
        throw new Error(t("composer.idleMessages.hostDisconnected"));
      }
      await client.updateAgent(input.agentId, {
        labels: { [IDLE_MESSAGE_LABEL]: message },
      });
    },
  });

  const selectMessage = useCallback(
    (message: string) => {
      mutation.mutate(message);
    },
    [mutation],
  );

  const disable = useCallback(() => {
    mutation.mutate(null);
  }, [mutation]);

  return useMemo(
    () => ({
      isEnabled,
      isPending: mutation.isPending,
      selectedMessage,
      selectMessage,
      disable,
    }),
    [isEnabled, mutation.isPending, selectedMessage, selectMessage, disable],
  );
}

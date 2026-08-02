import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlarmClock, AlarmClockOff } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgentIdleMessageToggle } from "@/hooks/use-agent-idle-message-toggle";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";

const ThemedAlarmClock = withUnistyles(AlarmClock, (theme: Theme) => ({
  color: theme.colors.foreground,
  size: ICON_SIZE.md,
}));

const ThemedAlarmClockOff = withUnistyles(AlarmClockOff, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: ICON_SIZE.md,
}));

interface AgentIdleMessageToggleProps {
  serverId: string;
  agentId: string;
}

export function AgentIdleMessageToggle({ serverId, agentId }: AgentIdleMessageToggleProps) {
  const { t } = useTranslation();
  const supportsIdleMessage = useHostFeature(serverId, "idleMessages");
  const { config } = useDaemonConfig(serverId);
  const { isEnabled, isPending, selectedMessage, selectMessage, disable } =
    useAgentIdleMessageToggle({
      serverId,
      agentId,
    });

  const messages = useMemo(() => config?.idleMessages?.messages ?? [], [config?.idleMessages]);
  const selectHandlers = useMemo(
    () => new Map(messages.map((message) => [message, () => selectMessage(message)])),
    [messages, selectMessage],
  );

  if (!supportsIdleMessage) {
    return null;
  }

  const icon = isEnabled ? <ThemedAlarmClock /> : <ThemedAlarmClockOff />;
  const label = isEnabled ? t("composer.idleMessages.disable") : t("composer.idleMessages.enable");

  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerSlot} collapsable={false}>
            <DropdownMenuTrigger
              disabled={isPending}
              accessibilityLabel={label}
              accessibilityRole="button"
              style={styles.button}
            >
              {icon}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{label}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" minWidth={220} side="bottom">
        {messages.map((message) => (
          <DropdownMenuItem
            key={message}
            selected={selectedMessage === message}
            onSelect={selectHandlers.get(message)}
          >
            {message}
          </DropdownMenuItem>
        ))}
        {isEnabled ? (
          <>
            {messages.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={disable}>
              {t("composer.idleMessages.disable")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  triggerSlot: {
    alignSelf: "center",
  },
  button: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));

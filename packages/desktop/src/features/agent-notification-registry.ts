export function deleteAgentNotificationIfCurrent<T>(
  notificationsByAgentId: Map<string, T>,
  agentId: string,
  notification: T,
): void {
  if (notificationsByAgentId.get(agentId) === notification) {
    notificationsByAgentId.delete(agentId);
  }
}

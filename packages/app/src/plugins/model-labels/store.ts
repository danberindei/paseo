import { PluginModelLabelColorStore } from "./model";

export const pluginModelLabelColorStore = new PluginModelLabelColorStore((pluginId, error) => {
  console.warn(`[Plugins] Model label color failed for ${pluginId}`, error);
});

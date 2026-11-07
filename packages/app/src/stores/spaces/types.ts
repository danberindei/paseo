import { z } from "zod";

export const SpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectIds: z.array(z.string()),
});

export type Space = z.infer<typeof SpaceSchema>;

export const SpaceSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  spaces: z.array(SpaceSchema),
});

export type SpaceSnapshot = z.infer<typeof SpaceSnapshotSchema>;
export type SpaceMutation = (spaces: Space[]) => Space[];

export interface SpaceStorage {
  read(): Promise<SpaceSnapshot | null>;
  initialize(spaces: Space[]): Promise<SpaceSnapshot>;
  mutate(mutation: SpaceMutation): Promise<SpaceSnapshot>;
}

export class SpaceStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpaceStorageError";
  }
}

export function normalizeName(name: string): string {
  return name.trim() || "New space";
}

const LegacySpaceSchema = z.object({
  id: z.string().trim().min(1),
  name: z.unknown().optional(),
  projectIds: z.unknown().optional(),
  projectKeys: z.unknown().optional(),
});

export function readLegacySpaces(raw: string | null): Space[] {
  if (raw === null) return [];
  const persisted = z
    .object({ state: z.object({ spaces: z.array(z.unknown()) }) })
    .parse(JSON.parse(raw));
  const spaces: Space[] = [];
  const seen = new Set<string>();
  for (const entry of persisted.state.spaces) {
    const parsed = LegacySpaceSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    const space = parsed.data;
    const persistedIds = space.projectIds ?? space.projectKeys;
    const ids: unknown[] = Array.isArray(persistedIds) ? persistedIds : [];
    const strings = ids.filter((id): id is string => typeof id === "string");
    const projectIds = strings.map((id) => id.trim()).filter(Boolean);
    const name = typeof space.name === "string" ? space.name : "";
    spaces.push({ id: space.id, name: normalizeName(name), projectIds: [...new Set(projectIds)] });
    seen.add(space.id);
  }
  return spaces;
}

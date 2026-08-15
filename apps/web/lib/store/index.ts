import { getDataBackend } from "../backend";
import { LocalCollectionStore } from "./local";
import { SupabaseCollectionStore } from "./supabase";
import type { CollectionStore } from "./types";

let cachedStore: CollectionStore | null = null;
let loggedBackend = false;

export function getCollectionStore(): CollectionStore {
  const backend = getDataBackend();

  if (!cachedStore || cachedStore.backend !== backend) {
    cachedStore = backend === "local" ? new LocalCollectionStore() : new SupabaseCollectionStore();
  }

  if (!loggedBackend) {
    loggedBackend = true;
    console.log(`[bonsai] data backend: ${backend}`);
  }

  return cachedStore;
}

export * from "./types";

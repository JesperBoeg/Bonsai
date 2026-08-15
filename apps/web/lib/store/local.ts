import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUserDataDirectory } from "../storage-paths";
import type {
  CollectionStore,
  CreateTreeInput,
  PhotoRecord,
  StoreViewer,
  SubmissionRecord,
  TargetStateRecord,
  TreeRecord,
} from "./types";

// Self-contained file-backed store: one JSON document per user plus photo files
// on disk. Used for development, demos, and offline deployments. All writes are
// serialized through an in-process queue (single-instance semantics, same as the
// deployed Render topology).

type LocalStoreDocument = {
  trees: TreeRecord[];
  photos: PhotoRecord[];
  captureSubmissions: SubmissionRecord[];
  targetStates: TargetStateRecord[];
  sequenceCounters: Record<string, number>;
};

let writeQueue = Promise.resolve();

function withStoreLock<T>(callback: () => Promise<T>): Promise<T> {
  const operation = writeQueue.then(callback, callback);
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function getStorePath(viewer: StoreViewer) {
  return path.join(getUserDataDirectory(viewer.id), "bonsai-store.json");
}

function emptyDocument(): LocalStoreDocument {
  return { trees: [], photos: [], captureSubmissions: [], targetStates: [], sequenceCounters: {} };
}

async function readDocument(viewer: StoreViewer): Promise<LocalStoreDocument> {
  try {
    const raw = await readFile(getStorePath(viewer), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalStoreDocument>;

    return {
      trees: Array.isArray(parsed.trees) ? parsed.trees : [],
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
      captureSubmissions: Array.isArray(parsed.captureSubmissions) ? parsed.captureSubmissions : [],
      targetStates: Array.isArray(parsed.targetStates) ? parsed.targetStates : [],
      sequenceCounters:
        parsed.sequenceCounters && typeof parsed.sequenceCounters === "object" ? parsed.sequenceCounters : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyDocument();
    }

    throw error;
  }
}

async function writeDocument(viewer: StoreViewer, document: LocalStoreDocument) {
  await mkdir(getUserDataDirectory(viewer.id), { recursive: true });
  const storePath = getStorePath(viewer);
  const tempPath = `${storePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(document, null, 2), "utf8");
  await rename(tempPath, storePath);
}

async function mutate<T>(viewer: StoreViewer, callback: (document: LocalStoreDocument) => T | Promise<T>): Promise<T> {
  return withStoreLock(async () => {
    const document = await readDocument(viewer);
    const result = await callback(document);
    await writeDocument(viewer, document);
    return result;
  });
}

function counterKey(speciesId: number, styleId: number) {
  return `${speciesId}:${styleId}`;
}

export class LocalCollectionStore implements CollectionStore {
  readonly backend = "local" as const;

  async listTrees(viewer: StoreViewer): Promise<TreeRecord[]> {
    const document = await readDocument(viewer);
    return document.trees;
  }

  async getTree(viewer: StoreViewer, treeId: string): Promise<TreeRecord | null> {
    const document = await readDocument(viewer);
    return document.trees.find((tree) => tree.id === treeId) ?? null;
  }

  async createTree(viewer: StoreViewer, input: CreateTreeInput): Promise<TreeRecord> {
    return mutate(viewer, (document) => {
      const key = counterKey(input.speciesId, input.styleId);
      const highestExisting = document.trees
        .filter((tree) => tree.speciesId === input.speciesId && tree.styleId === input.styleId)
        .reduce((highest, tree) => Math.max(highest, tree.sequenceNumber), 0);
      const sequenceNumber = Math.max(document.sequenceCounters[key] ?? 0, highestExisting) + 1;
      document.sequenceCounters[key] = sequenceNumber;

      const tree: TreeRecord = {
        id: crypto.randomUUID(),
        ownerId: viewer.id,
        speciesId: input.speciesId,
        styleId: input.styleId,
        sequenceNumber,
        inventoryName: input.inventoryName,
        createdAt: input.createdAt,
        developmentPlan: null,
      };
      document.trees.push(tree);
      return tree;
    });
  }

  async updateTreePlan(viewer: StoreViewer, treeId: string, developmentPlan: string | null): Promise<void> {
    await mutate(viewer, (document) => {
      const tree = document.trees.find((entry) => entry.id === treeId);

      if (!tree) {
        throw new Error("Tree not found.");
      }

      tree.developmentPlan = developmentPlan;
    });
  }

  async deleteTree(viewer: StoreViewer, treeId: string): Promise<string[]> {
    return mutate(viewer, (document) => {
      const photos = document.photos.filter((photo) => photo.treeId === treeId);
      const submissionIds = new Set(
        photos.map((photo) => photo.captureSubmissionId).filter((entry): entry is string => entry !== null),
      );
      const targetStates = document.targetStates.filter((target) => target.treeId === treeId);
      const storagePaths = [
        ...new Set([
          ...photos.map((photo) => photo.storagePath),
          ...document.captureSubmissions
            .filter((submission) => submissionIds.has(submission.id) && submission.leafStoragePath)
            .map((submission) => submission.leafStoragePath as string),
          ...targetStates.map((target) => target.imagePath).filter((entry): entry is string => entry !== null),
        ]),
      ];

      document.trees = document.trees.filter((tree) => tree.id !== treeId);
      document.photos = document.photos.filter((photo) => photo.treeId !== treeId);
      document.captureSubmissions = document.captureSubmissions.filter((submission) => !submissionIds.has(submission.id));
      document.targetStates = document.targetStates.filter((target) => target.treeId !== treeId);

      return storagePaths;
    });
  }

  async listPhotos(viewer: StoreViewer): Promise<PhotoRecord[]> {
    const document = await readDocument(viewer);
    return document.photos;
  }

  async listPhotosForTree(viewer: StoreViewer, treeId: string): Promise<PhotoRecord[]> {
    const document = await readDocument(viewer);
    return document.photos.filter((photo) => photo.treeId === treeId);
  }

  async getPhoto(viewer: StoreViewer, photoId: string): Promise<PhotoRecord | null> {
    const document = await readDocument(viewer);
    return document.photos.find((photo) => photo.id === photoId) ?? null;
  }

  async createPhoto(viewer: StoreViewer, photo: PhotoRecord): Promise<void> {
    await mutate(viewer, (document) => {
      document.photos.push(photo);
    });
  }

  async hasPhotosForTree(viewer: StoreViewer, treeId: string): Promise<boolean> {
    const document = await readDocument(viewer);
    return document.photos.some((photo) => photo.treeId === treeId);
  }

  async createSubmission(viewer: StoreViewer, submission: SubmissionRecord): Promise<void> {
    await mutate(viewer, (document) => {
      document.captureSubmissions.push(submission);
    });
  }

  async getSubmission(viewer: StoreViewer, submissionId: string): Promise<SubmissionRecord | null> {
    const document = await readDocument(viewer);
    return document.captureSubmissions.find((submission) => submission.id === submissionId) ?? null;
  }

  async markSubmissionConfirmed(
    viewer: StoreViewer,
    submissionId: string,
    finalized: { treeId: string; photoId: string },
  ): Promise<void> {
    await mutate(viewer, (document) => {
      const submission = document.captureSubmissions.find((entry) => entry.id === submissionId);

      if (!submission) {
        throw new Error("Capture submission not found.");
      }

      submission.status = "confirmed";
      submission.finalizedTreeId = finalized.treeId;
      submission.finalizedPhotoId = finalized.photoId;
    });
  }

  async createTargetState(viewer: StoreViewer, record: TargetStateRecord): Promise<void> {
    await mutate(viewer, (document) => {
      document.targetStates.push(record);
    });
  }

  async getTargetState(viewer: StoreViewer, targetId: string): Promise<TargetStateRecord | null> {
    const document = await readDocument(viewer);
    return document.targetStates.find((target) => target.id === targetId) ?? null;
  }

  async listTargetStatesForTree(viewer: StoreViewer, treeId: string): Promise<TargetStateRecord[]> {
    const document = await readDocument(viewer);
    return document.targetStates
      .filter((target) => target.treeId === treeId)
      .sort((left, right) => new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf());
  }

  async updateTargetState(
    viewer: StoreViewer,
    targetId: string,
    patch: Partial<Omit<TargetStateRecord, "id" | "treeId" | "ownerId" | "createdAt">>,
  ): Promise<void> {
    await mutate(viewer, (document) => {
      const target = document.targetStates.find((entry) => entry.id === targetId);

      if (!target) {
        throw new Error("Target state not found.");
      }

      Object.assign(target, patch);
    });
  }

  async setActiveTargetState(viewer: StoreViewer, treeId: string, targetId: string): Promise<void> {
    await mutate(viewer, (document) => {
      for (const target of document.targetStates) {
        if (target.treeId === treeId) {
          target.isActive = target.id === targetId;
        }
      }
    });
  }
}

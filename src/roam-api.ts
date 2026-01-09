/**
 * Roam Research API wrappers and utilities.
 * Provides type-safe access to Roam's global API.
 */

/**
 * Roam basic node type for tree traversal.
 */
export interface RoamBasicNode {
  text: string;
  uid: string;
  children?: RoamBasicNode[];
}

/**
 * Input node for creating blocks.
 */
export interface InputTextNode {
  text: string;
  children?: InputTextNode[];
}

interface RoamAlphaAPI {
  q?: (query: string, ...args: unknown[]) => unknown[][];
  data?: {
    pull?: (selector: string, eid: string) => unknown;
  };
  util?: {
    generateUID?: () => string;
  };
  createPage?: (config: { page: { title: string; uid?: string } }) => Promise<void>;
  createBlock?: (config: { location: { "parent-uid": string; order: number | "last" }; block: { string: string; uid?: string } }) => Promise<void>;
  updateBlock?: (config: { block: { uid: string; string: string } }) => Promise<void>;
  deleteBlock?: (config: { block: { uid: string } }) => Promise<void>;
  constants?: {
    corsAnywhereProxyUrl?: string;
  };
}

/**
 * Gets the Roam Alpha API from window.
 */
function getRoamAPI(): RoamAlphaAPI | undefined {
  return (window as unknown as { roamAlphaAPI?: RoamAlphaAPI }).roamAlphaAPI;
}

/**
 * Gets the Roam CORS proxy URL.
 */
export function getRoamProxyUrl(): string | undefined {
  return getRoamAPI()?.constants?.corsAnywhereProxyUrl;
}

/**
 * Generates a unique ID using Roam's API or fallback.
 */
function generateUID(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * Throttle delay between Roam API mutations (in ms).
 */
export const MUTATION_DELAY_MS = 100;

/**
 * Number of operations to process before yielding to main thread.
 */
export const YIELD_BATCH_SIZE = 3;

/**
 * Delays execution for the specified milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Yields control back to the main thread.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Conditionally yields to main thread based on operation count.
 */
export async function maybeYield(count: number): Promise<void> {
  if (count % YIELD_BATCH_SIZE === 0) {
    await yieldToMain();
  }
}

/**
 * Gets tree by parent UID using Roam API.
 * Returns direct children blocks of the parent.
 */
export function getBasicTreeByParentUid(parentUid: string): RoamBasicNode[] {
  const api = getRoamAPI();
  if (!api?.q) return [];

  const result = api.q(
    `[:find ?string ?uid ?order
      :where
      [?parent :block/uid "${parentUid}"]
      [?parent :block/children ?child]
      [?child :block/string ?string]
      [?child :block/uid ?uid]
      [?child :block/order ?order]]`
  );

  if (result && result.length > 0) {
    const nodes: (RoamBasicNode & { order: number })[] = [];
    for (const row of result) {
      const [text, uid, order] = row as [string, string, number];
      const children = getBasicTreeByParentUid(uid);
      nodes.push({
        text: text ?? "",
        uid: uid ?? "",
        children,
        order,
      });
    }

    return nodes.sort((a, b) => a.order - b.order);
  }

  return [];
}

/**
 * Gets page UID by title using Roam API.
 */
export function getPageUidByPageTitle(title: string): string | undefined {
  const api = getRoamAPI();
  if (!api?.q) return undefined;

  const result = api.q(
    `[:find ?uid :where [?p :node/title "${title}"] [?p :block/uid ?uid]]`
  );

  return result?.[0]?.[0] as string | undefined;
}

/**
 * Gets page titles starting with prefix.
 */
export function getPageTitlesStartingWithPrefix(prefix: string): string[] {
  const api = getRoamAPI();
  if (!api?.q) return [];

  const result = api.q(
    `[:find ?title :where [?p :node/title ?title] [(clojure.string/starts-with? ?title "${prefix}")]]`
  );

  return (result || []).map((row) => row[0] as string);
}

/**
 * Creates a page using Roam API.
 */
export async function createPage(config: { title: string; tree?: InputTextNode[] }): Promise<string> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createPage) {
    await api.createPage({ page: { title: config.title, uid } });
    await delay(MUTATION_DELAY_MS);
    await yieldToMain();

    if (config.tree && config.tree.length > 0) {
      for (let i = 0; i < config.tree.length; i++) {
        await createBlockRecursive(uid, config.tree[i], i);
      }
    }
  }

  return uid;
}

/**
 * Creates a block using Roam API.
 */
export async function createBlock(config: { parentUid: string; order: number | "last"; node: InputTextNode }): Promise<string> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createBlock) {
    await api.createBlock({
      location: { "parent-uid": config.parentUid, order: config.order },
      block: { string: config.node.text, uid },
    });
    await delay(MUTATION_DELAY_MS);
    await yieldToMain();

    if (config.node.children && config.node.children.length > 0) {
      for (let i = 0; i < config.node.children.length; i++) {
        await createBlockRecursive(uid, config.node.children[i], i);
      }
    }
  }

  return uid;
}

async function createBlockRecursive(parentUid: string, node: InputTextNode, order: number, depth = 0): Promise<void> {
  const api = getRoamAPI();
  const uid = api?.util?.generateUID?.() ?? generateUID();

  if (api?.createBlock) {
    await api.createBlock({
      location: { "parent-uid": parentUid, order },
      block: { string: node.text, uid },
    });
    await delay(MUTATION_DELAY_MS);

    if (depth % YIELD_BATCH_SIZE === 0) {
      await yieldToMain();
    }

    if (node.children && node.children.length > 0) {
      for (let i = 0; i < node.children.length; i++) {
        await createBlockRecursive(uid, node.children[i], i, depth + 1);
      }
    }
  }
}

/**
 * Updates a block using Roam API.
 */
export async function updateBlock(config: { uid: string; text: string }): Promise<void> {
  const api = getRoamAPI();
  if (api?.updateBlock) {
    await api.updateBlock({ block: { uid: config.uid, string: config.text } });
  }
}

/**
 * Deletes a block using Roam API.
 */
export async function deleteBlock(uid: string): Promise<void> {
  const api = getRoamAPI();
  if (api?.deleteBlock) {
    await api.deleteBlock({ block: { uid } });
  }
}

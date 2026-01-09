import { COMMAND_LABEL, SEARCH_COMMAND_LABEL, TOPBAR_BUTTON_ID, TOPBAR_ICON_NAME } from "./constants";
import { logInfo, logWarn } from "./logger";
import type { ExtensionAPI } from "./main";
import type { EventSearchQuery, EventSearchResult } from "./search";

/**
 * Creates an icon button element styled like Roam's built-in buttons.
 */
function createIconButton(icon: string): HTMLSpanElement {
  const button = document.createElement("span");
  button.className = "bp3-button bp3-minimal bp3-small";
  button.tabIndex = 0;

  const iconElement = document.createElement("span");
  iconElement.className = `bp3-icon bp3-icon-${icon}`;
  button.appendChild(iconElement);

  return button;
}

export async function registerCommand(
  extensionAPI: ExtensionAPI,
  onSync: () => Promise<void>
): Promise<() => Promise<void>> {
  const command = {
    label: COMMAND_LABEL,
    callback: () => {
      void onSync();
    },
  };

  const extensionCommandPalette = extensionAPI.ui?.commandPalette;
  if (extensionCommandPalette?.addCommand && extensionCommandPalette?.removeCommand) {
    await extensionCommandPalette.addCommand(command);
    logInfo("Command registered via extensionAPI.ui.commandPalette");

    return async () => {
      await extensionCommandPalette.removeCommand({ label: COMMAND_LABEL });
    };
  }

  const roamAPI = (window as unknown as {
    roamAlphaAPI?: {
      ui?: {
        commandPalette?: {
          addCommand: (config: { label: string; callback: () => void }) => Promise<void>;
          removeCommand: (config: { label: string }) => Promise<void>
        }
      }
    }
  }).roamAlphaAPI;

  const legacyCommandPalette = roamAPI?.ui?.commandPalette;
  if (legacyCommandPalette?.addCommand && legacyCommandPalette?.removeCommand) {
    await legacyCommandPalette.addCommand(command);
    logInfo("Command registered via window.roamAlphaAPI.ui.commandPalette");

    return async () => {
      await legacyCommandPalette.removeCommand({ label: COMMAND_LABEL });
    };
  }
  logWarn("Command palette API not available");

  return async () => undefined;
}

export function registerTopbarButton(onSync: () => Promise<void>): () => void {
  const topbar = document.querySelector(".rm-topbar");
  if (!topbar) {
    return () => undefined;
  }

  const existing = document.getElementById(TOPBAR_BUTTON_ID);
  existing?.remove();

  const button = createIconButton(TOPBAR_ICON_NAME);
  button.id = TOPBAR_BUTTON_ID;
  button.title = COMMAND_LABEL;

  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void onSync();
  };

  button.addEventListener("click", handleClick);
  topbar.appendChild(button);

  return () => {
    button.removeEventListener("click", handleClick);
    button.remove();
  };
}

/**
 * Search callback type for displaying search UI and results.
 */
export type SearchCallback = (query: EventSearchQuery) => Promise<EventSearchResult[]>;

/**
 * Registers the search command in the command palette.
 * Opens a search dialog when invoked.
 *
 * @param extensionAPI Extension API for command registration.
 * @param onSearch Callback to execute search.
 * @returns Cleanup function to unregister command.
 */
export async function registerSearchCommand(
  extensionAPI: ExtensionAPI,
  onSearch: SearchCallback
): Promise<() => Promise<void>> {
  const command = {
    label: SEARCH_COMMAND_LABEL,
    callback: () => {
      void showSearchDialog(onSearch);
    },
  };

  const extensionCommandPalette = extensionAPI.ui?.commandPalette;
  if (extensionCommandPalette?.addCommand && extensionCommandPalette?.removeCommand) {
    await extensionCommandPalette.addCommand(command);
    logInfo("Search command registered via extensionAPI.ui.commandPalette");

    return async () => {
      await extensionCommandPalette.removeCommand({ label: SEARCH_COMMAND_LABEL });
    };
  }

  const roamAPI = (window as unknown as {
    roamAlphaAPI?: {
      ui?: {
        commandPalette?: {
          addCommand: (config: { label: string; callback: () => void }) => Promise<void>;
          removeCommand: (config: { label: string }) => Promise<void>
        }
      }
    }
  }).roamAlphaAPI;

  const legacyCommandPalette = roamAPI?.ui?.commandPalette;
  if (legacyCommandPalette?.addCommand && legacyCommandPalette?.removeCommand) {
    await legacyCommandPalette.addCommand(command);
    logInfo("Search command registered via window.roamAlphaAPI.ui.commandPalette");

    return async () => {
      await legacyCommandPalette.removeCommand({ label: SEARCH_COMMAND_LABEL });
    };
  }

  logWarn("Command palette API not available for search command");
  return async () => undefined;
}

/**
 * Shows a search dialog using browser prompt (simplified UI).
 * In a production version, this would use a proper modal component.
 *
 * @param onSearch Callback to execute search.
 */
async function showSearchDialog(onSearch: SearchCallback): Promise<void> {
  const searchTerm = window.prompt("Search events by title:");
  if (!searchTerm) {
    return;
  }

  const query: EventSearchQuery = {
    title: searchTerm,
  };

  try {
    const results = await onSearch(query);

    if (results.length === 0) {
      window.alert(`No events found matching "${searchTerm}"`);
      return;
    }

    // Format results for display
    const resultText = results
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${r.title} - ${r.date} (${r.calendar})`)
      .join("\n");

    const moreText = results.length > 10 ? `\n\n...and ${results.length - 10} more results` : "";

    window.alert(`Found ${results.length} events:\n\n${resultText}${moreText}`);
  } catch (error) {
    logWarn("Search failed", { error: String(error) });
    window.alert("Search failed. Please try again.");
  }
}

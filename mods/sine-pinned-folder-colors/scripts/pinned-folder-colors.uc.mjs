const {
  PALETTE_SIZE,
  buildPalette,
  buildSwatchDataUri,
  deriveChildColor,
  formatCssColor,
  getFolderMixWeights,
  getNativeFolderFrontColor,
  getTopLevelPinnedFolder,
  isPinnedZenFolder,
  normalizeIntensityPreset,
  parseAssignments,
  parseColor,
} = await import(`./pinned-folder-colors-core.uc.mjs?v=${Date.now()}`);

const INSTANCE_KEY = "__sinePinnedFolderColors";
const LOG_PREFIX = "[Pinned Folder Colors]";
const ASSIGNMENTS_PREF = "sine.pinned-folder-colors.assignments";
const CONTRAST_PREF = "sine.pinned-folder-colors.contrast-aware";
const CONNECTORS_PREF = "sine.pinned-folder-colors.color-tree-connectors";
const INTENSITY_PREF = "sine.pinned-folder-colors.intensity";
const COLOR_PROPERTY = "--sine-pinned-folder-color";
const COLOR_ATTRIBUTE = "data-sine-pinned-folder-color";
const CONNECTORS_ATTRIBUTE = "sine-pinned-folder-colors-connectors";

class SinePinnedFolderColors {
  #abortController = new AbortController();
  #assignments = {};
  #contextFolder = null;
  #colorIntensity = 40;
  #folderMenu = null;
  #menuSeparator = null;
  #mutationObserver = null;
  #preferenceObserver = null;
  #scheduledFrame = 0;
  #swatchButtons = [];

  constructor(windowRef) {
    this.window = windowRef;
    this.document = windowRef.document;
  }

  init() {
    this.#assignments = this.#readAssignments();
    this.#installFolderMenu();
    this.#observePreferences();
    this.#observeFolders();
    this.#listenForWorkspaceChanges();
    this.#updateConnectorPreference();
    this.#updateIntensityPreference();
    this.#applyAllColors();
  }

  destroy() {
    this.#abortController.abort();
    this.#mutationObserver?.disconnect();
    if (this.#preferenceObserver) {
      for (const preference of [
        ASSIGNMENTS_PREF,
        CONTRAST_PREF,
        CONNECTORS_PREF,
        INTENSITY_PREF,
      ]) {
        try {
          Services.prefs.removeObserver(preference, this.#preferenceObserver);
        } catch (error) {
          console.error(
            `${LOG_PREFIX} Could not remove observer for ${preference}:`,
            error
          );
        }
      }
    }
    if (this.#scheduledFrame) {
      this.window.cancelAnimationFrame(this.#scheduledFrame);
    }
    this.#folderMenu?.remove();
    this.#menuSeparator?.remove();
    this.document.documentElement.removeAttribute(CONNECTORS_ATTRIBUTE);
    for (const property of [
      "--sine-pinned-folder-behind-strength",
      "--sine-pinned-folder-front-dark-strength",
      "--sine-pinned-folder-front-light-strength",
    ]) {
      this.document.documentElement.style.removeProperty(property);
    }
    this.#clearAllColors();
  }

  #listenForWorkspaceChanges() {
    const events = [
      "FolderGrouped",
      "FolderUngrouped",
      "TabGroupCreate",
      "ZenGradientCacheChanged",
      "ZenWorkspaceDataChanged",
      "ZenWorkspacesUIUpdate",
    ];
    for (const eventName of events) {
      this.window.addEventListener(eventName, this.#scheduleApply, {
        signal: this.#abortController.signal,
      });
    }
  }

  #observeFolders() {
    const target = this.window.gBrowser?.tabContainer ?? this.document;
    this.#mutationObserver = new MutationObserver(this.#scheduleApply);
    this.#mutationObserver.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["zen-workspace-id"],
    });
  }

  #observePreferences() {
    this.#preferenceObserver = {
      observe: (_subject, _topic, preference) => {
        if (preference === ASSIGNMENTS_PREF) {
          this.#assignments = this.#readAssignments();
        }
        if (preference === CONNECTORS_PREF) {
          this.#updateConnectorPreference();
        }
        if (preference === INTENSITY_PREF) {
          this.#updateIntensityPreference();
        }
        this.#scheduleApply();
      },
    };

    for (const preference of [
      ASSIGNMENTS_PREF,
      CONTRAST_PREF,
      CONNECTORS_PREF,
      INTENSITY_PREF,
    ]) {
      try {
        Services.prefs.addObserver(preference, this.#preferenceObserver);
      } catch (error) {
        console.error(
          `${LOG_PREFIX} Could not observe ${preference}:`,
          error
        );
      }
    }
  }

  #installFolderMenu() {
    const folderActionsMenu = this.document.getElementById("zenFolderActions");
    if (!folderActionsMenu) {
      console.error(`${LOG_PREFIX} Zen folder context menu was not found.`);
      return;
    }

    this.document.getElementById("sine-pinned-folder-colors-menu")?.remove();
    this.document
      .getElementById("sine-pinned-folder-colors-separator")
      ?.remove();

    const menu = this.document.createXULElement("menu");
    menu.id = "sine-pinned-folder-colors-menu";
    menu.setAttribute("label", "Folder color");

    const popup = this.document.createXULElement("menupopup");
    popup.id = "sine-pinned-folder-colors-popup";

    for (let slot = -1; slot < PALETTE_SIZE; slot += 1) {
      const buttonIndex = slot + 1;
      const button = this.document.createXULElement("menuitem");
      button.classList.add(
        "menuitem-iconic",
        "sine-pinned-folder-color-swatch"
      );
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("closemenu", "single");
      button.setAttribute("data-palette-slot", String(slot));
      button.style.left = `${10 + (buttonIndex % 3) * 36}px`;
      button.style.top = `${10 + Math.floor(buttonIndex / 3) * 36}px`;
      button.setAttribute(
        "tooltiptext",
        slot === -1 ? "Use Zen default" : `Workspace color ${slot + 1}`
      );
      button.setAttribute(
        "label",
        slot === -1 ? "Use Zen default" : `Workspace color ${slot + 1}`
      );
      button.setAttribute(
        "aria-label",
        slot === -1
          ? "Use Zen default folder color"
          : `Use workspace color ${slot + 1}`
      );
      if (slot === -1) {
        button.setAttribute("default-color", "true");
        this.#setSwatchImage(button, buildSwatchDataUri());
      }
      button.addEventListener("command", this.#onSwatchCommand, {
        signal: this.#abortController.signal,
      });
      popup.append(button);
      this.#swatchButtons.push(button);
    }

    menu.append(popup);
    const separator = this.document.createXULElement("menuseparator");
    separator.id = "sine-pinned-folder-colors-separator";

    const insertionPoint = this.document.getElementById(
      "context_zenFolderChangeIcon"
    );
    if (insertionPoint) {
      insertionPoint.before(separator, menu);
    } else {
      folderActionsMenu.append(separator, menu);
    }

    folderActionsMenu.addEventListener(
      "popupshowing",
      this.#onFolderContextMenuShowing,
      { signal: this.#abortController.signal }
    );

    this.#folderMenu = menu;
    this.#menuSeparator = separator;
  }

  #onFolderContextMenuShowing = event => {
    if (event.target !== event.currentTarget || !this.#folderMenu) {
      return;
    }

    const folder = this.#resolveContextFolder(event.explicitOriginalTarget);
    const isTopLevel =
      isPinnedZenFolder(folder) && getTopLevelPinnedFolder(folder) === folder;
    this.#contextFolder = isTopLevel ? folder : null;
    this.#folderMenu.hidden = !isTopLevel;
    this.#menuSeparator.hidden = !isTopLevel;
    if (isTopLevel) {
      this.#refreshSwatches(folder);
    }
  };

  #resolveContextFolder(target) {
    if (!target) {
      return null;
    }
    if (this.window.gBrowser.isTabGroupLabel(target)) {
      return target.group;
    }
    if (this.window.gBrowser.isTabGroupLabel(target.parentElement)) {
      return target.parentElement.group;
    }
    return (
      target.closest?.("zen-folder") ??
      target.parentElement?.closest?.("zen-folder") ??
      null
    );
  }

  #refreshSwatches(folder) {
    const paletteData = this.#getPaletteData(folder);
    if (!paletteData) {
      this.#folderMenu.setAttribute("disabled", "true");
      return;
    }
    this.#folderMenu.removeAttribute("disabled");
    const selectedSlot = this.#assignments[folder.id];
    for (const button of this.#swatchButtons) {
      const slot = Number(button.getAttribute("data-palette-slot"));
      const isSelected =
        slot === (Number.isInteger(selectedSlot) ? selectedSlot : -1);
      button.toggleAttribute("selected", isSelected);
      button.setAttribute("aria-checked", String(isSelected));
      if (slot >= 0) {
        this.#setSwatchImage(
          button,
          buildSwatchDataUri(
            getNativeFolderFrontColor(
              paletteData.palette[slot],
              paletteData.isDarkMode,
              this.#colorIntensity
            )
          )
        );
      }
    }
  }

  #setSwatchImage(button, imageUri) {
    button.setAttribute("image", imageUri);
    button.style.setProperty("list-style-image", `url("${imageUri}")`);
  }

  #onSwatchCommand = event => {
    const folder = this.#contextFolder;
    const slot = Number(event.currentTarget.getAttribute("data-palette-slot"));
    if (
      !isPinnedZenFolder(folder) ||
      getTopLevelPinnedFolder(folder) !== folder ||
      (slot !== -1 &&
        (!Number.isInteger(slot) || slot < 0 || slot >= PALETTE_SIZE))
    ) {
      return;
    }

    const nextAssignments = { ...this.#assignments };
    if (slot === -1) {
      delete nextAssignments[folder.id];
    } else {
      nextAssignments[folder.id] = slot;
    }

    try {
      Services.prefs.setStringPref(
        ASSIGNMENTS_PREF,
        JSON.stringify(nextAssignments)
      );
      this.#assignments = nextAssignments;
      this.#applyAllColors();
      this.#refreshSwatches(folder);
      this.document.getElementById("zenFolderActions")?.hidePopup();
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not save folder color:`, error);
    }
  };

  #readAssignments() {
    try {
      return parseAssignments(
        Services.prefs.getStringPref(ASSIGNMENTS_PREF, "{}")
      );
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not read saved colors:`, error);
      return {};
    }
  }

  #updateConnectorPreference() {
    let enabled = true;
    try {
      enabled = Services.prefs.getBoolPref(CONNECTORS_PREF, true);
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not read connector preference:`, error);
    }
    this.document.documentElement.toggleAttribute(
      CONNECTORS_ATTRIBUTE,
      enabled
    );
    if (enabled) {
      this.document.documentElement.setAttribute(CONNECTORS_ATTRIBUTE, "true");
    }
  }

  #updateIntensityPreference() {
    let storedValue = 40;
    try {
      storedValue = Services.prefs.getIntPref(INTENSITY_PREF, 40);
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not read intensity preference:`, error);
    }
    this.#colorIntensity = normalizeIntensityPreset(storedValue, 40);
    const weights = getFolderMixWeights(this.#colorIntensity);
    const rootStyle = this.document.documentElement.style;
    rootStyle.setProperty(
      "--sine-pinned-folder-behind-strength",
      `${weights.behind * 100}%`
    );
    rootStyle.setProperty(
      "--sine-pinned-folder-front-dark-strength",
      `${weights.frontDark * 100}%`
    );
    rootStyle.setProperty(
      "--sine-pinned-folder-front-light-strength",
      `${weights.frontLight * 100}%`
    );
  }

  #scheduleApply = () => {
    if (this.#scheduledFrame) {
      return;
    }
    this.#scheduledFrame = this.window.requestAnimationFrame(() => {
      this.#scheduledFrame = 0;
      this.#applyAllColors();
    });
  };

  #applyAllColors() {
    this.#clearAllColors();
    const folders = Array.from(
      this.document.querySelectorAll("zen-folder")
    ).filter(isPinnedZenFolder);
    const topLevelFolders = folders.filter(
      folder => getTopLevelPinnedFolder(folder) === folder
    );

    for (const folder of topLevelFolders) {
      const slot = this.#assignments[folder.id];
      if (!Number.isInteger(slot) || slot < 0 || slot >= PALETTE_SIZE) {
        continue;
      }
      const paletteData = this.#getPaletteData(folder);
      if (!paletteData) {
        continue;
      }
      this.#applyFolderTree(
        folder,
        paletteData.palette[slot],
        paletteData.isDarkMode
      );
    }
  }

  #applyFolderTree(folder, color, isDarkMode) {
    folder.style.setProperty(COLOR_PROPERTY, formatCssColor(color));
    folder.setAttribute(COLOR_ATTRIBUTE, "true");

    const childFolders = Array.from(folder.groupContainer?.children ?? []).filter(
      isPinnedZenFolder
    );
    childFolders.forEach((childFolder, siblingIndex) => {
      const childColor = deriveChildColor(color, siblingIndex, {
        adaptive: this.#contrastAware,
        isDarkMode,
      });
      this.#applyFolderTree(childFolder, childColor, isDarkMode);
    });
  }

  #clearAllColors() {
    for (const folder of this.document.querySelectorAll(
      `zen-folder[${COLOR_ATTRIBUTE}]`
    )) {
      folder.style.removeProperty(COLOR_PROPERTY);
      folder.removeAttribute(COLOR_ATTRIBUTE);
    }
  }

  get #contrastAware() {
    try {
      return Services.prefs.getBoolPref(CONTRAST_PREF, false);
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not read contrast preference:`, error);
      return false;
    }
  }

  #getPaletteData(folder) {
    const workspaceId =
      folder.getAttribute("zen-workspace-id") ||
      this.window.gZenWorkspaces.activeWorkspace;
    const workspace = this.window.gZenWorkspaces.getWorkspaceFromId(workspaceId);
    if (!workspace) {
      console.error(
        `${LOG_PREFIX} Could not find workspace ${workspaceId} for folder ${folder.id}.`
      );
      return null;
    }

    let gradientData;
    try {
      gradientData = this.window.gZenThemePicker.getGradientForWorkspace(
        workspace,
        { getGradient: false }
      );
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not read workspace theme:`, error);
      return null;
    }

    const anchors = Array.from(workspace.theme?.gradientColors ?? [])
      .map(color => color?.c)
      .filter(color => parseColor(color));
    if (anchors.length === 0 && parseColor(gradientData.primaryColor)) {
      anchors.push(gradientData.primaryColor);
    }
    if (anchors.length === 0) {
      const inheritedPrimary = this.window
        .getComputedStyle(folder)
        .getPropertyValue("--zen-primary-color");
      if (parseColor(inheritedPrimary)) {
        anchors.push(inheritedPrimary);
      }
    }
    if (anchors.length === 0) {
      console.error(
        `${LOG_PREFIX} Workspace ${workspaceId} does not expose a usable color.`
      );
      return null;
    }

    try {
      return {
        isDarkMode: Boolean(gradientData.isDarkMode),
        palette: buildPalette(anchors, {
          adaptive: this.#contrastAware,
          isDarkMode: Boolean(gradientData.isDarkMode),
          referenceColor: gradientData.primaryColor,
        }),
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not build workspace palette:`, error);
      return null;
    }
  }
}

if (!window.gZenWorkspaces?.promiseInitialized) {
  console.error(`${LOG_PREFIX} Zen workspaces are unavailable.`);
} else {
  await window.gZenWorkspaces.promiseInitialized;
  window[INSTANCE_KEY]?.destroy();

  const mod = new SinePinnedFolderColors(window);
  mod.init();
  window[INSTANCE_KEY] = mod;

  const destroy = () => {
    mod.destroy();
    if (window[INSTANCE_KEY] === mod) {
      delete window[INSTANCE_KEY];
    }
  };

  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(destroy);
  } else {
    window.addEventListener("unload", destroy, { once: true });
  }
}

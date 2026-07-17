(async () => {
  try {
    const moduleUrl =
      "chrome://sine/content/sine-pinned-folder-colors/scripts/" +
      `pinned-folder-colors.uc.mjs?v=${Date.now()}`;
    await import(moduleUrl);
  } catch (error) {
    console.error("[Pinned Folder Colors] Failed to load module:", error);
  }
})();

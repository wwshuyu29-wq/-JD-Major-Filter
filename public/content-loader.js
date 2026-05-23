import(chrome.runtime.getURL("assets/content.js")).catch((error) => {
  console.error("[JD Major Filter] Failed to load content module", error);
});

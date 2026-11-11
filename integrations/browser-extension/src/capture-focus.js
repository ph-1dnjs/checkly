// Restore the exact tab that was captured, rather than relying on Chrome's
// default selection when the editor tab closes (which can choose the other pane).
export async function closeCaptureEditor(source, tabs, close) {
  try {
    if (Number.isInteger(source?.tabId) && Number.isInteger(source?.windowId)) {
      const tab = await tabs.get(source.tabId);
      if (tab.windowId === source.windowId) await tabs.update(source.tabId, {active:true});
    }
  } catch {
    // The source tab or window may have been closed while editing.
  } finally {
    close();
  }
}

// downloadJson triggers a browser download of a JSON string under the given
// filename. Used by the server-mode export path, where the native save dialog
// is a no-op headless: the backend returns the JSON and default filename, and
// the browser saves it via a temporary object-URL anchor.
export const downloadJson = (filename: string, json: string) => {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

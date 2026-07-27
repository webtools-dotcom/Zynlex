export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard not available — not critical, the copy action just no-ops.
  }
}

export async function copyImageToClipboard(bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes], { type: "image/png" });
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch {
    // Clipboard not available — not critical, file was already saved by Rust
  }
}

export async function copyToClipboard(bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes], { type: "image/png" });
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch {
    // Clipboard not available — not critical, file was already saved by Rust
  }
}

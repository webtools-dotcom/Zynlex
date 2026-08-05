import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onHoveredUrlChanged } from "./browser";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("onHoveredUrlChanged", () => {
  beforeEach(() => {
    vi.mocked(listen).mockReset();
  });

  it("maps hovered URL events to tab ID and nullable URL", async () => {
    let eventHandler: ((event: { payload: { tabId: string; url: string | null } }) => void) | null =
      null;
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      eventHandler = handler as typeof eventHandler;
      return unlisten;
    });
    const callback = vi.fn();

    const result = await onHoveredUrlChanged(callback);
    const emit = eventHandler as unknown as (event: {
      payload: { tabId: string; url: string | null };
    }) => void;
    emit({ payload: { tabId: "tab-1", url: "https://example.com/docs" } });
    emit({ payload: { tabId: "tab-1", url: null } });

    expect(listen).toHaveBeenCalledWith("zynlex://hovered-url", expect.any(Function));
    expect(callback).toHaveBeenNthCalledWith(1, "tab-1", "https://example.com/docs");
    expect(callback).toHaveBeenNthCalledWith(2, "tab-1", null);
    expect(result).toBe(unlisten);
  });
});

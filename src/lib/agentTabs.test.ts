import { describe, expect, it } from "vitest";
import {
  forgetAgentTab,
  isAgentOpened,
  markAgentOpened,
  notePopup,
  popupMark,
  takePopups,
} from "./agentTabs";

describe("agent tab bookkeeping", () => {
  it("credits an action only with popups its own tab opened after it started", () => {
    notePopup("opener-1", "before", "http://localhost:3000/old");
    const mark = popupMark();
    notePopup("opener-1", "popup-1", "http://localhost:3000/terms");
    notePopup("other-tab", "popup-2", "http://localhost:3000/x");

    const hits = takePopups("opener-1", mark);
    expect(hits.map((p) => p.tabId)).toEqual(["popup-1"]);
    expect(isAgentOpened("popup-1")).toBe(true);
    // The developer's own popups, and ones from before the action, aren't the agent's.
    expect(isAgentOpened("popup-2")).toBe(false);
    expect(isAgentOpened("before")).toBe(false);
  });

  it("tracks tabs open created and forgets closed ones", () => {
    markAgentOpened("opened-1");
    expect(isAgentOpened("opened-1")).toBe(true);
    forgetAgentTab("opened-1");
    expect(isAgentOpened("opened-1")).toBe(false);
  });

  it("keeps a bounded history", () => {
    const mark = popupMark();
    for (let i = 0; i < 60; i++) notePopup("busy", `p${i}`, "http://localhost:3000/");
    const hits = takePopups("busy", mark);
    expect(hits).toHaveLength(50);
    expect(hits[0].tabId).toBe("p10");
  });
});

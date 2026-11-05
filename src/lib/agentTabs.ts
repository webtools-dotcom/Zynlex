/**
 * Which tabs an agent caused: popups its actions opened (`target=_blank`,
 * `window.open`, which useWebviewBridge turns into tabs) and tabs `open`
 * created. An agent may close only these, never the developer's own tabs.
 * See docs/agent-interface.md.
 */

export interface Popup {
  seq: number;
  opener: string;
  tabId: string;
  url: string;
}

/** Popups kept for matching against an action; older ones can't still be news. */
const MAX_POPUPS = 50;
let seq = 0;
const popups: Popup[] = [];
const owned = new Set<string>();

/** Called for every new-window request a page makes, agent or not. */
export function notePopup(opener: string, tabId: string, url: string): void {
  popups.push({ seq: ++seq, opener, tabId, url });
  if (popups.length > MAX_POPUPS) popups.shift();
}

/** Take before an action; hand to `takePopups` after it. */
export const popupMark = (): number => seq;

/** Popups `opener` opened since `mark`. The action caused them, so they count as the agent's. */
export function takePopups(opener: string, mark: number): Popup[] {
  const hits = popups.filter((p) => p.opener === opener && p.seq > mark);
  for (const p of hits) owned.add(p.tabId);
  return hits;
}

export const markAgentOpened = (tabId: string): void => {
  owned.add(tabId);
};
export const isAgentOpened = (tabId: string): boolean => owned.has(tabId);
export const forgetAgentTab = (tabId: string): void => {
  owned.delete(tabId);
};

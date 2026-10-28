import { describe, expect, it } from "vitest";
import {
  allCommands,
  bindChord,
  bindingMap,
  chordFromEvent,
  chordLabel,
  isBindable,
} from "@/lib/commands";
import { useSnippetsStore } from "@/stores/snippets";

const ev = (
  code: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
  key = "",
) => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("chordFromEvent", () => {
  // Same cases as chord_names_match_the_frontend in events.rs — the two must agree.
  it("names chords the way Rust does", () => {
    expect(chordFromEvent(ev("KeyK", { ctrl: true }))).toBe("ctrl+k");
    expect(chordFromEvent(ev("Digit1", { ctrl: true, shift: true }))).toBe("ctrl+shift+1");
    expect(chordFromEvent(ev("Slash", { ctrl: true, shift: true }))).toBe("ctrl+shift+/");
    expect(chordFromEvent(ev("NumpadAdd", { ctrl: true }))).toBe("ctrl+=");
    expect(chordFromEvent(ev("Numpad0", { ctrl: true }))).toBe("ctrl+0");
    expect(chordFromEvent(ev("ArrowLeft", { alt: true }))).toBe("alt+left");
    expect(chordFromEvent(ev("F12", { ctrl: true, alt: true, shift: true }))).toBe(
      "ctrl+alt+shift+f12",
    );
    expect(chordFromEvent(ev("Escape"))).toBe("escape");
    expect(chordFromEvent(ev("ControlLeft", { ctrl: true }))).toBeNull();
  });

  it("follows the keyboard layout for letters, like Windows virtual keys", () => {
    // AZERTY: the key labelled W sits where QWERTY has Z.
    expect(chordFromEvent(ev("KeyZ", { ctrl: true }, "w"))).toBe("ctrl+w");
    expect(chordFromEvent(ev("KeyT", { ctrl: true, shift: true }, "T"))).toBe("ctrl+shift+t");
    // Shifted digits still name the digit, not the symbol.
    expect(chordFromEvent(ev("Digit1", { ctrl: true, shift: true }, "!"))).toBe("ctrl+shift+1");
  });
});

describe("bindings", () => {
  it("resolves defaults", () => {
    expect(bindingMap({}).get("ctrl+k")?.id).toBe("palette.open");
    expect(bindingMap({}).get("f12")?.id).toBe("devtools.open");
  });

  it("moves a chord instead of mapping it twice", () => {
    const o = bindChord({}, "devtools.open", "ctrl+k");
    const map = bindingMap(o);
    expect(map.get("ctrl+k")?.id).toBe("devtools.open");
    expect(o["palette.open"]).toEqual([]);
    expect(o["devtools.open"]).toEqual(["f12", "ctrl+shift+i", "ctrl+k"]);
  });

  it("unbinds via an empty override", () => {
    expect(bindingMap({ "palette.open": [] }).has("ctrl+k")).toBe(false);
  });

  it("rejects chords that would swallow typing", () => {
    expect(isBindable("a")).toBe(false);
    expect(isBindable("shift+a")).toBe(false);
    expect(isBindable("ctrl+a")).toBe(true);
    expect(isBindable("alt+1")).toBe(true);
    expect(isBindable("f5")).toBe(true);
  });

  it("labels chords", () => {
    expect(chordLabel("ctrl+shift+left")).toEqual(["Ctrl", "Shift", "←"]);
  });
});

describe("snippet commands", () => {
  it("are bindable like built-ins, and keep their chord by id", () => {
    useSnippetsStore.setState({
      snippets: [
        { id: "a", name: "Fill login", code: "1" },
        { id: "b", name: "Print CSS", code: "2" },
      ],
    });
    expect(allCommands().find((c) => c.id === "snippet.b")?.title).toBe("Snippet: Print CSS");
    const overrides = bindChord({}, "snippet.b", "ctrl+alt+p");
    expect(bindingMap(overrides).get("ctrl+alt+p")?.id).toBe("snippet.b");
    // Deleting another snippet doesn't move the chord.
    useSnippetsStore.setState({ snippets: [{ id: "b", name: "Print CSS", code: "2" }] });
    expect(bindingMap(overrides).get("ctrl+alt+p")?.id).toBe("snippet.b");
    useSnippetsStore.setState({ snippets: [] });
    expect(bindingMap(overrides).get("ctrl+alt+p")).toBeUndefined();
  });
});

import { create } from "zustand";
import type { Recording } from "@/lib/agentRecord";

/**
 * The developer's latest step recording for agents (recorder.ts). In memory
 * only: one recording, replaced by the next, gone when the app closes.
 */
interface RecordingStore {
  /** Set while recording; also the last finished recording. */
  rec: Recording | null;
  /** True while `rec` is still being recorded. */
  active: boolean;
}

export const useRecordingStore = create<RecordingStore>()(() => ({ rec: null, active: false }));

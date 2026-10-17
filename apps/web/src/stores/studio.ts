import { create } from "zustand";

export type PreviewKind = "FINAL" | "PREVIEW";

type StudioStore = {
  selectedSceneId: string | null;
  previewKind: PreviewKind;
  setSelectedSceneId: (id: string | null) => void;
  setPreviewKind: (kind: PreviewKind) => void;
};

export const useStudioStore = create<StudioStore>((set) => ({
  selectedSceneId: null,
  previewKind: "FINAL",
  setSelectedSceneId: (id) => set({ selectedSceneId: id }),
  setPreviewKind: (kind) => set({ previewKind: kind }),
}));

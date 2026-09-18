import { create } from 'zustand';

type UiState = { sidebarOpen: boolean; copilotOpen: boolean; activeBrandId: number | null; toggleSidebar(): void; setCopilotOpen(open: boolean): void; setActiveBrandId(id: number | null): void };
export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false, copilotOpen: false, activeBrandId: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setCopilotOpen: (copilotOpen) => set({ copilotOpen }),
  setActiveBrandId: (activeBrandId) => set({ activeBrandId }),
}));

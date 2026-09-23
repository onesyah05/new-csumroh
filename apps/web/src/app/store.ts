import { create } from 'zustand';

export type RealtimeStatus = 'connecting' | 'online' | 'offline';

type UiState = {
  sidebarOpen: boolean;
  copilotOpen: boolean;
  activeBrandId: number | null;
  realtimeStatus: RealtimeStatus;
  toggleSidebar(): void;
  setCopilotOpen(open: boolean): void;
  setActiveBrandId(id: number | null): void;
  setRealtimeStatus(status: RealtimeStatus): void;
};
export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false, copilotOpen: false, activeBrandId: null, realtimeStatus: 'connecting',
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setCopilotOpen: (copilotOpen) => set({ copilotOpen }),
  setActiveBrandId: (activeBrandId) => set({ activeBrandId }),
  setRealtimeStatus: (realtimeStatus) => set({ realtimeStatus }),
}));

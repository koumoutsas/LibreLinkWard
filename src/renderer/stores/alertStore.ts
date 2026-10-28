import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type AlertSettingsStore = {
  bringToFrontEnabled: boolean;
  flashWindowEnabled: boolean;
  audioAlertEnabled: boolean;
  useCustomSound: boolean;
  overrideThreshold: boolean;
  customTargetLow: number | null;
  customTargetHigh: number | null;
  setBringToFrontEnabled: (value: boolean) => void;
  setFlashWindowEnabled: (value: boolean) => void;
  setAudioAlertEnabled: (value: boolean) => void;
  setUserCustomSoundEnabled: (value: boolean) => void;
  setOverrideThreshold: (value: boolean) => void;
  setCustomTargetLow: (value: number | null) => void;
  setCustomTargetHigh: (value: number | null) => void;
};

const useAlertStore = create<AlertSettingsStore>()(
  persist(
    (set) => ({
      // Initial state
      bringToFrontEnabled: false,
      flashWindowEnabled: false,
      audioAlertEnabled: false,
      useCustomSound: false,
      overrideThreshold: false,
      customTargetLow: null,
      customTargetHigh: null,
      // Setters
      setBringToFrontEnabled: (value: boolean) => set(() => ({ bringToFrontEnabled: value })),
      setFlashWindowEnabled: (value: boolean) => set(() => ({ flashWindowEnabled: value })),
      setAudioAlertEnabled: (value: boolean) => set(() => ({ audioAlertEnabled: value })),
      setUserCustomSoundEnabled: (value: boolean) => set(() => ({ useCustomSound: value })),
      setOverrideThreshold: (value: boolean) => set(() => ({ overrideThreshold: value })),
      setCustomTargetLow: (value: number | null) => set(() => ({ customTargetLow: value })),
      setCustomTargetHigh: (value: number | null) => set(() => ({ customTargetHigh: value })),
    }),
    {
      name: 'alert-settings-storage',
      storage: createJSONStorage(() => localStorage),
      // Alarms always start disabled; the persisted values for these are ignored at startup.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AlertSettingsStore>),
        bringToFrontEnabled: false,
        flashWindowEnabled: false,
        audioAlertEnabled: false,
      }),
    }
  )
);

export { useAlertStore };

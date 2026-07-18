import { create } from "zustand";
import { persist } from "zustand/middleware";

export type StudioLocale = "zh" | "en";

type StudioLocaleStore = {
    locale: StudioLocale;
    setLocale: (locale: StudioLocale) => void;
};

export const useStudioLocaleStore = create<StudioLocaleStore>()(
    persist(
        (set) => ({
            locale: "zh",
            setLocale: (locale) => set({ locale }),
        }),
        {
            name: "studio-locale",
        },
    ),
);


"use client";

import { create } from "zustand";

import type { StudioUser } from "@/services/studio-managed";

type StudioSessionStore = {
    user: StudioUser | null;
    ready: boolean;
    setUser: (user: StudioUser | null) => void;
    setReady: (ready: boolean) => void;
    clear: () => void;
};

export const useStudioSessionStore = create<StudioSessionStore>()((set) => ({
    user: null,
    ready: false,
    setUser: (user) => set({ user }),
    setReady: (ready) => set({ ready }),
    clear: () => set({ user: null, ready: true }),
}));

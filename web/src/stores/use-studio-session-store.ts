import { create } from "zustand";

import type { StudioUser } from "@/services/studio-managed";

export type StudioPointsDelta = {
    id: number;
    amount: number;
    nextPoints: number;
};

type StudioSessionStore = {
    user: StudioUser | null;
    bootstrapped: boolean;
    pointsDelta: StudioPointsDelta | null;
    setUser: (user: StudioUser | null) => void;
    setBootstrapped: (bootstrapped: boolean) => void;
    clearPointsDelta: (id: number) => void;
};

const POINT_EPSILON = 0.0001;

export const useStudioSessionStore = create<StudioSessionStore>()((set) => ({
    user: null,
    bootstrapped: false,
    pointsDelta: null,
    setUser: (user) =>
        set((state) => {
            const previousUser = state.user;
            let pointsDelta = state.pointsDelta;
            if (!user) {
                pointsDelta = null;
            } else if (previousUser && previousUser.id === user.id && previousUser.source === user.source) {
                const amount = Number(user.points || 0) - Number(previousUser.points || 0);
                if (Math.abs(amount) > POINT_EPSILON) {
                    pointsDelta = {
                        id: Date.now(),
                        amount,
                        nextPoints: Number(user.points || 0),
                    };
                }
            }
            return { user, pointsDelta };
        }),
    setBootstrapped: (bootstrapped) => set({ bootstrapped }),
    clearPointsDelta: (id) =>
        set((state) => ({
            pointsDelta: state.pointsDelta?.id === id ? null : state.pointsDelta,
        })),
}));

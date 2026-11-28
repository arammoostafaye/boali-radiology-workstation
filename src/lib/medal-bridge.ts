"use client";

/* ------------------------------------------------------------------ */
/*  MedalPACS bridge client state — shared between the PACS panel     */
/*  (login form / worklist / patient download) and the status bar     */
/*  ("MEDAL Bridge — ●").                                             */
/*                                                                    */
/*  The server-side session lives in /api/medal/* keyed by `sid` and  */
/*  is disk-persisted for 12 hours (the radiologist's previous        */
/*  method); this store remembers the sid client-side (localStorage)  */
/*  so a page reload — or even an app restart — keeps the session.    */
/* ------------------------------------------------------------------ */

import { create } from "zustand";

export interface MedalBridgeInfo {
  sid: string;
  serverName: string | null;
  hospitalName: string | null;
  username: string | null;
  appBase: string;
  hasCaptcha: boolean;
  /** epoch ms of the successful login (12-hour validity) */
  loginAt?: number | null;
  /** remaining session validity in hours (0.1 precision) */
  validHoursRemaining?: number;
}

interface MedalBridgeState {
  sid: string | null;
  connected: boolean;
  info: MedalBridgeInfo | null;
  connecting: boolean;
  setConnecting: (v: boolean) => void;
  setBridge: (info: MedalBridgeInfo) => void;
  clearBridge: () => void;
  /** re-validate a persisted sid on mount */
  revalidate: () => Promise<void>;
}

const LS_KEY = "boali.medalBridge";

function persist(sid: string | null): void {
  try {
    if (sid) localStorage.setItem(LS_KEY, sid);
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* private mode etc. */
  }
}

export const useMedalBridge = create<MedalBridgeState>((set, get) => ({
  sid: null,
  connected: false,
  info: null,
  connecting: false,
  setConnecting: (v) => set({ connecting: v }),
  setBridge: (info) => {
    persist(info.sid);
    set({ sid: info.sid, info, connected: true, connecting: false });
  },
  clearBridge: () => {
    persist(null);
    set({ sid: null, info: null, connected: false, connecting: false });
  },
  revalidate: async () => {
    let sid: string | null = null;
    try {
      sid = localStorage.getItem(LS_KEY);
    } catch {
      return;
    }
    if (!sid || get().sid) return;
    try {
      const res = await fetch(`/api/medal/status?sid=${encodeURIComponent(sid)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as Partial<MedalBridgeInfo> & {
        connected?: boolean;
      };
      if (data.connected) {
        set({
          sid,
          connected: true,
          info: {
            sid,
            serverName: data.serverName ?? null,
            hospitalName: data.hospitalName ?? null,
            username: data.username ?? null,
            appBase: data.appBase ?? "",
            hasCaptcha: !!data.hasCaptcha,
            loginAt: data.loginAt ?? null,
            validHoursRemaining: data.validHoursRemaining ?? 0,
          },
        });
      } else {
        persist(null);
      }
    } catch {
      /* server restarted → session gone */
      persist(null);
    }
  },
}));

/* the four hospital servers — identical to the desktop app's presets */
export const MEDAL_SERVERS: readonly { id: string; fa: string; url: string }[] = [
  { id: "lan", fa: "شبکه داخلی بیمارستان بوعلی", url: "http://192.168.11.201" },
  {
    id: "wan",
    fa: "دامنه دانشگاه علوم پزشکی",
    url: "https://marivan-pacs-boali.muk.ac.ir",
  },
  { id: "ext", fa: "آی‌پی خارج بیمارستان", url: "http://78.39.234.56" },
  { id: "fajr", fa: "بیمارستان فجر مریوان", url: "http://78.39.233.89:8088" },
];

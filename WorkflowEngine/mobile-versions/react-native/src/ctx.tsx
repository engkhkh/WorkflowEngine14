import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, loadSession, signOut as apiSignOut, refreshMe, getSession } from './api';
import { Lang, translate } from './i18n';

interface Ctx {
  ready: boolean; session: Session | null; setSession: (s: Session | null) => void; signOut: () => Promise<void>;
  lang: Lang; setLang: (l: Lang) => void; t: (k: string, v?: Record<string, string>) => string; rtl: boolean;
}
const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<Session | null>(null);
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    (async () => {
      try { const l = await AsyncStorage.getItem('wfe_rn_lang'); if (l === 'ar' || l === 'en') setLangState(l); } catch { /* default language */ }
      const s = await loadSession();
      setSessionState(s);
      if (s) { await refreshMe(); setSessionState(getSession()); }
      setReady(true);
    })();
  }, []);

  const setLang = useCallback((l: Lang) => { setLangState(l); AsyncStorage.setItem('wfe_rn_lang', l).catch(() => undefined); }, []);
  const signOut = useCallback(async () => { await apiSignOut(); setSessionState(null); }, []);
  const value = useMemo<Ctx>(() => ({
    ready, session, setSession: setSessionState, signOut, lang, setLang, rtl: lang === 'ar',
    t: (k, v) => translate(lang, k, v),
  }), [ready, session, signOut, lang, setLang]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

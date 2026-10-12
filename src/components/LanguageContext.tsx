'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Lang = 'en' | 'ar' | 'fr' | 'es';

export const LANGS: { code: Lang; label: string; native: string; rtl: boolean }[] = [
  { code: 'en', label: 'English', native: 'English', rtl: false },
  { code: 'ar', label: 'Arabic', native: 'العربية', rtl: true },
  { code: 'fr', label: 'French', native: 'Français', rtl: false },
  { code: 'es', label: 'Spanish', native: 'Español', rtl: false },
];

const KEY = 'mrc-lang';

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  rtl: boolean;
}

const Ctx = createContext<LangCtx>({ lang: 'en', setLang: () => {}, t: (k) => k, rtl: false });

// Translations loaded dynamically
let dicts: Record<Lang, Record<string, string>> = { en: {}, ar: {}, fr: {}, es: {} };
let loaded: Record<Lang, boolean> = { en: false, ar: false, fr: false, es: false };

async function loadDict(lang: Lang): Promise<void> {
  if (loaded[lang]) return;
  try {
    const [cust, barb] = await Promise.all([
      import(`./locales/${lang}-customer.json`).catch(() => ({ default: {} })),
      import(`./locales/${lang}-barber.json`).catch(() => ({ default: {} })),
    ]);
    dicts[lang] = { ...(cust.default || cust), ...(barb.default || barb) };
    loaded[lang] = true;
  } catch {
    // fall back to key
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Lang) || 'en';
    const valid = LANGS.some((l) => l.code === saved) ? saved : 'en';
    setLangState(valid);
    loadDict(valid).then(() => {
      document.documentElement.dir = LANGS.find((l) => l.code === valid)?.rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = valid;
      setReady(true);
    });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem(KEY, l);
    loadDict(l).then(() => {
      document.documentElement.dir = LANGS.find((x) => x.code === l)?.rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = l;
    });
  };

  const t = (key: string): string => {
    return dicts[lang]?.[key] ?? dicts.en?.[key] ?? key;
  };

  const rtl = LANGS.find((l) => l.code === lang)?.rtl ?? false;

  if (!ready) return null;
  return <Ctx.Provider value={{ lang, setLang, t, rtl }}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}

'use client';

import { useLang, LANGS } from './LanguageContext';
import { GlobeIcon } from './Icons';

export function LanguageSwitcher() {
  const { lang, setLang, t } = useLang();
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-gold"><GlobeIcon size={22} /></span>
        <b className="text-[16px]">{t('settings.language') || 'Language'}</b>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {LANGS.map((l) => (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            className={`rounded-2xl px-4 py-3.5 text-[15px] font-semibold border-2 transition-all ${
              lang === l.code
                ? 'border-gold bg-gold/10 text-gold'
                : 'border-neutral-200 text-neutral-600'
            }`}
          >
            {l.native}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * i18n.jsx — Sistema di localizzazione per PhotoBook Studio
 *
 * Uso:
 *   import { useT } from '../i18n'
 *   const t = useT()
 *   <h1>{t.nav.config}</h1>
 *   <p>{t.preview.pageOf(3, 12)}</p>
 *
 * Lingua memorizzata in localStorage('photobook_lang').
 * Fallback automatico all'italiano se una chiave manca in en.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import it from './locales/it.js'
import en from './locales/en.js'

export const LOCALES = {
  it: { label: 'Italiano', dict: it },
  en: { label: 'English',  dict: en },
}

const STORAGE_KEY = 'photobook_lang'
const DEFAULT_LANG = 'en'

// Deep merge: English fills in any key missing from a custom locale
function merge(base, override) {
  const result = { ...base }
  for (const k of Object.keys(override)) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]) && typeof base[k] === 'object') {
      result[k] = merge(base[k] || {}, override[k])
    } else {
      result[k] = override[k]
    }
  }
  return result
}

// Build merged dictionaries (all locales filled from Italian base)
const DICTS = Object.fromEntries(
  Object.entries(LOCALES).map(([code, { dict }]) => [code, merge(it, dict)])
)

// Context
const I18nContext = createContext({ lang: DEFAULT_LANG, t: it, setLang: () => {} })

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved && LOCALES[saved] ? saved : DEFAULT_LANG
  })

  const setLang = useCallback((code) => {
    if (!LOCALES[code]) return
    localStorage.setItem(STORAGE_KEY, code)
    setLangState(code)
    // Update <html lang="…"> for accessibility
    document.documentElement.lang = code
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const t = DICTS[lang] || it

  return (
    <I18nContext.Provider value={{ lang, t, setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

/** Returns the translation dict for the current locale */
export function useT() {
  return useContext(I18nContext).t
}

/** Returns { lang, setLang } */
export function useLang() {
  const { lang, setLang } = useContext(I18nContext)
  return { lang, setLang }
}

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

// index.html reads the same key before React loads, so a dark page does not
// flash light first. Change both together.
export const themeStorageKey = 'theme'

const darkQuery = '(prefers-color-scheme: dark)'

function storedTheme(): Theme {
  // Storage can throw outright (blocked site data), not only come back empty.
  try {
    const value = localStorage.getItem(themeStorageKey)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // Fall through to following the system.
  }
  return 'system'
}

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia(darkQuery).matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** The chosen theme, kept across visits and applied as `.dark` on `<html>`. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(storedTheme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return

    // Only System follows the OS; a fixed choice ignores it changing.
    const media = window.matchMedia(darkQuery)
    const follow = () => {
      applyTheme('system')
    }
    media.addEventListener('change', follow)
    return () => {
      media.removeEventListener('change', follow)
    }
  }, [theme])

  function setTheme(next: Theme) {
    try {
      // System is the absence of a choice, so it is stored as none.
      if (next === 'system') localStorage.removeItem(themeStorageKey)
      else localStorage.setItem(themeStorageKey, next)
    } catch {
      // The choice still applies for this visit.
    }
    setThemeState(next)
  }

  return { theme, setTheme }
}

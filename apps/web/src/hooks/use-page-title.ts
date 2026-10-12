import { useEffect } from 'react'

// The same name as <title> in index.html, which is what a page without this hook shows.
export const appTitle = 'Helpdesk'

/** Sets the tab title to `<title> · Helpdesk` while the calling page is mounted. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${appTitle}`
    // Restore the default, so a screen without a title of its own never keeps the last page's.
    return () => {
      document.title = appTitle
    }
  }, [title])
}

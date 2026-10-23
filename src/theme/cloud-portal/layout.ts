import { tv } from 'tailwind-variants'

/** The Cloud console: a bar with the server and account, sections in a sidebar. */
export const portalLayout = tv({
  slots: {
    page: 'flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-surface',
    bar: 'flex h-11 shrink-0 items-center gap-2 border-b border-border bg-panel px-4',
    barHome:
      'flex items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none',
    barTitle: 'text-xs font-semibold whitespace-nowrap',
    barHost: 'truncate text-[11px] text-muted max-sm:hidden',
    barEnd: 'ml-auto flex items-center gap-2',
    console: 'flex min-h-0 flex-1 max-md:flex-col',
    // Narrow screens turn the section list into one scrolling row above the page.
    nav: 'max-md:h-auto max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b max-md:pb-0',
    navGroup: 'max-md:flex-row max-md:items-center',
    navHeader: 'max-md:hidden',
    navItems: 'max-md:flex-row max-md:p-1',
    navItem: 'max-md:w-auto max-md:shrink-0',
    main: 'min-w-0 flex-1 overflow-y-auto',
    mainInner: 'mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 md:px-6',
    pageTitle: 'text-base font-semibold',
    pageDescription: 'mt-0.5 text-xs text-muted'
  }
})

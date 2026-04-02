export type DockTabKind = 'file' | 'diff' | 'terminal' | 'browser' | undefined

export const getDockTabToneClasses = (kind: DockTabKind, isActive: boolean): string => {
  if (kind === 'terminal') {
    return isActive
      ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100'
      : 'border-violet-200/70 bg-violet-50/80 text-violet-700 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20'
  }

  if (kind === 'diff') {
    return isActive
      ? 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-100'
      : 'border-sky-200/70 bg-sky-50/80 text-sky-700 hover:bg-sky-100 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20'
  }

  if (kind === 'browser') {
    return isActive
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100'
      : 'border-amber-200/70 bg-amber-50/80 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20'
  }

  return isActive
    ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
    : 'border-transparent bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:bg-neutral-800'
}

export const getDockTabIndicatorClasses = (kind: DockTabKind, isDirty: boolean): string => {
  if (kind === 'terminal') return 'bg-violet-500'
  if (kind === 'diff') return 'bg-sky-500/80'
  if (kind === 'browser') return 'bg-amber-500'
  return isDirty ? 'bg-amber-500' : 'bg-emerald-500/70'
}

export const getDockTabKindLabel = (kind: DockTabKind): string | null => {
  if (kind === 'terminal') return 'Term'
  if (kind === 'diff') return 'Diff'
  if (kind === 'browser') return 'Web'
  return null
}

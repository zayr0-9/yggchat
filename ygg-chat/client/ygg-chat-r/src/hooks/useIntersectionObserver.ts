import { useEffect, useRef, useState, RefObject } from 'react'

interface UseIntersectionObserverOptions {
  root?: Element | null
  rootMargin?: string
  threshold?: number | number[]
  enabled?: boolean
}

/**
 * Hook to observe when an element enters the viewport
 * Used for infinite scroll "load more" triggers
 *
 * @param options - IntersectionObserver options
 * @returns { ref, isIntersecting } - Ref to attach to sentinel element and intersection state
 */
export function useIntersectionObserver<T extends Element = HTMLDivElement>({
  root = null,
  rootMargin = '0px',
  threshold = 0,
  enabled = true,
}: UseIntersectionObserverOptions = {}): {
  ref: RefObject<T | null>
  isIntersecting: boolean
} {
  const ref = useRef<T | null>(null)
  const [isIntersecting, setIsIntersecting] = useState(false)

  useEffect(() => {
    if (!enabled || !ref.current) {
      setIsIntersecting(false)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting)
      },
      {
        root,
        rootMargin,
        threshold,
      }
    )

    observer.observe(ref.current)

    return () => {
      observer.disconnect()
    }
  }, [root, rootMargin, threshold, enabled])

  return { ref, isIntersecting }
}

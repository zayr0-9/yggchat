import React from 'react'
import { Link } from 'react-router-dom'
import { Logo } from './Logo'

interface FooterProps {
  isDark?: boolean
}

export const Footer: React.FC<FooterProps> = ({ isDark = true }) => {
  const supportEmail = 'support@yggchat.com'
  const [isCopied, setIsCopied] = React.useState(false)
  const copyTimeoutRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const triggerCopied = () => {
    setIsCopied(true)
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current)
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setIsCopied(false)
    }, 2000)
  }

  const handleCopyEmail = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(supportEmail)
        triggerCopied()
        return
      }
    } catch {
      // Fallback to mailto if clipboard write fails.
    }

    window.location.href = `mailto:${supportEmail}`
  }

  return (
    <footer className='bg-white dark:bg-black py-24 px-6 md:px-12 border-t border-zinc-200 dark:border-zinc-900 transition-colors duration-500'>
      <div className='max-w-7xl mx-auto flex flex-col md:flex-row justify-between gap-12'>
        <div className='max-w-sm'>
          <div className='flex items-center gap-3 mb-6'>
            <Logo className='w-8 h-8 text-zinc-900 dark:text-white' isDark={isDark} />
            <span className='text-xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white'>
              YGGDRASIL
            </span>
          </div>
          <p className='text-zinc-600 dark:text-zinc-500 text-sm leading-relaxed'>
            © 2026 Yggchat
            <br />
            Karanraj Singh t/a Yggchat.com <br></br>225, Whittock Road, Bristol, BS14 8DB
          </p>
        </div>
        <div className='flex flex-col md:flex-row gap-12'>
          <div>
            <h5 className='mono text-md font-bold uppercase text-[#0052FF] mb-6 tracking-widest'>Connect</h5>
            <ul className='space-y-3 text-sm font-medium text-zinc-800 dark:text-zinc-200'>
              <li>
                <a
                  href='https://x.com/yggdrasil__ai'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='hover:text-[#0052FF] transition-colors'
                >
                  Twitter
                </a>
              </li>
              <li>
                <a
                  href='https://discord.gg/tM42HaNxN3'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='hover:text-[#0052FF] transition-colors'
                >
                  Discord
                </a>
              </li>
              <li className='relative'>
                <a
                  href={`mailto:${supportEmail}`}
                  onClick={handleCopyEmail}
                  className='hover:text-[#0052FF] transition-colors'
                >
                  {supportEmail}
                </a>
                {isCopied ? (
                  <span
                    role='status'
                    className='absolute -top-7 left-0 rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white shadow-sm dark:bg-white dark:text-zinc-900'
                  >
                    Email copied
                  </span>
                ) : null}
              </li>
            </ul>
          </div>
          <div>
            <h5 className='mono text-md font-bold uppercase text-[#0052FF] mb-6 tracking-widest'>Legal</h5>
            <ul className='space-y-3 text-sm font-medium text-zinc-800 dark:text-zinc-200'>
              <li>
                <Link to='/terms' className='hover:text-[#0052FF] transition-colors'>
                  Terms
                </Link>
              </li>
              <li>
                <Link to='/refund-policy' className='hover:text-[#0052FF] transition-colors'>
                  Refunds
                </Link>
              </li>
              <li>
                <Link to='/privacy' className='hover:text-[#0052FF] transition-colors'>
                  Privacy
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className='max-w-7xl mx-auto mt-24'>
        <div className='text-[12vw] font-black tracking-tighter text-zinc-200 dark:text-zinc-900 leading-none select-none opacity-50 transition-colors duration-500'>
          ROOT ACCESS
        </div>
      </div>
    </footer>
  )
}

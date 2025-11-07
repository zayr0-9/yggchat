import React from 'react'

/**
 * Shared video background component that persists across route navigation.
 * Prevents video reload flashing when switching between pages.
 * Syncs with dark mode via document.documentElement.classList
 */
const VideoBackground: React.FC = () => {
  return (
    <>
      {/* Video Background - Light Mode */}
      <video
        autoPlay
        loop
        muted
        className='fixed inset-0 w-full h-full blur-[0px] dark:blur-[1px] 2xl:dark:blur-[1px] 2xl:blur-[1px] object-cover z-0 dark:hidden'
      >
        <source src='/video/l3.webm' type='video/webm' />
      </video>

      {/* Video Background - Dark Mode */}
      <video
        autoPlay
        loop
        muted
        className='fixed inset-0 w-full h-full blur-[1px] dark:blur-[1px] 2xl:dark:blur-[1px] 2xl:blur-[1px] object-cover z-0 hidden dark:block'
      >
        <source src='/video/d2.webm' type='video/webm' />
      </video>
    </>
  )
}

export default VideoBackground

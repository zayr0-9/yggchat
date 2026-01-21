import React from 'react'
import { ScrollReveal } from './ScrollReveal'

export const Comparison: React.FC = () => {
  return (
    <div className='space-y-12'>
      <ScrollReveal className='overflow-x-auto'>
        <div className='min-w-[800px] border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-10 transition-colors duration-500'>
          <div className='flex justify-between items-center mb-10 pb-4 border-b border-zinc-100 dark:border-zinc-900'>
            <div className='flex items-center gap-4'>
              <div className='w-1.5 h-10 bg-[#0052FF]' />
              <h3 className='text-2xl font-black uppercase text-zinc-900 dark:text-white tracking-tighter'>
                Legacy Agent Comparison
              </h3>
            </div>
            <span className='px-3 py-1 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-[10px] font-black uppercase tracking-widest rounded-full'>
              Market Reality
            </span>
          </div>

          <table className='w-full text-left'>
            <thead>
              <tr className='text-[18px] font-black uppercase text-zinc-400 border-b border-zinc-100 dark:border-zinc-900'>
                <th className='pb-6 w-1/4'>Feature</th>
                <th className='pb-6 w-1/3'>Claude Cowork</th>
                <th className='pb-6 w-1/3'>Yggdrasil</th>
              </tr>
            </thead>
            <tbody className='text-sm font-bold divide-y divide-zinc-100 dark:divide-zinc-900'>
              <tr>
                <td className='py-6 uppercase text-[11px] text-zinc-500 tracking-wider'>Architecture</td>
                <td className='py-6 text-zinc-800 dark:text-zinc-300'>Upload Folder & Tokenize</td>
                <td className='py-6 text-[#0052FF]'>Local Execution Runtime</td>
              </tr>
              <tr>
                <td className='py-6 uppercase text-[11px] text-zinc-500 tracking-wider'>Privacy</td>
                <td className='py-6 text-red-600'>Data Egress (Cloud)</td>
                <td className='py-6 text-emerald-600'>Zero Egress (Local)</td>
              </tr>
              <tr>
                <td className='py-6 uppercase text-[11px] text-zinc-500 tracking-wider'>Economics</td>
                <td className='py-6 text-zinc-800 dark:text-zinc-300'>$100-200/mo (High Overhead)</td>
                <td className='py-6 text-[#0052FF]'>Consumption Based</td>
              </tr>
              <tr>
                <td className='py-6 uppercase text-[11px] text-zinc-500 tracking-wider'>Scale</td>
                <td className='py-6 text-zinc-800 dark:text-zinc-300'>Limited by Context Window</td>
                <td className='py-6 text-[#0052FF]'>Infinite (Local Compute)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ScrollReveal>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-8'>
        <ScrollReveal className='p-8 border-2 border-zinc-100 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-900/40'>
          <h4 className='text-2xl font-black uppercase text-zinc-400 mb-4 tracking-widest'>The 100MB Problem</h4>
          <p className='text-zinc-600 dark:text-zinc-400 text-[17px] leading-relaxed'>
            To process a 100MB dataset, Claude Cowork must tokenize/upload the data. At $100/mo,{' '}
            <strong>one afternoon of work exhausts the profit margin</strong> of a seat.
          </p>
        </ScrollReveal>

        <ScrollReveal
          delay='reveal-delayed-1'
          className='p-8 border-2 border-[#0052FF]/20 bg-[#0052FF]/5 dark:bg-[#0052FF]/10'
        >
          <h4 className='text-2xl font-black uppercase text-[#0052FF] mb-4 tracking-widest'>The Yggdrasil Advantage</h4>
          <p className='text-zinc-800 dark:text-zinc-200 text-[17px] leading-relaxed'>
            Calculates answer locally using a custom app. Local runtime executes it. LLM only sees the 1KB result.{' '}
            <strong>10,000x more token-efficient.</strong>
          </p>
        </ScrollReveal>
      </div>

      <ScrollReveal className='border-t-2 border-dashed border-zinc-200 dark:border-zinc-800 pt-12 text-center'>
        <div className='inline-block border-2 border-[#0052FF] px-12 py-6 bg-white dark:bg-black group hover:bg-[#0052FF] transition-all duration-300'>
          <h3 className='text-3xl font-black uppercase text-[#0052FF] group-hover:text-white tracking-tighter'>
            Concurrency: Unlimited
          </h3>
          <p className='text-[14px] font-black text-zinc-400 group-hover:text-white/80 uppercase mt-1 tracking-[0.3em]'>
            Zero-Bottleneck, Multi-Threaded Reasoning Architecture
          </p>
        </div>
      </ScrollReveal>
    </div>
  )
}

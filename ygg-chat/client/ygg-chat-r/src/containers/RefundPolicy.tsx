import React from 'react'
import { Link } from 'react-router-dom'

const RefundPolicy: React.FC = () => {
  return (
    <div className='relative h-full min-h-screen w-full overflow-y-auto bg-white text-zinc-900 dark:bg-black dark:text-white'>
      <div className='pointer-events-none absolute inset-0 opacity-80'>
        <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,82,255,0.12),_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(0,82,255,0.2),_transparent_55%)]' />
        <div className='absolute inset-0 bg-[linear-gradient(to_right,rgba(24,24,27,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,24,27,0.08)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:80px_80px]' />
      </div>

      <header className='relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 md:px-12 py-6 border-b border-zinc-200 dark:border-zinc-900'>
        <Link
          to='/'
          className='mono text-[18px] tracking-[0.4em] text-white bg-zinc-900 px-3 py-2 uppercase hover:bg-zinc-800 hover:text-white/90 transition-colors'
        >
          ← Back
        </Link>
        <div className='flex items-center gap-3 text-[20px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>
          <span className='mono'>Legal Node</span>
          <span className='hidden sm:inline'>/</span>
          <span className='mono'>Refunds</span>
        </div>
        <Link
          to='/login'
          className='border-2 border-zinc-900 dark:border-white bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-white hover:bg-zinc-800 hover:border-zinc-800 dark:hover:border-white transition-colors'
        >
          Sign In
        </Link>
      </header>

      <main className='relative z-10 px-6 md:px-12 pb-24'>
        <section className='max-w-5xl mx-auto pt-16 md:pt-24'>
          <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[16px]'>[ Refund Protocol ]</span>
          <h1 className='text-5xl md:text-6xl font-black tracking-tighter mt-4'>Refund Policy</h1>
          <p className='mt-6 text-lg text-zinc-600 dark:text-zinc-300 max-w-3xl leading-relaxed'>
            Conditions, timelines, and procedures for billing refunds on Yggchat subscriptions.
          </p>
        </section>

        <section className='max-w-5xl mx-auto mt-10 border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm'>
          <div className='flex flex-wrap items-center justify-between gap-6 px-6 py-6 border-b border-zinc-200 dark:border-zinc-900'>
            <div>
              <p className='mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>Last Updated</p>
              <p className='text-lg font-semibold text-zinc-800 dark:text-zinc-100'>12 November 2025</p>
            </div>
            <div>
              <p className='mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>Contact</p>
              <a href='mailto:support@yggchat.com' className='text-lg font-semibold text-[#0052FF]'>
                support@yggchat.com
              </a>
            </div>
          </div>

          <div className='px-6 py-8 space-y-8 text-zinc-700 dark:text-zinc-300'>
            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>1. General Policy</h2>
              <p>
                You can cancel your subscription at any time through your account settings. When cancelled, you retain
                access until the end of your current billing period.
              </p>
              <p>
                All refunds are <strong>manually reviewed and approved by us</strong> and then <strong>processed by Stripe</strong>{' '}
                on our behalf to your original payment method.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>2. Refund Eligibility</h2>
              <p>We offer refunds in the following situations:</p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>Duplicate or accidental charges</li>
                <li>Technical issues preventing access to paid features</li>
                <li>
                  Pro-rated refunds requested within <strong>30 days</strong> of the most recent payment
                </li>
              </ul>
              <p>Refunds for digital access are limited by Stripe's terms and applicable law.</p>
              <p>Refunds are <strong>not</strong> provided for:</p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>Change of mind after significant use</li>
                <li>Failure to use the Service</li>
                <li>Renewals billed before cancellation</li>
              </ul>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>3. Pro-Rated Refunds</h2>
              <p>If we approve a pro-rated refund, it is based on the unused portion of your current billing period.</p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>The exact calculation and payment are executed by Stripe when we initiate the refund.</li>
                <li>All refunds are subject to Stripe's processing fees, which may reduce the refunded amount.</li>
                <li>
                  Once initiated, refunds are typically processed to the original payment method within{' '}
                  <strong>5–10 business days</strong> (subject to Stripe’s and your bank’s timelines).
                </li>
              </ul>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>4. How to Request a Refund</h2>
              <p>
                To request a refund, email <strong>support@yggchat.com</strong> with:
              </p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>The email linked to your Yggchat account</li>
                <li>Date and amount of the charge</li>
                <li>Reason for your refund request</li>
              </ul>
              <p>
                We manually review all refund requests for eligibility under this Policy. If your request is approved,
                we will initiate the refund through Stripe.
              </p>
              <p>
                We aim to respond to all refund requests within <strong>5 business days</strong>.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>5. Chargebacks</h2>
              <p>
                If you dispute a charge with your bank or card issuer without contacting us first, your account may be
                suspended pending review. Stripe handles chargeback disputes in accordance with their policies. We
                encourage you to contact <strong>support@yggchat.com</strong> first to attempt to resolve billing issues
                directly.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>6. Consumer Rights</h2>
              <p>
                Nothing in this Refund Policy limits your statutory rights under UK or international consumer
                protection laws.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>7. Contact</h2>
              <p>
                For refund or billing assistance, email: <strong>support@yggchat.com</strong>
              </p>
            </section>
          </div>
        </section>

        <section className='max-w-5xl mx-auto mt-10 border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm px-6 py-6'>
          <p className='mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400 mb-2'>Need help?</p>
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <p className='text-sm text-zinc-600 dark:text-zinc-300'>
              If you have questions about refunds, contact our team.
            </p>
            <a
              href='mailto:support@yggchat.com'
              className='inline-flex items-center gap-2 border-2 border-[#0052FF] px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-[#0052FF] hover:bg-[#0052FF] hover:text-white transition-colors'
            >
              Support
              <i className='bx bx-right-arrow-alt text-lg'></i>
            </a>
          </div>
        </section>
      </main>
    </div>
  )
}

export default RefundPolicy

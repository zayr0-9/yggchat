import React from 'react'
import { Link, useNavigate } from 'react-router-dom'

const RefundPolicy: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div className='h-screen overflow-hidden flex flex-col text-neutral-900 dark:text-neutral-100'>
      <div className='flex-1 overflow-y-auto py-12 px-6'>
        <div className='max-w-4xl mx-auto'>
          <button onClick={() => navigate('/')} className='mb-6 px-4 py-2 mica text-white rounded-lg transition-colors'>
            ← Back to Home
          </button>
          {/* Header */}
          <div className='mb-12 rounded-2xl p-8 mica'>
            <h1 className='text-4xl md:text-5xl font-bold text-stone-800 dark:text-neutral-100 mb-4'>
              Refund Policy — Yggchat
            </h1>
            <p className='text-lg text-neutral-900 dark:text-neutral-100 mx-auto'>
              <strong>Last Updated:</strong> 12 November 2025
              <br />
              <strong>Contact:</strong> support@yggchat.com
            </p>
          </div>

          <div className='bg-transparent mica rounded-2xl p-8 md:p-12'>
            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>1. General Policy</h2>
              <p className='mb-4 text-lg'>
                You can cancel your subscription at any time through your account settings.
                <br />
                When cancelled, you retain access until the end of your current billing period.
              </p>
              <p className='mb-4 text-lg'>
                All refunds are <strong>manually reviewed and approved by us</strong> and then{' '}
                <strong>processed by Stripe</strong> on our behalf to your original payment method.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>2. Refund Eligibility</h2>
              <p className='mb-4 text-lg'>We offer refunds in the following situations:</p>
              <ul className='list-disc ml-6 mb-4 text-lg'>
                <li>Duplicate or accidental charges</li>
                <li>Technical issues preventing access to paid features</li>
                <li>
                  Pro-rated refunds requested within <strong>30 days</strong> of the most recent payment
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                Refunds for digital access are limited by Stripe's terms and applicable law.
              </p>
              <p className='mb-4 text-lg'>
                Refunds are <strong>not</strong> provided for:
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg'>
                <li>Change of mind after significant use</li>
                <li>Failure to use the Service</li>
                <li>Renewals billed before cancellation</li>
              </ul>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>3. Pro-Rated Refunds</h2>
              <p className='mb-4 text-lg'>
                If we approve a pro-rated refund, it is based on the unused portion of your current billing period.
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg'>
                <li>The exact calculation and payment are executed by Stripe when we initiate the refund.</li>
                <li>All refunds are subject to Stripe's processing fees, which may reduce the refunded amount.</li>
                <li>
                  Once initiated, refunds are typically processed to the original payment method within{' '}
                  <strong>5–10 business days</strong> (subject to Stripe’s and your bank’s timelines).
                </li>
              </ul>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>4. How to Request a Refund</h2>
              <p className='mb-4 text-lg'>
                To request a refund, email <strong>support@yggchat.com</strong> with:
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg'>
                <li>The email linked to your Yggchat account</li>
                <li>Date and amount of the charge</li>
                <li>Reason for your refund request</li>
              </ul>
              <p className='mb-4 text-lg'>
                We manually review all refund requests for eligibility under this Policy.
                <br />
                If your request is approved, we will initiate the refund through Stripe.
              </p>
              <p className='mb-4 text-lg'>
                We aim to respond to all refund requests within <strong>5 business days</strong>.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>5. Chargebacks</h2>
              <p className='mb-4 text-lg'>
                If you dispute a charge with your bank or card issuer without contacting us first, your account may be
                suspended pending review.
                <br />
                Stripe handles chargeback disputes in accordance with their policies.
                <br />
                We encourage you to contact <strong>support@yggchat.com</strong> first to attempt to resolve billing
                issues directly.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>6. Consumer Rights</h2>
              <p className='mb-4 text-lg'>
                Nothing in this Refund Policy limits your statutory rights under UK or international consumer protection
                laws.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>7. Contact</h2>
              <p className='mb-4 text-lg'>
                For refund or billing assistance, email:
                <br />
                <strong>support@yggchat.com</strong>
              </p>
            </section>
          </div>
        </div>
      </div>
      <footer className='relative z-10 w-full border-t border-white/10 bg-neutral-900/30 backdrop-blur-md font-sans'>
        <div className='max-w-[1400px] mx-auto px-6 py-4 flex flex-col lg:flex-row items-center justify-between gap-4 text-xs'>
          {/* LEFT SIDE: Copyright + Business Info (Merged perfectly) */}
          <div className='flex flex-col md:flex-row items-center gap-2 md:gap-4 text-center md:text-left'>
            {/* Copyright */}
            <span className='text-neutral-300 font-medium'>© {new Date().getFullYear()} Yggchat</span>
            {/* Desktop Divider */}
            <span className='hidden md:block text-white/10 h-3 border-l border-white/10'></span>

            {/* Business Details - Subtle & Horizontal */}
            <div className='flex flex-wrap justify-center md:justify-start gap-x-3 text-neutral-500'>
              <span>[Karanraj Singh] t/a Yggchat.com</span>
              <span className='hidden sm:inline'>•</span>
              <span>[225, Whittock Road, Bristol, BS14 8DB]</span>
              <span className='hidden sm:inline'>•</span>
              <a href='mailto:support@yggchat.com' className='hover:text-neutral-300 transition-colors'>
                support@yggchat.com
              </a>
            </div>
          </div>

          {/* RIGHT SIDE: Legal Links (Using proper Link tags for Stripe bots) */}
          <div className='flex items-center gap-6 text-neutral-400'>
            <Link to='/terms' className='hover:text-white transition-colors'>
              Terms
            </Link>
            <Link to='/privacy' className='hover:text-white transition-colors'>
              Privacy
            </Link>
            <Link to='/refund-policy' className='hover:text-white transition-colors'>
              Refunds
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default RefundPolicy

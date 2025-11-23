import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
const RefundPolicy: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div className='h-screen overflow-hidden flex flex-col dark:bg-blue-900 bg-blue-200 text-neutral-900 dark:text-neutral-100'>
      <div className='flex-1 overflow-y-auto py-12 px-6'>
        <div className='max-w-4xl mx-auto'>
          <button onClick={() => navigate('/')} className='mb-6 px-4 py-2 mica text-white rounded-lg transition-colors'>
            ← Back to Home
          </button>
          {/* Header */}
          <div className='mb-12 rounded-2xl p-8 mica'>
            <h1 className='text-4xl md:text-5xl font-bold text-stone-800 dark:text-neutral-100 mb-4'>
              Refund Policy — Yggchat.com
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
                To request a refund, email support@yggchat.com with:
                <br />
                • The email linked to your Yggchat.com account
                <br />
                • Date and amount of the charge
                <br />
                • Reason for your refund request
                <br />
                <br />
                We manually review all refund requests for eligibility under this Policy. If your request is approved,
                we will initiate the refund through Stripe. We aim to respond to all refund requests within 5 business
                days.
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
                If approved, refunds are calculated based on the unused portion of your current billing period (less any
                transaction fees). All refunds are subject to Stripe's processing fees, which may reduce the refunded
                amount and are governed by Stripe's Services Agreement.
              </p>
              <p className='mb-4 text-lg'>
                Refunds are processed to the original payment method within <strong>5–10 business days</strong> (subject
                to Stripe's timelines and banking delays).
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>4. How to Request a Refund</h2>
              <p className='mb-4 text-lg'>
                Pro-rated refunds are handled automatically by Stripe upon eligible cancellation or issuance—no manual
                request is required. For non-standard cases (e.g., duplicate charges or technical issues), trigger the
                refund via your Stripe account dashboard or contact Stripe support. For eligibility concerns or
                assistance with Stripe processes, email support@yggchat.com. We respond within{' '}
                <strong>5 business days</strong> and coordinate if needed.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>5. Chargebacks</h2>
              <p className='mb-4 text-lg'>
                If you dispute a charge without contacting us first, your account may be suspended pending review.
                Stripe handles chargeback disputes per their policies. We encourage you to contact support to resolve
                billing issues directly to avoid fees or suspensions.
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
      <footer className='relative z-10 py-4 px-6 text-center border-t border-white/10 bg-neutral-900/30'>
        <div className='max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4'>
          <div className='text-sm text-neutral-200'>©{new Date().getFullYear()} Yggdrasil. All rights reserved.</div>

          <div className='flex items-center gap-6'>
            <Link to='/terms' className='text-sm text-neutral-200 hover:text-white transition-colors'>
              Terms of Service
            </Link>
            <span className='text-neutral-400'>|</span>
            <Link to='/privacy' className='text-sm text-neutral-200 hover:text-white transition-colors'>
              Privacy Policy
            </Link>
            <span className='text-neutral-400'>|</span>
            <Link to='/refund-policy' className='text-sm text-neutral-200 hover:text-white transition-colors'>
              Refund Policy
            </Link>
          </div>
        </div>

        {/* NEW: Add business address/contact for Stripe/UK compliance */}
        <div className='max-w-7xl mx-auto mt-4 pt-4 border-t border-white/5'>
          <p className='text-xs text-neutral-400 leading-relaxed'>
            <strong>[Your Full Legal Name]</strong>, Sole Trader trading as Yggdrasil
            <br />
            <strong>[Full UK Address]</strong>
            <br />
            e.g., 123 Example Street, London, SW1A 1AA
            <br />
            <a href='mailto:support@yggchat.com' className='hover:text-white transition-colors'>
              support@yggchat.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

export default RefundPolicy

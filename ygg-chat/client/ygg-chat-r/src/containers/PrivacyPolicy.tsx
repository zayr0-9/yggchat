import React from 'react'
import { Link, useNavigate } from 'react-router-dom'

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div className='h-screen overflow-hidden flex flex-col text-neutral-900 dark:text-neutral-100'>
      <div className='flex-1 overflow-y-auto py-12 px-6'>
        <div className='max-w-4xl mx-auto'>
          <button onClick={() => navigate('/')} className='mb-6 px-4 py-2 mica text-white rounded-lg transition-colors'>
            ← Back to Home
          </button>
          {/* Header */}
          <div className='text-left p-8 mb-12 mica rounded-2xl'>
            <h1 className='text-4xl md:text-5xl font-bold text-stone-800 dark:text-neutral-100 mb-4'>
              Privacy Policy — Yggchat
            </h1>
            <div className='text-lg text-neutral-900 px-2 dark:text-neutral-100 mx-auto space-y-2'>
              <p>
                <strong>Effective Date:</strong> 12 November 2025
              </p>
              <p>
                <strong>Last Updated:</strong> 12 November 2025
              </p>
              <p>
                <strong>Operator/Data Controller:</strong> An independent UK-based developer operating as Yggchat (“we”,
                “our”, or “us”)
              </p>
              <p>
                <strong>Contact:</strong> support@yggchat.com
              </p>
              <p>
                <strong>Data Protection Officer:</strong> Not applicable (as a small UK-based developer); contact
                support for data matters.
              </p>
            </div>
          </div>

          <div className='bg-transparent mica rounded-2xl p-8 md:p-12'>
            <p className='mb-8 text-lg'>
              This Privacy Policy explains how an independent UK-based developer operating Yggchat (“we”, “Service”, or
              the “Platform”) collects, uses, stores, and protects your personal data when you use our online chat and
              AI messaging service. We are committed to protecting your privacy and complying with the UK General Data
              Protection Regulation (UK GDPR) and other applicable data protection laws. By using the Service, you
              consent to the practices described here.
            </p>
            <p className='mb-8 text-lg'>
              If you do not agree, please do not use the Service. For questions, contact support@yggchat.com. This
              Policy forms part of our{' '}
              <a href='/terms' className='text-blue-600 dark:text-blue-400 hover:underline'>
                Terms of Service
              </a>
              .
            </p>

            <hr className='border-neutral-400 dark:border-neutral-600 my-8' />

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>1. Information We Collect</h2>
              <p className='mb-4 text-lg'>
                We collect the minimum data necessary to provide and improve the Service. Types of data include:
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Account and Profile Data</strong>: Email address, username, password (hashed), and age
                  verification (to confirm 18+ eligibility).
                </li>
                <li>
                  <strong>Usage and Content Data</strong>: Chat messages, AI interactions, and user-generated content
                  you create or share. This is stored to enable platform functionality.
                </li>
                <li>
                  <strong>Payment Data</strong>: If you subscribe, billing details (e.g., name, email) via Stripe. We do
                  not store full payment card details—Stripe handles this securely under PCI DSS.
                </li>
                <li>
                  <strong>Technical Data</strong>: Device info (e.g., IP address, browser type), usage logs (e.g.,
                  session times), and analytics data to improve performance.
                </li>
                <li>
                  <strong>PC app Data (Desktop Feature)</strong>: In the <strong>PC app</strong>, enabling{' '}
                  <strong>Privacy Mode</strong> allows chats and AI data to be collected and processed only on your
                  device (locally stored). No data from the PC app in Privacy Mode is sent to our servers, which
                  enhances privacy.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                We do <strong>not</strong> intentionally collect sensitive personal data (e.g., health, political views)
                unless you voluntarily share it in chats (which we advise against).
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>2. How We Collect Data</h2>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Directly from You</strong>: During account creation, subscriptions, or chats.
                </li>
                <li>
                  <strong>Automatically</strong>: Via cookies, logs, and analytics tools (e.g., for crash reporting or
                  usage insights).
                </li>
                <li>
                  <strong>From Third Parties</strong>: Stripe for payment processing; limited analytics providers (e.g.,
                  Google Analytics if used—see Section 6). We do not buy or receive data from advertisers.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                In the PC app with Privacy Mode enabled, data collection is device-local only—no server transmission
                occurs unless you explicitly sync or export it.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>3. How We Use Your Data</h2>
              <p className='mb-4 text-lg'>We use data solely to:</p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>Provide and maintain the Service (e.g., hosting chats, AI responses).</li>
                <li>Process payments and subscriptions (via Stripe).</li>
                <li>Improve the platform (e.g., anonymized analytics for bug fixes and performance).</li>
                <li>Communicate with you (e.g., support emails, billing notices, important service updates).</li>
                <li>Ensure compliance (e.g., age checks, fraud detection).</li>
                <li>Enforce our Terms (e.g., moderating prohibited content).</li>
              </ul>
              <p className='mb-4 text-lg'>
                Data is retained only as long as necessary for these purposes or until you delete your account (see
                Section 5). In the PC app with Privacy Mode, local data is managed by you and is not retained by us
                beyond what is necessary for any optional sync features you enable.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>4. Data Storage and Security</h2>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Storage Duration</strong>: We store your data until you delete your account or request erasure
                  (subject to legal retention, e.g., 6 years for billing under UK tax law). Upon deletion, all
                  associated data (e.g., chats, profile) is permanently removed from our servers within 30 days, except
                  for anonymized aggregates.
                </li>
                <li>
                  <strong>Local Storage (PC app)</strong>: In the PC app with Privacy Mode, data is stored on your
                  device only. You control deletion—for example, via app settings or by removing the app or data from
                  your device.
                </li>
                <li>
                  <strong>Security Measures</strong>: Data is encrypted in transit (HTTPS/TLS) and at rest where
                  applicable (e.g., encrypted storage). We use access controls, regular checks, and rely on Stripe for
                  PCI DSS-compliant payment processing. As a small developer, we limit access to essential personnel
                  only.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                We store data primarily in the UK/EU (e.g., secure cloud providers compliant with GDPR adequacy).
                Transfers outside (e.g., to US-based Stripe) rely on appropriate safeguards such as Standard Contractual
                Clauses.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>5. Your Data Rights (GDPR)</h2>
              <p className='mb-4 text-lg'>
                Under UK GDPR, you have rights regarding your data. Email support@yggchat.com to exercise them—we
                respond within 1 month (free, unless requests are excessive or repetitive):
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Access</strong>: Request a copy of your data.
                </li>
                <li>
                  <strong>Rectification</strong>: Correct inaccurate or incomplete data.
                </li>
                <li>
                  <strong>Erasure ("Right to be Forgotten")</strong>: Delete your data/account. For PC app data, you
                  must delete it directly from your device.
                </li>
                <li>
                  <strong>Restriction/Objection</strong>: Limit or object to certain processing (e.g., analytics,
                  marketing—note that we do not run targeted third-party ads).
                </li>
                <li>
                  <strong>Portability</strong>: Receive data in a machine-readable format, where technically feasible.
                </li>
                <li>
                  <strong>Withdraw Consent</strong>: Where processing relies on consent (e.g., certain cookies), you can
                  withdraw it at any time.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                For account deletion: Log in &gt; Settings &gt; Delete Account (where available) or contact support.
                This revokes access and erases server-side data. PC app data must be removed by you locally.
              </p>
              <p className='mb-4 text-lg'>
                If you are unhappy with our handling of your data, you can complain to the UK Information Commissioner's
                Office (ICO) at ico.org.uk.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>6. Sharing Your Data</h2>
              <p className='mb-4 text-lg'>
                We do <strong>not</strong> sell your data. We share it only with:
              </p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Service Providers</strong>: Stripe (for payments), cloud hosting providers, and analytics or
                  error-reporting services (for aggregated or pseudonymised insights). All are required to follow data
                  protection laws and act only on our instructions.
                </li>
                <li>
                  <strong>Legal and Safety</strong>: Authorities or third parties where required by law, court order, or
                  to protect rights, property, or safety.
                </li>
                <li>
                  <strong>Business Transfers</strong>: In the event of a sale, merger, or similar transaction, user data
                  may transfer to a successor entity, with notice given.
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                In the PC app with Privacy Mode, data is not shared with us or third parties unless you choose to sync
                or export it.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>7. Cookies and Tracking</h2>
              <p className='mb-4 text-lg'>We use:</p>
              <ul className='list-disc ml-6 mb-4 text-lg space-y-2'>
                <li>
                  <strong>Essential Cookies</strong>: Needed for login, security, and core functionality.
                </li>
                <li>
                  <strong>Optional Analytics</strong>: To understand usage and improve the Service (only where legally
                  permitted and, if needed, with your consent).
                </li>
              </ul>
              <p className='mb-4 text-lg'>
                You can manage cookies in your browser or device settings. For more details, contact
                support@yggchat.com.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>8. Children's Privacy</h2>
              <p className='mb-4 text-lg'>
                The Service is intended for users <strong>18+</strong>. We do not knowingly collect data from anyone
                under 18. If we learn that we have collected such data, we will delete it as soon as reasonably
                possible.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>9. International Users</h2>
              <p className='mb-4 text-lg'>
                Your data may be processed in the UK or other countries with adequate protections (e.g., EU/EEA) or
                under appropriate safeguards (e.g., Standard Contractual Clauses for transfers to the US).
              </p>
              <p className='mb-4 text-lg'>
                We apply UK GDPR standards regardless of where you are located and will try to respect additional local
                rights where relevant.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>10. Changes to This Policy</h2>
              <p className='mb-4 text-lg'>We may update this Privacy Policy from time to time.</p>
              <p className='mb-4 text-lg'>
                The current version is always available at:{' '}
                <a href='https://yggchat.com/privacy' className='text-blue-600 dark:text-blue-400 hover:underline'>
                  https://yggchat.com/privacy
                </a>
              </p>
              <p className='mb-4 text-lg'>
                If we make material changes, we will notify you by email or via prominent notice in the Service.
                Continued use after changes means you accept the updated Policy.
              </p>
            </section>

            <section className='mb-8'>
              <h2 className='text-2xl font-bold mb-4'>11. Contact</h2>
              <p className='mb-4 text-lg'>
                For privacy questions, data requests, or concerns, contact:
                <br />
                <strong>Email:</strong> support@yggchat.com
              </p>
              <p className='mb-4 text-lg'>
                We aim to respond within <strong>5 business days</strong>. For unresolved issues relating to UK GDPR,
                you may contact the ICO.
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

export default PrivacyPolicy

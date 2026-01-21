import React from 'react'
import { Link } from 'react-router-dom'

const PrivacyPolicy: React.FC = () => {
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
          <span className='mono'>Privacy</span>
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
          <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[16px]'>[ Privacy Matrix ]</span>
          <h1 className='text-5xl md:text-6xl font-black tracking-tighter mt-4'>Privacy Policy</h1>
          <p className='mt-6 text-lg text-zinc-600 dark:text-zinc-300 max-w-3xl leading-relaxed'>
            How Yggchat collects, stores, and protects information across web and desktop experiences.
          </p>
        </section>

        <section className='max-w-5xl mx-auto mt-10 border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm'>
          <div className='flex flex-wrap items-center justify-between gap-6 px-6 py-6 border-b border-zinc-200 dark:border-zinc-900'>
            <div>
              <p className='mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400'>Effective Date</p>
              <p className='text-lg font-semibold text-zinc-800 dark:text-zinc-100'>12 November 2025</p>
            </div>
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
              <p>
                This Privacy Policy explains how an independent UK-based developer operating Yggchat (“we”, “Service”,
                or the “Platform”) collects, uses, stores, and protects your personal data when you use our online chat
                and AI messaging service. We are committed to protecting your privacy and complying with the UK General
                Data Protection Regulation (UK GDPR) and other applicable data protection laws.
              </p>
              <p>
                If you do not agree, please do not use the Service. For questions, contact support@yggchat.com. This
                Policy forms part of our{' '}
                <Link to='/terms' className='underline hover:text-[#0052FF]'>
                  Terms of Service
                </Link>
                .
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>1. Information We Collect</h2>
              <p>We collect the minimum data necessary to provide and improve the Service. Types of data include:</p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>
                  <strong>Account and Profile Data</strong>: Email address and username.
                </li>
                <li>
                  <strong>Usage and Content Data</strong>: Chat messages, AI interactions, and user-generated content
                  you create or share <strong>only in cloud mode</strong>. This is stored to enable platform
                  functionality. We collect no chat or AI interaction related information when the project is in
                  <strong> Local Mode</strong>.
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
                  <strong>Local Mode</strong> allows chats and AI data to be collected and processed only on your
                  <strong> device (locally stored)</strong>. No data from the PC app in Local Mode is sent to our
                  servers, which enhances privacy. When creating a project, select storage location as{' '}
                  <strong>Local Only</strong>.
                </li>
              </ul>
              <p>
                We do <strong>not</strong> intentionally collect sensitive personal data (e.g., health, political views)
                unless you voluntarily share it in chats (which we advise against).
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>2. How We Collect Data</h2>
              <ul className='list-disc ml-6 space-y-2'>
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
              <p>
                In the PC app with Privacy Mode enabled, data collection is device-local only—no server transmission
                occurs unless you explicitly sync or export it.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>3. How We Use Your Data</h2>
              <p>We use data solely to:</p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>Provide and maintain the Service (e.g., hosting chats, AI responses).</li>
                <li>Process payments and subscriptions (via Stripe).</li>
                <li>Improve the platform (e.g., anonymized analytics for bug fixes and performance).</li>
                <li>Communicate with you (e.g., support emails, billing notices, important service updates).</li>
                <li>Ensure compliance (e.g., age checks, fraud detection).</li>
                <li>Enforce our Terms (e.g., moderating prohibited content).</li>
              </ul>
              <p>
                Data is retained only as long as necessary for these purposes or until you delete your account (see
                Section 5). In the PC app with Privacy Mode, local data is managed by you and is not retained by us
                beyond what is necessary for any optional sync features you enable.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>4. Data Storage and Security</h2>
              <ul className='list-disc ml-6 space-y-2'>
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
              <p>
                We store data primarily in the UK/EU (e.g., secure cloud providers compliant with GDPR adequacy).
                Transfers outside (e.g., to US-based Stripe) rely on appropriate safeguards such as Standard Contractual
                Clauses.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>5. Your Data Rights (GDPR)</h2>
              <p>
                Under UK GDPR, you have rights regarding your data. Email support@yggchat.com to exercise them—we
                respond within 1 month (free, unless requests are excessive or repetitive):
              </p>
              <ul className='list-disc ml-6 space-y-2'>
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
              <p>
                For account deletion: Log in &gt; Settings &gt; Delete Account (where available) or contact support. This
                revokes access and erases server-side data. PC app data must be removed by you locally.
              </p>
              <p>
                If you are unhappy with our handling of your data, you can complain to the UK Information
                Commissioner's Office (ICO) at ico.org.uk.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>6. Sharing Your Data</h2>
              <p>
                We do <strong>not</strong> sell your data. We share it only with:
              </p>
              <ul className='list-disc ml-6 space-y-2'>
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
              <p>
                In the PC app with Privacy Mode, data is not shared with us or third parties unless you choose to sync
                or export it.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>7. Cookies and Tracking</h2>
              <p>We use:</p>
              <ul className='list-disc ml-6 space-y-2'>
                <li>
                  <strong>Essential Cookies</strong>: Needed for login, security, and core functionality.
                </li>
                <li>
                  <strong>Optional Analytics</strong>: To understand usage and improve the Service (only where legally
                  permitted and, if needed, with your consent).
                </li>
              </ul>
              <p>
                You can manage cookies in your browser or device settings. For more details, contact
                support@yggchat.com.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>8. Children's Privacy</h2>
              <p>
                The Service is intended for users <strong>18+</strong>. We do not knowingly collect data from anyone
                under 18. If we learn that we have collected such data, we will delete it as soon as reasonably
                possible.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>9. International Users</h2>
              <p>
                Your data may be processed in the UK or other countries with adequate protections (e.g., EU/EEA) or
                under appropriate safeguards (e.g., Standard Contractual Clauses for transfers to the US).
              </p>
              <p>
                We apply UK GDPR standards regardless of where you are located and will try to respect additional local
                rights where relevant.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>10. Changes to This Policy</h2>
              <p>We may update this Privacy Policy from time to time.</p>
              <p>
                The current version is always available at:{' '}
                <a href='https://yggchat.com/privacy' className='underline hover:text-[#0052FF]'>
                  https://yggchat.com/privacy
                </a>
              </p>
              <p>
                If we make material changes, we will notify you by email or via prominent notice in the Service.
                Continued use after changes means you accept the updated Policy.
              </p>
            </section>

            <section className='space-y-3'>
              <h2 className='text-xl font-bold text-zinc-900 dark:text-white'>11. Contact</h2>
              <p>
                For privacy questions, data requests, or concerns, contact:
                <br />
                <strong>Email:</strong> support@yggchat.com
              </p>
              <p>
                We aim to respond within <strong>5 business days</strong>. For unresolved issues relating to UK GDPR,
                you may contact the ICO.
              </p>
            </section>
          </div>
        </section>

        <section className='max-w-5xl mx-auto mt-10 border-2 border-zinc-200 dark:border-zinc-900 bg-white/80 dark:bg-zinc-950/70 backdrop-blur-sm px-6 py-6'>
          <p className='mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400 mb-2'>Need help?</p>
          <div className='flex flex-wrap items-center justify-between gap-4'>
            <p className='text-sm text-zinc-600 dark:text-zinc-300'>
              If you have questions about privacy, contact our team.
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

export default PrivacyPolicy

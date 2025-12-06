import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button/button'

interface FaqItem {
  question: string
  answer: string[]
}

interface FaqSection {
  title: string
  items: FaqItem[]
}

const FAQPage: React.FC = () => {
  const sections = useMemo<FaqSection[]>(
    () => [
      {
        title: 'Product Overview & Core Concept',
        items: [
          {
            question: 'What is Yggdrasil and how is it different from ChatGPT, Claude, or other AI interfaces?',
            answer: [
              'Yggdrasil is a branching-first AGI interface. Instead of locking you into a linear chat, every message can be edited and branched so you can explore alternatives without losing history.',
              'Linear chats force you to pick one path; Yggdrasil keeps all paths in one tree so you can compare, iterate, and reroll from any point.',
            ],
          },
          {
            question: 'What does "the most advanced AGI interface" mean?',
            answer: [
              "LLMs can feel like slot machines—lucky or unlucky per run. We call it an 'Artificial Gacha Interface' to acknowledge that randomness. Yggdrasil gives you the most powerful controls to use any 'AGI' model effectively.",
              'Branching, model routing, and agentic control together make it the most capable interface to harness modern models.',
            ],
          },
          {
            question: 'Who is Yggdrasil built for?',
            answer: [
              'Developers, researchers, enterprises, and power users who need rigorous control over context, branching, and models.',
            ],
          },
          {
            question: 'Do I still need accounts with OpenAI, Anthropic, etc.?',
            answer: [
              'No. We use OpenRouter as the provider and offer 400+ models—no separate provider accounts needed.',
            ],
          },
        ],
      },
      {
        title: 'Branching & Conversation Management',
        items: [
          {
            question: 'How does branching work? Can I really branch from any message?',
            answer: [
              'Yes. Under each message is a control panel. Click edit to modify in place, or branch to send the edited message and create a new branch. The branch shows up in the tree view.',
            ],
          },
          {
            question: "What's the difference between a branch and a regular chat?",
            answer: [
              'Work rarely succeeds in one shot. Branching mirrors iterative thinking—explore multiple takes before committing. A branch is just a focused path you can iterate on without losing others.',
            ],
          },
          {
            question: 'How many branches can I create? Are there limits?',
            answer: [
              'No limits on branch count or depth. We use occlusion (like in games) to cull non-visible nodes and keep performance constant.',
            ],
          },
          {
            question: 'Can I merge branches or combine insights from different paths?',
            answer: [
              'Yes. In tree view, right-click, hold, and drag to select a branch or messages. An options menu lets you start a new chat with the selected messages in order, or copy them.',
              'Use the Notes panel (bottom right) as a scratchpad. Right-click selected text in any message to send it to Notes.',
            ],
          },
          {
            question: 'What happens if I delete a branch? Is my data gone forever?',
            answer: ['Yes. Deleting a branch permanently removes its data.'],
          },
        ],
      },
      {
        title: 'Context Management & Cost Control',
        items: [
          {
            question: 'How does Yggdrasil save me money on API costs?',
            answer: [
              'Spin subtopics into their own branches. Each branch stays short, lowering context tokens per call and improving model quality. Avoids paying for bloated, mixed-topic context.',
            ],
          },
          {
            question: 'What is "context rot" and how do you prevent it?',
            answer: [
              'Context rot = performance drops as context grows and diverges. Branching keeps context short and topic-pure, preventing drift and hallucinations.',
            ],
          },
          {
            question: 'Can I control what context is sent to the model?',
            answer: [
              'Yes. Set a project-level system prompt/context plus a chat-level system prompt/context; they append. You can also edit agent responses and tool calls, and manually prune/compact if you want.',
            ],
          },
          {
            question: 'How much context can I keep in a branch?',
            answer: [
              'Depends on the selected LLM. Click the three-dot menu next to a model name to see its context window.',
            ],
          },
          {
            question: 'Will branching increase my costs since I have multiple conversations?',
            answer: [
              'No. Only the currently selected branch is sent to the model. Parallel branches do not add cost unless used.',
            ],
          },
        ],
      },
      {
        title: 'Agentic Features & Security',
        items: [
          {
            question: 'What are AI agents in Yggdrasil and how do they work?',
            answer: [
              'Yggdrasil ships with Valkyrie, a custom agent. Tools are listed in the chat settings panel (cog on input). Enable/disable what you want.',
              'Valkyrie can read/edit/create/delete files, browse directories, search files, manage todos, search the web, browse web, and run terminal (local mode). In cloud mode: only web search/browse web in app; on website: web search only for now.',
            ],
          },
          {
            question: 'How do permissions work for agents? Can they access my files?',
            answer: [
              'On the chat input, click the three-dot button to set CWD. Agents are sandboxed to that path. VS Code extension can auto-fill your project path.',
              'Valkyrie tools are blocked from paths outside the CWD.',
            ],
          },
          {
            question: "What's the difference between Chat mode and Agent mode?",
            answer: [
              'Chat mode: tool calls (except web search/browse/todo) are denied; the agent must stay in plan mode. Agent mode lifts that block but still respects the allow/don’t allow/allow all permissions layer.',
            ],
          },
          {
            question: 'Can agents maintain state across multiple steps?',
            answer: [
              'Yes. Valkyrie keeps execution state within the branch without bloating global context—stateful runs, minimal token waste.',
            ],
          },
        ],
      },
      {
        title: 'Model Routing & Performance',
        items: [
          {
            question: 'What models does Yggdrasil support?',
            answer: [
              '400+ models via OpenRouter, including Gemini-3, GPT 5.1 Codex Max, Claude Opus 4.5, many open-source and smaller-lab models. Yggdrasil surfaces the newest models fast.',
            ],
          },
          {
            question: 'How does model routing work? Can I switch models mid-conversation?',
            answer: [
              'Yes. Before sending a message or branching, change the model. Use a strong model for planning, a cheaper one for execution or web search. Mix and match per branch.',
            ],
          },
          {
            question: 'Can I compare different models on the same prompt?',
            answer: ['Yes. Branch the same prompt across multiple models to A/B test outputs side by side.'],
          },
          {
            question: 'What are specialized models and when should I use them?',
            answer: [
              'We recommend GPT 5.1 Codex Max (our build workhorse). Other great options: Gemini-3 and Claude family. You can also plan in Yggdrasil and use Claude Code integration (Anthropic harness) to implement within Yggdrasil.',
            ],
          },
        ],
      },
      {
        title: 'Privacy & Data Ownership',
        items: [
          {
            question: 'What does "local-first operation" mean?',
            answer: [
              'You can keep projects/chats entirely on your local PC in a user-accessible SQLite DB. We store nothing for local-mode chats. Cloud-mode projects are stored by us.',
            ],
          },
          {
            question: 'Will my code and conversations be used for training AI models?',
            answer: [
              'We do not store messages in Local Mode. Provider policies are shown to you; you can pick privacy-focused models.',
            ],
          },
          {
            question: 'Can I export my data? In what formats?',
            answer: ['Data is in a simple user-accessible SQLite .db file. A friendlier export is in development.'],
          },
          {
            question: 'What happens if my account is suspended? Do I lose my work?',
            answer: [
              'We comply with legal requirements. Illegal activity can lead to suspension. Your local data remains available to you.',
            ],
          },
        ],
      },
      {
        title: 'Technical & Getting Started',
        items: [
          {
            question: 'How do I get started with Yggdrasil?',
            answer: [
              'Log in with Google or GitHub. Open the default Quick Chat project or create your own. Free users get 50 free messages.',
              'You can also try the Yggdrasil App from the download button on the homepage. Windows/macOS may show SmartScreen; we are working on signed builds. Linux has no such issues.',
            ],
          },
          {
            question: 'What platforms does Yggdrasil support?',
            answer: ['Web, Linux, macOS, and Windows desktop app.'],
          },
          {
            question: 'Do you offer an API or SDK for integration?',
            answer: ['Not yet. Custom MCP and Tool integration are on the roadmap.'],
          },
          {
            question: 'Can I import my conversation history from ChatGPT/Claude?',
            answer: ['Not currently.'],
          },
        ],
      },
      {
        title: 'Pricing & Plans',
        items: [
          {
            question: 'How much does Yggdrasil cost?',
            answer: [
              'Three tiers: Basic (daily assistant, non-dev), Pro (>2x usage, ideal for developers), Ultra (max usage for power users).',
            ],
          },
          {
            question: 'Do I pay you or the model providers directly?',
            answer: ['You pay Yggdrasil. Providers do not access your personal or financial info.'],
          },
          {
            question: 'Is there a free tier or trial?',
            answer: ['Yes. On sign-in, you get 50 free messages.'],
          },
          {
            question: 'What happens if I exceed my usage limits?',
            answer: ['We notify you when you run out of credits.'],
          },
        ],
      },
      {
        title: 'Use Cases & Best Practices',
        items: [
          {
            question: "What's the best way to use branches for software development?",
            answer: [
              'Use Chat mode to explore the problem and its subtopics in separate branches. Once you have a holistic view, guide the model to produce a detailed plan.',
              'Then switch to the best agentic model and ask it to implement. Short, focused context → better performance and lower cost.',
            ],
          },
          {
            question: 'How can researchers benefit from Yggdrasil?',
            answer: ["It's an excellent interface to test and compare LLM outputs quickly across models and branches."],
          },
          {
            question: 'Can teams collaborate on branches?',
            answer: ['Not yet—planned feature.'],
          },
          {
            question: 'What are some common workflows or patterns I should follow?',
            answer: [
              'See best practices: branch early, keep contexts short, compare models via branching, use Notes to merge insights, and switch models per task.',
            ],
          },
        ],
      },
      {
        title: 'Support & Troubleshooting',
        items: [
          {
            question: "I'm stuck. Where can I get help?",
            answer: ['Email support@yggchat.com.'],
          },
          {
            question: 'How do I report bugs or suggest features?',
            answer: ['Join our Discord: https://discord.gg/7Zmvteg5t2'],
          },
          {
            question: 'What if a model gives me bad results? Is that your fault?',
            answer: ["Switch models easily to isolate whether it's Yggdrasil or the model."],
          },
        ],
      },
    ],
    []
  )

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    sections.forEach(section => {
      initial[section.title] = true
    })
    return initial
  })
  const [search, setSearch] = useState('')

  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections
    const q = search.toLowerCase()
    return sections
      .map(section => {
        const items = section.items.filter(
          item => item.question.toLowerCase().includes(q) || item.answer.some(a => a.toLowerCase().includes(q))
        )
        return { ...section, items }
      })
      .filter(section => section.items.length > 0)
  }, [search, sections])

  const toggleSection = (title: string) => {
    setOpenSections(prev => ({ ...prev, [title]: !prev[title] }))
  }

  return (
    <div className='min-h-screen w-full bg-blue-200 dark:bg-blue-900 text-gray-900 dark:text-gray-100'>
      <header className='sticky top-0 z-30 flex items-center justify-between px-6 sm:px-8 py-3 bg-transparent dark:bg-transparent backdrop-blur-sm'>
        <div className='flex items-center gap-3'>
          <Link to='/' className='text-white font-semibold tracking-wide text-lg hover:text-gray-200'>
            ← Back
          </Link>
        </div>
        <div className='flex items-center gap-2'>
          <Link to='/login'>
            <Button variant='outline2' size='large' className='hover:scale-105 text-white hover:bg-neutral-200/40'>
              Login
            </Button>
          </Link>
        </div>
      </header>

      <section className='max-w-6xl rounded-4xl mica mx-4 md:mx-6 lg:mx-auto px-4 sm:px-8 pt-16 pb-8 my-12'>
        <p className='text-sm uppercase tracking-[0.2em] text-gray-800 dark:text-gray-300 mb-2'>Support</p>
        <h1 className='text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-6'>Yggdrasil FAQ</h1>
        <p className='text-lg text-gray-700 dark:text-gray-200 max-w-3xl mb-6'>
          Answers to how branching, context control, agentic execution, and model routing work in Yggdrasil.
        </p>
        <div className='flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between'>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Search questions...'
            className='w-full sm:w-2/3 px-4 py-3 rounded-xl bg-white/80 dark:bg-yBlack-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400'
          />
          <div className='flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300'>
            <span>Still need help?</span>
            <a
              href='mailto:support@yggchat.com'
              className='px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-400 transition'
            >
              Contact Support
            </a>
          </div>
        </div>
      </section>

      <section className='max-w-6xl rounded-4xl mica mx-4 md:mx-6 lg:mx-auto px-4 sm:px-6 md:px-8 lg:px-10 pt-16 pb-8 my-12'>
        <div className='space-y-6'>
          {filteredSections.map(section => (
            <div
              key={section.title}
              className='rounded-2xl border border-gray-200/60 dark:border-white/10 bg-white/70 dark:bg-yBlack-800/70 shadow-lg backdrop-blur'
            >
              <button
                onClick={() => toggleSection(section.title)}
                className='w-full flex items-center justify-between px-6 pt-6 pb-4 text-left'
              >
                <div>
                  <p className='text-lg uppercase tracking-[0.15em] text-blue-600 dark:text-blue-400'>
                    {section.title}
                  </p>
                </div>
                <i
                  className={`bx bx-chevron-${openSections[section.title] ? 'up' : 'down'} text-3xl text-gray-700 dark:text-gray-200`}
                ></i>
              </button>

              <div
                className={`px-6 pb-6 divide-y divide-gray-200/60 dark:divide-white/10 overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
                  openSections[section.title] ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                }`}
                aria-hidden={!openSections[section.title]}
              >
                <div className={openSections[section.title] ? 'pt-6' : 'pt-0'}>
                  {section.items.map(item => (
                    <details key={item.question} open className='group py-4'>
                      <summary className='cursor-pointer text-lg font-semibold text-gray-900 dark:text-white flex items-start justify-between gap-4'>
                        <span>{item.question}</span>
                        <i className='bx bx-chevron-down text-xl text-gray-500 group-open:rotate-180 transition-transform duration-200'></i>
                      </summary>
                      <div className='mt-3 space-y-2 text-gray-700 dark:text-gray-300 leading-relaxed'>
                        {item.answer.map((line, idx) => (
                          <p key={idx}>{line}</p>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {filteredSections.length === 0 && (
            <div className='text-center text-gray-600 dark:text-gray-300 py-12 rounded-2xl border border-dashed border-gray-300 dark:border-white/20'>
              No results. Try another keyword.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default FAQPage

import { useEffect, useState } from 'react'

interface BlogMeta {
  id: string
  slug: string
  title: string
  date: string
}

const BlogPage = () => {
  const [isDark, setIsDark] = useState(true)
  const [blogs, setBlogs] = useState<BlogMeta[]>([])
  const [selectedBlog, setSelectedBlog] = useState<BlogMeta | null>(null)
  const [blogContent, setBlogContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const accentColor = isDark ? '#00ff88' : '#3b82f6'

  // Load blog index
  useEffect(() => {
    fetch('/blogs/index.json')
      .then(res => res.json())
      .then((data: BlogMeta[]) => {
        setBlogs(data)
        if (data.length > 0) {
          setSelectedBlog(data[0])
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Load selected blog content
  useEffect(() => {
    if (!selectedBlog) return
    setBlogContent('')
    fetch(`/blogs/${selectedBlog.slug}.html`)
      .then(res => res.text())
      .then(html => setBlogContent(html))
      .catch(() => setBlogContent('<p>Failed to load blog content.</p>'))
  }, [selectedBlog])

  const styles = {
    container: {
      position: 'fixed' as const,
      inset: 0,
      display: 'flex',
      backgroundColor: isDark ? '#050505' : '#ffffff',
      color: isDark ? '#9ca3af' : '#374151',
      fontFamily: 'Inter, sans-serif',
    },
    sidebar: {
      width: sidebarCollapsed ? '64px' : '280px',
      minWidth: sidebarCollapsed ? '64px' : '280px',
      borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      padding: sidebarCollapsed ? '16px 8px' : '24px',
      overflowY: 'auto' as const,
      overflowX: 'hidden' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      zIndex: 20,
      backgroundColor: isDark ? '#050505' : '#ffffff',
      transition: 'all 0.3s ease',
    },
    collapseBtn: {
      background: 'none',
      border: 'none',
      color: accentColor,
      cursor: 'pointer',
      fontSize: '16px',
      fontFamily: 'JetBrains Mono, monospace',
      opacity: 0.5,
      transition: 'opacity 0.2s',
      padding: 0,
    },
    sidebarHeader: {
      fontSize: '10px',
      fontFamily: 'JetBrains Mono, monospace',
      letterSpacing: '0.2em',
      textTransform: 'uppercase' as const,
      color: accentColor,
      marginBottom: '24px',
      paddingBottom: '16px',
      position: 'relative' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sidebarHeaderLine: {
      position: 'absolute' as const,
      bottom: 0,
      left: 0,
      right: 0,
      height: '1px',
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      overflow: 'hidden' as const,
    },
    sidebarHeaderGlow: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      width: '50%',
      height: '100%',
      background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
      animation: 'scanLine 3s ease-in-out infinite',
    },
    blogItem: (isSelected: boolean) => ({
      padding: '12px 16px',
      marginBottom: '8px',
      borderRadius: '8px',
      cursor: 'pointer',
      backgroundColor: isSelected ? (isDark ? 'rgba(0,255,136,0.1)' : 'rgba(59,130,246,0.15)') : 'transparent',
      borderLeft: isSelected ? `2px solid ${accentColor}` : '2px solid transparent',
      transition: 'all 0.2s',
    }),
    blogItemTitle: {
      fontSize: '14px',
      fontWeight: 500,
      color: isDark ? '#ffffff' : '#000000',
      marginBottom: '4px',
    },
    blogItemDate: {
      fontSize: '10px',
      fontFamily: 'JetBrains Mono, monospace',
      opacity: 0.5,
    },
    mainArea: {
      flex: 1,
      overflow: 'auto' as const,
      position: 'relative' as const,
    },
    bgAmbient: {
      position: 'fixed' as const,
      top: 0,
      left: sidebarCollapsed ? '64px' : '280px',
      right: 0,
      bottom: 0,
      zIndex: 0,
      background: isDark
        ? 'radial-gradient(circle at 50% 50%, #0a0a0a, #000)'
        : 'radial-gradient(circle at 50% 50%, #f9fafb, #fff)',
      transition: 'left 0.3s ease',
    },
    orb: {
      position: 'absolute' as const,
      borderRadius: '50%',
      filter: 'blur(100px)',
      backgroundColor: accentColor,
      opacity: isDark ? 0.12 : 0.04,
    },
    nav: {
      position: 'sticky' as const,
      top: 0,
      zIndex: 50,
      padding: '24px 32px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(5,5,5,0.8)' : 'rgba(255,255,255,0.8)',
      backdropFilter: 'blur(8px)',
    },
    navText: {
      fontSize: '10px',
      fontFamily: 'JetBrains Mono, monospace',
      letterSpacing: '0.3em',
      textTransform: 'uppercase' as const,
      opacity: 0.4,
    },
    switchBtn: {
      fontSize: '10px',
      fontFamily: 'JetBrains Mono, monospace',
      letterSpacing: '0.3em',
      textTransform: 'uppercase' as const,
      background: 'none',
      border: 'none',
      color: 'inherit',
      cursor: 'pointer',
    },
    content: {
      position: 'relative' as const,
      zIndex: 10,
    },
    articleHeader: {
      marginBottom: '48px',
      paddingBottom: '24px',
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    },
    articleNumber: {
      fontSize: '10px',
      fontFamily: 'JetBrains Mono, monospace',
      color: accentColor,
      marginBottom: '8px',
    },
    articleTitle: {
      fontSize: '2.5rem',
      fontFamily: 'Space Grotesk, sans-serif',
      fontWeight: 700,
      color: isDark ? '#ffffff' : '#000000',
      marginBottom: '12px',
      lineHeight: 1.1,
    },
    articleDate: {
      fontSize: '12px',
      fontFamily: 'JetBrains Mono, monospace',
      opacity: 0.4,
    },
    articleBody: {
      fontSize: '24px',
      fontWeight: 300,
      lineHeight: 1.8,
    },
  }

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes drift {
          0% { transform: translate(-5%, -5%) scale(1); }
          100% { transform: translate(15%, 15%) scale(1.3); }
        }
        @keyframes scanLine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          {!sidebarCollapsed && <span>Journal Entries</span>}
          <button
            style={{
              ...styles.collapseBtn,
              margin: sidebarCollapsed ? '0 auto' : undefined,
            }}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
          {!sidebarCollapsed && (
            <div style={styles.sidebarHeaderLine}>
              <div style={styles.sidebarHeaderGlow} />
            </div>
          )}
        </div>
        {!sidebarCollapsed &&
          (loading ? (
            <div style={{ opacity: 0.5 }}>Loading...</div>
          ) : (
            blogs.map(blog => (
              <div
                key={blog.id}
                style={styles.blogItem(selectedBlog?.id === blog.id)}
                onClick={() => setSelectedBlog(blog)}
                onMouseEnter={e => {
                  if (selectedBlog?.id !== blog.id) {
                    e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                  }
                }}
                onMouseLeave={e => {
                  if (selectedBlog?.id !== blog.id) {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }
                }}
              >
                <div style={styles.blogItemTitle}>{blog.title}</div>
                <div style={styles.blogItemDate}>
                  #{blog.id} — {blog.date}
                </div>
              </div>
            ))
          ))}
      </aside>

      {/* Main Content Area */}
      <div style={styles.mainArea}>
        {/* Background */}
        <div style={styles.bgAmbient}>
          <div
            style={{
              ...styles.orb,
              width: '600px',
              height: '600px',
              top: '-160px',
              right: '-160px',
              animation: 'drift 25s infinite alternate ease-in-out',
            }}
          />
          <div
            style={{
              ...styles.orb,
              width: '500px',
              height: '500px',
              bottom: 0,
              left: '100px',
              animation: 'drift 35s infinite alternate ease-in-out',
            }}
          />
        </div>

        {/* Nav */}
        <nav style={styles.nav}>
          <div style={styles.navText}>Yggdrasil // OS_Core</div>
          <button
            style={styles.switchBtn}
            onClick={() => setIsDark(!isDark)}
            onMouseEnter={e => (e.currentTarget.style.color = accentColor)}
            onMouseLeave={e => (e.currentTarget.style.color = 'inherit')}
          >
            [ Switch_Mode ]
          </button>
        </nav>

        {/* Content */}
        <div
          style={styles.content}
          className='w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto px-6 pt-10 pb-32'
        >
          {selectedBlog ? (
            <>
              <header style={styles.articleHeader}>
                <div style={styles.articleNumber}>#{selectedBlog.id}</div>
                <h1 style={styles.articleTitle}>{selectedBlog.title}</h1>
                <div style={styles.articleDate}>{selectedBlog.date}</div>
              </header>
              <div style={styles.articleBody} dangerouslySetInnerHTML={{ __html: blogContent }} />
            </>
          ) : (
            <div style={{ textAlign: 'center', paddingTop: '100px', opacity: 0.5 }}>
              Select a blog entry from the sidebar
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BlogPage

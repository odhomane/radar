import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider, showApiError, showApiSuccess } from './components/ui/Toast'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { useAppSettings, useAuthStatus } from './api/client'
import './index.css'

// Mouse back/forward button navigation for desktop webview.
// On Windows (WebView2/Chromium), these events fire natively — this handles them.
// On macOS (WKWebView), these events never reach JS — handled by native NSEvent monitor in mouse_darwin.go.
// On Linux (webkit2gtk), behavior varies by version — this catches it when supported.
window.addEventListener('auxclick', (e: MouseEvent) => {
  if (e.button === 3) {
    e.preventDefault()
    window.history.back()
  } else if (e.button === 4) {
    e.preventDefault()
    window.history.forward()
  }
})

// Type the meta property for mutations
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      errorMessage?: string      // e.g., "Failed to delete resource"
      successMessage?: string    // e.g., "Resource deleted"
      successDetail?: string     // e.g., "Pod 'nginx' removed"
    }
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Only show toast if errorMessage is explicitly provided in meta
      // This allows mutations to opt-out by not providing meta (e.g., context switch has its own dialog)
      const message = mutation.options.meta?.errorMessage
      if (message) {
        showApiError(message, error.message)
      }
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      const message = mutation.options.meta?.successMessage
      if (message) {
        showApiSuccess(message, mutation.options.meta?.successDetail)
      }
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Log background refetch failures (when stale data exists)
      if (query.state.data !== undefined) {
        console.warn('[Background sync failed]', query.queryKey, error.message)
      }
    },
  }),
})

function DesktopUserStyleLoader() {
  React.useEffect(() => {
    const applyUserStyle = () => {
      let link = document.getElementById('radar-desktop-userstyle') as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.id = 'radar-desktop-userstyle'
        link.rel = 'stylesheet'
        document.head.appendChild(link)
      }
      link.href = `/api/desktop/userstyle.css?v=${Date.now()}`
    }

    applyUserStyle()

    const wailsRuntime = (window as unknown as Record<string, unknown>).runtime as
      | { EventsOn?: (event: string, callback: () => void) => (() => void) | void }
      | undefined
    const cleanup = wailsRuntime?.EventsOn?.('reload-user-style', applyUserStyle)
    window.addEventListener('radar:reload-user-style', applyUserStyle)

    return () => {
      window.removeEventListener('radar:reload-user-style', applyUserStyle)
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
  }, [])

  return null
}

function AppearanceSettingsLoader() {
  const { data: authStatus } = useAuthStatus()
  const { data: settings } = useAppSettings(Boolean(authStatus?.authenticated))
  const { setTheme } = useTheme()

  React.useEffect(() => {
    if (!settings) return

    setTheme((settings.appearance.uiTheme as 'light' | 'dark' | 'system') || 'system')

    const root = document.documentElement
    root.style.setProperty('--font-ui', normalizeFontStack(settings.appearance.uiFont, 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'))
    root.style.setProperty('--font-code', normalizeFontStack(settings.appearance.codeFont, 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'))

    const accent = resolveAccentColor('blue')
    root.style.setProperty('--color-brand', accent.base)
    root.style.setProperty('--color-brand-light', accent.light)
    root.style.setProperty('--color-brand-dark', accent.dark)

    root.setAttribute('data-density', settings.appearance.density || 'comfortable')
    root.setAttribute('data-reduce-motion', settings.appearance.reduceMotion ? 'true' : 'false')
    root.setAttribute('data-compact-sidebar', settings.appearance.compactSidebar ? 'true' : 'false')
  }, [settings, setTheme])

  return null
}

function normalizeFontStack(value: string, fallback: string) {
  const font = value.trim()
  if (!font) return fallback
  if (font.includes(',') || font.includes('"') || font.includes("'")) return font
  return `"${font}", ${fallback}`
}

function resolveAccentColor(value: string) {
  const normalized = value.trim().toLowerCase()
  const palette: Record<string, { base: string; light: string; dark: string }> = {
    blue: { base: '#2D7AFF', light: '#5A9AFF', dark: '#1A5FCC' },
    green: { base: '#16A34A', light: '#22C55E', dark: '#15803D' },
    red: { base: '#DC2626', light: '#EF4444', dark: '#B91C1C' },
    orange: { base: '#EA580C', light: '#F97316', dark: '#C2410C' },
    amber: { base: '#D97706', light: '#F59E0B', dark: '#B45309' },
    teal: { base: '#0F766E', light: '#14B8A6', dark: '#115E59' },
  }

  if (palette[normalized]) return palette[normalized]
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    return { base: normalized, light: normalized, dark: normalized }
  }
  return palette.blue
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <DesktopUserStyleLoader />
            <AppearanceSettingsLoader />
            <App />
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)

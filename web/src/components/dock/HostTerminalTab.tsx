import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { Tooltip } from '../ui/Tooltip'
import { getCssFontVar } from '../../utils/fonts'

interface HostTerminalTabProps {
  contextName?: string
  initialCommand?: string
  isActive?: boolean
}

interface TerminalMessage {
  type: 'input' | 'resize' | 'output' | 'error'
  data?: string
  rows?: number
  cols?: number
}

export function HostTerminalTab({
  contextName,
  initialCommand,
  isActive = true,
}: HostTerminalTabProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(() => {
    if (!terminalRef.current) return

    setIsConnecting(true)
    setError(null)

    if (xtermRef.current) xtermRef.current.dispose()
    if (wsRef.current) wsRef.current.close()

    const xterm = new XTerm({
      cursorBlink: true,
      fontFamily: getCssFontVar('--font-code', 'JetBrains Mono, Menlo, Monaco, monospace'),
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#60a5fa',
        cursorAccent: '#0f172a',
        selectionBackground: '#3b82f680',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
    })

    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(new WebLinksAddon())
    xterm.open(terminalRef.current)

    const doFit = () => {
      const dims = fitAddon.proposeDimensions()
      if (dims) xterm.resize(dims.cols, dims.rows)
    }

    requestAnimationFrame(() => {
      doFit()
      setTimeout(doFit, 100)
    })

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/host-terminal`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setIsConnecting(false)
      xterm.focus()

      ws.send(JSON.stringify({ type: 'resize', rows: xterm.rows, cols: xterm.cols }))

      if (initialCommand) {
        ws.send(JSON.stringify({ type: 'input', data: initialCommand }))
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as TerminalMessage
        if (msg.type === 'output' && msg.data) {
          xterm.write(msg.data)
        } else if (msg.type === 'error' && msg.data) {
          setError(msg.data)
          setIsConnected(false)
        }
      } catch {
        xterm.write(event.data)
      }
    }

    ws.onerror = () => {
      setError('Connection error')
      setIsConnected(false)
      setIsConnecting(false)
    }

    ws.onclose = () => {
      setIsConnected(false)
      setIsConnecting(false)
      xterm.write('\r\n\x1b[31mConnection closed\x1b[0m\r\n')
    }

    xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    let lastWidth = 0
    let lastHeight = 0
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (Math.abs(width - lastWidth) < 5 && Math.abs(height - lastHeight) < 5) return
      lastWidth = width
      lastHeight = height

      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims) xtermRef.current.resize(dims.cols, dims.rows)
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', rows: xtermRef.current.rows, cols: xtermRef.current.cols }))
          }
        }
      }, 100)
    })
    resizeObserver.observe(terminalRef.current)

    return () => resizeObserver.disconnect()
  }, [initialCommand])

  useEffect(() => {
    const cleanup = connect()
    return () => {
      cleanup?.()
      wsRef.current?.close()
      xtermRef.current?.dispose()
    }
  }, [connect])

  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current) {
      const dims = fitAddonRef.current.proposeDimensions()
      if (dims) xtermRef.current.resize(dims.cols, dims.rows)
      xtermRef.current.focus()
    }
  }, [isActive])

  return (
    <div className="relative h-full w-full bg-slate-900 overflow-hidden">
      <div className="h-8 flex items-center gap-2 px-2 bg-slate-800/50 border-b border-slate-700/50">
        <Tooltip
          content={isConnected ? 'Connected to host terminal' : isConnecting ? 'Connecting...' : 'Disconnected - click Reconnect'}
          position="bottom"
        >
          <span
            className={clsx(
              'w-2 h-2 rounded-full cursor-help',
              isConnected ? 'bg-green-500' : isConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
            )}
          />
        </Tooltip>

        <span className="text-xs text-slate-300 font-medium">Host</span>
        {contextName && (
          <span className="text-xs text-slate-400 truncate max-w-[50%]">{contextName}</span>
        )}

        <button
          onClick={connect}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs text-slate-400 hover:text-white hover:bg-slate-700 rounded"
          title="Reconnect"
        >
          <RefreshCw className="w-3 h-3" />
          Reconnect
        </button>
      </div>

      {error && (
        <div className="absolute top-8 left-0 right-0 z-10 bg-red-900/90 border-b border-red-700 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      )}

      <div ref={terminalRef} className={clsx('absolute left-0 right-0 bottom-0', error ? 'top-16' : 'top-8')} />
    </div>
  )
}


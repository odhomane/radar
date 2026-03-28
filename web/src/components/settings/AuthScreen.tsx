import { useState, type ReactNode } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useAuthStatus, useLogin } from '../../api/client'

export function AuthScreen() {
  const { data: status, isLoading } = useAuthStatus()
  const loginMutation = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<'local' | 'ldap'>('local')

  if (isLoading || !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme-base">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  const mutation = loginMutation
  const showPasswordLogin = status.providers.localEnabled || status.providers.ldapEnabled
  const showMethodToggle = status.providers.localEnabled && status.providers.ldapEnabled

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(45,122,255,0.14),_transparent_34%),linear-gradient(180deg,var(--bg-base),var(--bg-elevated))] px-6 py-10 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl items-center justify-center">
        <div className="mx-auto w-full max-w-md rounded-[2rem] border border-theme-border bg-theme-surface/95 p-7 shadow-2xl backdrop-blur xl:p-9">
          <div className="inline-flex items-center gap-2 rounded-full border border-theme-border bg-theme-base px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.24em] text-theme-text-secondary">
            Secure sign in
          </div>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight text-theme-text-primary">
            Welcome back
          </h2>
          <p className="mt-2 text-sm text-theme-text-secondary">
            Sign in to Radar using one of the configured authentication methods.
          </p>
          {showPasswordLogin && (
            <form
              className="mt-8 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                loginMutation.mutate({ email, password, method })
              }}
            >
              {showMethodToggle && (
                <div className="inline-flex rounded-2xl border border-theme-border bg-theme-base p-1">
                  <button type="button" onClick={() => setMethod('local')} className={method === 'local' ? activeMethodClass : methodClass}>Local</button>
                  <button type="button" onClick={() => setMethod('ldap')} className={method === 'ldap' ? activeMethodClass : methodClass}>LDAP</button>
                </div>
              )}
              <Field label={method === 'ldap' ? 'LDAP username or email' : 'Username or email'}>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} type="text" autoComplete="username" placeholder={method === 'ldap' ? 'jdoe or you@example.com' : 'admin'} />
              </Field>
              <Field label="Password">
                <input value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} type="password" autoComplete="current-password" placeholder="Enter your password" />
              </Field>
              {mutation.error && <div className="rounded-2xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm text-red-500">{mutation.error.message}</div>}
              <button
                type="submit"
                disabled={mutation.isPending}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-medium text-white shadow-[0_12px_30px_rgba(37,99,235,0.28)] transition hover:bg-blue-500 disabled:opacity-60"
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {method === 'ldap' ? 'Sign in with LDAP' : 'Sign in'}
              </button>
            </form>
          )}

          {status.providers.ssoEnabled && (
            <div className={showPasswordLogin ? 'mt-6 border-t border-theme-border pt-6' : 'mt-8'}>
              <button
                type="button"
                onClick={() => { window.location.href = '/api/auth/sso/start' }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-theme-border bg-theme-base px-4 py-3.5 text-sm font-medium text-theme-text-primary transition hover:bg-theme-elevated"
              >
                Continue with {status.providers.ssoProviderName || 'SSO'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-theme-text-secondary">{label}</div>
      {children}
    </label>
  )
}

const inputClass = 'w-full rounded-2xl border border-theme-border bg-theme-base px-4 py-3.5 text-sm text-theme-text-primary placeholder:text-theme-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500'
const methodClass = 'rounded-2xl px-3 py-2 text-sm text-theme-text-secondary transition hover:text-theme-text-primary'
const activeMethodClass = 'rounded-2xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm'

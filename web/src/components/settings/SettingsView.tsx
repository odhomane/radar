import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { BrushCleaning, Lock, ShieldCheck, Users, Layers3, KeyRound, Network, SlidersHorizontal } from 'lucide-react'
import {
  AppSettingsRecord,
  type CurrentUser,
  type GroupInput,
  type RoleInput,
  type UserInput,
  useAppSettings,
  useCreateGroup,
  useCreateRole,
  useCreateUser,
  useDeleteGroup,
  useDeleteRole,
  useDeleteUser,
  useResetUserPassword,
  useSettingsGroups,
  useSettingsRoles,
  useSettingsUsers,
  useUpdateAppSettings,
} from '../../api/client'

const AVAILABLE_PERMISSIONS = [
  'settings.view',
  'settings.manage',
  'users.manage',
  'roles.manage',
  'groups.manage',
]

interface SettingsViewProps {
  currentUser: CurrentUser
}

type SettingsPageKey = 'appearance' | 'general' | 'local-auth' | 'sso' | 'ldap' | 'users' | 'roles' | 'groups'
type AuthMethodKey = 'local' | 'ldap' | 'github' | 'google' | 'azuread' | 'generic'

const SETTINGS_MENU_GROUPS: Array<{
  title: string
  items: Array<{
    key: SettingsPageKey
    label: string
    description: string
    eyebrow: string
    icon: typeof BrushCleaning
  }>
}> = [
  {
    title: 'Application',
    items: [
      { key: 'appearance', label: 'Appearance', eyebrow: 'Application settings', icon: BrushCleaning, description: 'Theme, fonts, density, and presentation defaults.' },
      { key: 'general', label: 'General', eyebrow: 'Operations', icon: SlidersHorizontal, description: 'Sessions, password policy, alerts, and workspace defaults.' },
    ],
  },
  {
    title: 'Authentication',
    items: [
      { key: 'local-auth', label: 'Local auth', eyebrow: 'Built-in login', icon: KeyRound, description: 'Radar-managed usernames, passwords, and session controls.' },
      { key: 'sso', label: 'SSO', eyebrow: 'OAuth providers', icon: Lock, description: 'GitHub, Google, Azure AD, or custom OAuth browser login.' },
      { key: 'ldap', label: 'LDAP', eyebrow: 'Directory auth', icon: Network, description: 'Bind directly to enterprise LDAP directories.' },
    ],
  },
  {
    title: 'Access control',
    items: [
      { key: 'users', label: 'Users', eyebrow: 'User-related', icon: Users, description: 'Provision accounts and rotate passwords.' },
      { key: 'roles', label: 'Roles & RBAC', eyebrow: 'Authorization', icon: ShieldCheck, description: 'Permission bundles for administrators and operators.' },
      { key: 'groups', label: 'Groups', eyebrow: 'Teams & groups', icon: Layers3, description: 'Team-level access bundles built on top of roles.' },
    ],
  },
]

const SETTINGS_PAGES = SETTINGS_MENU_GROUPS.flatMap((group) => group.items)

const LEGACY_SETTINGS_SECTIONS: Array<{
  key: SettingsPageKey
  label: string
  description: string
  eyebrow: string
  icon: typeof BrushCleaning
}> = SETTINGS_PAGES

export function SettingsView({ currentUser }: SettingsViewProps) {
  const settingsQuery = useAppSettings()
  const usersQuery = useSettingsUsers()
  const rolesQuery = useSettingsRoles()
  const groupsQuery = useSettingsGroups()
  const updateSettings = useUpdateAppSettings()
  const createUser = useCreateUser()
  const deleteUser = useDeleteUser()
  const resetUserPassword = useResetUserPassword()
  const createRole = useCreateRole()
  const deleteRole = useDeleteRole()
  const createGroup = useCreateGroup()
  const deleteGroup = useDeleteGroup()

  const [settingsDraft, setSettingsDraft] = useState<AppSettingsRecord | null>(null)
  const [newUser, setNewUser] = useState<UserInput>({ email: '', displayName: '', status: 'active', roleIds: [], groupIds: [], password: '' })
  const [newRole, setNewRole] = useState<RoleInput>({ name: '', description: '', permissions: [] })
  const [newGroup, setNewGroup] = useState<GroupInput>({ name: '', description: '', roleIds: [] })
  const [activePage, setActivePage] = useState<SettingsPageKey>('appearance')

  useEffect(() => {
    if (!settingsQuery.data) return
    setSettingsDraft({
      ...settingsQuery.data,
      appearance: {
        ...settingsQuery.data.appearance,
        accentColor: 'blue',
      },
    })
  }, [settingsQuery.data])

  const currentPermissions = currentUser.permissions ?? []
  const canManageSettings = currentPermissions.includes('settings.manage')
  const canManageUsers = currentUser.isSuperUser
  const canManageRoles = currentPermissions.includes('roles.manage')
  const canManageGroups = currentPermissions.includes('groups.manage')

  const activeSectionMeta = LEGACY_SETTINGS_SECTIONS.find((section) => section.key === activePage) ?? LEGACY_SETTINGS_SECTIONS[0]
  const showSecondaryIdentity = currentUser.email.trim().toLowerCase() !== currentUser.displayName.trim().toLowerCase()
  const formGridClass = 'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]'
  const activeAuthMethod: AuthMethodKey =
    activePage === 'local-auth'
      ? 'local'
      : activePage === 'ldap'
        ? 'ldap'
        : ((settingsDraft?.authentication.genericOAuth.providerType as AuthMethodKey | undefined) ?? 'generic')

  const selectAuthMethod = (method: AuthMethodKey) => {
    if (method === 'local') {
      setActivePage('local-auth')
      return
    }
    if (method === 'ldap') {
      setActivePage('ldap')
      return
    }
    setActivePage('sso')
    setSettingsDraft((current) => {
      if (!current) return current
      return {
        ...current,
        authentication: {
          ...current.authentication,
          genericOAuth: {
            ...current.authentication.genericOAuth,
            providerType: method,
          },
        },
      }
    })
  }

  return (
    <div className="h-full w-full overflow-auto bg-slate-50 dark:bg-slate-950">
      <div className="w-full px-4 py-6 md:px-6 md:py-8 xl:px-8 2xl:px-10">
        <div className="grid w-full gap-6 xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="self-start space-y-4 xl:sticky xl:top-6 xl:w-full">
            <div className="rounded-3xl border border-slate-800 bg-[#0f3c63] p-5 text-white shadow-[0_20px_60px_-24px_rgba(15,60,99,0.9)]">
              <div className="text-xs uppercase tracking-[0.25em] text-sky-100/70">Settings</div>
              <div className="mt-3 text-2xl font-semibold">Workspace admin</div>
              <p className="mt-2 text-sm text-sky-50/80">
                Manage application defaults, local auth, users, and access controls.
              </p>
            </div>

            <nav className="rounded-3xl border border-slate-800 bg-[#134a74] p-3 text-white shadow-[0_20px_60px_-24px_rgba(19,74,116,0.8)]">
              <div className="space-y-4">
                {SETTINGS_MENU_GROUPS.map((group) => (
                  <div key={group.title}>
                    <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100/65">{group.title}</div>
                    <div className="space-y-1">
                      {group.items.map((section) => (
                        <button
                          key={section.key}
                          onClick={() => setActivePage(section.key)}
                          className={`w-full rounded-2xl px-3 py-2.5 text-left transition-colors ${
                            activePage === section.key
                              ? 'bg-sky-500 text-white shadow-sm'
                              : 'text-sky-50/80 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 rounded-xl p-2 ${activePage === section.key ? 'bg-white/15' : 'bg-black/10'}`}>
                              <section.icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{section.label}</div>
                              <div className={`mt-1 text-xs ${activePage === section.key ? 'text-white/90' : 'text-sky-50/60'}`}>
                                {section.description}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </nav>

          </aside>

          <div className="min-w-0 w-full space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_12rem] lg:items-start">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">Settings</div>
                  <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-100">{activeSectionMeta.label}</h1>
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    {activeSectionMeta.description}
                  </p>
                </div>
                <div className="justify-self-start rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left dark:border-slate-800 dark:bg-slate-950 lg:justify-self-end lg:text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Signed in as</div>
                  <div className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{currentUser.displayName}</div>
                  {showSecondaryIdentity && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">{currentUser.email}</div>
                  )}
                </div>
              </div>
            </div>

            {activePage === 'appearance' && (
              <Section title="Appearance & UX" description="Tailor the application look and operational defaults for your team.">
                {settingsDraft && (
                  <div className={formGridClass}>
                    <Field label="UI Theme">
                      <select value={settingsDraft.appearance.uiTheme} onChange={(e) => patchSettings(setSettingsDraft, ['appearance', 'uiTheme'], e.target.value)} className={inputClass}>
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </Field>
                    <Field label="UI Font">
                      <input value={settingsDraft.appearance.uiFont} onChange={(e) => patchSettings(setSettingsDraft, ['appearance', 'uiFont'], e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Code Font">
                      <input value={settingsDraft.appearance.codeFont} onChange={(e) => patchSettings(setSettingsDraft, ['appearance', 'codeFont'], e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Density">
                      <select value={settingsDraft.appearance.density} onChange={(e) => patchSettings(setSettingsDraft, ['appearance', 'density'], e.target.value)} className={inputClass}>
                        <option value="comfortable">Comfortable</option>
                        <option value="compact">Compact</option>
                      </select>
                    </Field>
                    <Field label="Date Format">
                      <select value={settingsDraft.appearance.dateFormat} onChange={(e) => patchSettings(setSettingsDraft, ['appearance', 'dateFormat'], e.target.value)} className={inputClass}>
                        <option value="relative">Relative</option>
                        <option value="absolute">Absolute</option>
                      </select>
                    </Field>
                    <Toggle label="Reduce motion" checked={settingsDraft.appearance.reduceMotion} onChange={(checked) => patchSettings(setSettingsDraft, ['appearance', 'reduceMotion'], checked)} />
                    <Toggle label="Compact sidebar" checked={settingsDraft.appearance.compactSidebar} onChange={(checked) => patchSettings(setSettingsDraft, ['appearance', 'compactSidebar'], checked)} />
                  </div>
                )}
                <SettingsActions
                  canSave={canManageSettings}
                  saving={updateSettings.isPending}
                  onSave={() => settingsDraft && updateSettings.mutate(settingsDraft)}
                  error={updateSettings.error?.message}
                />
              </Section>
            )}

            {activePage === 'general' && (
              <Section title="General settings" description="Manage workspace defaults, session lifetime, password rules, and operational guardrails.">
                {settingsDraft && (
                  <div className={formGridClass}>
                    <Field label="Organization Name">
                      <input value={settingsDraft.organizationName} onChange={(e) => patchSettings(setSettingsDraft, ['organizationName'], e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Support Email">
                      <input value={settingsDraft.supportEmail} onChange={(e) => patchSettings(setSettingsDraft, ['supportEmail'], e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Session Timeout (minutes)">
                      <input type="number" value={settingsDraft.security.sessionTimeoutMinutes} onChange={(e) => patchSettings(setSettingsDraft, ['security', 'sessionTimeoutMinutes'], Number(e.target.value))} className={inputClass} />
                    </Field>
                    <Field label="Password Min Length">
                      <input type="number" value={settingsDraft.security.passwordMinLength} onChange={(e) => patchSettings(setSettingsDraft, ['security', 'passwordMinLength'], Number(e.target.value))} className={inputClass} />
                    </Field>
                    <Field label="Auto Refresh (seconds)">
                      <input type="number" value={settingsDraft.operations.autoRefreshSeconds} onChange={(e) => patchSettings(setSettingsDraft, ['operations', 'autoRefreshSeconds'], Number(e.target.value))} className={inputClass} />
                    </Field>
                    <Field label="Default Landing Page">
                      <select value={settingsDraft.operations.defaultLandingPage} onChange={(e) => patchSettings(setSettingsDraft, ['operations', 'defaultLandingPage'], e.target.value)} className={inputClass}>
                        <option value="home">Home</option>
                        <option value="topology">Topology</option>
                        <option value="resources">Resources</option>
                        <option value="timeline">Timeline</option>
                        <option value="helm">Helm</option>
                      </select>
                    </Field>
                    <Toggle label="Strong passwords" checked={settingsDraft.security.requireStrongPasswords} onChange={(checked) => patchSettings(setSettingsDraft, ['security', 'requireStrongPasswords'], checked)} />
                    <Toggle label="Confirm destructive actions" checked={settingsDraft.operations.confirmDestructiveActions} onChange={(checked) => patchSettings(setSettingsDraft, ['operations', 'confirmDestructiveActions'], checked)} />
                    <Toggle label="Desktop notifications" checked={settingsDraft.operations.enableDesktopNotifications} onChange={(checked) => patchSettings(setSettingsDraft, ['operations', 'enableDesktopNotifications'], checked)} />
                    <Toggle label="Allow self signup" checked={settingsDraft.security.allowSelfSignup} onChange={(checked) => patchSettings(setSettingsDraft, ['security', 'allowSelfSignup'], checked)} />
                  </div>
                )}
                <SettingsActions
                  canSave={canManageSettings}
                  saving={updateSettings.isPending}
                  onSave={() => settingsDraft && updateSettings.mutate(settingsDraft)}
                  error={updateSettings.error?.message}
                />
              </Section>
            )}

            {activePage === 'local-auth' && (
              <Section title="Local auth" description="Configure Radar-managed usernames, passwords, reset flow, and MFA requirements.">
                <AuthenticationMethodPicker activeMethod={activeAuthMethod} onSelect={selectAuthMethod} />
                {settingsDraft && (
                  <SubCard title="Built-in authentication" description="Use the local Radar user store for username and password sign-in.">
                    <div className={formGridClass}>
                      <Toggle label="Enable local auth" checked={settingsDraft.authentication.local.enabled} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'local', 'enabled'], checked)} />
                      <Toggle label="Allow password reset" checked={settingsDraft.security.allowPasswordReset} onChange={(checked) => patchSettings(setSettingsDraft, ['security', 'allowPasswordReset'], checked)} />
                      <Toggle label="Require MFA" checked={settingsDraft.security.requireMFA} onChange={(checked) => patchSettings(setSettingsDraft, ['security', 'requireMFA'], checked)} />
                    </div>
                  </SubCard>
                )}
                <SettingsActions
                  canSave={canManageSettings}
                  saving={updateSettings.isPending}
                  onSave={() => settingsDraft && updateSettings.mutate(settingsDraft)}
                  error={updateSettings.error?.message}
                />
              </Section>
            )}

            {activePage === 'sso' && (
              <Section title="SSO" description="Configure GitHub, Google, Azure AD, or a custom OAuth provider for browser sign-in.">
                <AuthenticationMethodPicker activeMethod={activeAuthMethod} onSelect={selectAuthMethod} />
                {settingsDraft && (
                  <SubCard title="OAuth providers" description="Choose a preset provider or use a fully custom OAuth configuration.">
                    <div className={formGridClass}>
                      <Toggle label="Enable SSO" checked={settingsDraft.authentication.genericOAuth.enabled} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'enabled'], checked)} />
                      <Toggle label="Auto sign-up" checked={settingsDraft.authentication.genericOAuth.autoSignUp} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'autoSignUp'], checked)} />
                      <Field label="Provider type">
                        <select value={settingsDraft.authentication.genericOAuth.providerType} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'providerType'], e.target.value)} className={inputClass}>
                          <option value="generic">Custom OAuth</option>
                          <option value="github">GitHub</option>
                          <option value="google">Google</option>
                          <option value="azuread">Azure AD</option>
                        </select>
                      </Field>
                      <Field label="Provider name"><input value={settingsDraft.authentication.genericOAuth.providerName} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'providerName'], e.target.value)} className={inputClass} /></Field>
                      <Field label="Default role"><input value={settingsDraft.authentication.genericOAuth.defaultRole} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'defaultRole'], e.target.value)} className={inputClass} placeholder="Viewer" /></Field>
                      <Field label="Client ID"><input value={settingsDraft.authentication.genericOAuth.clientId} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'clientId'], e.target.value)} className={inputClass} /></Field>
                      <Field label="Client secret"><input type="password" value={settingsDraft.authentication.genericOAuth.clientSecret} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'clientSecret'], e.target.value)} className={inputClass} /></Field>
                      {settingsDraft.authentication.genericOAuth.providerType === 'azuread' && (
                        <Field label="Azure tenant ID">
                          <input value={settingsDraft.authentication.genericOAuth.azureTenantId} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'azureTenantId'], e.target.value)} className={inputClass} placeholder="common" />
                        </Field>
                      )}
                      {settingsDraft.authentication.genericOAuth.providerType === 'generic' && (
                        <>
                          <Field label="Auth URL"><input value={settingsDraft.authentication.genericOAuth.authUrl} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'authUrl'], e.target.value)} className={inputClass} placeholder="https://idp.example.com/oauth2/authorize" /></Field>
                          <Field label="Token URL"><input value={settingsDraft.authentication.genericOAuth.tokenUrl} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'tokenUrl'], e.target.value)} className={inputClass} placeholder="https://idp.example.com/oauth2/token" /></Field>
                          <Field label="UserInfo URL"><input value={settingsDraft.authentication.genericOAuth.userInfoUrl} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'userInfoUrl'], e.target.value)} className={inputClass} placeholder="https://idp.example.com/userinfo" /></Field>
                        </>
                      )}
                      <Field label="Scopes"><input value={(settingsDraft.authentication.genericOAuth.scopes ?? []).join(', ')} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'scopes'], splitCSV(e.target.value))} className={inputClass} placeholder="openid, profile, email" /></Field>
                      <Field label="Email field path"><input value={settingsDraft.authentication.genericOAuth.emailPath} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'emailPath'], e.target.value)} className={inputClass} placeholder="email" /></Field>
                      <Field label="Display name path"><input value={settingsDraft.authentication.genericOAuth.namePath} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'namePath'], e.target.value)} className={inputClass} placeholder="name" /></Field>
                      {settingsDraft.authentication.genericOAuth.providerType === 'generic' && (
                        <Field label="Groups path"><input value={settingsDraft.authentication.genericOAuth.groupsPath} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'groupsPath'], e.target.value)} className={inputClass} placeholder="groups" /></Field>
                      )}
                      <Field label="Allowed domains"><input value={(settingsDraft.authentication.genericOAuth.allowedDomains ?? []).join(', ')} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'allowedDomains'], splitCSV(e.target.value))} className={inputClass} placeholder="example.com" /></Field>
                      <Field label="Allowed groups"><input value={(settingsDraft.authentication.genericOAuth.allowedGroups ?? []).join(', ')} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'genericOAuth', 'allowedGroups'], splitCSV(e.target.value))} className={inputClass} placeholder="engineering, admins" /></Field>
                    </div>
                  </SubCard>
                )}
                <SettingsActions
                  canSave={canManageSettings}
                  saving={updateSettings.isPending}
                  onSave={() => settingsDraft && updateSettings.mutate(settingsDraft)}
                  error={updateSettings.error?.message}
                />
              </Section>
            )}

            {activePage === 'ldap' && (
              <Section title="LDAP" description="Configure direct LDAP authentication and map successful logins into Radar users.">
                <AuthenticationMethodPicker activeMethod={activeAuthMethod} onSelect={selectAuthMethod} />
                {settingsDraft && (
                  <SubCard title="Directory authentication" description="Bind to an LDAP directory, search for users, and apply RBAC through Radar.">
                    <div className={formGridClass}>
                      <Toggle label="Enable LDAP" checked={settingsDraft.authentication.ldap.enabled} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'enabled'], checked)} />
                      <Toggle label="Auto sign-up" checked={settingsDraft.authentication.ldap.autoSignUp} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'autoSignUp'], checked)} />
                      <Field label="Host"><input value={settingsDraft.authentication.ldap.host} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'host'], e.target.value)} className={inputClass} placeholder="ldap.example.com" /></Field>
                      <Field label="Port"><input type="number" value={settingsDraft.authentication.ldap.port} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'port'], Number(e.target.value))} className={inputClass} /></Field>
                      <Toggle label="Use LDAPS" checked={settingsDraft.authentication.ldap.useSSL} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'useSSL'], checked)} />
                      <Toggle label="Use StartTLS" checked={settingsDraft.authentication.ldap.startTLS} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'startTLS'], checked)} />
                      <Toggle label="Skip TLS verify" checked={settingsDraft.authentication.ldap.skipTLSVerify} onChange={(checked) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'skipTLSVerify'], checked)} />
                      <Field label="Default role"><input value={settingsDraft.authentication.ldap.defaultRole} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'defaultRole'], e.target.value)} className={inputClass} placeholder="Viewer" /></Field>
                      <Field label="Bind DN"><input value={settingsDraft.authentication.ldap.bindDn} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'bindDn'], e.target.value)} className={inputClass} placeholder="cn=svc-radar,dc=example,dc=com" /></Field>
                      <Field label="Bind password"><input type="password" value={settingsDraft.authentication.ldap.bindPassword} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'bindPassword'], e.target.value)} className={inputClass} /></Field>
                      <Field label="User base DN"><input value={settingsDraft.authentication.ldap.userBaseDn} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'userBaseDn'], e.target.value)} className={inputClass} placeholder="ou=users,dc=example,dc=com" /></Field>
                      <Field label="User search filter"><input value={settingsDraft.authentication.ldap.userSearchFilter} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'userSearchFilter'], e.target.value)} className={inputClass} placeholder="(|(uid=%s)(mail=%s))" /></Field>
                      <Field label="Email attribute"><input value={settingsDraft.authentication.ldap.emailAttribute} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'emailAttribute'], e.target.value)} className={inputClass} placeholder="mail" /></Field>
                      <Field label="Display name attribute"><input value={settingsDraft.authentication.ldap.nameAttribute} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'nameAttribute'], e.target.value)} className={inputClass} placeholder="cn" /></Field>
                      <Field label="Group attribute"><input value={settingsDraft.authentication.ldap.groupAttribute} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'groupAttribute'], e.target.value)} className={inputClass} placeholder="memberOf" /></Field>
                      <Field label="Allowed groups"><input value={(settingsDraft.authentication.ldap.allowedGroups ?? []).join(', ')} onChange={(e) => patchSettings(setSettingsDraft, ['authentication', 'ldap', 'allowedGroups'], splitCSV(e.target.value))} className={inputClass} placeholder="cn=radar-users,ou=groups,dc=example,dc=com" /></Field>
                    </div>
                  </SubCard>
                )}
                <SettingsActions
                  canSave={canManageSettings}
                  saving={updateSettings.isPending}
                  onSave={() => settingsDraft && updateSettings.mutate(settingsDraft)}
                  error={updateSettings.error?.message}
                />
              </Section>
            )}

            {activePage === 'users' && (
              <Section title="Users" description="Provision local accounts, assign roles and groups, and rotate passwords.">
                <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_24rem]">
                  <div className="rounded-2xl border border-theme-border bg-theme-surface overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-theme-elevated/40 border-b border-theme-border">
                        <tr>
                          {['User', 'Status', 'Roles', 'Groups', 'Actions'].map((label) => (
                            <th key={label} className="px-4 py-3 text-left text-xs uppercase tracking-wide text-theme-text-secondary">{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-theme-border">
                        {usersQuery.data?.map((user) => {
                          const effectiveRoles = user.effectiveRoles ?? []
                          const groupIds = user.groupIds ?? []
                          const isBuiltInAdmin = user.email.trim().toLowerCase() === 'admin'
                          return (
                            <tr key={user.id}>
                              <td className="px-4 py-3">
                                <div className="font-medium text-theme-text-primary">{user.displayName}</div>
                                <div className="text-xs text-theme-text-secondary">{user.email}</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-theme-text-secondary">{user.status}</td>
                              <td className="px-4 py-3 text-sm text-theme-text-secondary">{effectiveRoles.join(', ') || '-'}</td>
                              <td className="px-4 py-3 text-sm text-theme-text-secondary">{groupIds.length}</td>
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button
                                    disabled={!canManageUsers}
                                    onClick={() => {
                                      const password = window.prompt(`Set a new password for ${user.displayName}`)
                                      if (password) resetUserPassword.mutate({ id: user.id, password })
                                    }}
                                    className="rounded-lg border border-theme-border px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                                  >
                                    Reset Password
                                  </button>
                                  {isBuiltInAdmin ? (
                                    <span className="inline-flex items-center rounded-lg border border-theme-border bg-theme-base px-3 py-1.5 text-xs text-theme-text-tertiary">
                                      Protected
                                    </span>
                                  ) : (
                                    <button
                                      disabled={!canManageUsers}
                                      onClick={() => {
                                        if (!window.confirm(`Delete ${user.displayName}?`)) return
                                        deleteUser.mutate(user.id)
                                      }}
                                      className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-500 disabled:opacity-50"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <FormCard title="Add user" disabled={!canManageUsers}>
                    <Field label="Display Name"><input value={newUser.displayName} onChange={(e) => setNewUser((v) => ({ ...v, displayName: e.target.value }))} className={inputClass} /></Field>
                    <Field label="Email"><input value={newUser.email} onChange={(e) => setNewUser((v) => ({ ...v, email: e.target.value }))} className={inputClass} /></Field>
                    <Field label="Password"><input type="password" value={newUser.password || ''} onChange={(e) => setNewUser((v) => ({ ...v, password: e.target.value }))} className={inputClass} /></Field>
                    <Field label="Status">
                      <select value={newUser.status} onChange={(e) => setNewUser((v) => ({ ...v, status: e.target.value }))} className={inputClass}>
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </Field>
                    <Field label="Role IDs (comma separated)"><input value={newUser.roleIds.join(', ')} onChange={(e) => setNewUser((v) => ({ ...v, roleIds: splitCSV(e.target.value) }))} className={inputClass} /></Field>
                    <Field label="Group IDs (comma separated)"><input value={newUser.groupIds.join(', ')} onChange={(e) => setNewUser((v) => ({ ...v, groupIds: splitCSV(e.target.value) }))} className={inputClass} /></Field>
                    <button
                      disabled={!canManageUsers || createUser.isPending}
                      onClick={() => createUser.mutate(newUser, { onSuccess: () => setNewUser({ email: '', displayName: '', status: 'active', roleIds: [], groupIds: [], password: '' }) })}
                      className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white opacity-95 hover:opacity-100 disabled:opacity-50"
                    >
                      Create user
                    </button>
                  </FormCard>
                </div>
              </Section>
            )}

            {activePage === 'roles' && (
              <Section title="Roles & RBAC" description="Define role bundles for operational access across settings and administration.">
                <div className="grid gap-8 2xl:grid-cols-[minmax(0,1.2fr)_24rem]">
                  <div className="space-y-4">
                    {rolesQuery.data?.map((role) => (
                      <div key={role.id} className="rounded-2xl border border-theme-border bg-theme-surface p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-base font-medium text-theme-text-primary">{role.name}</div>
                            <div className="mt-1 text-sm text-theme-text-secondary">{role.description}</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(role.permissions ?? []).map((permission) => (
                                <span key={permission} className="rounded-full bg-theme-elevated px-2.5 py-1 text-xs text-theme-text-secondary">{permission}</span>
                              ))}
                            </div>
                          </div>
                          {!role.system && (
                            <button
                              disabled={!canManageRoles}
                              onClick={() => deleteRole.mutate(role.id)}
                              className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-500 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <FormCard title="Create role" disabled={!canManageRoles}>
                    <Field label="Name"><input value={newRole.name} onChange={(e) => setNewRole((v) => ({ ...v, name: e.target.value }))} className={inputClass} /></Field>
                    <Field label="Description"><textarea value={newRole.description} onChange={(e) => setNewRole((v) => ({ ...v, description: e.target.value }))} className={textareaClass} /></Field>
                    <Field label="Permissions">
                      <div className="grid gap-2">
                        {AVAILABLE_PERMISSIONS.map((permission) => (
                          <label key={permission} className="flex items-center gap-2 text-sm text-theme-text-secondary">
                            <input
                              type="checkbox"
                              checked={newRole.permissions.includes(permission)}
                              onChange={(e) => setNewRole((v) => ({ ...v, permissions: e.target.checked ? [...v.permissions, permission] : v.permissions.filter((p) => p !== permission) }))}
                            />
                            {permission}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <button
                      disabled={!canManageRoles || createRole.isPending}
                      onClick={() => createRole.mutate(newRole, { onSuccess: () => setNewRole({ name: '', description: '', permissions: [] }) })}
                      className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white opacity-95 hover:opacity-100 disabled:opacity-50"
                    >
                      Create role
                    </button>
                  </FormCard>
                </div>
              </Section>
            )}

            {activePage === 'groups' && (
              <Section title="Groups" description="Use groups to aggregate users and attach role bundles to teams.">
                <div className="grid gap-8 2xl:grid-cols-[minmax(0,1.2fr)_24rem]">
                  <div className="space-y-4">
                    {groupsQuery.data?.map((group) => (
                      <div key={group.id} className="rounded-2xl border border-theme-border bg-theme-surface p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-base font-medium text-theme-text-primary">{group.name}</div>
                            <div className="mt-1 text-sm text-theme-text-secondary">{group.description}</div>
                            <div className="mt-3 text-xs text-theme-text-tertiary">Members: {group.memberCount} · Roles: {(group.roleIds ?? []).join(', ') || '-'}</div>
                          </div>
                          <button
                            disabled={!canManageGroups}
                            onClick={() => deleteGroup.mutate(group.id)}
                            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-500 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <FormCard title="Create group" disabled={!canManageGroups}>
                    <Field label="Name"><input value={newGroup.name} onChange={(e) => setNewGroup((v) => ({ ...v, name: e.target.value }))} className={inputClass} /></Field>
                    <Field label="Description"><textarea value={newGroup.description} onChange={(e) => setNewGroup((v) => ({ ...v, description: e.target.value }))} className={textareaClass} /></Field>
                    <Field label="Role IDs (comma separated)"><input value={newGroup.roleIds.join(', ')} onChange={(e) => setNewGroup((v) => ({ ...v, roleIds: splitCSV(e.target.value) }))} className={inputClass} /></Field>
                    <button
                      disabled={!canManageGroups || createGroup.isPending}
                      onClick={() => createGroup.mutate(newGroup, { onSuccess: () => setNewGroup({ name: '', description: '', roleIds: [] }) })}
                      className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white opacity-95 hover:opacity-100 disabled:opacity-50"
                    >
                      Create group
                    </button>
                  </FormCard>
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="w-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-7">
      <div className="mb-6 border-b border-slate-200 pb-4 dark:border-slate-800">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{label}</div>
      {children}
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
      <span className="text-sm text-slate-900 dark:text-slate-100">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function SettingsActions({ canSave, saving, onSave, error }: { canSave: boolean; saving: boolean; onSave: () => void; error?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-end">
      {!canSave && <div className="text-sm text-slate-500 dark:text-slate-400 sm:mr-auto">You have read-only access to this section.</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {error && <div className="text-sm text-red-500">{error}</div>}
        <button disabled={!canSave || saving} onClick={onSave} className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white opacity-95 hover:opacity-100 disabled:opacity-50 sm:w-auto">
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function AuthenticationMethodPicker({ activeMethod, onSelect }: { activeMethod: AuthMethodKey; onSelect: (method: AuthMethodKey) => void }) {
  const items: Array<{ key: AuthMethodKey; title: string; description: string; accent: string; logo: ReactNode }> = [
    { key: 'local', title: 'Internal', description: 'Local Radar authentication', accent: 'bg-sky-500/15 text-sky-600 dark:text-sky-300', logo: <InternalLogo /> },
    { key: 'ldap', title: 'LDAP', description: 'Directory authentication', accent: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', logo: <LdapLogo /> },
    { key: 'github', title: 'GitHub', description: 'GitHub OAuth login', accent: 'bg-slate-500/15 text-slate-700 dark:text-slate-200', logo: <GitHubLogo /> },
    { key: 'google', title: 'Google', description: 'Google identity', accent: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', logo: <GoogleLogo /> },
    { key: 'azuread', title: 'Azure AD', description: 'Microsoft Entra ID', accent: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', logo: <AzureLogo /> },
    { key: 'generic', title: 'OAuth', description: 'Custom OAuth provider', accent: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', logo: <OAuthLogo /> },
  ]

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Authentication method</div>
        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose the sign-in method to configure for this workspace.</div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        {items.map((item) => {
          const selected = activeMethod === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={`rounded-2xl border p-4 text-left transition ${
                selected
                  ? 'border-sky-400 bg-sky-50 shadow-sm dark:border-sky-500 dark:bg-sky-500/10'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${item.accent}`}>
                  {item.logo}
                </div>
                <div className={`mt-1 h-4 w-4 rounded-full border ${selected ? 'border-sky-500 bg-sky-500' : 'border-slate-300 dark:border-slate-700'}`}>
                  {selected && <div className="m-[3px] h-2 w-2 rounded-full bg-white" />}
                </div>
              </div>
              <div className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.description}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function InternalLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M8 11l4-4 4 4" />
    </svg>
  )
}

function LdapLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M3 18 7.5 5h2.2L5.2 18H3Zm5.6 0L13 5h2.2L10.8 18H8.6Zm5.6 0L18.6 5h2.2L16.4 18h-2.2Z" />
    </svg>
  )
}

function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.1.82-.26.82-.58v-2.03c-3.34.73-4.04-1.42-4.04-1.42-.55-1.37-1.33-1.73-1.33-1.73-1.1-.74.08-.73.08-.73 1.2.08 1.84 1.22 1.84 1.22 1.08 1.82 2.82 1.29 3.5.99.1-.77.42-1.29.76-1.59-2.67-.3-5.48-1.31-5.48-5.86 0-1.3.47-2.36 1.24-3.19-.13-.3-.54-1.5.12-3.12 0 0 1.02-.32 3.35 1.22a11.8 11.8 0 0 1 6.1 0c2.33-1.54 3.35-1.22 3.35-1.22.66 1.62.25 2.82.12 3.12.77.83 1.24 1.89 1.24 3.19 0 4.56-2.81 5.55-5.5 5.84.43.37.82 1.1.82 2.22v3.29c0 .32.21.69.83.58A12 12 0 0 0 12 .5Z"/>
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.25-.96 2.31-2.04 3.02l3.3 2.56c1.92-1.77 3.04-4.37 3.04-7.48 0-.72-.07-1.41-.19-2.08H12Z"/>
      <path fill="#34A853" d="M12 22c2.75 0 5.06-.91 6.75-2.48l-3.3-2.56c-.91.61-2.08.98-3.45.98-2.65 0-4.89-1.79-5.69-4.2H2.9v2.64A10.19 10.19 0 0 0 12 22Z"/>
      <path fill="#4A90E2" d="M6.31 13.74A6.12 6.12 0 0 1 6 12c0-.6.11-1.18.31-1.74V7.62H2.9A10.2 10.2 0 0 0 1.8 12c0 1.63.39 3.17 1.1 4.38l3.41-2.64Z"/>
      <path fill="#FBBC05" d="M12 6.06c1.5 0 2.84.52 3.89 1.54l2.92-2.92C17.05 3.03 14.75 2 12 2 7.95 2 4.45 4.33 2.9 7.62l3.41 2.64c.8-2.41 3.04-4.2 5.69-4.2Z"/>
    </svg>
  )
}

function AzureLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <rect x="3" y="3" width="8" height="8" fill="#F35325" />
      <rect x="13" y="3" width="8" height="8" fill="#81BC06" />
      <rect x="3" y="13" width="8" height="8" fill="#05A6F0" />
      <rect x="13" y="13" width="8" height="8" fill="#FFBA08" />
    </svg>
  )
}

function OAuthLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v6" />
      <path d="M12 16v6" />
      <path d="M4.93 4.93l4.24 4.24" />
      <path d="m14.83 14.83 4.24 4.24" />
      <path d="M2 12h6" />
      <path d="M16 12h6" />
      <path d="M4.93 19.07l4.24-4.24" />
      <path d="m14.83 9.17 4.24-4.24" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  )
}

function SubCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
      <div>
        <div className="text-base font-medium text-slate-900 dark:text-slate-100">{title}</div>
        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function FormCard({ title, disabled, children }: { title: string; disabled: boolean; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="text-base font-medium text-slate-900 dark:text-slate-100">{title}</div>
        {disabled && <div className="text-xs text-slate-400 dark:text-slate-500">Admin permission required</div>}
      </div>
      <div className={disabled ? 'opacity-60 pointer-events-none space-y-4' : 'space-y-4'}>
        {children}
      </div>
    </div>
  )
}

function patchSettings(
  setDraft: Dispatch<SetStateAction<AppSettingsRecord | null>>,
  path: string[],
  value: string | number | boolean | string[]
) {
  setDraft((current) => {
    if (!current) return current
    const clone: any = structuredClone(current)
    let target = clone
    for (let i = 0; i < path.length - 1; i++) target = target[path[i]]
    target[path[path.length - 1]] = value
    return clone
  })
}

function splitCSV(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100'
const textareaClass = `${inputClass} min-h-24`

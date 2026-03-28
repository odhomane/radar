package settings

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const (
	PermissionSettingsView   = "settings.view"
	PermissionSettingsManage = "settings.manage"
	PermissionUsersManage    = "users.manage"
	PermissionRolesManage    = "roles.manage"
	PermissionGroupsManage   = "groups.manage"
)

type Store struct {
	db *sql.DB
}

type AppearanceSettings struct {
	UITheme        string `json:"uiTheme"`
	UIFont         string `json:"uiFont"`
	CodeFont       string `json:"codeFont"`
	Density        string `json:"density"`
	AccentColor    string `json:"accentColor"`
	ReduceMotion   bool   `json:"reduceMotion"`
	CompactSidebar bool   `json:"compactSidebar"`
	DateFormat     string `json:"dateFormat"`
}

type SecuritySettings struct {
	SessionTimeoutMinutes  int  `json:"sessionTimeoutMinutes"`
	PasswordMinLength      int  `json:"passwordMinLength"`
	RequireStrongPasswords bool `json:"requireStrongPasswords"`
	RequireMFA             bool `json:"requireMFA"`
	AllowSelfSignup        bool `json:"allowSelfSignup"`
	AllowPasswordReset     bool `json:"allowPasswordReset"`
	AuditRetentionDays     int  `json:"auditRetentionDays"`
}

type LocalAuthSettings struct {
	Enabled bool `json:"enabled"`
}

type GenericOAuthSettings struct {
	Enabled      bool     `json:"enabled"`
	ProviderType string   `json:"providerType"`
	ProviderName string   `json:"providerName"`
	ClientID     string   `json:"clientId"`
	ClientSecret string   `json:"clientSecret"`
	AzureTenantID string  `json:"azureTenantId"`
	AuthURL      string   `json:"authUrl"`
	TokenURL     string   `json:"tokenUrl"`
	UserInfoURL  string   `json:"userInfoUrl"`
	Scopes       []string `json:"scopes"`
	EmailPath    string   `json:"emailPath"`
	NamePath     string   `json:"namePath"`
	GroupsPath   string   `json:"groupsPath"`
	AllowedGroups []string `json:"allowedGroups"`
	AllowedDomains []string `json:"allowedDomains"`
	AutoSignUp   bool     `json:"autoSignUp"`
	DefaultRole  string   `json:"defaultRole"`
}

type LDAPSettings struct {
	Enabled         bool     `json:"enabled"`
	Host            string   `json:"host"`
	Port            int      `json:"port"`
	UseSSL          bool     `json:"useSSL"`
	StartTLS        bool     `json:"startTLS"`
	SkipTLSVerify   bool     `json:"skipTLSVerify"`
	BindDN          string   `json:"bindDn"`
	BindPassword    string   `json:"bindPassword"`
	UserBaseDN      string   `json:"userBaseDn"`
	UserSearchFilter string  `json:"userSearchFilter"`
	EmailAttribute  string   `json:"emailAttribute"`
	NameAttribute   string   `json:"nameAttribute"`
	GroupAttribute  string   `json:"groupAttribute"`
	AllowedGroups   []string `json:"allowedGroups"`
	AutoSignUp      bool     `json:"autoSignUp"`
	DefaultRole     string   `json:"defaultRole"`
}

type AuthenticationSettings struct {
	Local        LocalAuthSettings    `json:"local"`
	GenericOAuth GenericOAuthSettings `json:"genericOAuth"`
	LDAP         LDAPSettings         `json:"ldap"`
}

type OperationsSettings struct {
	DefaultLandingPage         string `json:"defaultLandingPage"`
	DefaultNamespaceMode       string `json:"defaultNamespaceMode"`
	AutoRefreshSeconds         int    `json:"autoRefreshSeconds"`
	ConfirmDestructiveActions  bool   `json:"confirmDestructiveActions"`
	EnableDesktopNotifications bool   `json:"enableDesktopNotifications"`
}

type AppSettings struct {
	OrganizationName string             `json:"organizationName"`
	SupportEmail     string             `json:"supportEmail"`
	Appearance       AppearanceSettings `json:"appearance"`
	Security         SecuritySettings   `json:"security"`
	Authentication   AuthenticationSettings `json:"authentication"`
	Operations       OperationsSettings `json:"operations"`
}

type Role struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Permissions []string  `json:"permissions"`
	System      bool      `json:"system"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Group struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	RoleIDs     []string  `json:"roleIds"`
	MemberCount int       `json:"memberCount"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type User struct {
	ID             string    `json:"id"`
	Email          string    `json:"email"`
	DisplayName    string    `json:"displayName"`
	Status         string    `json:"status"`
	RoleIDs        []string  `json:"roleIds"`
	GroupIDs       []string  `json:"groupIds"`
	EffectiveRoles []string  `json:"effectiveRoles"`
	Permissions    []string  `json:"permissions"`
	LastLoginAt    time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type UserInput struct {
	Email       string   `json:"email"`
	DisplayName string   `json:"displayName"`
	Status      string   `json:"status"`
	RoleIDs     []string `json:"roleIds"`
	GroupIDs    []string `json:"groupIds"`
	Password    string   `json:"password,omitempty"`
}

type RoleInput struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

type GroupInput struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	RoleIDs     []string `json:"roleIds"`
}

type CurrentUser struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	DisplayName string   `json:"displayName"`
	Permissions []string `json:"permissions"`
	RoleIDs     []string `json:"roleIds"`
	GroupIDs    []string `json:"groupIds"`
	IsSuperUser bool     `json:"isSuperUser"`
}

type AuthStatus struct {
	NeedsSetup    bool         `json:"needsSetup"`
	Authenticated bool         `json:"authenticated"`
	CurrentUser   *CurrentUser `json:"currentUser,omitempty"`
	Providers     AuthProviderStatus `json:"providers"`
}

type AuthProviderStatus struct {
	LocalEnabled    bool   `json:"localEnabled"`
	LDAPEnabled     bool   `json:"ldapEnabled"`
	SSOEnabled      bool   `json:"ssoEnabled"`
	SSOProviderName string `json:"ssoProviderName"`
}

type bootstrapRequest struct{}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create settings db dir: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	if err := store.init(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) init() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);`,
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			status TEXT NOT NULL,
			last_login_at TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS roles (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL,
			permissions_json TEXT NOT NULL,
			is_system INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS user_roles (
			user_id TEXT NOT NULL,
			role_id TEXT NOT NULL,
			PRIMARY KEY (user_id, role_id)
		);`,
		`CREATE TABLE IF NOT EXISTS group_roles (
			group_id TEXT NOT NULL,
			role_id TEXT NOT NULL,
			PRIMARY KEY (group_id, role_id)
		);`,
		`CREATE TABLE IF NOT EXISTS group_members (
			group_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			PRIMARY KEY (group_id, user_id)
		);`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		);`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}
	if err := s.ensureDefaultSettings(); err != nil {
		return err
	}
	if err := s.ensureSystemRoles(); err != nil {
		return err
	}
	return nil
}

func defaultAppSettings() AppSettings {
	return AppSettings{
		OrganizationName: "Radar",
		SupportEmail:     "platform@example.com",
		Appearance: AppearanceSettings{
			UITheme:        "system",
			UIFont:         "Inter",
			CodeFont:       "JetBrains Mono",
			Density:        "comfortable",
			AccentColor:    "blue",
			ReduceMotion:   false,
			CompactSidebar: false,
			DateFormat:     "relative",
		},
		Security: SecuritySettings{
			SessionTimeoutMinutes:  720,
			PasswordMinLength:      12,
			RequireStrongPasswords: true,
			RequireMFA:             false,
			AllowSelfSignup:        false,
			AllowPasswordReset:     false,
			AuditRetentionDays:     90,
		},
		Authentication: AuthenticationSettings{
			Local: LocalAuthSettings{
				Enabled: true,
			},
			GenericOAuth: GenericOAuthSettings{
				Enabled:      false,
				ProviderType: "generic",
				ProviderName: "SSO",
				Scopes:       []string{"openid", "profile", "email"},
				AzureTenantID: "common",
				EmailPath:    "email",
				NamePath:     "name",
				GroupsPath:   "groups",
				AllowedGroups: []string{},
				AllowedDomains: []string{},
				AutoSignUp:   false,
				DefaultRole:  "Viewer",
			},
			LDAP: LDAPSettings{
				Enabled:          false,
				Port:             636,
				UseSSL:           true,
				StartTLS:         false,
				SkipTLSVerify:    false,
				UserSearchFilter: "(|(uid=%s)(mail=%s))",
				EmailAttribute:   "mail",
				NameAttribute:    "cn",
				GroupAttribute:   "memberOf",
				AllowedGroups:    []string{},
				AutoSignUp:       false,
				DefaultRole:      "Viewer",
			},
		},
		Operations: OperationsSettings{
			DefaultLandingPage:         "home",
			DefaultNamespaceMode:       "remember",
			AutoRefreshSeconds:         30,
			ConfirmDestructiveActions:  true,
			EnableDesktopNotifications: true,
		},
	}
}

func systemRoles() []RoleInput {
	return []RoleInput{
		{
			Name:        "Admin",
			Description: "Full administrative access across settings, users, roles, and groups.",
			Permissions: []string{PermissionSettingsView, PermissionSettingsManage, PermissionUsersManage, PermissionRolesManage, PermissionGroupsManage},
		},
		{
			Name:        "Operator",
			Description: "Operational access with read-only access to settings and user directory.",
			Permissions: []string{PermissionSettingsView},
		},
		{
			Name:        "Viewer",
			Description: "Basic authenticated access to the application.",
			Permissions: []string{PermissionSettingsView},
		},
	}
}

func (s *Store) ensureDefaultSettings() error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM app_settings`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	payload, _ := json.Marshal(defaultAppSettings())
	_, err := s.db.Exec(`INSERT INTO app_settings(id, payload) VALUES (1, ?)`, string(payload))
	return err
}

func (s *Store) ensureSystemRoles() error {
	now := time.Now().UTC().Format(time.RFC3339)
	for _, role := range systemRoles() {
		var exists int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM roles WHERE name = ?`, role.Name).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		perms, _ := json.Marshal(role.Permissions)
		if _, err := s.db.Exec(
			`INSERT INTO roles(id, name, description, permissions_json, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
			uuid.NewString(), role.Name, role.Description, string(perms), now, now,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetAuthStatus(sessionID string) (AuthStatus, error) {
	cfg, err := s.GetSettings()
	if err != nil {
		return AuthStatus{}, err
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return AuthStatus{}, err
	}
	status := AuthStatus{
		NeedsSetup: count == 0,
		Providers: AuthProviderStatus{
			LocalEnabled:    cfg.Authentication.Local.Enabled,
			LDAPEnabled:     cfg.Authentication.LDAP.Enabled,
			SSOEnabled:      cfg.Authentication.GenericOAuth.Enabled,
			SSOProviderName: oauthProviderLabel(cfg.Authentication.GenericOAuth.ProviderType, cfg.Authentication.GenericOAuth.ProviderName),
		},
	}
	if sessionID == "" || status.NeedsSetup {
		return status, nil
	}
	user, err := s.GetSessionUser(sessionID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return status, nil
		}
		return status, err
	}
	status.Authenticated = true
	status.CurrentUser = user
	return status, nil
}

func (s *Store) GetSettings() (AppSettings, error) {
	var payload string
	if err := s.db.QueryRow(`SELECT payload FROM app_settings WHERE id = 1`).Scan(&payload); err != nil {
		return AppSettings{}, err
	}
	var out AppSettings
	if err := json.Unmarshal([]byte(payload), &out); err != nil {
		return AppSettings{}, err
	}
	normalizeSettings(&out)
	return out, nil
}

func (s *Store) UpdateSettings(input AppSettings) (AppSettings, error) {
	normalizeSettings(&input)
	payload, err := json.Marshal(input)
	if err != nil {
		return AppSettings{}, err
	}
	_, err = s.db.Exec(`UPDATE app_settings SET payload = ? WHERE id = 1`, string(payload))
	return input, err
}

func (s *Store) BootstrapAdmin(name, email, password string) (*CurrentUser, string, time.Time, error) {
	return nil, "", time.Time{}, fmt.Errorf("self-signup is disabled; sign in with the seeded admin account")
}

func (s *Store) AuthenticateLocal(identifier, password string) (*CurrentUser, string, time.Time, error) {
	settings, err := s.GetSettings()
	if err != nil {
		return nil, "", time.Time{}, err
	}
	if !settings.Authentication.Local.Enabled {
		return nil, "", time.Time{}, fmt.Errorf("local authentication is disabled")
	}
	normalized := normalizeEmail(identifier)
	row := s.db.QueryRow(`SELECT id, password_hash, status FROM users WHERE email = ?`, normalized)
	var userID, hash, status string
	if err := row.Scan(&userID, &hash, &status); err != nil {
		return nil, "", time.Time{}, fmt.Errorf("invalid username or password")
	}
	if status != "active" {
		return nil, "", time.Time{}, fmt.Errorf("user account is %s", status)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, "", time.Time{}, fmt.Errorf("invalid username or password")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, _ = s.db.Exec(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`, now, now, userID)
	return s.createSessionForUser(userID, settings.Security.SessionTimeoutMinutes)
}

func (s *Store) Authenticate(identifier, password string) (*CurrentUser, string, time.Time, error) {
	return s.AuthenticateLocal(identifier, password)
}

func (s *Store) GetUserByEmail(email string) (*User, error) {
	row := s.db.QueryRow(`SELECT id, email, display_name, status, COALESCE(last_login_at, ''), created_at, updated_at FROM users WHERE email = ?`, normalizeEmail(email))
	var u User
	var lastLogin, createdAt, updatedAt string
	if err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Status, &lastLogin, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	u.LastLoginAt = parseOptionalTime(lastLogin)
	u.CreatedAt = parseOptionalTime(createdAt)
	u.UpdatedAt = parseOptionalTime(updatedAt)
	if err := s.populateUserRelations(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) AuthenticateExternalIdentity(email, displayName string, autoSignUp bool, defaultRole string) (*CurrentUser, string, time.Time, error) {
	settings, err := s.GetSettings()
	if err != nil {
		return nil, "", time.Time{}, err
	}
	normalized := normalizeEmail(email)
	user, err := s.GetUserByEmail(normalized)
	switch {
	case err == nil:
		if user.Status != "active" {
			return nil, "", time.Time{}, fmt.Errorf("user account is %s", user.Status)
		}
		if strings.TrimSpace(displayName) != "" && strings.TrimSpace(displayName) != user.DisplayName {
			_, _ = s.db.Exec(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`, strings.TrimSpace(displayName), time.Now().UTC().Format(time.RFC3339), user.ID)
		}
	case errors.Is(err, sql.ErrNoRows):
		if !autoSignUp {
			return nil, "", time.Time{}, fmt.Errorf("no Radar user exists for %s", normalized)
		}
		user, err = s.createExternalUser(normalized, displayName, defaultRole)
		if err != nil {
			return nil, "", time.Time{}, err
		}
	default:
		return nil, "", time.Time{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, _ = s.db.Exec(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`, now, now, user.ID)
	return s.createSessionForUser(user.ID, settings.Security.SessionTimeoutMinutes)
}

func (s *Store) createSessionForUser(userID string, timeoutMinutes int) (*CurrentUser, string, time.Time, error) {
	if timeoutMinutes <= 0 {
		timeoutMinutes = 720
	}
	expiresAt := time.Now().UTC().Add(time.Duration(timeoutMinutes) * time.Minute)
	sessionID := uuid.NewString()
	if _, err := s.db.Exec(
		`INSERT INTO sessions(id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		sessionID, userID, expiresAt.Format(time.RFC3339), time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return nil, "", time.Time{}, err
	}
	user, err := s.GetUserByID(userID)
	if err != nil {
		return nil, "", time.Time{}, err
	}
	return toCurrentUser(user), sessionID, expiresAt, nil
}

func (s *Store) DeleteSession(sessionID string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, sessionID)
	return err
}

func (s *Store) GetSessionUser(sessionID string) (*CurrentUser, error) {
	if sessionID == "" {
		return nil, sql.ErrNoRows
	}
	var userID string
	var expiresRaw string
	if err := s.db.QueryRow(`SELECT user_id, expires_at FROM sessions WHERE id = ?`, sessionID).Scan(&userID, &expiresRaw); err != nil {
		return nil, err
	}
	expiresAt, err := time.Parse(time.RFC3339, expiresRaw)
	if err != nil || time.Now().UTC().After(expiresAt) {
		_, _ = s.db.Exec(`DELETE FROM sessions WHERE id = ?`, sessionID)
		return nil, sql.ErrNoRows
	}
	user, err := s.GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	return toCurrentUser(user), nil
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT id, email, display_name, status, COALESCE(last_login_at, ''), created_at, updated_at FROM users ORDER BY email`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		var lastLogin, createdAt, updatedAt string
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Status, &lastLogin, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		u.LastLoginAt = parseOptionalTime(lastLogin)
		u.CreatedAt = parseOptionalTime(createdAt)
		u.UpdatedAt = parseOptionalTime(updatedAt)
		if err := s.populateUserRelations(&u); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

func (s *Store) GetUserByID(id string) (*User, error) {
	row := s.db.QueryRow(`SELECT id, email, display_name, status, COALESCE(last_login_at, ''), created_at, updated_at FROM users WHERE id = ?`, id)
	var u User
	var lastLogin, createdAt, updatedAt string
	if err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Status, &lastLogin, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	u.LastLoginAt = parseOptionalTime(lastLogin)
	u.CreatedAt = parseOptionalTime(createdAt)
	u.UpdatedAt = parseOptionalTime(updatedAt)
	if err := s.populateUserRelations(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) CreateUser(input UserInput) (*User, error) {
	settings, err := s.GetSettings()
	if err != nil {
		return nil, err
	}
	if err := validatePassword(input.Password, settings.Security.PasswordMinLength, settings.Security.RequireStrongPasswords); err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	status := input.Status
	if status == "" {
		status = "active"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO users(id, email, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, normalizeEmail(input.Email), strings.TrimSpace(input.DisplayName), string(hash), status, now, now,
	); err != nil {
		return nil, err
	}
	if err := syncAssignments(tx, "user_roles", "user_id", id, input.RoleIDs); err != nil {
		return nil, err
	}
	if err := syncAssignments(tx, "group_members", "user_id", id, input.GroupIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetUserByID(id)
}

func (s *Store) UpdateUser(id string, input UserInput) (*User, error) {
	existing, err := s.GetUserByID(id)
	if err != nil {
		return nil, err
	}
	if isSuperUserIdentity(existing.Email) {
		input.Email = adminIdentifier
		input.Status = "active"
		input.RoleIDs = existing.RoleIDs
		input.GroupIDs = existing.GroupIDs
		if strings.TrimSpace(input.DisplayName) == "" {
			input.DisplayName = existing.DisplayName
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE users SET email = ?, display_name = ?, status = ?, updated_at = ? WHERE id = ?`,
		normalizeEmail(input.Email), strings.TrimSpace(input.DisplayName), input.Status, now, id,
	); err != nil {
		return nil, err
	}
	if err := syncAssignments(tx, "user_roles", "user_id", id, input.RoleIDs); err != nil {
		return nil, err
	}
	if err := syncAssignments(tx, "group_members", "user_id", id, input.GroupIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetUserByID(id)
}

func (s *Store) SetUserPassword(id, password string) error {
	settings, err := s.GetSettings()
	if err != nil {
		return err
	}
	if err := validatePassword(password, settings.Security.PasswordMinLength, settings.Security.RequireStrongPasswords); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, string(hash), time.Now().UTC().Format(time.RFC3339), id)
	return err
}

func (s *Store) DeleteUser(id string) error {
	user, err := s.GetUserByID(id)
	if err != nil {
		return err
	}
	if isSuperUserIdentity(user.Email) {
		return fmt.Errorf("the built-in admin user cannot be deleted")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`DELETE FROM sessions WHERE user_id = ?`,
		`DELETE FROM user_roles WHERE user_id = ?`,
		`DELETE FROM group_members WHERE user_id = ?`,
		`DELETE FROM users WHERE id = ?`,
	} {
		if _, err := tx.Exec(stmt, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListRoles() ([]Role, error) {
	rows, err := s.db.Query(`SELECT id, name, description, permissions_json, is_system, created_at, updated_at FROM roles ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roles []Role
	for rows.Next() {
		var r Role
		var permsJSON, createdAt, updatedAt string
		var system int
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &permsJSON, &system, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(permsJSON), &r.Permissions)
		r.Permissions = nonNilStrings(r.Permissions)
		r.System = system == 1
		r.CreatedAt = parseOptionalTime(createdAt)
		r.UpdatedAt = parseOptionalTime(updatedAt)
		roles = append(roles, r)
	}
	return roles, nil
}

func (s *Store) CreateRole(input RoleInput) (*Role, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	perms, _ := json.Marshal(uniqueStrings(input.Permissions))
	if _, err := s.db.Exec(
		`INSERT INTO roles(id, name, description, permissions_json, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
		id, strings.TrimSpace(input.Name), strings.TrimSpace(input.Description), string(perms), now, now,
	); err != nil {
		return nil, err
	}
	return s.getRoleByID(id)
}

func (s *Store) UpdateRole(id string, input RoleInput) (*Role, error) {
	var system int
	if err := s.db.QueryRow(`SELECT is_system FROM roles WHERE id = ?`, id).Scan(&system); err != nil {
		return nil, err
	}
	if system == 1 {
		return nil, fmt.Errorf("system roles cannot be modified")
	}
	perms, _ := json.Marshal(uniqueStrings(input.Permissions))
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.db.Exec(`UPDATE roles SET name = ?, description = ?, permissions_json = ?, updated_at = ? WHERE id = ?`,
		strings.TrimSpace(input.Name), strings.TrimSpace(input.Description), string(perms), now, id,
	); err != nil {
		return nil, err
	}
	return s.getRoleByID(id)
}

func (s *Store) DeleteRole(id string) error {
	var system int
	if err := s.db.QueryRow(`SELECT is_system FROM roles WHERE id = ?`, id).Scan(&system); err != nil {
		return err
	}
	if system == 1 {
		return fmt.Errorf("system roles cannot be deleted")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`DELETE FROM user_roles WHERE role_id = ?`,
		`DELETE FROM group_roles WHERE role_id = ?`,
		`DELETE FROM roles WHERE id = ?`,
	} {
		if _, err := tx.Exec(stmt, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListGroups() ([]Group, error) {
	rows, err := s.db.Query(`SELECT id, name, description, created_at, updated_at FROM groups ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []Group
	for rows.Next() {
		var g Group
		var createdAt, updatedAt string
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		g.RoleIDs, _ = s.fetchIDs(`SELECT role_id FROM group_roles WHERE group_id = ? ORDER BY role_id`, g.ID)
		g.RoleIDs = nonNilStrings(g.RoleIDs)
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM group_members WHERE group_id = ?`, g.ID).Scan(&g.MemberCount); err != nil {
			return nil, err
		}
		g.CreatedAt = parseOptionalTime(createdAt)
		g.UpdatedAt = parseOptionalTime(updatedAt)
		groups = append(groups, g)
	}
	return groups, nil
}

func (s *Store) CreateGroup(input GroupInput) (*Group, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO groups(id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		id, strings.TrimSpace(input.Name), strings.TrimSpace(input.Description), now, now,
	); err != nil {
		return nil, err
	}
	if err := syncAssignments(tx, "group_roles", "group_id", id, input.RoleIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.getGroupByID(id)
}

func (s *Store) UpdateGroup(id string, input GroupInput) (*Group, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE groups SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
		strings.TrimSpace(input.Name), strings.TrimSpace(input.Description), now, id,
	); err != nil {
		return nil, err
	}
	if err := syncAssignments(tx, "group_roles", "group_id", id, input.RoleIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.getGroupByID(id)
}

func (s *Store) DeleteGroup(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`DELETE FROM group_roles WHERE group_id = ?`,
		`DELETE FROM group_members WHERE group_id = ?`,
		`DELETE FROM groups WHERE id = ?`,
	} {
		if _, err := tx.Exec(stmt, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) getRoleByID(id string) (*Role, error) {
	roles, err := s.ListRoles()
	if err != nil {
		return nil, err
	}
	for _, role := range roles {
		if role.ID == id {
			return &role, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (s *Store) getGroupByID(id string) (*Group, error) {
	groups, err := s.ListGroups()
	if err != nil {
		return nil, err
	}
	for _, group := range groups {
		if group.ID == id {
			return &group, nil
		}
	}
	return nil, sql.ErrNoRows
}

func (s *Store) populateUserRelations(u *User) error {
	roleIDs, err := s.fetchIDs(`SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY role_id`, u.ID)
	if err != nil {
		return err
	}
	groupIDs, err := s.fetchIDs(`SELECT group_id FROM group_members WHERE user_id = ? ORDER BY group_id`, u.ID)
	if err != nil {
		return err
	}
	effectiveRoleIDs := append([]string{}, roleIDs...)
	for _, groupID := range groupIDs {
		groupRoleIDs, err := s.fetchIDs(`SELECT role_id FROM group_roles WHERE group_id = ? ORDER BY role_id`, groupID)
		if err != nil {
			return err
		}
		effectiveRoleIDs = append(effectiveRoleIDs, groupRoleIDs...)
	}
	permissions, err := s.fetchPermissionsForRoles(uniqueStrings(effectiveRoleIDs))
	if err != nil {
		return err
	}
	u.RoleIDs = nonNilStrings(uniqueStrings(roleIDs))
	u.GroupIDs = nonNilStrings(uniqueStrings(groupIDs))
	u.EffectiveRoles = nonNilStrings(uniqueStrings(effectiveRoleIDs))
	u.Permissions = nonNilStrings(permissions)
	return nil
}

func (s *Store) fetchIDs(query string, args ...any) ([]string, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return nonNilStrings(out), nil
}

func (s *Store) fetchPermissionsForRoles(roleIDs []string) ([]string, error) {
	if len(roleIDs) == 0 {
		return []string{}, nil
	}
	var perms []string
	for _, roleID := range roleIDs {
		var payload string
		if err := s.db.QueryRow(`SELECT permissions_json FROM roles WHERE id = ?`, roleID).Scan(&payload); err != nil {
			continue
		}
		var rolePerms []string
		_ = json.Unmarshal([]byte(payload), &rolePerms)
		perms = append(perms, rolePerms...)
	}
	return nonNilStrings(uniqueStrings(perms)), nil
}

func syncAssignments(tx *sql.Tx, table, ownerColumn, ownerID string, ids []string) error {
	var targetColumn string
	switch table {
	case "user_roles", "group_roles":
		targetColumn = "role_id"
	case "group_members":
		targetColumn = "group_id"
	default:
		return fmt.Errorf("unsupported assignment table %s", table)
	}
	if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM %s WHERE %s = ?`, table, ownerColumn), ownerID); err != nil {
		return err
	}
	for _, id := range uniqueStrings(ids) {
		var stmt string
		switch table {
		case "user_roles":
			stmt = `INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)`
			if _, err := tx.Exec(stmt, ownerID, id); err != nil {
				return err
			}
		case "group_roles":
			stmt = `INSERT INTO group_roles(group_id, role_id) VALUES (?, ?)`
			if _, err := tx.Exec(stmt, ownerID, id); err != nil {
				return err
			}
		case "group_members":
			stmt = `INSERT INTO group_members(group_id, user_id) VALUES (?, ?)`
			if _, err := tx.Exec(stmt, id, ownerID); err != nil {
				return err
			}
		}
	}
	_ = targetColumn
	return nil
}

func (s *Store) createExternalUser(email, displayName, defaultRole string) (*User, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	password, err := generateAdminPassword(16)
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	roleID, err := s.resolveRoleIDByName(defaultRole)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = email
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`INSERT INTO users(id, email, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
		id, normalizeEmail(email), strings.TrimSpace(displayName), string(hash), now, now,
	); err != nil {
		return nil, err
	}
	if roleID != "" {
		if _, err := tx.Exec(`INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)`, id, roleID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetUserByID(id)
}

func (s *Store) resolveRoleIDByName(name string) (string, error) {
	roleName := strings.TrimSpace(name)
	if roleName == "" {
		roleName = "Viewer"
	}
	rows, err := s.db.Query(`SELECT id, name FROM roles`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var id, existing string
		if err := rows.Scan(&id, &existing); err != nil {
			return "", err
		}
		if strings.EqualFold(existing, roleName) {
			return id, nil
		}
	}
	return "", fmt.Errorf("default role %q was not found", roleName)
}

func normalizeSettings(cfg *AppSettings) {
	defaults := defaultAppSettings()
	if cfg.OrganizationName == "" {
		cfg.OrganizationName = defaults.OrganizationName
	}
	if cfg.SupportEmail == "" {
		cfg.SupportEmail = defaults.SupportEmail
	}
	if cfg.Appearance.UITheme == "" {
		cfg.Appearance.UITheme = defaults.Appearance.UITheme
	}
	if cfg.Appearance.UIFont == "" {
		cfg.Appearance.UIFont = defaults.Appearance.UIFont
	}
	if cfg.Appearance.CodeFont == "" {
		cfg.Appearance.CodeFont = defaults.Appearance.CodeFont
	}
	if cfg.Appearance.Density == "" {
		cfg.Appearance.Density = defaults.Appearance.Density
	}
	if cfg.Appearance.AccentColor == "" {
		cfg.Appearance.AccentColor = defaults.Appearance.AccentColor
	}
	if cfg.Appearance.DateFormat == "" {
		cfg.Appearance.DateFormat = defaults.Appearance.DateFormat
	}
	if cfg.Security.SessionTimeoutMinutes == 0 {
		cfg.Security.SessionTimeoutMinutes = defaults.Security.SessionTimeoutMinutes
	}
	if cfg.Security.PasswordMinLength == 0 {
		cfg.Security.PasswordMinLength = defaults.Security.PasswordMinLength
	}
	if cfg.Security.AuditRetentionDays == 0 {
		cfg.Security.AuditRetentionDays = defaults.Security.AuditRetentionDays
	}
	if cfg.Operations.DefaultLandingPage == "" {
		cfg.Operations.DefaultLandingPage = defaults.Operations.DefaultLandingPage
	}
	if cfg.Operations.DefaultNamespaceMode == "" {
		cfg.Operations.DefaultNamespaceMode = defaults.Operations.DefaultNamespaceMode
	}
	if cfg.Operations.AutoRefreshSeconds == 0 {
		cfg.Operations.AutoRefreshSeconds = defaults.Operations.AutoRefreshSeconds
	}
	if !cfg.Authentication.Local.Enabled && !cfg.Authentication.GenericOAuth.Enabled && !cfg.Authentication.LDAP.Enabled {
		cfg.Authentication.Local.Enabled = true
	}
	if cfg.Authentication.GenericOAuth.ProviderName == "" {
		cfg.Authentication.GenericOAuth.ProviderName = oauthProviderLabel(cfg.Authentication.GenericOAuth.ProviderType, defaults.Authentication.GenericOAuth.ProviderName)
	}
	if cfg.Authentication.GenericOAuth.ProviderType == "" {
		cfg.Authentication.GenericOAuth.ProviderType = defaults.Authentication.GenericOAuth.ProviderType
	}
	if cfg.Authentication.GenericOAuth.AzureTenantID == "" {
		cfg.Authentication.GenericOAuth.AzureTenantID = defaults.Authentication.GenericOAuth.AzureTenantID
	}
	if len(cfg.Authentication.GenericOAuth.Scopes) == 0 {
		cfg.Authentication.GenericOAuth.Scopes = defaults.Authentication.GenericOAuth.Scopes
	}
	cfg.Authentication.GenericOAuth.Scopes = nonNilStrings(cfg.Authentication.GenericOAuth.Scopes)
	if cfg.Authentication.GenericOAuth.EmailPath == "" {
		cfg.Authentication.GenericOAuth.EmailPath = defaults.Authentication.GenericOAuth.EmailPath
	}
	if cfg.Authentication.GenericOAuth.NamePath == "" {
		cfg.Authentication.GenericOAuth.NamePath = defaults.Authentication.GenericOAuth.NamePath
	}
	if cfg.Authentication.GenericOAuth.GroupsPath == "" {
		cfg.Authentication.GenericOAuth.GroupsPath = defaults.Authentication.GenericOAuth.GroupsPath
	}
	cfg.Authentication.GenericOAuth.AllowedGroups = nonNilStrings(cfg.Authentication.GenericOAuth.AllowedGroups)
	cfg.Authentication.GenericOAuth.AllowedDomains = nonNilStrings(cfg.Authentication.GenericOAuth.AllowedDomains)
	if cfg.Authentication.GenericOAuth.DefaultRole == "" {
		cfg.Authentication.GenericOAuth.DefaultRole = defaults.Authentication.GenericOAuth.DefaultRole
	}
	if cfg.Authentication.LDAP.Port == 0 {
		cfg.Authentication.LDAP.Port = defaults.Authentication.LDAP.Port
	}
	if cfg.Authentication.LDAP.UserSearchFilter == "" {
		cfg.Authentication.LDAP.UserSearchFilter = defaults.Authentication.LDAP.UserSearchFilter
	}
	if cfg.Authentication.LDAP.EmailAttribute == "" {
		cfg.Authentication.LDAP.EmailAttribute = defaults.Authentication.LDAP.EmailAttribute
	}
	if cfg.Authentication.LDAP.NameAttribute == "" {
		cfg.Authentication.LDAP.NameAttribute = defaults.Authentication.LDAP.NameAttribute
	}
	if cfg.Authentication.LDAP.GroupAttribute == "" {
		cfg.Authentication.LDAP.GroupAttribute = defaults.Authentication.LDAP.GroupAttribute
	}
	cfg.Authentication.LDAP.AllowedGroups = nonNilStrings(cfg.Authentication.LDAP.AllowedGroups)
	if cfg.Authentication.LDAP.DefaultRole == "" {
		cfg.Authentication.LDAP.DefaultRole = defaults.Authentication.LDAP.DefaultRole
	}
}

func oauthProviderLabel(providerType, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "github":
		return "GitHub"
	case "google":
		return "Google"
	case "azuread":
		return "Azure AD"
	default:
		if strings.TrimSpace(fallback) == "" {
			return "SSO"
		}
		return fallback
	}
}

func validatePassword(password string, minLength int, requireStrong bool) error {
	if len(password) < minLength {
		return fmt.Errorf("password must be at least %d characters", minLength)
	}
	if !requireStrong {
		return nil
	}
	var hasUpper, hasLower, hasDigit bool
	for _, ch := range password {
		switch {
		case ch >= 'A' && ch <= 'Z':
			hasUpper = true
		case ch >= 'a' && ch <= 'z':
			hasLower = true
		case ch >= '0' && ch <= '9':
			hasDigit = true
		}
	}
	if !hasUpper || !hasLower || !hasDigit {
		return fmt.Errorf("password must include uppercase, lowercase, and a number")
	}
	return nil
}

func parseOptionalTime(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, raw)
	return t
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	var out []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func toCurrentUser(user *User) *CurrentUser {
	return &CurrentUser{
		ID:          user.ID,
		Email:       user.Email,
		DisplayName: user.DisplayName,
		Permissions: nonNilStrings(user.Permissions),
		RoleIDs:     nonNilStrings(user.RoleIDs),
		GroupIDs:    nonNilStrings(user.GroupIDs),
		IsSuperUser: isSuperUserIdentity(user.Email),
	}
}

func (s *Store) EnsureAdminUser() (bool, string, error) {
	row := s.db.QueryRow(`SELECT id FROM users WHERE email = ?`, adminIdentifier)
	var existingID string
	if err := row.Scan(&existingID); err == nil {
		return false, "", nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return false, "", err
	}

	settings, err := s.GetSettings()
	if err != nil {
		return false, "", err
	}
	password, err := generateAdminPassword(settings.Security.PasswordMinLength)
	if err != nil {
		return false, "", err
	}
	if err := validatePassword(password, settings.Security.PasswordMinLength, settings.Security.RequireStrongPasswords); err != nil {
		return false, "", err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return false, "", err
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return false, "", err
	}

	userID := uuid.NewString()
	if _, err := tx.Exec(
		`INSERT INTO users(id, email, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
		userID, adminIdentifier, adminIdentifier, string(hash), now.Format(time.RFC3339), now.Format(time.RFC3339),
	); err != nil {
		return false, "", err
	}

	var adminRoleID string
	if err := tx.QueryRow(`SELECT id FROM roles WHERE name = 'Admin'`).Scan(&adminRoleID); err != nil {
		return false, "", err
	}
	if _, err := tx.Exec(`INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)`, userID, adminRoleID); err != nil {
		return false, "", err
	}
	if err := tx.Commit(); err != nil {
		return false, "", err
	}

	return true, password, nil
}

const adminIdentifier = "admin"

func isSuperUserIdentity(identifier string) bool {
	return normalizeEmail(identifier) == adminIdentifier
}

func generateAdminPassword(minLength int) (string, error) {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
	if minLength < 16 {
		minLength = 16
	}
	buffer := make([]byte, minLength)
	random := make([]byte, minLength)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	for i, value := range random {
		buffer[i] = charset[int(value)%len(charset)]
	}
	password := string(buffer)
	if !strings.ContainsAny(password, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
		password = "A" + password[1:]
	}
	if !strings.ContainsAny(password, "abcdefghijklmnopqrstuvwxyz") {
		password = password[:1] + "a" + password[2:]
	}
	if !strings.ContainsAny(password, "0123456789") {
		password = password[:2] + "7" + password[3:]
	}
	return password, nil
}

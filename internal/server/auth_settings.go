package server

import (
	"crypto/rand"
	"crypto/tls"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-ldap/ldap/v3"
	"github.com/skyhook-io/radar/internal/settings"
	"golang.org/x/oauth2"
)

const sessionCookieName = "radar_session"
const oauthStateCookieName = "radar_oauth_state"

type contextKey string

const currentUserKey contextKey = "radar-current-user"

type authRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	Method      string `json:"method"`
}

type passwordResetRequest struct {
	Password string `json:"password"`
}

func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	status, err := s.settings.GetAuthStatus(s.sessionID(r))
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writeJSON(w, status)
}

func (s *Server) authSetup(w http.ResponseWriter, r *http.Request) {
	s.writeError(w, http.StatusForbidden, "self-signup is disabled; sign in with the built-in admin account")
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	method := strings.TrimSpace(req.Method)
	if method == "" {
		method = "local"
	}
	var (
		user      *settings.CurrentUser
		sessionID string
		expiresAt time.Time
		err      error
	)
	switch method {
	case "local":
		user, sessionID, expiresAt, err = s.settings.AuthenticateLocal(req.Email, req.Password)
	case "ldap":
		user, sessionID, expiresAt, err = s.authenticateLDAP(req.Email, req.Password)
	default:
		s.writeError(w, http.StatusBadRequest, "unsupported authentication method")
		return
	}
	if err != nil {
		s.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	s.setSessionCookie(w, sessionID, expiresAt)
	s.writeJSON(w, map[string]any{"currentUser": user})
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	sessionID := s.sessionID(r)
	if sessionID != "" {
		_ = s.settings.DeleteSession(sessionID)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		SameSite: http.SameSiteLaxMode,
	})
	s.writeJSON(w, map[string]string{"status": "logged_out"})
}

func (s *Server) authMe(w http.ResponseWriter, r *http.Request) {
	user, ok := currentUserFromContext(r.Context())
	if !ok {
		s.writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	s.writeJSON(w, user)
}

func (s *Server) authSSOStart(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.settings.GetSettings()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	provider := cfg.Authentication.GenericOAuth
	if !provider.Enabled {
		s.writeError(w, http.StatusBadRequest, "single sign-on is disabled")
		return
	}
	resolved, err := resolveOAuthProvider(provider)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	state, err := randomStateToken()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		Expires:  time.Now().Add(10 * time.Minute),
		SameSite: http.SameSiteLaxMode,
	})

	oauthConfig := oauth2.Config{
		ClientID:     provider.ClientID,
		ClientSecret: provider.ClientSecret,
		Endpoint: oauth2.Endpoint{
			AuthURL:  resolved.AuthURL,
			TokenURL: resolved.TokenURL,
		},
		RedirectURL: s.oauthRedirectURL(r, resolved),
		Scopes:      resolved.Scopes,
	}
	http.Redirect(w, r, oauthConfig.AuthCodeURL(state, oauth2.AccessTypeOnline), http.StatusFound)
}

func (s *Server) authSSOCallback(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.settings.GetSettings()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	provider := cfg.Authentication.GenericOAuth
	if !provider.Enabled {
		s.writeError(w, http.StatusBadRequest, "single sign-on is disabled")
		return
	}
	resolved, err := resolveOAuthProvider(provider)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	stateCookie, err := r.Cookie(oauthStateCookieName)
	if err != nil || r.URL.Query().Get("state") == "" || r.URL.Query().Get("state") != stateCookie.Value {
		s.writeError(w, http.StatusBadRequest, "invalid oauth state")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		SameSite: http.SameSiteLaxMode,
	})

	oauthConfig := oauth2.Config{
		ClientID:     provider.ClientID,
		ClientSecret: provider.ClientSecret,
		Endpoint: oauth2.Endpoint{
			AuthURL:  resolved.AuthURL,
			TokenURL: resolved.TokenURL,
		},
		RedirectURL: s.oauthRedirectURL(r, resolved),
		Scopes:      resolved.Scopes,
	}
	token, err := oauthConfig.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		s.writeError(w, http.StatusUnauthorized, "failed to exchange oauth code")
		return
	}
	profile, err := fetchOAuthProfile(r.Context(), oauthConfig.Client(r.Context(), token), resolved)
	if err != nil {
		s.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	email := extractProfileString(profile, provider.EmailPath)
	if email == "" {
		s.writeError(w, http.StatusUnauthorized, "oauth provider did not return an email address")
		return
	}
	if !isAllowedDomain(email, provider.AllowedDomains) {
		s.writeError(w, http.StatusForbidden, "email domain is not allowed for this provider")
		return
	}
	groups := extractProfileStrings(profile, provider.GroupsPath)
	if !matchesAllowedGroup(groups, provider.AllowedGroups) {
		s.writeError(w, http.StatusForbidden, "you are not a member of an allowed group")
		return
	}
	displayName := extractProfileString(profile, provider.NamePath)
	_, sessionID, expiresAt, err := s.settings.AuthenticateExternalIdentity(email, displayName, provider.AutoSignUp, provider.DefaultRole)
	if err != nil {
		s.writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	s.setSessionCookie(w, sessionID, expiresAt)
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *Server) getAppSettings(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.settings.GetSettings()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writeJSON(w, cfg)
}

func (s *Server) updateAppSettings(w http.ResponseWriter, r *http.Request) {
	var req settings.AppSettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	cfg, err := s.settings.UpdateSettings(req)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writeJSON(w, cfg)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.settings.ListUsers()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writeJSON(w, users)
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var req settings.UserInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	user, err := s.settings.CreateUser(req)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, user)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	var req settings.UserInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	user, err := s.settings.UpdateUser(chi.URLParam(r, "id"), req)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, user)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	if err := s.settings.DeleteUser(chi.URLParam(r, "id")); err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	var req passwordResetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := s.settings.SetUserPassword(chi.URLParam(r, "id"), req.Password); err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, map[string]string{"status": "password_updated"})
}

func (s *Server) listRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := s.settings.ListRoles()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writeJSON(w, roles)
}

func (s *Server) createRole(w http.ResponseWriter, r *http.Request) {
	var req settings.RoleInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	role, err := s.settings.CreateRole(req)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, role)
}

func (s *Server) updateRole(w http.ResponseWriter, r *http.Request) {
	var req settings.RoleInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	role, err := s.settings.UpdateRole(chi.URLParam(r, "id"), req)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, role)
}

func (s *Server) deleteRole(w http.ResponseWriter, r *http.Request) {
	if err := s.settings.DeleteRole(chi.URLParam(r, "id")); err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := s.settings.ListGroups()
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writeJSON(w, groups)
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var req settings.GroupInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	group, err := s.settings.CreateGroup(req)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, group)
}

func (s *Server) updateGroup(w http.ResponseWriter, r *http.Request) {
	var req settings.GroupInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	group, err := s.settings.UpdateGroup(chi.URLParam(r, "id"), req)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, group)
}

func (s *Server) deleteGroup(w http.ResponseWriter, r *http.Request) {
	if err := s.settings.DeleteGroup(chi.URLParam(r, "id")); err != nil {
		s.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.writeJSON(w, map[string]string{"status": "deleted"})
}

func (s *Server) authenticateLDAP(identifier, password string) (*settings.CurrentUser, string, time.Time, error) {
	cfg, err := s.settings.GetSettings()
	if err != nil {
		return nil, "", time.Time{}, err
	}
	ldapCfg := cfg.Authentication.LDAP
	if !ldapCfg.Enabled {
		return nil, "", time.Time{}, fmt.Errorf("ldap authentication is disabled")
	}
	if ldapCfg.Host == "" || ldapCfg.UserBaseDN == "" {
		return nil, "", time.Time{}, fmt.Errorf("ldap is not fully configured")
	}
	if password == "" {
		return nil, "", time.Time{}, fmt.Errorf("password is required")
	}

	conn, err := dialLDAP(ldapCfg)
	if err != nil {
		return nil, "", time.Time{}, fmt.Errorf("failed to connect to ldap")
	}
	defer conn.Close()

	if ldapCfg.BindDN != "" {
		if err := conn.Bind(ldapCfg.BindDN, ldapCfg.BindPassword); err != nil {
			return nil, "", time.Time{}, fmt.Errorf("failed to bind ldap service account")
		}
	}

	escaped := ldap.EscapeFilter(identifier)
	searchFilter := strings.ReplaceAll(ldapCfg.UserSearchFilter, "%s", escaped)
	searchReq := ldap.NewSearchRequest(
		ldapCfg.UserBaseDN,
		ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 1, 0, false,
		searchFilter,
		[]string{"dn", ldapCfg.EmailAttribute, ldapCfg.NameAttribute, ldapCfg.GroupAttribute},
		nil,
	)
	result, err := conn.Search(searchReq)
	if err != nil || len(result.Entries) == 0 {
		return nil, "", time.Time{}, fmt.Errorf("invalid username or password")
	}
	entry := result.Entries[0]
	userDN := entry.DN

	if err := conn.Bind(userDN, password); err != nil {
		return nil, "", time.Time{}, fmt.Errorf("invalid username or password")
	}

	email := strings.TrimSpace(entry.GetAttributeValue(ldapCfg.EmailAttribute))
	if email == "" {
		email = normalizeIdentifier(identifier)
	}
	displayName := strings.TrimSpace(entry.GetAttributeValue(ldapCfg.NameAttribute))
	if displayName == "" {
		displayName = email
	}
	groups := entry.GetAttributeValues(ldapCfg.GroupAttribute)
	if !matchesAllowedGroup(groups, ldapCfg.AllowedGroups) {
		return nil, "", time.Time{}, fmt.Errorf("you are not a member of an allowed ldap group")
	}
	return s.settings.AuthenticateExternalIdentity(email, displayName, ldapCfg.AutoSignUp, ldapCfg.DefaultRole)
}

func dialLDAP(cfg settings.LDAPSettings) (*ldap.Conn, error) {
	address := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	if cfg.UseSSL {
		return ldap.DialTLS("tcp", address, &tls.Config{InsecureSkipVerify: cfg.SkipTLSVerify})
	}
	conn, err := ldap.DialURL("ldap://" + address)
	if err != nil {
		return nil, err
	}
	if cfg.StartTLS {
		if err := conn.StartTLS(&tls.Config{InsecureSkipVerify: cfg.SkipTLSVerify}); err != nil {
			conn.Close()
			return nil, err
		}
	}
	return conn, nil
}

func fetchOAuthProfile(ctx context.Context, client *http.Client, provider settings.GenericOAuthSettings) (map[string]any, error) {
	if strings.EqualFold(provider.ProviderType, "github") {
		return fetchGitHubProfile(ctx, client, provider.UserInfoURL)
	}
	userInfoURL := provider.UserInfoURL
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, userInfoURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to fetch oauth profile")
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var profile map[string]any
	if err := json.Unmarshal(body, &profile); err != nil {
		return nil, fmt.Errorf("failed to parse oauth profile")
	}
	return profile, nil
}

func fetchGitHubProfile(ctx context.Context, client *http.Client, userInfoURL string) (map[string]any, error) {
	profile, err := fetchOAuthProfileGeneric(ctx, client, userInfoURL)
	if err != nil {
		return nil, err
	}
	if extractProfileString(profile, "email") != "" {
		return profile, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user/emails", nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return profile, nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var emails []map[string]any
	if err := json.Unmarshal(body, &emails); err != nil {
		return nil, err
	}
	for _, email := range emails {
		primary, _ := email["primary"].(bool)
		verified, _ := email["verified"].(bool)
		address, _ := email["email"].(string)
		if primary && verified && strings.TrimSpace(address) != "" {
			profile["email"] = address
			break
		}
	}
	return profile, nil
}

func fetchOAuthProfileGeneric(ctx context.Context, client *http.Client, userInfoURL string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, userInfoURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to fetch oauth profile")
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var profile map[string]any
	if err := json.Unmarshal(body, &profile); err != nil {
		return nil, fmt.Errorf("failed to parse oauth profile")
	}
	return profile, nil
}

func extractProfileString(payload map[string]any, path string) string {
	if path == "" {
		return ""
	}
	value := walkJSONPath(payload, path)
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func extractProfileStrings(payload map[string]any, path string) []string {
	if path == "" {
		return nil
	}
	value := walkJSONPath(payload, path)
	switch typed := value.(type) {
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, strings.TrimSpace(text))
			}
		}
		return out
	case []string:
		return typed
	case string:
		if typed == "" {
			return nil
		}
		return []string{typed}
	default:
		return nil
	}
}

func walkJSONPath(payload map[string]any, path string) any {
	current := any(payload)
	for _, part := range strings.Split(path, ".") {
		if part == "" {
			continue
		}
		nextMap, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = nextMap[part]
	}
	return current
}

func isAllowedDomain(email string, allowedDomains []string) bool {
	if len(allowedDomains) == 0 {
		return true
	}
	parts := strings.SplitN(strings.ToLower(strings.TrimSpace(email)), "@", 2)
	if len(parts) != 2 {
		return false
	}
	domain := parts[1]
	for _, allowed := range allowedDomains {
		if strings.EqualFold(strings.TrimSpace(allowed), domain) {
			return true
		}
	}
	return false
}

func matchesAllowedGroup(actual, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, group := range actual {
		for _, want := range allowed {
			if groupMatches(group, want) {
				return true
			}
		}
	}
	return false
}

func groupMatches(actual, allowed string) bool {
	actual = strings.ToLower(strings.TrimSpace(actual))
	allowed = strings.ToLower(strings.TrimSpace(allowed))
	if actual == allowed {
		return true
	}
	return strings.Contains(actual, allowed)
}

func resolveOAuthProvider(provider settings.GenericOAuthSettings) (settings.GenericOAuthSettings, error) {
	resolved := provider
	switch strings.ToLower(strings.TrimSpace(provider.ProviderType)) {
	case "", "generic":
		if resolved.ProviderName == "" {
			resolved.ProviderName = "SSO"
		}
	case "github":
		resolved.ProviderName = "GitHub"
		resolved.AuthURL = "https://github.com/login/oauth/authorize"
		resolved.TokenURL = "https://github.com/login/oauth/access_token"
		resolved.UserInfoURL = "https://api.github.com/user"
		resolved.Scopes = fallbackScopes(provider.Scopes, []string{"read:user", "user:email"})
		resolved.EmailPath = "email"
		resolved.NamePath = "name"
		resolved.GroupsPath = ""
	case "google":
		resolved.ProviderName = "Google"
		resolved.AuthURL = "https://accounts.google.com/o/oauth2/v2/auth"
		resolved.TokenURL = "https://oauth2.googleapis.com/token"
		resolved.UserInfoURL = "https://openidconnect.googleapis.com/v1/userinfo"
		resolved.Scopes = fallbackScopes(provider.Scopes, []string{"openid", "profile", "email"})
		resolved.EmailPath = "email"
		resolved.NamePath = "name"
		resolved.GroupsPath = ""
	case "azuread":
		tenant := strings.TrimSpace(provider.AzureTenantID)
		if tenant == "" {
			tenant = "common"
		}
		resolved.ProviderName = "Azure AD"
		resolved.AuthURL = fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/authorize", tenant)
		resolved.TokenURL = fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", tenant)
		resolved.UserInfoURL = "https://graph.microsoft.com/oidc/userinfo"
		resolved.Scopes = fallbackScopes(provider.Scopes, []string{"openid", "profile", "email", "User.Read"})
		resolved.EmailPath = "email"
		resolved.NamePath = "name"
		resolved.GroupsPath = ""
	default:
		return resolved, fmt.Errorf("unsupported oauth provider type %q", provider.ProviderType)
	}

	if provider.ClientID == "" || provider.ClientSecret == "" || resolved.AuthURL == "" || resolved.TokenURL == "" || resolved.UserInfoURL == "" {
		return resolved, fmt.Errorf("oauth provider is not fully configured")
	}
	if resolved.DefaultRole == "" {
		resolved.DefaultRole = "Viewer"
	}
	return resolved, nil
}

func fallbackScopes(actual, defaults []string) []string {
	if len(actual) > 0 {
		return actual
	}
	return defaults
}

func randomStateToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", buf), nil
}

func (s *Server) oauthRedirectURL(r *http.Request, provider settings.GenericOAuthSettings) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	base := url.URL{
		Scheme: scheme,
		Host:   r.Host,
		Path:   "/api/auth/sso/callback",
	}
	return base.String()
}

func normalizeIdentifier(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func (s *Server) sessionID(r *http.Request) string {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func (s *Server) setSessionCookie(w http.ResponseWriter, sessionID string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Expires:  expiresAt,
		SameSite: http.SameSiteLaxMode,
	})
}

func currentUserFromContext(ctx context.Context) (*settings.CurrentUser, bool) {
	value := ctx.Value(currentUserKey)
	user, ok := value.(*settings.CurrentUser)
	return user, ok && user != nil
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		status, err := s.settings.GetAuthStatus("")
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if status.NeedsSetup {
			next.ServeHTTP(w, r)
			return
		}
		user, err := s.settings.GetSessionUser(s.sessionID(r))
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				s.writeError(w, http.StatusUnauthorized, "authentication required")
				return
			}
			s.writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), currentUserKey, user)))
	})
}

func (s *Server) requirePermission(permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUserFromContext(r.Context())
		if !ok {
			s.writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		for _, existing := range user.Permissions {
			if existing == permission {
				next(w, r)
				return
			}
		}
		s.writeError(w, http.StatusForbidden, "insufficient permissions")
	}
}

func (s *Server) requireSuperUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUserFromContext(r.Context())
		if !ok {
			s.writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		if !user.IsSuperUser {
			s.writeError(w, http.StatusForbidden, "only the built-in admin user can manage users")
			return
		}
		next(w, r)
	}
}

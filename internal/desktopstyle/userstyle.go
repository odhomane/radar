package desktopstyle

import (
	"fmt"
	"os"
	"path/filepath"
)

const defaultUserStyle = `/* Radar Desktop userstyle.css
 *
 * This file is loaded after the built-in app styles.
 * Edit it to override fonts, spacing, colors, or any other CSS.
 *
 * After saving changes, use View -> Reload User Style in Radar Desktop.
 *
 * Example:
 * :root {
 *   --font-ui: "SF Pro Text", "Inter", sans-serif;
 *   --font-mono: "JetBrains Mono", monospace;
 * }
 *
 * body {
 *   font-family: var(--font-ui);
 * }
 *
 * code, pre, .font-mono {
 *   font-family: var(--font-mono) !important;
 * }
 */
`

// Manager owns the desktop userstyle file under ~/.radar/desktop/.
type Manager struct {
	path string
}

// NewManager creates a manager using the standard Radar desktop config path.
func NewManager() (*Manager, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("get home dir: %w", err)
	}

	return &Manager{
		path: filepath.Join(home, ".radar", "desktop", "userstyle.css"),
	}, nil
}

// Ensure creates the userstyle file with a starter template if it does not exist.
func (m *Manager) Ensure() error {
	if err := os.MkdirAll(filepath.Dir(m.path), 0o755); err != nil {
		return fmt.Errorf("create userstyle dir: %w", err)
	}

	if _, err := os.Stat(m.path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat userstyle: %w", err)
	}

	if err := os.WriteFile(m.path, []byte(defaultUserStyle), 0o644); err != nil {
		return fmt.Errorf("write default userstyle: %w", err)
	}

	return nil
}

// Path returns the absolute path to userstyle.css.
func (m *Manager) Path() string {
	return m.path
}

// Dir returns the directory containing userstyle.css.
func (m *Manager) Dir() string {
	return filepath.Dir(m.path)
}

// Read returns the current file contents, creating the file first if needed.
func (m *Manager) Read() ([]byte, error) {
	if err := m.Ensure(); err != nil {
		return nil, err
	}

	data, err := os.ReadFile(m.path)
	if err != nil {
		return nil, fmt.Errorf("read userstyle: %w", err)
	}
	return data, nil
}

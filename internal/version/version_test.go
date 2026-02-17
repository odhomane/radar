package version

import (
	"testing"
)

func TestIsNewerVersion(t *testing.T) {
	tests := []struct {
		name    string
		latest  string
		current string
		want    bool
		wantErr bool
	}{
		{"major upgrade", "2.0.0", "1.0.0", true, false},
		{"minor upgrade", "1.1.0", "1.0.0", true, false},
		{"patch upgrade", "1.0.1", "1.0.0", true, false},
		{"same version", "1.0.0", "1.0.0", false, false},
		{"downgrade", "1.0.0", "2.0.0", false, false},
		{"prerelease newer than stable", "1.1.0-rc1", "1.0.0", true, false},
		{"with v prefix on latest", "v1.1.0", "1.0.0", true, false},
		{"with v prefix on current", "1.1.0", "v1.0.0", true, false},
		{"invalid latest", "not-a-version", "1.0.0", false, true},
		{"invalid current", "1.0.0", "not-a-version", false, true},
		{"empty latest", "", "1.0.0", false, true},
		{"empty current", "1.0.0", "", false, true},
		{"both empty", "", "", false, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := isNewerVersion(tt.latest, tt.current)
			if (err != nil) != tt.wantErr {
				t.Errorf("isNewerVersion(%q, %q) error = %v, wantErr %v", tt.latest, tt.current, err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("isNewerVersion(%q, %q) = %v, want %v", tt.latest, tt.current, got, tt.want)
			}
		})
	}
}

func TestGetUpdateCommand(t *testing.T) {
	tests := []struct {
		method InstallMethod
		want   string
	}{
		{InstallHomebrew, "brew upgrade cmdb/tap/cmdb-kubeexplorer"},
		{InstallKrew, "kubectl krew upgrade cmdb-kubeexplorer"},
		{InstallScoop, "scoop update cmdb-kubeexplorer"},
		{InstallDirect, ""},
		{InstallDesktop, ""},
		{InstallMethod("unknown"), ""},
	}

	for _, tt := range tests {
		t.Run(string(tt.method), func(t *testing.T) {
			got := getUpdateCommand(tt.method)
			if got != tt.want {
				t.Errorf("getUpdateCommand(%q) = %q, want %q", tt.method, got, tt.want)
			}
		})
	}
}

func TestDetectInstallMethodFromPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want InstallMethod
	}{
		{"homebrew mac arm", "/opt/homebrew/bin/cmdb-kubeexplorer", InstallHomebrew},
		{"homebrew cellar", "/usr/local/Cellar/cmdb-kubeexplorer/1.0/bin/cmdb-kubeexplorer", InstallHomebrew},
		{"linuxbrew", "/home/linuxbrew/.linuxbrew/bin/cmdb-kubeexplorer", InstallHomebrew},
		{"krew", "/home/user/.krew/store/cmdb-kubeexplorer/v1.0/cmdb-kubeexplorer", InstallKrew},
		{"scoop unix", "/home/user/scoop/apps/cmdb-kubeexplorer/current/cmdb-kubeexplorer", InstallScoop},
		{"scoop windows", `C:\Users\user\scoop\apps\cmdb-kubeexplorer\current\cmdb-kubeexplorer.exe`, InstallScoop},
		{"direct /usr/local/bin", "/usr/local/bin/cmdb-kubeexplorer", InstallDirect},
		{"direct home", "/home/user/bin/cmdb-kubeexplorer", InstallDirect},
		{"direct tmp", "/tmp/cmdb-kubeexplorer", InstallDirect},
		{"mixed case Homebrew", "/opt/Homebrew/bin/cmdb-kubeexplorer", InstallHomebrew},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectInstallMethodFromPath(tt.path)
			if got != tt.want {
				t.Errorf("detectInstallMethodFromPath(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestTruncateNotes(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{"shorter than max", "hello", 10, "hello"},
		{"exactly at max", "hello", 5, "hello"},
		{"longer than max", "hello world", 5, "hello..."},
		{"empty string", "", 10, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncateNotes(tt.input, tt.maxLen)
			if got != tt.want {
				t.Errorf("truncateNotes(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}
}

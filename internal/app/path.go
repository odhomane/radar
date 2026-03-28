package app

import (
	"context"
	"log"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// EnrichPATH ensures Radar can find auth helper binaries like
// gke-gcloud-auth-plugin, aws, gcloud, and kubelogin even when it is launched
// from an environment with an incomplete PATH.
func EnrichPATH() {
	shellPath := getShellPath()
	if shellPath != "" {
		os.Setenv("PATH", shellPath)
		log.Printf("PATH enriched from login shell (%d entries)", len(strings.Split(shellPath, ":")))
		return
	}

	current := os.Getenv("PATH")
	extras := commonPaths()
	if len(extras) == 0 {
		log.Printf("PATH enrichment: no additional paths found; auth plugins may be unavailable")
		return
	}

	if current == "" {
		os.Setenv("PATH", strings.Join(extras, ":"))
	} else {
		os.Setenv("PATH", current+":"+strings.Join(extras, ":"))
	}
	log.Printf("PATH enriched with %d common paths", len(extras))
}

func getShellPath() string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		if runtime.GOOS == "darwin" {
			shell = "/bin/zsh"
		} else {
			shell = "/bin/bash"
		}
	}

	const startMarker = "__RADAR_PATH_START__"
	const endMarker = "__RADAR_PATH_END__"
	echoCmd := "echo " + startMarker + "$PATH" + endMarker

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, shell, "-l", "-i", "-c", echoCmd)
	cmd.Env = []string{
		"HOME=" + os.Getenv("HOME"),
		"USER=" + os.Getenv("USER"),
		"SHELL=" + shell,
	}
	cmd.Stdin = nil

	out, err := cmd.Output()
	if err != nil {
		log.Printf("Shell PATH detection failed (%s -l -i -c): %v", shell, err)
		return ""
	}

	output := string(out)
	startIdx := strings.Index(output, startMarker)
	endIdx := strings.Index(output, endMarker)
	if startIdx == -1 || endIdx == -1 || endIdx <= startIdx {
		log.Printf("Shell PATH detection: markers not found in output")
		return ""
	}

	path := strings.TrimSpace(output[startIdx+len(startMarker) : endIdx])
	if path == "" || path == os.Getenv("PATH") {
		return ""
	}
	return path
}

func commonPaths() []string {
	home := os.Getenv("HOME")
	if home == "" {
		if u, err := user.Current(); err == nil {
			home = u.HomeDir
		}
	}

	candidates := []string{
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/opt/homebrew/share/google-cloud-sdk/bin",
		"/usr/local/bin",
		"/usr/local/share/google-cloud-sdk/bin",
		"/usr/local/go/bin",
		"/snap/bin",
	}

	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, "google-cloud-sdk", "bin"),
			filepath.Join(home, "go", "bin"),
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".krew", "bin"),
		)
	}

	current := os.Getenv("PATH")
	var existing []string
	for _, p := range candidates {
		if strings.Contains(current, p) {
			continue
		}
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			existing = append(existing, p)
		}
	}
	return existing
}

package main

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/skyhook-io/radar/internal/desktopstyle"
)

func newDesktopUserStyleManager() (*desktopstyle.Manager, error) {
	manager, err := desktopstyle.NewManager()
	if err != nil {
		return nil, err
	}
	if err := manager.Ensure(); err != nil {
		return nil, err
	}
	return manager, nil
}

func openPath(path string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "linux":
		cmd = exec.Command("xdg-open", path)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", path)
	default:
		return fmt.Errorf("opening files is not supported on %s", runtime.GOOS)
	}

	return cmd.Start()
}

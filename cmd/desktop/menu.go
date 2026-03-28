package main

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func createMenu(desktopApp *DesktopApp) *menu.Menu {
	appMenu := menu.NewMenu()

	// File menu
	fileMenu := appMenu.AddSubmenu("File")
	fileMenu.AddText("New Window", keys.CmdOrCtrl("n"), func(_ *menu.CallbackData) {
		// Future: open a new window with a different context
	})
	fileMenu.AddSeparator()
	fileMenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(desktopApp.ctx)
	})

	// Edit menu (standard accelerators)
	editMenu := appMenu.AddSubmenu("Edit")
	editMenu.AddText("Undo", keys.CmdOrCtrl("z"), nil)
	editMenu.AddText("Redo", keys.Combo("z", keys.ShiftKey, keys.CmdOrCtrlKey), nil)
	editMenu.AddSeparator()
	editMenu.AddText("Cut", keys.CmdOrCtrl("x"), nil)
	editMenu.AddText("Copy", keys.CmdOrCtrl("c"), nil)
	editMenu.AddText("Paste", keys.CmdOrCtrl("v"), nil)
	editMenu.AddText("Select All", keys.CmdOrCtrl("a"), nil)

	// View menu
	viewMenu := appMenu.AddSubmenu("View")
	viewMenu.AddText("Back", keys.CmdOrCtrl("["), func(_ *menu.CallbackData) {
		runtime.WindowExecJS(desktopApp.ctx, "window.history.back()")
	})
	viewMenu.AddText("Forward", keys.CmdOrCtrl("]"), func(_ *menu.CallbackData) {
		runtime.WindowExecJS(desktopApp.ctx, "window.history.forward()")
	})
	viewMenu.AddSeparator()
	viewMenu.AddText("Reload", keys.CmdOrCtrl("r"), func(_ *menu.CallbackData) {
		runtime.WindowReloadApp(desktopApp.ctx)
	})
	viewMenu.AddText("Open User Style CSS", keys.CmdOrCtrl("u"), func(_ *menu.CallbackData) {
		if desktopApp.userStyle == nil {
			return
		}
		if err := openPath(desktopApp.userStyle.Path()); err != nil {
			runtime.MessageDialog(desktopApp.ctx, runtime.MessageDialogOptions{
				Type:    runtime.ErrorDialog,
				Title:   "Open User Style CSS",
				Message: fmt.Sprintf("Failed to open %s\n\n%v", desktopApp.userStyle.Path(), err),
			})
		}
	})
	viewMenu.AddText("Reveal User Style Folder", nil, func(_ *menu.CallbackData) {
		if desktopApp.userStyle == nil {
			return
		}
		if err := openPath(desktopApp.userStyle.Dir()); err != nil {
			runtime.MessageDialog(desktopApp.ctx, runtime.MessageDialogOptions{
				Type:    runtime.ErrorDialog,
				Title:   "Reveal User Style Folder",
				Message: fmt.Sprintf("Failed to open %s\n\n%v", desktopApp.userStyle.Dir(), err),
			})
		}
	})
	viewMenu.AddText("Reload User Style", keys.Combo("u", keys.ShiftKey, keys.CmdOrCtrlKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(desktopApp.ctx, "reload-user-style")
		runtime.WindowExecJS(desktopApp.ctx, "window.dispatchEvent(new CustomEvent('radar:reload-user-style'))")
	})
	viewMenu.AddSeparator()
	viewMenu.AddText("Zoom In", keys.CmdOrCtrl("="), nil)
	viewMenu.AddText("Zoom Out", keys.CmdOrCtrl("-"), nil)
	viewMenu.AddText("Reset Zoom", keys.CmdOrCtrl("0"), nil)

	// Help menu
	helpMenu := appMenu.AddSubmenu("Help")
	helpMenu.AddText("Check for Updates...", nil, func(_ *menu.CallbackData) {
		// Emit an event that the frontend listens for to trigger a version check
		runtime.EventsEmit(desktopApp.ctx, "check-for-updates")
	})
	helpMenu.AddSeparator()
	helpMenu.AddText("About Radar", nil, func(_ *menu.CallbackData) {
		runtime.MessageDialog(desktopApp.ctx, runtime.MessageDialogOptions{
			Type:    runtime.InfoDialog,
			Title:   "About Radar",
			Message: "Radar — Kubernetes Visibility Tool\nBuilt by Skyhook\n\nhttps://github.com/skyhook-io/radar",
		})
	})
	helpMenu.AddText("Documentation", nil, func(_ *menu.CallbackData) {
		runtime.BrowserOpenURL(desktopApp.ctx, "https://github.com/skyhook-io/radar#readme")
	})
	helpMenu.AddText("GitHub Repository", nil, func(_ *menu.CallbackData) {
		runtime.BrowserOpenURL(desktopApp.ctx, "https://github.com/skyhook-io/radar")
	})

	return appMenu
}

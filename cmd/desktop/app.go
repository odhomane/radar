package main

import (
	"context"
	"log"

	"github.com/skyhook-io/radar/internal/app"
	"github.com/skyhook-io/radar/internal/k8s"
	"github.com/skyhook-io/radar/internal/server"
	"github.com/skyhook-io/radar/internal/timeline"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// DesktopApp manages the desktop application lifecycle.
type DesktopApp struct {
	ctx              context.Context
	srv              *server.Server
	timelineStoreCfg timeline.StoreConfig
}

func NewDesktopApp(srv *server.Server, timelineStoreCfg timeline.StoreConfig) *DesktopApp {
	return &DesktopApp{
		srv:              srv,
		timelineStoreCfg: timelineStoreCfg,
	}
}

// startup is called when the Wails app starts.
func (a *DesktopApp) startup(ctx context.Context) {
	a.ctx = ctx
	startNativeMouseMonitor(ctx)
}

// domReady is called when the webview DOM is ready.
func (a *DesktopApp) domReady(ctx context.Context) {
	// Update window title with cluster context
	contextName := k8s.GetContextName()
	if contextName != "" {
		wailsRuntime.WindowSetTitle(ctx, "Radar — "+contextName)
	}
}

// beforeClose is called before the window closes. Return true to prevent closing.
func (a *DesktopApp) beforeClose(ctx context.Context) bool {
	return false // allow close
}

// shutdown is called when the application is shutting down.
func (a *DesktopApp) shutdown(ctx context.Context) {
	stopNativeMouseMonitor()
	log.Println("Desktop app shutting down...")
	app.Shutdown(a.srv)
}

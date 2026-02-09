//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

// Callback from Go
extern void onMouseButton(int button);

static id mouseMonitor = nil;

static void startMouseMonitor() {
	// Monitor otherMouseDown for standard mice that send button 3 (back) / 4 (forward).
	// Note: Logitech Options+ intercepts these at the driver level and sends them as
	// NX_SYSDEFINED system events instead. For Logitech mice, users should configure
	// back/forward buttons to send Cmd+[ / Cmd+] keyboard shortcuts in Logi Options+,
	// which are handled by the app's View menu.
	mouseMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskOtherMouseDown
		handler:^NSEvent*(NSEvent* event) {
			int btn = (int)[event buttonNumber];
			if (btn == 3 || btn == 4) {
				onMouseButton(btn);
			}
			return event;
		}];
}

static void stopMouseMonitor() {
	if (mouseMonitor != nil) {
		[NSEvent removeMonitor:mouseMonitor];
		mouseMonitor = nil;
	}
}
*/
import "C"

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// appCtx is set once in startNativeMouseMonitor (before the monitor starts)
// and only read thereafter — no concurrent writes.
var appCtx context.Context

//export onMouseButton
func onMouseButton(button C.int) {
	if appCtx == nil {
		return
	}
	switch int(button) {
	case 3: // back
		runtime.WindowExecJS(appCtx, "window.history.back()")
	case 4: // forward
		runtime.WindowExecJS(appCtx, "window.history.forward()")
	}
}

func startNativeMouseMonitor(ctx context.Context) {
	appCtx = ctx
	C.startMouseMonitor()
}

func stopNativeMouseMonitor() {
	C.stopMouseMonitor()
}

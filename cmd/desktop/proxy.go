package main

import (
	"fmt"
	"net/http"
)

// RedirectHandler serves a minimal HTML page that redirects the Wails webview
// to the real localhost server. Once the redirect fires, the webview is on a
// real localhost URL — all fetch, SSE, and WebSocket work identically to
// browser mode.
type RedirectHandler struct {
	serverAddr string // e.g. "localhost:54321"
}

func NewRedirectHandler(serverAddr string) *RedirectHandler {
	return &RedirectHandler{serverAddr: serverAddr}
}

func (h *RedirectHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    background: #0a0a0f;
    color: #a0a0b0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    margin: 0;
  }
  .loader {
    text-align: center;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #1a1a2e;
    border-top: 3px solid #6366f1;
    border-radius: 50%%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
<script>
  window.location.replace("http://%s");
</script>
</head>
<body>
<div class="loader">
  <div class="spinner"></div>
  <div>Starting CMDB KubeExplorer...</div>
</div>
</body>
</html>`, h.serverAddr)
}

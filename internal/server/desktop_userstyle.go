package server

import (
	"log"
	"net/http"

	"github.com/skyhook-io/radar/internal/desktopstyle"
)

// handleDesktopUserStyle serves the desktop-only custom stylesheet.
// GET /api/desktop/userstyle.css
func (s *Server) handleDesktopUserStyle(w http.ResponseWriter, r *http.Request) {
	if s.userStyle == nil {
		s.writeError(w, http.StatusNotFound, "desktop userstyle not available in this build")
		return
	}

	css, err := s.userStyle.Read()
	if err != nil {
		log.Printf("[desktop-userstyle] Failed to read custom stylesheet: %v", err)
		s.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	_, _ = w.Write(css)
}

// SetUserStyleManager attaches desktop userstyle support to the server.
func (s *Server) SetUserStyleManager(m *desktopstyle.Manager) {
	s.userStyle = m
}

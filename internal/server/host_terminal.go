package server

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sync"
)

// handleHostTerminal handles WebSocket connections for a host shell terminal.
func (s *Server) handleHostTerminal(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Host terminal: websocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	shell := os.Getenv("SHELL")
	if shell == "" {
		switch runtime.GOOS {
		case "windows":
			shell = "cmd.exe"
		default:
			shell = "/bin/sh"
		}
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(r.Context(), shell)
	} else {
		cmd = exec.CommandContext(r.Context(), shell, "-l", "-i")
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		sendWSError(conn, "failed to initialize host terminal stdin: "+err.Error())
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		sendWSError(conn, "failed to initialize host terminal stdout: "+err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		sendWSError(conn, "failed to initialize host terminal stderr: "+err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		sendWSError(conn, "failed to start host shell: "+err.Error())
		return
	}
	defer func() {
		_ = stdin.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}()

	wsOut := &wsWriter{conn: conn}
	var copyWG sync.WaitGroup
	copyWG.Add(2)
	go func() {
		defer copyWG.Done()
		_, _ = io.Copy(wsOut, stdout)
	}()
	go func() {
		defer copyWG.Done()
		_, _ = io.Copy(wsOut, stderr)
	}()

	cmdDone := make(chan error, 1)
	go func() {
		cmdDone <- cmd.Wait()
	}()

	msgChan := make(chan []byte, 1)
	readErrChan := make(chan error, 1)
	go func() {
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				readErrChan <- err
				return
			}
			msgChan <- message
		}
	}()

	for {
		select {
		case err := <-cmdDone:
			if err != nil {
				sendWSError(conn, "host terminal exited: "+err.Error())
			}
			copyWG.Wait()
			return
		case <-r.Context().Done():
			copyWG.Wait()
			return
		case <-readErrChan:
			copyWG.Wait()
			return
		case message := <-msgChan:
			var msg TerminalMessage
			if err := json.Unmarshal(message, &msg); err != nil {
				continue
			}
			if msg.Type == "input" {
				_, _ = stdin.Write([]byte(msg.Data))
			}
		}
	}
}

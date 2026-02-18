package server

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/skyhook-io/radar/internal/k8s"
)

type podFilesystemEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Type        string `json:"type"` // dir | file | symlink
	Size        int64  `json:"size"`
	Permissions string `json:"permissions,omitempty"`
	LinkTarget  string `json:"linkTarget,omitempty"`
}

type podFilesystemListResponse struct {
	CurrentPath string               `json:"currentPath"`
	Entries     []podFilesystemEntry `json:"entries"`
}

type podFilesystemSearchResponse struct {
	Query   string               `json:"query"`
	Root    string               `json:"root"`
	Entries []podFilesystemEntry `json:"entries"`
}

type podFilesystemMkdirRequest struct {
	Container string `json:"container"`
	Path      string `json:"path"`
}

type podFilesystemRenameRequest struct {
	Container string `json:"container"`
	OldPath   string `json:"oldPath"`
	NewPath   string `json:"newPath"`
}

type podFilesystemDeleteRequest struct {
	Container string `json:"container"`
	Path      string `json:"path"`
	Recursive bool   `json:"recursive"`
}

func (s *Server) handlePodFilesystemList(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		targetPath = "/"
	}

	currentPath, entries, err := s.listPodDirectory(r.Context(), namespace, podName, container, targetPath)
	if err != nil {
		if strings.Contains(err.Error(), "__ERR_NOT_DIR__") {
			s.writeError(w, http.StatusBadRequest, "path is not a directory")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "failed to list filesystem: "+err.Error())
		return
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Type == "dir" && entries[j].Type != "dir" {
			return true
		}
		if entries[i].Type != "dir" && entries[j].Type == "dir" {
			return false
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	s.writeJSON(w, podFilesystemListResponse{
		CurrentPath: currentPath,
		Entries:     entries,
	})
}

func (s *Server) handlePodFilesystemDownload(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")
	filePath := r.URL.Query().Get("path")
	if strings.TrimSpace(filePath) == "" {
		s.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", path.Base(filePath)))
	content, err := s.readPodFile(r.Context(), namespace, podName, container, filePath)
	if err != nil {
		if strings.Contains(err.Error(), "__ERR_NOT_FILE__") {
			s.writeError(w, http.StatusBadRequest, "path is not a file")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "failed to download file: "+err.Error())
		return
	}
	_, _ = w.Write(content)
}

func (s *Server) handlePodFilesystemSave(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")
	filePath := r.URL.Query().Get("path")
	if strings.TrimSpace(filePath) == "" {
		s.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	stderr := &bytes.Buffer{}
	script := `
set -eu
dest="$1"
[ -f "$dest" ] || [ -L "$dest" ] || { echo "__ERR_NOT_FILE__" >&2; exit 13; }
[ -w "$dest" ] || { echo "__ERR_PERMISSION__ destination file is not writable" >&2; exit 77; }
cat > "$dest" 2>/dev/null || { echo "__ERR_PERMISSION__ destination file is not writable" >&2; exit 77; }
`
	err = s.execInPod(r.Context(), namespace, podName, container, []string{"sh", "-c", script, "sh", filePath}, bytes.NewReader(body), io.Discard, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(msg, "__ERR_NOT_FILE__") {
			s.writeError(w, http.StatusBadRequest, "path is not a file")
			return
		}
		if strings.Contains(msg, "__ERR_PERMISSION__") || strings.Contains(strings.ToLower(msg), "permission denied") {
			s.writeError(w, http.StatusForbidden, "permission denied: target file is not writable by the container user")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "failed to save file: "+msg)
		return
	}

	s.writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handlePodFilesystemSearch(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")
	root := r.URL.Query().Get("path")
	if strings.TrimSpace(root) == "" {
		root = "/"
	}
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if query == "" {
		s.writeError(w, http.StatusBadRequest, "q is required")
		return
	}

	limit := 500
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 2000 {
				parsed = 2000
			}
			limit = parsed
		}
	}

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	script := `
set -eu
root="$1"
query="$2"
limit="$3"
cd / || true
[ -d "$root" ] || { echo "__ERR_NOT_DIR__" >&2; exit 12; }
find "$root" -mindepth 1 -iname "*$query*" 2>/dev/null | head -n "$limit" | while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  name="$(basename "$entry")"
  kind="file"
  if [ -d "$entry" ]; then
    kind="dir"
  elif [ -L "$entry" ]; then
    kind="symlink"
  fi
  lsmeta="$(ls -ldn "$entry" 2>/dev/null || true)"
  set -- $lsmeta
  perms="${1:-}"
  msize="${5:-0}"
  if [ "$kind" = "dir" ]; then
    size="0"
  else
    size="$msize"
  fi
  target=""
  if [ "$kind" = "symlink" ]; then
    target="$(readlink "$entry" 2>/dev/null || true)"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$entry" "$kind" "$size" "$perms" "$target"
done
`

	err := s.execInPod(
		r.Context(),
		namespace,
		podName,
		container,
		[]string{"sh", "-c", script, "sh", root, query, strconv.Itoa(limit)},
		nil,
		stdout,
		stderr,
	)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(msg, "__ERR_NOT_DIR__") {
			s.writeError(w, http.StatusBadRequest, "path is not a directory")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "search failed: "+msg)
		return
	}

	entries := make([]podFilesystemEntry, 0, 64)
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 6)
		if len(parts) == 1 && strings.Contains(line, `\t`) {
			parts = strings.SplitN(line, `\t`, 6)
		}
		if len(parts) != 6 {
			continue
		}
		size, _ := strconv.ParseInt(parts[3], 10, 64)
		entries = append(entries, podFilesystemEntry{
			Name:        parts[0],
			Path:        parts[1],
			Type:        parts[2],
			Size:        size,
			Permissions: parts[4],
			LinkTarget:  parts[5],
		})
	}

	s.writeJSON(w, podFilesystemSearchResponse{
		Query:   query,
		Root:    root,
		Entries: entries,
	})
}

func (s *Server) handlePodFilesystemArchive(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")
	targetPath := r.URL.Query().Get("path")
	if strings.TrimSpace(targetPath) == "" {
		s.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	baseName := path.Base(strings.TrimSuffix(targetPath, "/"))
	if baseName == "." || baseName == "/" {
		s.writeError(w, http.StatusBadRequest, "invalid path")
		return
	}

	zipName := baseName + ".zip"
	if strings.HasSuffix(strings.ToLower(baseName), ".zip") {
		zipName = baseName
	}

	if ok, content, err := s.buildZipFromTarInContainer(r.Context(), namespace, podName, container, targetPath); err == nil && ok {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", zipName))
		w.Header().Set("Content-Length", strconv.Itoa(len(content)))
		_, _ = w.Write(content)
		return
	}
	if ok, content, err := s.buildZipInContainer(r.Context(), namespace, podName, container, targetPath); err == nil && ok {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", zipName))
		w.Header().Set("Content-Length", strconv.Itoa(len(content)))
		_, _ = w.Write(content)
		return
	}

	zipBuf := &bytes.Buffer{}
	zw := zip.NewWriter(zipBuf)
	kind, err := s.getPodPathType(r.Context(), namespace, podName, container, targetPath)
	if err != nil {
		s.writeError(w, http.StatusInternalServerError, "failed to create archive: "+err.Error())
		return
	}
	if kind == "missing" {
		s.writeError(w, http.StatusNotFound, "path not found")
		return
	}

	if kind == "file" || kind == "symlink" {
		content, err := s.readPodFile(r.Context(), namespace, podName, container, targetPath)
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, "failed to create archive: "+err.Error())
			return
		}
		fw, err := zw.Create(baseName)
		if err != nil {
			s.writeError(w, http.StatusInternalServerError, "failed to build zip archive: "+err.Error())
			return
		}
		if _, err := fw.Write(content); err != nil {
			s.writeError(w, http.StatusInternalServerError, "failed to build zip archive: "+err.Error())
			return
		}
	} else {
		type queueItem struct {
			abs string
			rel string
		}
		queue := []queueItem{{abs: targetPath, rel: baseName}}
		for len(queue) > 0 {
			item := queue[0]
			queue = queue[1:]

			curPath, entries, err := s.listPodDirectory(r.Context(), namespace, podName, container, item.abs)
			if err != nil {
				continue
			}

			dirName := item.rel
			if !strings.HasSuffix(dirName, "/") {
				dirName += "/"
			}
			if _, err := zw.Create(dirName); err != nil {
				s.writeError(w, http.StatusInternalServerError, "failed to build zip archive: "+err.Error())
				return
			}

			for _, entry := range entries {
				rel := path.Join(item.rel, entry.Name)
				switch entry.Type {
				case "dir":
					queue = append(queue, queueItem{
						abs: path.Join(curPath, entry.Name),
						rel: rel,
					})
				case "file", "symlink":
					content, err := s.readPodFile(r.Context(), namespace, podName, container, path.Join(curPath, entry.Name))
					if err != nil {
						continue
					}
					fw, err := zw.Create(rel)
					if err != nil {
						s.writeError(w, http.StatusInternalServerError, "failed to build zip archive: "+err.Error())
						return
					}
					if _, err := fw.Write(content); err != nil {
						s.writeError(w, http.StatusInternalServerError, "failed to build zip archive: "+err.Error())
						return
					}
				}
			}
		}
	}

	if err := zw.Close(); err != nil {
		s.writeError(w, http.StatusInternalServerError, "failed to build zip archive: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", zipName))
	w.Header().Set("Content-Length", strconv.Itoa(zipBuf.Len()))
	_, _ = io.Copy(w, zipBuf)
}

func (s *Server) listPodDirectory(ctx context.Context, namespace, podName, container, targetPath string) (string, []podFilesystemEntry, error) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	script := `
set -eu
dir="$1"
if [ -z "$dir" ]; then dir="/"; fi
if [ ! -d "$dir" ]; then
  echo "__ERR_NOT_DIR__" >&2
  exit 12
fi
pwd_out="$(cd "$dir" 2>/dev/null && pwd || printf '%s' "$dir")"
printf '__PWD__\t%s\n' "$pwd_out"
if [ "$dir" = "/" ]; then
  candidates="/.[!.]* /..?* /*"
else
  candidates="$dir/.[!.]* $dir/..?* $dir/*"
fi
for entry in $candidates; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  name="$(basename "$entry")"
  kind="file"
  if [ -d "$entry" ]; then
    kind="dir"
  elif [ -L "$entry" ]; then
    kind="symlink"
  fi
  lsmeta="$(ls -ldn "$entry" 2>/dev/null || true)"
  set -- $lsmeta
  perms="${1:-}"
  msize="${5:-0}"
  if [ "$kind" = "dir" ]; then
    size="0"
  else
    size="$msize"
  fi
  target=""
  if [ "$kind" = "symlink" ]; then
    target="$(readlink "$entry" 2>/dev/null || true)"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$entry" "$kind" "$size" "$perms" "$target"
done
`

	err := s.execInPod(ctx, namespace, podName, container, []string{"sh", "-c", script, "sh", targetPath}, nil, stdout, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", nil, fmt.Errorf("%s", msg)
	}

	currentPath := targetPath
	entries := make([]podFilesystemEntry, 0, 64)
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 6)
		if len(parts) == 1 && strings.Contains(line, `\t`) {
			parts = strings.SplitN(line, `\t`, 6)
		}
		if len(parts) == 2 && parts[0] == "__PWD__" {
			if strings.TrimSpace(parts[1]) != "" {
				currentPath = parts[1]
			}
			continue
		}
		if len(parts) != 6 {
			continue
		}
		size, _ := strconv.ParseInt(parts[3], 10, 64)
		entries = append(entries, podFilesystemEntry{
			Name:        parts[0],
			Path:        parts[1],
			Type:        parts[2],
			Size:        size,
			Permissions: parts[4],
			LinkTarget:  parts[5],
		})
	}
	return currentPath, entries, nil
}

func (s *Server) readPodFile(ctx context.Context, namespace, podName, container, filePath string) ([]byte, error) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	script := `
set -eu
f="$1"
[ -f "$f" ] || [ -L "$f" ] || { echo "__ERR_NOT_FILE__" >&2; exit 13; }
cat "$f"
`
	err := s.execInPod(ctx, namespace, podName, container, []string{"sh", "-c", script, "sh", filePath}, nil, stdout, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("%s", msg)
	}
	return stdout.Bytes(), nil
}

func (s *Server) getPodPathType(ctx context.Context, namespace, podName, container, targetPath string) (string, error) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	script := `
set -eu
p="$1"
if [ -d "$p" ]; then
  echo dir
elif [ -f "$p" ]; then
  echo file
elif [ -L "$p" ]; then
  echo symlink
else
  echo missing
fi
`
	err := s.execInPod(ctx, namespace, podName, container, []string{"sh", "-c", script, "sh", targetPath}, nil, stdout, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return strings.TrimSpace(stdout.String()), nil
}

func (s *Server) buildZipInContainer(ctx context.Context, namespace, podName, container, targetPath string) (bool, []byte, error) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	script := `
set -eu
target="$1"
cd / || true
[ -e "$target" ] || { echo "__ERR_NOT_FOUND__" >&2; exit 14; }
if ! command -v zip >/dev/null 2>&1; then
  echo "__ERR_NO_ZIP__" >&2
  exit 15
fi
parent="$(dirname "$target")"
name="$(basename "$target")"
cd "$parent"
zip -q -r - "$name"
`
	err := s.execInPod(ctx, namespace, podName, container, []string{"sh", "-c", script, "sh", targetPath}, nil, stdout, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if strings.Contains(msg, "__ERR_NO_ZIP__") {
			return false, nil, nil
		}
		if strings.Contains(msg, "__ERR_NOT_FOUND__") {
			return false, nil, fmt.Errorf("path not found")
		}
		if msg == "" {
			msg = err.Error()
		}
		return false, nil, fmt.Errorf("%s", msg)
	}
	return true, stdout.Bytes(), nil
}

func (s *Server) buildZipFromTarInContainer(ctx context.Context, namespace, podName, container, targetPath string) (bool, []byte, error) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	script := `
set -eu
target="$1"
cd / || true
[ -e "$target" ] || { echo "__ERR_NOT_FOUND__" >&2; exit 14; }
parent="$(dirname "$target")"
name="$(basename "$target")"
tar -h -C "$parent" -cf - "$name"
`
	err := s.execInPod(ctx, namespace, podName, container, []string{"sh", "-c", script, "sh", targetPath}, nil, stdout, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if strings.Contains(msg, "__ERR_NOT_FOUND__") {
			return false, nil, fmt.Errorf("path not found")
		}
		if msg == "" {
			msg = err.Error()
		}
		return false, nil, fmt.Errorf("%s", msg)
	}

	tr := tar.NewReader(bytes.NewReader(stdout.Bytes()))
	zipBuf := &bytes.Buffer{}
	zw := zip.NewWriter(zipBuf)

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			_ = zw.Close()
			return false, nil, nil
		}

		name := strings.TrimPrefix(path.Clean(hdr.Name), "/")
		if name == "." || name == "" {
			continue
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			dirName := name
			if !strings.HasSuffix(dirName, "/") {
				dirName += "/"
			}
			if _, err := zw.Create(dirName); err != nil {
				_ = zw.Close()
				return false, nil, err
			}
		case tar.TypeReg, tar.TypeRegA:
			fw, err := zw.Create(name)
			if err != nil {
				_ = zw.Close()
				return false, nil, err
			}
			if _, err := io.Copy(fw, tr); err != nil {
				_ = zw.Close()
				return false, nil, err
			}
		default:
			// Ignore unsupported types (devices/fifos/etc)
		}
	}

	if err := zw.Close(); err != nil {
		return false, nil, err
	}
	return true, zipBuf.Bytes(), nil
}

func (s *Server) handlePodFilesystemUpload(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")
	targetPath := r.URL.Query().Get("path")
	if strings.TrimSpace(targetPath) == "" {
		s.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	stderr := &bytes.Buffer{}
	script := `
set -eu
dest="$1"
parent="$(dirname "$dest")"
[ -d "$parent" ] || mkdir -p "$parent" 2>/dev/null || { echo "__ERR_PERMISSION__ cannot create parent directory" >&2; exit 77; }
[ -w "$parent" ] || { echo "__ERR_PERMISSION__ target directory is not writable" >&2; exit 77; }
cat > "$dest" 2>/dev/null || { echo "__ERR_PERMISSION__ destination file is not writable" >&2; exit 77; }
`
	err = s.execInPod(r.Context(), namespace, podName, container, []string{"sh", "-c", script, "sh", targetPath}, file, io.Discard, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(msg, "__ERR_PERMISSION__") || strings.Contains(strings.ToLower(msg), "permission denied") {
			s.writeError(w, http.StatusForbidden, "permission denied: target path is not writable by the container user")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "failed to upload file: "+msg)
		return
	}

	s.writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handlePodFilesystemMkdir(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")

	var req podFilesystemMkdirRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		s.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	stderr := &bytes.Buffer{}
	err := s.execInPod(r.Context(), namespace, podName, req.Container, []string{"mkdir", "-p", req.Path}, nil, io.Discard, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(strings.ToLower(msg), "permission denied") {
			s.writeError(w, http.StatusForbidden, "permission denied: target path is not writable by the container user")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "failed to create directory: "+msg)
		return
	}
	s.writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handlePodFilesystemRename(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")

	var req podFilesystemRenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.OldPath) == "" || strings.TrimSpace(req.NewPath) == "" {
		s.writeError(w, http.StatusBadRequest, "oldPath and newPath are required")
		return
	}

	stderr := &bytes.Buffer{}
	err := s.execInPod(r.Context(), namespace, podName, req.Container, []string{"mv", req.OldPath, req.NewPath}, nil, io.Discard, stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(strings.ToLower(msg), "permission denied") {
			s.writeError(w, http.StatusForbidden, "permission denied: source or target path is not writable by the container user")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "failed to rename path: "+msg)
		return
	}
	s.writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handlePodFilesystemDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireConnected(w) {
		return
	}

	namespace := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")

	var req podFilesystemDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Path) == "" {
		s.writeError(w, http.StatusBadRequest, "path is required")
		return
	}

	stderr := &bytes.Buffer{}
	var err error
	if req.Recursive {
		err = s.execInPod(r.Context(), namespace, podName, req.Container, []string{"rm", "-rf", req.Path}, nil, io.Discard, stderr)
	} else {
		script := `
set -eu
p="$1"
if [ -d "$p" ]; then
  rmdir "$p"
else
  rm -f "$p"
fi
`
		err = s.execInPod(r.Context(), namespace, podName, req.Container, []string{"sh", "-c", script, "sh", req.Path}, nil, io.Discard, stderr)
	}
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if strings.Contains(strings.ToLower(msg), "permission denied") {
			s.writeError(w, http.StatusForbidden, "permission denied: path is not writable by the container user")
			return
		}
		s.writeError(w, http.StatusInternalServerError, "failed to delete path: "+msg)
		return
	}
	s.writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) execInPod(ctx context.Context, namespace, podName, container string, command []string, stdin io.Reader, stdout, stderr io.Writer) error {
	client := k8s.GetClient()
	config := k8s.GetConfig()
	if client == nil || config == nil {
		return fmt.Errorf("k8s client not initialized")
	}

	req := client.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   command,
			Stdin:     stdin != nil,
			Stdout:    stdout != nil,
			Stderr:    stderr != nil,
			TTY:       false,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		return err
	}

	return executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
		Tty:    false,
	})
}

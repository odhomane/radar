# Radar Repository Summary

Radar is a local-first Kubernetes observability tool that runs as a single binary (CLI plugin or standalone) and serves a browser UI for cluster visibility and operations.

## What this repo contains

- **CLI app** (`cmd/explorer`): starts the Go API server, initializes Kubernetes clients/caches, and opens the browser UI.
- **Desktop app** (`cmd/desktop`): Wails-based native shell around the same backend, with auto-update support.
- **Go backend** (`internal/*`): Kubernetes discovery/caching, topology graph construction, timeline/history, Helm/GitOps/traffic integrations, and HTTP/SSE/WebSocket handlers.
- **React frontend** (`web/`): topology graph, resource explorer, timeline, Helm, GitOps, traffic view, and pod operations UI.
- **Deployment assets** (`deploy/`): Helm chart, Linux desktop files, and Krew plugin manifest.
- **Docs** (`docs/` + root markdown files): user guides and development docs.

## Architecture at a glance

- **Backend:** chi router + Kubernetes informers + SSE broadcaster + on-demand topology builder.
- **Frontend:** React + TypeScript, TanStack Query for server state, `@xyflow/react` + ELK.js for graph visualization.
- **Transport:** REST for reads/writes, SSE for real-time updates, WebSocket for interactive pod exec.

## Primary capabilities

- Topology visualization (resource hierarchy and traffic modes)
- Resource browsing/editing with CRD support
- Event and change timeline
- Pod logs, exec terminal, and port forwarding
- Helm release management
- GitOps monitoring/actions for FluxCD and ArgoCD
- Traffic visualization using Hubble or Caretta
- Container image filesystem inspection

## Build and development workflow

- `make build`: build frontend, embed assets, compile CLI binary
- `make watch-frontend` + `make watch-backend`: hot-reload development loop
- `make test`: Go test suite
- `make tsc`: TypeScript type-check
- `make desktop`: desktop build path

## Tech stack highlights

- **Backend:** Go, client-go, chi, gorilla/websocket, Helm SDK, embedded static assets
- **Frontend:** React, Vite, TypeScript, Tailwind CSS, TanStack Query, XYFlow, ELK.js, Monaco, xterm

# CMDB KubeExplorer Docker Compose Deployment

This folder contains a ready-to-use, multi-architecture Docker Compose setup for CMDB KubeExplorer.

## What this gives you

- Uses the official image: `ghcr.io/cmdb/kubeexplorer:latest`
- Works on any architecture supported by the image manifest (for example `amd64` and `arm64`)
- Exposes CMDB KubeExplorer on **port `8585` by default**
- Mounts your local kubeconfig so CMDB KubeExplorer can connect to your cluster

## Prerequisites

- Docker + Docker Compose plugin (`docker compose`)
- A valid kubeconfig at `~/.kube/config`

## Run

From the repository root:

```bash
cd docker
docker compose up -d
```

Then open:

- http://localhost:8585

## Stop

```bash
cd docker
docker compose down
```

## Notes

- The service runs with:
  - `--no-browser`
  - `--port 8585`
- `read_only: true` is enabled for safer runtime defaults.
- Temporary writable space is provided via `tmpfs` on `/tmp` for runtime needs.
- If your kubeconfig is in a custom location, update the `volumes` section in `docker-compose.yaml`.

## Optional: run in foreground

```bash
cd docker
docker compose up
```

## Optional: view logs

```bash
cd docker
docker compose logs -f cmdb-kubeexplorer
```

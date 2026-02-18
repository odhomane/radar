# Radar Docker Compose Deployment

This folder contains a production-friendly Docker Compose setup for Radar with a read-only filesystem, `tmpfs` for runtime writes, and kubeconfig mounting.

## Included file

- `docker-compose.yaml`

## Default behavior

- Image: `ghcr.io/skyhook-io/radar:latest`
- Exposed port: `8585`
- Command: `--no-browser --port 8585`
- Kubeconfig mount: `${HOME}/.kube/config` -> `/home/nonroot/.kube/config:ro`
- Runtime hardening:
  - `read_only: true`
  - `tmpfs: /tmp`

## Prerequisites

- Docker Engine + Compose plugin (`docker compose`)
- Valid kubeconfig file

## Quick start

```bash
cd docker
docker compose up -d
docker compose logs -f radar
```

Open: [http://localhost:8585](http://localhost:8585)

Stop:

```bash
cd docker
docker compose down
```

## Configuration via environment variables

You can override image/tag, container name, port, and kubeconfig path without editing YAML.

- `RADAR_IMAGE` (default: `ghcr.io/skyhook-io/radar:latest`)
- `RADAR_CONTAINER_NAME` (default: `radar`)
- `RADAR_PORT` (default: `8585`)
- `KUBECONFIG_PATH` (default: `${HOME}/.kube/config`)

## Examples

### 1) Use your Docker Hub image/tag

```bash
cd docker
RADAR_IMAGE=dhomane/radar:0.9.12 docker compose up -d
```

### 2) Use a custom host port

```bash
cd docker
RADAR_PORT=9280 docker compose up -d
```

Open: [http://localhost:9280](http://localhost:9280)

### 3) Use kubeconfig from a custom path

```bash
cd docker
KUBECONFIG_PATH=/path/to/kubeconfig docker compose up -d
```

### 4) Combine multiple overrides

```bash
cd docker
RADAR_IMAGE=dhomane/radar:0.9.12 \
RADAR_PORT=9280 \
KUBECONFIG_PATH=/Users/you/.kube/config \
docker compose up -d
```

### 5) Keep overrides in a `.env` file

Create `docker/.env`:

```dotenv
RADAR_IMAGE=dhomane/radar:0.9.12
RADAR_PORT=8585
KUBECONFIG_PATH=/Users/you/.kube/config
RADAR_CONTAINER_NAME=radar
```

Then run:

```bash
cd docker
docker compose up -d
```

## Operations

Tail logs:

```bash
cd docker
docker compose logs -f radar
```

Restart service:

```bash
cd docker
docker compose restart radar
```

Pull newer image:

```bash
cd docker
docker compose pull
docker compose up -d
```

Remove container and network:

```bash
cd docker
docker compose down
```

## Troubleshooting

- `permission denied` on kubeconfig mount:
  - Ensure the file exists and your shell expands `KUBECONFIG_PATH` correctly.
- UI not reachable:
  - Check `RADAR_PORT` mapping and `docker compose logs -f radar`.
- Kubernetes auth failures:
  - Verify the mounted kubeconfig context and credentials are valid on your host.

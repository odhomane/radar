# Radar Docker Compose Deployment

This folder contains production-friendly Docker Compose setups for Radar with a read-only filesystem, `tmpfs` for runtime writes, and host credential mounts for Kubernetes exec auth plugins.

## Included files

- `docker-compose.yaml`
- `docker-compose-with-auth.yaml` for `oauth2-proxy` with Azure Entra ID
- `docker-compose-with-authentik.yaml` for Authentik
- `docker-compose-with-keycloak.yaml` for Keycloak
- `.env.authentik.example` as a template for the Authentik stack

## Default behavior

- Image: `odhomane/radar:latest`
- Exposed port: `8585`
- Command: `--no-browser --port 8585`
- Kubeconfig mount: `${HOME}/.kube/config` -> `/home/nonroot/.kube/config:ro`
- AWS CLI config mount for EKS auth: `${HOME}/.aws` -> `/root/.aws`
- Azure CLI config mount for AKS auth: `${HOME}/.azure` -> `/home/nonroot/.azure`
- GCloud config mount for GKE auth: `${HOME}/.config/gcloud` -> `/home/nonroot/.config/gcloud`
- Runtime hardening:
  - `read_only: true`
  - `tmpfs: /tmp`

## Prerequisites

- Docker Engine with the Compose plugin
- A working kubeconfig on the host
- If your kubeconfig uses an exec plugin:
- EKS: sign in on the host with `aws sts get-caller-identity` or your normal `aws sso login` / profile flow
- AKS: sign in on the host with `az login`
- GKE: sign in on the host with `gcloud auth login`

## Quick start

```bash
cd docker
docker compose up -d
docker compose logs -f radar
```

Open [http://localhost:8585](http://localhost:8585).

Stop:

```bash
cd docker
docker compose down
```

## Configuration

You can override image, port, and host credential paths without editing YAML.

- `RADAR_IMAGE` default `odhomane/radar:latest`
- `RADAR_CONTAINER_NAME` default `radar`
- `RADAR_PORT` default `8585`
- `KUBECONFIG_PATH` default `${HOME}/.kube/config`
- `AWS_CONFIG_PATH` default `${HOME}/.aws`
- `AZURE_CONFIG_PATH` default `${HOME}/.azure`
- `GCLOUD_CONFIG_PATH` default `${HOME}/.config/gcloud`

Example:

```bash
cd docker
RADAR_PORT=9280 \
KUBECONFIG_PATH=/Users/you/.kube/config \
AWS_CONFIG_PATH=/Users/you/.aws \
AZURE_CONFIG_PATH=/Users/you/.azure \
GCLOUD_CONFIG_PATH=/Users/you/.config/gcloud \
docker compose up -d
```

You can also keep overrides in `docker/.env`:

```dotenv
RADAR_IMAGE=odhomane/radar:latest
RADAR_PORT=8585
KUBECONFIG_PATH=/Users/you/.kube/config
AWS_CONFIG_PATH=/Users/you/.aws
AZURE_CONFIG_PATH=/Users/you/.azure
GCLOUD_CONFIG_PATH=/Users/you/.config/gcloud
RADAR_CONTAINER_NAME=radar
```

## Authentication variants

### Azure Entra ID SSO with oauth2-proxy

Use `docker-compose-with-auth.yaml` to protect the Radar UI with Azure Entra ID.

Required variables:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `OAUTH2_PROXY_COOKIE_SECRET`

Start it:

```bash
cd docker
docker compose -f docker-compose-with-auth.yaml up -d
docker compose -f docker-compose-with-auth.yaml logs -f radar-auth
```

### Authentik

```bash
cd docker
cp .env.authentik.example .env.authentik
docker compose --env-file .env.authentik -f docker-compose-with-authentik.yaml up -d radar authentik-db authentik-redis authentik-server authentik-worker
```

### Keycloak

Use `docker-compose-with-keycloak.yaml` when you want Radar behind Keycloak via `oauth2-proxy`.

## Troubleshooting

- `kubelogin not found` or AKS auth failure:
  - Rebuild or pull an image that includes `kubelogin`.
  - Ensure `AZURE_CONFIG_PATH` points to a host directory with a valid Azure CLI login.
  - Verify host access first with `kubectl get nodes`.
- `aws` not found or EKS auth failure:
  - Rebuild or pull an image that includes the AWS CLI.
  - Ensure `AWS_CONFIG_PATH` points to a host directory with valid AWS credentials or SSO cache.
  - Verify host access first with `kubectl get nodes`.
- `gke-gcloud-auth-plugin` or GKE auth failure:
  - Ensure `GCLOUD_CONFIG_PATH` is mounted and writable for token refresh.
  - Verify host access first with `kubectl get nodes`.
- `permission denied` opening kubeconfig:
  - The compose files run Radar as `root` so host kubeconfigs with mode `0600` can be read.
  - Confirm `KUBECONFIG_PATH` resolves to a real file on the host.
- UI not reachable:
  - Check `RADAR_PORT` and `docker compose logs -f radar`.

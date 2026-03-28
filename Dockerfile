# Multi-stage Dockerfile for Radar
#
# Usage:
#   Full build (default):  docker build .
#   Release (pre-built):   docker build --target release .
#                          (requires radar-amd64/radar-arm64 binaries in context)

# Buildx automatic platform args with docker-build fallback defaults
ARG TARGETOS=linux
ARG TARGETARCH=amd64

# =============================================================================
# Stage 1: Build frontend
# =============================================================================
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder

WORKDIR /app/web

# Install dependencies
COPY web/package*.json ./
RUN npm ci --prefer-offline --no-audit

# Build frontend
COPY web/ ./
RUN npm run build

# =============================================================================
# Stage 2: Build Go backend
# =============================================================================
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend-builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Download Go modules first (cacheable layer)
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY cmd/ cmd/
COPY internal/ internal/

# Copy built frontend into embed location
COPY --from=frontend-builder /app/web/dist internal/static/dist/

# Build arguments
# TARGETOS and TARGETARCH are automatically set by Docker buildx for multi-platform builds
# Defaults provided for regular docker build (without buildx)
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH

# Build the binary
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags "-s -w -X main.version=${VERSION}" \
    -o /radar ./cmd/explorer

# =============================================================================
# Stage 3: Runtime base with cloud auth plugins
# =============================================================================
FROM --platform=$TARGETPLATFORM debian:bookworm-slim AS runtime-base

ARG TARGETARCH
ARG KUBELOGIN_VERSION=v0.2.15

RUN set -eux; \
    retry() { \
      n=0; \
      until "$@"; do \
        n=$((n + 1)); \
        if [ "$n" -ge 3 ]; then \
          return 1; \
        fi; \
        sleep $((n * 5)); \
      done; \
    }; \
    retry apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    unzip && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
    gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | \
    gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg && \
    chmod go+r /etc/apt/keyrings/microsoft.gpg && \
    . /etc/os-release && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ ${VERSION_CODENAME} main" \
    > /etc/apt/sources.list.d/azure-cli.list && \
    retry apt-get update && \
    retry apt-get install -y --no-install-recommends \
    azure-cli \
    google-cloud-cli \
    google-cloud-cli-gke-gcloud-auth-plugin && \
    case "${TARGETARCH}" in \
      amd64) AWSCLI_ARCH=x86_64 ;; \
      arm64) AWSCLI_ARCH=aarch64 ;; \
      *) echo "unsupported TARGETARCH for awscli: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl -fsSLo /tmp/awscliv2.zip "https://awscli.amazonaws.com/awscli-exe-linux-${AWSCLI_ARCH}.zip" && \
    unzip /tmp/awscliv2.zip -d /tmp && \
    /tmp/aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli && \
    curl -fsSLo /tmp/kubelogin.zip "https://github.com/Azure/kubelogin/releases/download/${KUBELOGIN_VERSION}/kubelogin-linux-${TARGETARCH}.zip" && \
    unzip /tmp/kubelogin.zip -d /tmp/kubelogin && \
    install -m 0755 /tmp/kubelogin/bin/linux_${TARGETARCH}/kubelogin /usr/local/bin/kubelogin && \
    useradd --uid 65532 --create-home --shell /usr/sbin/nologin nonroot && \
    rm -rf /var/lib/apt/lists/* /tmp/aws /tmp/awscliv2.zip /tmp/kubelogin /tmp/kubelogin.zip

ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# =============================================================================
# Stage 3a: Full build (default) - copies from build stages
# =============================================================================
FROM --platform=$TARGETPLATFORM runtime-base AS full

LABEL org.opencontainers.image.title="Radar"
LABEL org.opencontainers.image.description="Modern Kubernetes visibility — topology, traffic, and Helm management"
LABEL org.opencontainers.image.source="https://github.com/odhomane/radar"
LABEL org.opencontainers.image.vendor="Skyhook"

COPY --from=backend-builder /radar /radar

EXPOSE 9280
USER nonroot:nonroot
ENTRYPOINT ["/radar"]
CMD ["--no-browser"]

# =============================================================================
# Stage 3b: Release build - uses pre-built binaries from goreleaser
# Much faster for multi-arch since no QEMU compilation needed
# Requires: radar-amd64 and radar-arm64 in build context
# =============================================================================
FROM --platform=$TARGETPLATFORM runtime-base AS release

LABEL org.opencontainers.image.title="Radar"
LABEL org.opencontainers.image.description="Modern Kubernetes visibility — topology, traffic, and Helm management"
LABEL org.opencontainers.image.source="https://github.com/odhomane/radar"
LABEL org.opencontainers.image.vendor="Skyhook"

ARG TARGETARCH
COPY radar-amd64 /tmp/radar-amd64
COPY radar-arm64 /tmp/radar-arm64
RUN case "${TARGETARCH}" in \
      amd64) cp /tmp/radar-amd64 /radar ;; \
      arm64) cp /tmp/radar-arm64 /radar ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    chmod +x /radar && \
    rm -f /tmp/radar-amd64 /tmp/radar-arm64

EXPOSE 9280
USER nonroot:nonroot
ENTRYPOINT ["/radar"]
CMD ["--no-browser"]

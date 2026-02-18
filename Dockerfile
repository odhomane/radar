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
FROM node:20-alpine AS frontend-builder

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
FROM golang:1.25-alpine AS backend-builder

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
# Stage 3: Runtime base with GKE auth plugin
# =============================================================================
FROM debian:bookworm-slim AS runtime-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg && \
    curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
    gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    google-cloud-cli \
    google-cloud-cli-gke-gcloud-auth-plugin && \
    useradd --uid 65532 --create-home --shell /usr/sbin/nologin nonroot && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# =============================================================================
# Stage 3a: Full build (default) - copies from build stages
# =============================================================================
FROM runtime-base AS full

LABEL org.opencontainers.image.title="Radar"
LABEL org.opencontainers.image.description="Modern Kubernetes visibility — topology, traffic, and Helm management"
LABEL org.opencontainers.image.source="https://github.com/skyhook-io/radar"
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
FROM runtime-base AS release

LABEL org.opencontainers.image.title="Radar"
LABEL org.opencontainers.image.description="Modern Kubernetes visibility — topology, traffic, and Helm management"
LABEL org.opencontainers.image.source="https://github.com/skyhook-io/radar"
LABEL org.opencontainers.image.vendor="Skyhook"

ARG TARGETARCH
COPY radar-${TARGETARCH} /radar

EXPOSE 9280
USER nonroot:nonroot
ENTRYPOINT ["/radar"]
CMD ["--no-browser"]

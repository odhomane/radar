# Multi-stage Dockerfile for CMDB KubeExplorer
#
# Usage:
#   Full build (default):  docker build .
#   Release (pre-built):   docker build --target release .
#                          (requires cmdb-kubeexplorer-amd64/cmdb-kubeexplorer-arm64 binaries in context)

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
ARG TARGETOS=linux
ARG TARGETARCH=amd64

# Build the binary
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags "-s -w -X main.version=${VERSION}" \
    -o /cmdb-kubeexplorer ./cmd/explorer

# =============================================================================
# Stage 3a: Full build (default) - copies from build stages
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS full

LABEL org.opencontainers.image.title="CMDB KubeExplorer"
LABEL org.opencontainers.image.description="Modern Kubernetes visibility — topology, traffic, and Helm management"
LABEL org.opencontainers.image.source="https://github.com/cmdb/kubeexplorer"
LABEL org.opencontainers.image.vendor="CMDB"

COPY --from=backend-builder /cmdb-kubeexplorer /cmdb-kubeexplorer

EXPOSE 9280
USER nonroot:nonroot
ENTRYPOINT ["/cmdb-kubeexplorer"]
CMD ["--no-browser"]

# =============================================================================
# Stage 3b: Release build - uses pre-built binaries from goreleaser
# Much faster for multi-arch since no QEMU compilation needed
# Requires: cmdb-kubeexplorer-amd64 and cmdb-kubeexplorer-arm64 in build context
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot AS release

LABEL org.opencontainers.image.title="CMDB KubeExplorer"
LABEL org.opencontainers.image.description="Modern Kubernetes visibility — topology, traffic, and Helm management"
LABEL org.opencontainers.image.source="https://github.com/cmdb/kubeexplorer"
LABEL org.opencontainers.image.vendor="CMDB"

ARG TARGETARCH
COPY cmdb-kubeexplorer-${TARGETARCH} /cmdb-kubeexplorer

EXPOSE 9280
USER nonroot:nonroot
ENTRYPOINT ["/cmdb-kubeexplorer"]
CMD ["--no-browser"]

# In-Cluster Deployment

Deploy CMDB KubeExplorer to your Kubernetes cluster for shared team access.

> **Note:** This guide covers deploying CMDB KubeExplorer as a pod in your cluster. If you're running CMDB KubeExplorer locally but need to understand cluster connection behavior (e.g., using `KUBECONFIG` to override in-cluster detection), see the [Configuration Guide](configuration.md).

## Quick Start

```bash
helm repo add cmdb https://cmdb.github.io/helm-charts
helm install cmdb-kubeexplorer cmdb/cmdb-kubeexplorer -n cmdb-kubeexplorer --create-namespace
```

Access via port-forward:
```bash
kubectl port-forward svc/cmdb-kubeexplorer 9280:9280 -n cmdb-kubeexplorer
open http://localhost:9280
```

## Exposing with Ingress

### Basic (No Authentication)

```yaml
# values.yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: cmdb-kubeexplorer.your-domain.com
      paths:
        - path: /
          pathType: Prefix
```

```bash
helm upgrade --install cmdb-kubeexplorer cmdb/cmdb-kubeexplorer \
  -n cmdb-kubeexplorer -f values.yaml
```

### With Basic Authentication

1. **Create the auth secret:**
   ```bash
   # Install htpasswd if needed: brew install httpd (macOS) or apt install apache2-utils (Linux)

   # Generate credentials (replace 'admin' and 'your-password')
   htpasswd -nb admin 'your-password' > auth

   # Create the secret
   kubectl create secret generic cmdb-kubeexplorer-basic-auth \
     --from-file=auth \
     -n cmdb-kubeexplorer

   rm auth  # Clean up local file
   ```

2. **Configure ingress:**
   ```yaml
   # values.yaml
   ingress:
     enabled: true
     className: nginx
     annotations:
       nginx.ingress.kubernetes.io/auth-type: basic
       nginx.ingress.kubernetes.io/auth-secret: cmdb-kubeexplorer-basic-auth
       nginx.ingress.kubernetes.io/auth-realm: "CMDB KubeExplorer"
     hosts:
       - host: cmdb-kubeexplorer.your-domain.com
         paths:
           - path: /
             pathType: Prefix
   ```

3. **Deploy:**
   ```bash
   helm upgrade --install cmdb-kubeexplorer cmdb/cmdb-kubeexplorer \
     -n cmdb-kubeexplorer -f values.yaml
   ```

### With TLS (HTTPS)

Requires [cert-manager](https://cert-manager.io/) installed in your cluster.

```yaml
# values.yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: cmdb-kubeexplorer.your-domain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: cmdb-kubeexplorer-tls
      hosts:
        - cmdb-kubeexplorer.your-domain.com
```

## DNS Setup

1. **Get your ingress IP:**
   ```bash
   kubectl get ingress -n cmdb-kubeexplorer
   ```

2. **Create a DNS A record** pointing your domain to the ingress IP.

**Multi-cluster naming convention:**
```
cmdb-kubeexplorer.<cluster-name>.<domain>
```
Example: `cmdb-kubeexplorer.prod-us-east1.example.com`

## RBAC

CMDB KubeExplorer uses its ServiceAccount to access the Kubernetes API. The Helm chart creates a ClusterRole with **read-only access** to common resources by default:

- Pods, Services, ConfigMaps, Events, Namespaces, Nodes, ServiceAccounts, Endpoints
- Deployments, DaemonSets, StatefulSets, ReplicaSets
- Ingresses, NetworkPolicies, Jobs, CronJobs, HPAs, PVCs
- Pod logs (enabled by default)

### Opt-in Permissions

Some features require additional permissions that are **disabled by default** for security:

| Feature | Value | Description |
|---------|-------|-------------|
| Secrets | `rbac.secrets: true` | Show secrets in resource list |
| Terminal | `rbac.podExec: true` | Shell access to pods |
| Port Forward | `rbac.portForward: true` | Port forwarding to pods/services |
| Logs | `rbac.podLogs: true` | View pod logs (enabled by default) |

Enable features as needed:

```yaml
# values.yaml
rbac:
  secrets: false      # Keep disabled unless needed
  podExec: true       # Enable terminal feature
  podLogs: true       # Enable log viewer (default)
  portForward: true   # Enable port forwarding
```

### Graceful RBAC Degradation

CMDB KubeExplorer works with whatever permissions are available — it does not require full cluster-admin access. At startup, CMDB KubeExplorer checks which resource types are accessible using `SelfSubjectAccessReview` and only starts informers for permitted resources.

**What this means in practice:**

- If your ServiceAccount can only list Pods and Services, CMDB KubeExplorer shows those — other resource types display an "Access Restricted" message
- Cluster-scoped resources (Nodes, Namespaces) require a ClusterRole; if unavailable, those sections are gracefully hidden
- For namespace-scoped ServiceAccounts (RoleBinding instead of ClusterRoleBinding), CMDB KubeExplorer automatically detects this and scopes its informers to the permitted namespace
- The UI clearly indicates which resources are restricted vs simply empty

**Example: Namespace-scoped deployment**

```yaml
# Custom Role granting access to a single namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cmdb-kubeexplorer-viewer
  namespace: my-team
rules:
  - apiGroups: ["", "apps", "batch", "networking.k8s.io"]
    resources: ["pods", "services", "deployments", "daemonsets", "statefulsets",
                "replicasets", "jobs", "cronjobs", "configmaps", "events",
                "ingresses", "persistentvolumeclaims"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cmdb-kubeexplorer-viewer
  namespace: my-team
subjects:
  - kind: ServiceAccount
    name: cmdb-kubeexplorer
    namespace: cmdb-kubeexplorer
roleRef:
  kind: Role
  name: cmdb-kubeexplorer-viewer
  apiGroup: rbac.authorization.k8s.io
```

Set `rbac.create: false` in the Helm values and apply the custom Role/RoleBinding above. CMDB KubeExplorer will detect the namespace-scoped permissions and work within `my-team` only.

## Security Considerations

When deploying CMDB KubeExplorer in-cluster:

1. **Authentication**: Always enable authentication when exposing via ingress. Use basic auth (shown above) or an auth proxy like oauth2-proxy.

2. **RBAC scope**: The default ClusterRole grants cluster-wide read access. For namespace-restricted access, set `rbac.create: false` and create a custom Role/RoleBinding. CMDB KubeExplorer will gracefully adapt to the available permissions.

3. **Privileged features**: Terminal (`podExec`) and port forwarding grant significant access. Only enable these in trusted environments or when using per-user authentication.

4. **Network access**: Consider using NetworkPolicies to restrict which pods can reach CMDB KubeExplorer.

## Configuration Reference

See [Helm Chart README](../deploy/helm/cmdb-kubeexplorer/README.md) for all available values.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image | `ghcr.io/cmdb/kubeexplorer` |
| `image.tag` | Image tag | Chart appVersion |
| `ingress.enabled` | Enable ingress | `false` |
| `ingress.className` | Ingress class | `""` |
| `service.port` | Service port | `9280` |
| `timeline.storage` | Event storage (memory/sqlite) | `memory` |
| `rbac.podLogs` | Enable log viewer | `true` |
| `rbac.podExec` | Enable terminal feature | `false` |
| `rbac.portForward` | Enable port forwarding | `false` |
| `rbac.secrets` | Show secrets in resource list | `false` |

## Troubleshooting

### Pod not starting

```bash
kubectl logs -n cmdb-kubeexplorer -l app.kubernetes.io/name=cmdb-kubeexplorer
kubectl describe pod -n cmdb-kubeexplorer -l app.kubernetes.io/name=cmdb-kubeexplorer
```

### Ingress not working

```bash
kubectl get ingress -n cmdb-kubeexplorer -o yaml
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx
```

### Basic auth prompt not appearing

Verify the secret format:
```bash
kubectl get secret cmdb-kubeexplorer-basic-auth -n cmdb-kubeexplorer -o jsonpath='{.data.auth}' | base64 -d
# Should show: username:$apr1$...
```

## Upgrading

```bash
helm repo update cmdb
helm upgrade cmdb-kubeexplorer cmdb/cmdb-kubeexplorer -n cmdb-kubeexplorer -f values.yaml
```

## Uninstalling

```bash
helm uninstall cmdb-kubeexplorer -n cmdb-kubeexplorer
kubectl delete namespace cmdb-kubeexplorer
```

package app

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/skyhook-io/radar/internal/helm"
	"github.com/skyhook-io/radar/internal/k8s"
	"github.com/skyhook-io/radar/internal/server"
	"github.com/skyhook-io/radar/internal/static"
	"github.com/skyhook-io/radar/internal/timeline"
	"github.com/skyhook-io/radar/internal/traffic"
	versionpkg "github.com/skyhook-io/radar/internal/version"
)

// AppConfig holds all parsed configuration for the Radar application.
type AppConfig struct {
	Kubeconfig       string
	KubeconfigDirs   []string
	Namespace        string
	Port             int
	NoBrowser        bool
	DevMode          bool
	HistoryLimit     int
	DebugEvents      bool
	FakeInCluster    bool
	DisableHelmWrite bool
	TimelineStorage  string
	TimelineDBPath   string
	PrometheusURL    string
	Version          string
}

// SetGlobals applies debug/test flags to global state.
func SetGlobals(cfg AppConfig) {
	k8s.DebugEvents = cfg.DebugEvents
	k8s.ForceInCluster = cfg.FakeInCluster
	k8s.ForceDisableHelmWrite = cfg.DisableHelmWrite
	versionpkg.SetCurrent(cfg.Version)
}

// InitializeK8s creates and configures the Kubernetes client.
func InitializeK8s(cfg AppConfig) error {
	err := k8s.Initialize(k8s.InitOptions{
		KubeconfigPath: cfg.Kubeconfig,
		KubeconfigDirs: cfg.KubeconfigDirs,
	})
	if err != nil {
		return fmt.Errorf("failed to initialize K8s client: %w", err)
	}

	if cfg.Namespace != "" {
		k8s.SetFallbackNamespace(cfg.Namespace)
	}

	if len(cfg.KubeconfigDirs) > 0 {
		log.Printf("Using kubeconfigs from directories: %v", cfg.KubeconfigDirs)
	} else if kubepath := k8s.GetKubeconfigPath(); kubepath != "" {
		log.Printf("Using kubeconfig: %s", kubepath)
	} else {
		log.Printf("Using in-cluster config")
	}

	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnecting,
		Context:     k8s.GetContextName(),
		ProgressMsg: "Starting server...",
	})

	return nil
}

// BuildTimelineStoreConfig creates the timeline store configuration from app config.
func BuildTimelineStoreConfig(cfg AppConfig) timeline.StoreConfig {
	storeCfg := timeline.StoreConfig{
		Type:    timeline.StoreTypeMemory,
		MaxSize: cfg.HistoryLimit,
	}
	if cfg.TimelineStorage == "sqlite" {
		storeCfg.Type = timeline.StoreTypeSQLite
		dbPath := cfg.TimelineDBPath
		if dbPath == "" {
			homeDir, _ := os.UserHomeDir()
			dbPath = filepath.Join(homeDir, ".radar", "timeline.db")
		}
		storeCfg.Path = dbPath
	}
	return storeCfg
}

// RegisterCallbacks registers Helm, timeline, and traffic reset/reinit functions
// for context switching. Must be called before InitializeCluster.
func RegisterCallbacks(cfg AppConfig, timelineStoreCfg timeline.StoreConfig) {
	k8s.RegisterHelmFuncs(helm.ResetClient, helm.ReinitClient)

	k8s.RegisterTimelineFuncs(timeline.ResetStore, func() error {
		return timeline.ReinitStore(timelineStoreCfg)
	})

	if cfg.PrometheusURL != "" {
		u, err := url.Parse(cfg.PrometheusURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			log.Fatalf("Invalid --prometheus-url %q: must be a valid HTTP(S) URL (e.g., http://prometheus-server.monitoring:9090)", cfg.PrometheusURL)
		}
		traffic.SetMetricsURL(cfg.PrometheusURL)
	}

	k8s.RegisterTrafficFuncs(traffic.Reset, func() error {
		return traffic.ReinitializeWithConfig(k8s.GetClient(), k8s.GetConfig(), k8s.GetContextName())
	})
}

// CreateServer creates the HTTP server with the given configuration.
func CreateServer(cfg AppConfig) *server.Server {
	serverCfg := server.Config{
		Port:       cfg.Port,
		DevMode:    cfg.DevMode,
		StaticFS:   static.FS,
		StaticRoot: "dist",
	}
	return server.New(serverCfg)
}

// InitializeCluster connects to the cluster and initializes all caches.
// Progress is broadcast via SSE so the browser can show updates.
func InitializeCluster(timelineStoreCfg timeline.StoreConfig) {
	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnecting,
		Context:     k8s.GetContextName(),
		ProgressMsg: "Testing cluster connectivity...",
	})

	clusterAccessErr := CheckClusterAccess()

	if clusterAccessErr != nil {
		k8s.SetConnectionStatus(k8s.ConnectionStatus{
			State:     k8s.StateDisconnected,
			Context:   k8s.GetContextName(),
			Error:     clusterAccessErr.Error(),
			ErrorType: k8s.ClassifyError(clusterAccessErr),
		})
		log.Printf("Warning: Cluster not reachable, starting in disconnected mode")
		return
	}

	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnecting,
		Context:     k8s.GetContextName(),
		ProgressMsg: "Initializing timeline...",
	})
	if err := timeline.InitStore(timelineStoreCfg); err != nil {
		log.Fatalf("Failed to initialize timeline store: %v", err)
	}

	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnecting,
		Context:     k8s.GetContextName(),
		ProgressMsg: "Loading workloads...",
	})
	if err := k8s.InitResourceCache(); err != nil {
		log.Printf("Warning: Failed to initialize resource cache: %v", err)
	}
	if cache := k8s.GetResourceCache(); cache != nil {
		log.Printf("Resource cache initialized with %d resources", cache.GetResourceCount())
	}

	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnecting,
		Context:     k8s.GetContextName(),
		ProgressMsg: "Discovering API resources...",
	})
	if err := k8s.InitResourceDiscovery(); err != nil {
		log.Printf("Warning: Failed to initialize resource discovery: %v", err)
	}

	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnecting,
		Context:     k8s.GetContextName(),
		ProgressMsg: "Loading custom resources...",
	})
	if cache := k8s.GetResourceCache(); cache != nil {
		changeCh := cache.ChangesRaw()
		if err := k8s.InitDynamicResourceCache(changeCh); err != nil {
			log.Printf("Warning: Failed to initialize dynamic resource cache: %v", err)
		}

		k8s.WarmupCommonCRDs()

		if dynamicCache := k8s.GetDynamicResourceCache(); dynamicCache != nil {
			dynamicCache.DiscoverAllCRDs()
		}
	}

	k8s.InitMetricsHistory()

	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnecting,
		Context:     k8s.GetContextName(),
		ProgressMsg: "Loading Helm releases...",
	})
	if err := helm.Initialize(k8s.GetKubeconfigPath()); err != nil {
		log.Printf("Warning: Failed to initialize Helm client: %v", err)
	}

	if err := traffic.InitializeWithConfig(k8s.GetClient(), k8s.GetConfig(), k8s.GetContextName()); err != nil {
		log.Printf("Warning: Failed to initialize traffic manager: %v", err)
	}

	k8s.SetConnectionStatus(k8s.ConnectionStatus{
		State:       k8s.StateConnected,
		Context:     k8s.GetContextName(),
		ClusterName: k8s.GetClusterName(),
	})
}

// Shutdown performs graceful teardown of caches and timeline.
func Shutdown(srv *server.Server) {
	log.Println("Shutting down...")
	srv.Stop()
	if cache := k8s.GetResourceCache(); cache != nil {
		cache.Stop()
	}
	if dynCache := k8s.GetDynamicResourceCache(); dynCache != nil {
		dynCache.Stop()
	}
	timeline.ResetStore()
}

// CheckClusterAccess verifies connectivity to the Kubernetes cluster.
func CheckClusterAccess() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clientset := k8s.GetClient()
	if clientset == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}

	_, err := clientset.Discovery().RESTClient().Get().AbsPath("/version").Do(ctx).Raw()
	if err != nil {
		return fmt.Errorf("failed to connect to cluster: %w", err)
	}
	return nil
}

// ParseKubeconfigDirs splits a comma-separated directory string into a slice.
func ParseKubeconfigDirs(dirs string) []string {
	if dirs == "" {
		return nil
	}
	var result []string
	for _, dir := range strings.Split(dirs, ",") {
		dir = strings.TrimSpace(dir)
		if dir != "" {
			result = append(result, dir)
		}
	}
	return result
}

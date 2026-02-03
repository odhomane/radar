package k8s

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EphemeralContainerOptions configures debug container creation
type EphemeralContainerOptions struct {
	Namespace       string
	PodName         string
	TargetContainer string // Container to share process namespace with
	Image           string // Debug image (default: busybox:latest)
	ContainerName   string // Name for ephemeral container (auto-generated if empty)
}

// DefaultDebugImage is the default image for debug containers
const DefaultDebugImage = "busybox:latest"

// CreateEphemeralContainer adds an ephemeral debug container to a pod
func CreateEphemeralContainer(ctx context.Context, opts EphemeralContainerOptions) (*corev1.EphemeralContainer, error) {
	client := GetClient()
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	// Set defaults
	if opts.Image == "" {
		opts.Image = DefaultDebugImage
	}
	if opts.ContainerName == "" {
		opts.ContainerName = fmt.Sprintf("debug-%d", time.Now().Unix())
	}

	// Get current pod
	pod, err := client.CoreV1().Pods(opts.Namespace).Get(ctx, opts.PodName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	// Create ephemeral container spec
	ec := corev1.EphemeralContainer{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name:                     opts.ContainerName,
			Image:                    opts.Image,
			ImagePullPolicy:          corev1.PullIfNotPresent,
			Stdin:                    true,
			TTY:                      true,
			TerminationMessagePolicy: corev1.TerminationMessageReadFile,
		},
		TargetContainerName: opts.TargetContainer,
	}

	// Add to pod's ephemeral containers
	pod.Spec.EphemeralContainers = append(pod.Spec.EphemeralContainers, ec)

	// Update pod with ephemeral container using the ephemeralcontainers subresource
	_, err = client.CoreV1().Pods(opts.Namespace).UpdateEphemeralContainers(
		ctx,
		opts.PodName,
		pod,
		metav1.UpdateOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create ephemeral container: %w", err)
	}

	return &ec, nil
}

// WaitForEphemeralContainer waits for an ephemeral container to be running
func WaitForEphemeralContainer(ctx context.Context, namespace, podName, containerName string, timeout time.Duration) error {
	client := GetClient()
	if client == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		pod, err := client.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("failed to get pod: %w", err)
		}

		for _, status := range pod.Status.EphemeralContainerStatuses {
			if status.Name == containerName {
				if status.State.Running != nil {
					return nil
				}
				if status.State.Terminated != nil {
					return fmt.Errorf("container terminated: %s", status.State.Terminated.Reason)
				}
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
			continue
		}
	}

	return fmt.Errorf("timeout waiting for ephemeral container to start")
}

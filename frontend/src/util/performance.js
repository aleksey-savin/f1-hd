import React, {
  lazy,
  Suspense,
  memo,
  useMemo,
  useCallback,
  useState,
  useEffect,
} from "react";

// Lazy loading wrapper with error boundary
export const LazyComponent = ({
  factory,
  fallback = null,
  errorFallback = null,
}) => {
  const LazyLoadedComponent = lazy(factory);

  return (
    <Suspense fallback={fallback}>
      <ErrorBoundary fallback={errorFallback}>
        <LazyLoadedComponent />
      </ErrorBoundary>
    </Suspense>
  );
};

// Error boundary for lazy loaded components
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Lazy component loading error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="alert alert-danger">
            <h4>Something went wrong</h4>
            <p>Failed to load component. Please refresh the page.</p>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

// Performance monitoring hook
export const usePerformanceMonitor = (componentName) => {
  useEffect(() => {
    const startTime = performance.now();

    return () => {
      const endTime = performance.now();
      const renderTime = endTime - startTime;

      if (renderTime > 100) {
        // Log slow renders
        console.warn(
          `Slow render detected in ${componentName}: ${renderTime.toFixed(2)}ms`,
        );
      }
    };
  });
};

// Debounced state hook
export const useDebouncedState = (initialValue, delay = 300) => {
  const [value, setValue] = useState(initialValue);
  const [debouncedValue, setDebouncedValue] = useState(initialValue);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return [debouncedValue, setValue];
};

// Memoized API call hook
export const useMemoizedAPI = (apiCall, dependencies = []) => {
  return useMemo(() => {
    return apiCall;
  }, dependencies);
};

// Throttled callback hook
export const useThrottledCallback = (callback, delay = 300) => {
  const [lastCall, setLastCall] = useState(0);

  return useCallback(
    (...args) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        setLastCall(now);
        return callback(...args);
      }
    },
    [callback, delay, lastCall],
  );
};

// Virtual scrolling helper
export const useVirtualScroll = (items, itemHeight, containerHeight) => {
  const [scrollTop, setScrollTop] = useState(0);

  const visibleItems = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.min(
      visibleStart + Math.ceil(containerHeight / itemHeight) + 1,
      items.length,
    );

    return items.slice(visibleStart, visibleEnd).map((item, index) => ({
      ...item,
      index: visibleStart + index,
      top: (visibleStart + index) * itemHeight,
    }));
  }, [items, itemHeight, containerHeight, scrollTop]);

  return {
    visibleItems,
    totalHeight: items.length * itemHeight,
    onScroll: (e) => setScrollTop(e.target.scrollTop),
  };
};

// Image lazy loading hook
export const useLazyImage = (src, options = {}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);
  const [imageSrc, setImageSrc] = useState(options.placeholder || "");

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageSrc(src);
      setIsLoaded(true);
    };
    img.onerror = () => {
      setIsError(true);
      setImageSrc(options.fallback || "");
    };
    img.src = src;
  }, [src, options.fallback]);

  return { imageSrc, isLoaded, isError };
};

// Bundle size analyzer (dev only)
export const analyzeBundleSize = () => {
  if (process.env.NODE_ENV === "development") {
    const scripts = document.querySelectorAll("script[src]");
    let totalSize = 0;

    scripts.forEach((script) => {
      if (script.src.includes("localhost")) {
        fetch(script.src)
          .then((response) => response.text())
          .then((text) => {
            const size = new Blob([text]).size;
            totalSize += size;
            console.log(`Script ${script.src}: ${(size / 1024).toFixed(2)}KB`);
          });
      }
    });

    setTimeout(() => {
      console.log(`Total bundle size: ${(totalSize / 1024).toFixed(2)}KB`);
    }, 1000);
  }
};

// Component performance wrapper
export const withPerformanceMonitoring = (WrappedComponent, componentName) => {
  return memo((props) => {
    usePerformanceMonitor(componentName);
    return <WrappedComponent {...props} />;
  });
};

// Intersection Observer hook for lazy loading
export const useIntersectionObserver = (options = {}) => {
  const [ref, setRef] = useState(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    if (!ref) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      {
        threshold: 0.1,
        rootMargin: "50px",
        ...options,
      },
    );

    observer.observe(ref);

    return () => {
      observer.disconnect();
    };
  }, [ref, options]);

  return [setRef, isIntersecting];
};

// Preload critical resources
export const preloadCriticalResources = (resources) => {
  if (typeof window === "undefined") return;

  resources.forEach(({ href, as, type }) => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.href = href;
    link.as = as;
    if (type) link.type = type;
    document.head.appendChild(link);
  });
};

// Memory usage monitor (dev only)
export const useMemoryMonitor = () => {
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && "memory" in performance) {
      const logMemoryUsage = () => {
        const memInfo = performance.memory;
        console.log("Memory usage:", {
          used: `${(memInfo.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
          total: `${(memInfo.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
          limit: `${(memInfo.jsHeapSizeLimit / 1024 / 1024).toFixed(2)}MB`,
        });
      };

      const interval = setInterval(logMemoryUsage, 30000); // Log every 30 seconds
      return () => clearInterval(interval);
    }
  }, []);
};

// Custom memoization with size limit
export const createMemoCache = (maxSize = 100) => {
  const cache = new Map();

  return (fn) => {
    return (...args) => {
      const key = JSON.stringify(args);

      if (cache.has(key)) {
        return cache.get(key);
      }

      const result = fn(...args);

      if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }

      cache.set(key, result);
      return result;
    };
  };
};

// Performance optimized list component
export const OptimizedList = memo(
  ({ items, renderItem, itemHeight = 50, containerHeight = 400 }) => {
    const { visibleItems, totalHeight, onScroll } = useVirtualScroll(
      items,
      itemHeight,
      containerHeight,
    );

    return (
      <div
        style={{ height: containerHeight, overflow: "auto" }}
        onScroll={onScroll}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          {visibleItems.map((item) => (
            <div
              key={item.id || item.index}
              style={{
                position: "absolute",
                top: item.top,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    );
  },
);

// Web Worker hook for heavy computations
export const useWebWorker = (workerScript) => {
  const [worker, setWorker] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const workerInstance = new Worker(workerScript);
    setWorker(workerInstance);

    return () => {
      workerInstance.terminate();
    };
  }, [workerScript]);

  const postMessage = useCallback(
    (data) => {
      if (!worker) return Promise.reject(new Error("Worker not initialized"));

      setIsLoading(true);
      setError(null);

      return new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          setIsLoading(false);
          resolve(e.data);
        };

        worker.onerror = (e) => {
          setIsLoading(false);
          setError(e.message);
          reject(e);
        };

        worker.postMessage(data);
      });
    },
    [worker],
  );

  return { postMessage, isLoading, error };
};

// Initialize performance monitoring
export const initializePerformanceMonitoring = () => {
  if (process.env.NODE_ENV === "development") {
    // Monitor Core Web Vitals
    import("web-vitals").then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
      getCLS(console.log);
      getFID(console.log);
      getFCP(console.log);
      getLCP(console.log);
      getTTFB(console.log);
    });

    // Log performance entries
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.log("Performance entry:", entry);
      }
    });

    observer.observe({ entryTypes: ["measure", "navigation", "resource"] });
  }
};

export default {
  LazyComponent,
  usePerformanceMonitor,
  useDebouncedState,
  useMemoizedAPI,
  useThrottledCallback,
  useVirtualScroll,
  useLazyImage,
  useIntersectionObserver,
  useMemoryMonitor,
  withPerformanceMonitoring,
  OptimizedList,
  useWebWorker,
  createMemoCache,
  preloadCriticalResources,
  analyzeBundleSize,
  initializePerformanceMonitoring,
};

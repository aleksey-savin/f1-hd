import { useState, useEffect } from 'react';

const useSystemTheme = () => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Initialize with current system preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch (error) {
        console.warn('matchMedia not supported or failed:', error);
        return false;
      }
    }
    return false;
  });

  useEffect(() => {
    // Check if matchMedia is supported
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Define the handler function
    const handleChange = (event) => {
      setIsDarkMode(event.matches);
    };

    // Set initial value
    setIsDarkMode(mediaQuery.matches);

    // Add listener for changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
    }

    // Cleanup function
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        // Fallback for older browsers
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  return isDarkMode;
};

export default useSystemTheme;

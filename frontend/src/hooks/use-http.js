import { useState, useCallback } from "react";

const useHttp = () => {
  const [isLoading, setIsLoading] = useState(false);

  const [error, setError] = useState(null);

  const sendRequest = useCallback(async (requestConfig, applyData) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(requestConfig.url, {
        method: requestConfig.method ? requestConfig.method : "GET",
        headers: requestConfig.headers ? requestConfig.headers : {},
        body: requestConfig.body
          ? requestConfig.isFormData
            ? requestConfig.body
            : JSON.stringify(requestConfig.body)
          : null,
      });
      if (!response.ok) {
        setError({
          message: response.statusText,
          status: response.status,
        });
      }
      const data = await response.json();
      applyData(data);
    } catch (error) {
      setError({
        message: error.message || "Что-то пошло не так :(",
        status: error.status,
      });
    }
    setIsLoading(false);
  }, []);
  return {
    isLoading,
    error,
    sendRequest,
  };
};

export default useHttp;

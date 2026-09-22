// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import { useCallback, useEffect, useState } from "react";
import { apiGetJson, apiSendJson, errorMessage, messageFromOkFalseBody } from "./api-client";

export function useApiGet<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!url) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const slash = url.indexOf("/", url.indexOf("://") + 3);
      const apiBase = slash > 0 ? url.slice(0, slash) : url;
      const path = slash > 0 ? url.slice(slash) : "/";
      const result = await apiGetJson<T>(apiBase, path);
      setData(result);
    } catch (err) {
      setError(errorMessage(err, "加载失败"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls invalidation via deps
  }, [refetch, ...deps]);

  return { data, error, loading, refetch };
}

export function useApiMutation<TResponse, TBody>(
  apiBase: string,
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (body?: TBody): Promise<TResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiSendJson<TResponse, TBody>(apiBase, path, method, body);
        const msg = messageFromOkFalseBody(res, "请求失败");
        if (msg) {
          setError(msg);
          return null;
        }
        return res;
      } catch (err) {
        setError(errorMessage(err, "请求失败"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiBase, path, method],
  );

  return { mutate, loading, error };
}

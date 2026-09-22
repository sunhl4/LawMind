import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { apiSendJson, errorMessage, messageFromOkFalseBody } from "./api-client";

export function useLawmindMutation<TResponse, TBody = unknown>(opts: {
  apiBase: string;
  path: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  invalidateKeys?: QueryKey[];
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body?: TBody): Promise<TResponse> => {
      const res = await apiSendJson<TResponse, TBody>(opts.apiBase, opts.path, opts.method, body);
      const msg = messageFromOkFalseBody(res as { ok?: boolean; error?: string }, "请求失败");
      if (msg) {
        throw new Error(msg);
      }
      return res;
    },
    onSuccess: async () => {
      for (const key of opts.invalidateKeys ?? []) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
    meta: {
      formatError: (err: unknown) => errorMessage(err, "请求失败"),
    },
  });
}

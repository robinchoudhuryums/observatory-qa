import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export function getCsrfToken(): string {
  const match = document.cookie.match(/csrf-token=([^;]+)/);
  return match ? match[1] : "";
}

/**
 * Drop-in replacement for fetch() that auto-attaches CSRF token header
 * on mutating requests (POST/PUT/PATCH/DELETE). Use this instead of raw
 * fetch() for any API call that modifies state.
 *
 * Unlike apiRequest(), this does NOT throw on non-2xx responses — it
 * returns the raw Response just like fetch(), so callers can handle
 * errors themselves.
 */
export function csrfFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("X-CSRF-Token")) {
    headers.set("X-CSRF-Token", getCsrfToken());
  }
  return fetch(url, { ...init, headers, credentials: "include" });
}

export async function apiRequest(method: string, url: string, data?: unknown | undefined): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = getCsrfToken();
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
// Replace your old getQueryFn with this new one
export const getQueryFn: <T>(options?: { on401?: "returnNull" | "throw" }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior = "throw" } = {}) =>
  async ({ queryKey }) => {
    // The first part of the key is always the base URL
    let url = queryKey[0] as string;
    const params = queryKey.length > 1 ? queryKey[1] : undefined;

    // Check if the second part is for a specific ID or for query parameters
    if (params) {
      if (typeof params === "object" && params !== null) {
        // It's an object for query parameters (like in your table)
        // Filters out empty string values
        const filteredParams = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ""));
        const searchParams = new URLSearchParams(filteredParams as Record<string, string>);
        const queryString = searchParams.toString();
        if (queryString) {
          url += `?${queryString}`;
        }
      } else {
        // It's an ID for a specific resource (like in your transcript viewer)
        url += `/${params}`;
      }
    }

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchOnWindowFocus: true,
      staleTime: 60000, // Data considered fresh for 1 minute
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
});

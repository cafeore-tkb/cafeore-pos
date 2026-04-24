import createClient from "openapi-fetch";
import { API_BASE_URL } from "../repositories";
import type { paths } from "../types/api";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export const updateMasterStatus = async (type: string) => {
  const { data, error, response } = await client.POST("/api/master-status", {
    body: {
      type,
    },
  });

  if (error || !response.ok) {
    let message = "Failed to update master status";

    try {
      const body = await response.clone().json();
      if (body && typeof body === "object" && "error" in body) {
        message = String(body.error);
      }
    } catch {
      try {
        const text = await response.clone().text();
        if (text) {
          message = text;
        }
      } catch {
        // ignore
      }
    }

    throw new Error(
      `Failed to update master status: ${response.status} ${message}`,
    );
  }

  return data;
};

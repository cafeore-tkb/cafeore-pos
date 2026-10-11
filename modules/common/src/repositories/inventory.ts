import { apiClient, throwApiError } from "../api/client";
import type { components } from "../types/api";

export type InventoryStatus = components["schemas"]["InventoryStatus"];
export type InventoryLevel = components["schemas"]["InventoryLevel"];
export type StockResource = components["schemas"]["StockResourceResponse"];
export type StockResourceInput = components["schemas"]["StockResourceRequest"];
export type StockResourceKind = components["schemas"]["StockResourceKind"];
export type StockEventKind = components["schemas"]["StockEventKind"];
export type StockEventResult =
  components["schemas"]["StockEventCreateResponse"];
export type StockUsage = components["schemas"]["StockUsage"];

export const inventoryRepository = {
  getStatuses: async (): Promise<InventoryStatus[]> => {
    const { data, error, response } = await apiClient.GET("/api/inventory");
    if (error || !response.ok || !data) {
      throwApiError(response, error, "Failed to fetch inventory");
    }
    return data;
  },

  createResource: async (input: StockResourceInput): Promise<StockResource> => {
    const { data, error, response } = await apiClient.POST(
      "/api/inventory/resources",
      { body: input },
    );
    if (error || !response.ok || !data) {
      throwApiError(response, error, "Failed to create stock resource");
    }
    return data;
  },

  updateResource: async (
    id: string,
    input: StockResourceInput,
  ): Promise<StockResource> => {
    const { data, error, response } = await apiClient.PUT(
      "/api/inventory/resources/{id}",
      { params: { path: { id } }, body: input },
    );
    if (error || !response.ok || !data) {
      throwApiError(response, error, "Failed to update stock resource");
    }
    return data;
  },

  deleteResource: async (id: string): Promise<void> => {
    const { error, response } = await apiClient.DELETE(
      "/api/inventory/resources/{id}",
      { params: { path: { id } } },
    );
    if (error || !response.ok) {
      throwApiError(response, error, "Failed to delete stock resource");
    }
  },

  /**
   * count は実数で残量を置き換え、receipt / adjust は差分として足す
   */
  recordEvent: async (
    id: string,
    kind: StockEventKind,
    quantity: number,
    note?: string,
  ): Promise<StockEventResult> => {
    const { data, error, response } = await apiClient.POST(
      "/api/inventory/resources/{id}/events",
      { params: { path: { id } }, body: { kind, quantity, note } },
    );
    if (error || !response.ok || !data) {
      throwApiError(response, error, "Failed to record stock event");
    }
    return data;
  },

  getUsages: async (): Promise<StockUsage[]> => {
    const { data, error, response } = await apiClient.GET(
      "/api/inventory/usages",
    );
    if (error || !response.ok || !data) {
      throwApiError(response, error, "Failed to fetch stock usages");
    }
    return data;
  },

  replaceUsages: async (usages: StockUsage[]): Promise<StockUsage[]> => {
    const { data, error, response } = await apiClient.PUT(
      "/api/inventory/usages",
      { body: usages },
    );
    if (error || !response.ok || !data) {
      throwApiError(response, error, "Failed to save stock usages");
    }
    return data;
  },
};

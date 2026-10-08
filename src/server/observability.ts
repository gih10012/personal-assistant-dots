import "server-only";
import { z } from "zod";
import { loadMeshConfig, meshRequest, MeshAuthorityError } from "./mesh-client";
import { safeCapabilityProjection } from "./capability-projection";
import type { Observation, Observations, ProjectPage } from "@/lib/observability";

const native = z.object({ thread_id: z.string().optional(), turn_id: z.string().optional(), harness: z.string().optional(), mode: z.string().optional(), plan: z.unknown().optional(), goal: z.unknown().optional() });
const task = z.object({ id: z.string(), parent_id: z.string().nullable(), input: z.string(), status: z.string(), node: z.string().nullable(), created: z.number(), result: z.string().nullable(), native: native.optional() });
const page = z.object({ projects: z.array(z.object({ id: z.string(), title: z.string(), status_counts: z.record(z.string(), z.number()), tasks: z.array(task) })), next_cursor: z.number().int().nonnegative(), has_more: z.boolean(), counts_scope: z.literal("page"), source: z.literal("task-ledger") });

export async function observe(after = 0): Promise<Observations> {
  async function read<T>(route: string, parse: (value: unknown) => T): Promise<Observation<T>> {
    if (!process.env.DOTS_MESH_CONFIG) return { state: "unavailable", reason: "mesh_not_configured" };
    try {
      const config = loadMeshConfig(process.env.DOTS_MESH_CONFIG);
      return { state: "available", data: parse(await meshRequest<unknown>(config, route)) };
    } catch (error) {
      return { state: "unavailable", reason: error instanceof MeshAuthorityError && error.status === 404 ? "authority_endpoint_not_available" : "authority_unavailable_or_invalid_response" };
    }
  }
  const [projects, resources, events] = await Promise.all([
    read<ProjectPage>(`/v1/projects?limit=50&after=${after}`, (value) => page.parse(value)),
    read("/v1/resources?include_unavailable=1&limit=100", (value) => safeCapabilityProjection(value)),
    read("/v1/capability-events", (value) => safeCapabilityProjection(value)),
  ]);
  return { sampled_at: Date.now(), projects, resources, events };
}

export async function observeCapability(id: string): Promise<Observation<Record<string, unknown>>> {
  if (!process.env.DOTS_MESH_CONFIG) return { state: "unavailable", reason: "mesh_not_configured" };
  try {
    const config = loadMeshConfig(process.env.DOTS_MESH_CONFIG);
    return { state: "available", data: safeCapabilityProjection(await meshRequest<unknown>(config, `/v1/resource?id=${encodeURIComponent(id)}`)) };
  } catch { return { state: "unavailable", reason: "capability_details_unavailable" }; }
}

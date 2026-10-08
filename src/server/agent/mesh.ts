import "server-only";
import { db } from "../db";
import * as repo from "../repo";
import { loadMeshConfig, meshRequest } from "../mesh-client";
import { MeshQueue } from "../mesh-queue";
import type { Attachment } from "@/lib/types";

// Native mesh is the default. Calling paid Responses requires explicit opt-in.
export const enabled = () => process.env.DOTS_ENGINE !== "responses";
export function configState(): "configured" | "not_configured" | "invalid_config" {
  if (!process.env.DOTS_MESH_CONFIG) return "not_configured";
  try { loadMeshConfig(process.env.DOTS_MESH_CONFIG); return "configured"; }
  catch { return "invalid_config"; }
}

const state = globalThis as unknown as {
  meshTimer?: ReturnType<typeof setInterval>;
  meshQueue?: MeshQueue;
};
const queue = () => (state.meshQueue ??= new MeshQueue(db(), repo));

/** Chat and non-chat tasks use the same native thread for a dot. */
export function send(dotId: string, text: string, attachments: Attachment[] = [], convId?: string,
  options: { channelId?: string; recordUser?: boolean; trigger?: unknown } = {}) {
  const dot = repo.getDot(dotId);
  if (!dot) throw new Error("No such dot");
  const conversationId = convId ?? repo.latestConversationId(dotId);
  if (options.recordUser !== false)
    repo.addMessage({ dotId, role: "user", text, attachments, conversationId, channelId: options.channelId ?? null });
  if (attachments.length) {
    repo.addMessage({ dotId, role: "system", conversationId, channelId: options.channelId ?? null,
      text: "Mesh attachment transfer is not connected yet. No native task was submitted for this message. Files remain private in this app; send a text-only instruction to continue." });
    return;
  }
  const context = {
    dot_id: dotId, dot_name: dot.name,
    agent_id: dotId, session_scope: `leader:${dotId}`, conversation_id: conversationId,
    name: dot.name, purpose: dot.purpose, instructions: dot.instructions,
    memories: repo.listMemories(dotId), skills: repo.listSkills(dotId),
    rules: repo.rulesFor(dotId), mode: text.startsWith("/plan ") ? "plan" : "default",
    ...(options.channelId ? { channel_id: options.channelId } : {}),
    ...(options.trigger ? { trigger: options.trigger } : {}),
    ...(text.startsWith("/goal ") ? { goal: { objective: text.slice(6).trim(), status: "active" } } : {}),
  };
  // Freeze the payload BEFORE any network call. Lost responses reuse this ID.
  const taskId = queue().stage({ dotId, conversationId, channelId: options.channelId, input: text, context });
  start();
  void pump();
  return taskId;
}

export function start() {
  if (!enabled() || state.meshTimer) return;
  queue().restoreStatuses();
  state.meshTimer = setInterval(() => { void pump(); }, 2000);
  state.meshTimer.unref();
  void pump();
}

async function pump() {
  try {
    const status = configState();
    if (status !== "configured") { queue().unavailable(status); return; }
    const config = loadMeshConfig(process.env.DOTS_MESH_CONFIG!);
    await queue().pump(<T>(path: string, body: unknown) => meshRequest<T>(config, path, body));
  } catch {
    // Only credential-free persistent notices reach the UI. No API fallback.
  }
}

export async function pause(dotId: string): Promise<boolean> {
  queue().requestControl(dotId, "pause");
  start();
  await pump();
  return !queue().hasPendingControl(dotId);
}

export async function resume(dotId: string): Promise<boolean> {
  queue().requestControl(dotId, "resume");
  start();
  await pump();
  return !queue().hasPendingControl(dotId);
}

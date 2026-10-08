import "server-only";
import * as repo from "./repo";
import { dockerAvailable, BOX_IMAGE } from "./computer/shell";
import { defaultMode } from "./computer";
import { knownModels, hasKey, keySource } from "./agent/client";
import { COMPUTER_ENABLED } from "./agent/tools";
import { skyInstalled } from "./computer/sky";
import { cloudKeySource } from "./computer/cloud";
import { openRouterSource } from "./agent/openrouter";
import { triggersKeySource } from "./triggers";
import { apps, signedIn } from "./composio";
import type { ComputerInfo, Snapshot } from "@/lib/types";
import { configState, enabled as meshEnabled } from "./agent/mesh";

export function computerInfo(): ComputerInfo {
  const m = knownModels();
  return {
    mode: defaultMode(),
    docker: dockerAvailable(),
    image: BOX_IMAGE,
    model: meshEnabled() ? "Codex host catalog" : m.defaultModel,
    models: meshEnabled() ? [] : m.available,
    computerTool: COMPUTER_ENABLED ? "computer" : "off",
    hasKey: meshEnabled() ? configState() === "configured" : hasKey(),
    keySource: meshEnabled() ? "codex-mesh" : keySource(),
    ...(meshEnabled() ? { meshConfig: configState() } : {}),
    cloudKey: cloudKeySource(),
    openRouter: openRouterSource(),
    triggersKey: triggersKeySource(),
    sky: skyInstalled(),
    composio: signedIn(),
  };
}

export function snapshot(): Snapshot {
  return {
    dots: repo.listDots(),
    messages: [...repo.recentMessages(120), ...repo.channelMessages(300)],
    routines: repo.listRoutines(),
    triggers: repo.listTriggers(),
    rules: repo.listRules(),
    memories: repo.listMemories(),
    skills: repo.listSkills(),
    passwords: repo.listPasswords(),
    computer: computerInfo(),
    apps: apps(),
    channels: repo.listChannels(),
    conversations: repo.listConversations(),
  };
}

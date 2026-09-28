/**
 * Map a desktop bubble index onto persisted lawyer bubbles.
 *
 * The on-screen list drifts from `sessionHistoryToSimpleMessages`: a failed
 * model call keeps an assistant row only in the renderer, and compact drops
 * older turns from disk without rewriting the open transcript. Edit/delete
 * must follow the utterance, not that stale index — an out-of-range index
 * is rejected before the turn can be resent.
 */

export type TranscriptBubble = {
  role: "user" | "assistant";
  text: string;
};

export type TranscriptMutatePlan =
  | { action: "mutate"; uiIndex: number }
  | { action: "local" }
  | { action: "missing" };

/** Typed text, or the same sentence stored after a file-context prefix. */
export function transcriptTextsMatch(serverText: string, clientText: string): boolean {
  const server = serverText.trim();
  const client = clientText.trim();
  if (server === client) {
    return true;
  }
  if (!client || !server.endsWith(`\n\n${client}`)) {
    return false;
  }
  const head = server.slice(0, server.length - client.length - 2);
  return head.indexOf("路径引用") >= 0 || head.indexOf("【用户在") >= 0;
}

/**
 * Decide how to rewrite history for edit-resend (`truncate`) or delete.
 * `mutate` uses a server bubble index. `local` means this row never landed
 * in the session, so the caller only changes the open transcript.
 */
export function planTranscriptMutate(opts: {
  mode: "truncate" | "delete_pair";
  clientMessages: readonly TranscriptBubble[];
  clientIndex: number;
  serverMessages: readonly TranscriptBubble[];
}): TranscriptMutatePlan {
  const { mode, clientMessages, clientIndex, serverMessages } = opts;
  if (!Number.isInteger(clientIndex) || clientIndex < 0 || clientIndex >= clientMessages.length) {
    return { action: "missing" };
  }
  const target = clientMessages[clientIndex];
  if (!target) {
    return { action: "missing" };
  }

  const aligned = alignRoleFromTail(clientMessages, serverMessages, target.role);
  const serverIndex = aligned.get(clientIndex);
  if (serverIndex != null) {
    return { action: "mutate", uiIndex: serverIndex };
  }

  // Edit-resend still has to drop turns that survived on disk after this row
  // (the row itself was compacted away or never persisted).
  if (mode === "truncate") {
    let next: number | null = null;
    for (const [clientAt, serverAt] of aligned) {
      if (clientAt > clientIndex && (next == null || serverAt < next)) {
        next = serverAt;
      }
    }
    if (next != null) {
      return { action: "mutate", uiIndex: next };
    }
  }
  return { action: "local" };
}

function alignRoleFromTail(
  clientMessages: readonly TranscriptBubble[],
  serverMessages: readonly TranscriptBubble[],
  role: TranscriptBubble["role"],
): Map<number, number> {
  const clientAt: number[] = [];
  const serverAt: number[] = [];
  clientMessages.forEach((message, index) => {
    if (message.role === role) {
      clientAt.push(index);
    }
  });
  serverMessages.forEach((message, index) => {
    if (message.role === role) {
      serverAt.push(index);
    }
  });

  const aligned = new Map<number, number>();
  let serverCursor = serverAt.length - 1;
  for (
    let clientCursor = clientAt.length - 1;
    clientCursor >= 0 && serverCursor >= 0;
    clientCursor -= 1
  ) {
    const clientIndex = clientAt[clientCursor];
    const serverIndex = serverAt[serverCursor];
    if (clientIndex == null || serverIndex == null) {
      continue;
    }
    const client = clientMessages[clientIndex];
    const server = serverMessages[serverIndex];
    if (!client || !server || !transcriptTextsMatch(server.text, client.text)) {
      continue;
    }
    aligned.set(clientIndex, serverIndex);
    serverCursor -= 1;
  }
  return aligned;
}

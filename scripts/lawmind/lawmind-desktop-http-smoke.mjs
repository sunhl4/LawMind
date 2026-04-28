#!/usr/bin/env node
/**
 * Quick probe against a running LawMind desktop local API (loopback).
 *
 * Usage:
 *   LAWMIND_DESKTOP_PORT=18790 node scripts/lawmind/lawmind-desktop-http-smoke.mjs
 *   node scripts/lawmind/lawmind-desktop-http-smoke.mjs http://127.0.0.1:18790
 *
 * Exits 0 when GET /api/health returns JSON with ok===true; else 1.
 *
 * Deep mode (optional):
 *   LAWMIND_SMOKE_DEEP=1 — also checks GET /api/tasks and, when possible,
 *   GET /api/tasks/:id includes `checkpoints`, and GET /api/drafts/:id includes `citationIntegrity`.
 */
const baseArg = process.argv[2]?.trim();
const port = process.env.LAWMIND_DESKTOP_PORT?.trim();
const base = baseArg || (port ? `http://127.0.0.1:${port}` : "");

if (!base) {
  console.error("Set LAWMIND_DESKTOP_PORT or pass base URL, e.g. http://127.0.0.1:18790");
  process.exit(1);
}

const root = base.replace(/\/$/, "");
const healthUrl = `${root}/api/health`;
const deep = process.env.LAWMIND_SMOKE_DEEP?.trim() === "1";

try {
  const res = await fetch(healthUrl);
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    console.error("Non-JSON response", res.status, text.slice(0, 200));
    process.exit(1);
  }
  if (!res.ok || j.ok !== true) {
    console.error("Health check failed", res.status, j);
    process.exit(1);
  }
  console.log("ok workspaceDir=", j.workspaceDir, "modelConfigured=", j.modelConfigured);
  if (j.doctor?.researchSnapshotCount != null) {
    console.log(
      "doctor drafts=",
      j.doctor.draftCount,
      "researchSnapshots=",
      j.doctor.researchSnapshotCount,
    );
  }

  if (deep) {
    const tr = await fetch(`${root}/api/tasks`);
    const tj = await tr.json();
    if (!tr.ok || tj.ok !== true || !Array.isArray(tj.tasks)) {
      console.error("Deep smoke: /api/tasks failed", tr.status, tj);
      process.exit(1);
    }
    if (tj.tasks.length > 0) {
      const id = tj.tasks[0].taskId;
      const dr = await fetch(`${root}/api/tasks/${encodeURIComponent(id)}`);
      const dj = await dr.json();
      if (!dr.ok || dj.ok !== true || !Array.isArray(dj.checkpoints)) {
        console.error("Deep smoke: task detail missing checkpoints", dr.status, dj);
        process.exit(1);
      }
      console.log("deep ok task", id, "checkpoints=", dj.checkpoints.length);
    }
    const dlr = await fetch(`${root}/api/drafts`);
    const dlj = await dlr.json();
    if (!dlr.ok || dlj.ok !== true || !Array.isArray(dlj.drafts)) {
      console.error("Deep smoke: /api/drafts failed", dlr.status, dlj);
      process.exit(1);
    }
    if (dlj.drafts.length > 0) {
      const did = dlj.drafts[0].taskId;
      const ddr = await fetch(`${root}/api/drafts/${encodeURIComponent(did)}`);
      const ddj = await ddr.json();
      if (!ddr.ok || ddj.ok !== true || ddj.citationIntegrity === undefined) {
        console.error("Deep smoke: draft detail missing citationIntegrity", ddr.status, ddj);
        process.exit(1);
      }
      console.log(
        "deep ok draft",
        did,
        "citationIntegrity.checked=",
        ddj.citationIntegrity?.checked,
      );
    }
  }

  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

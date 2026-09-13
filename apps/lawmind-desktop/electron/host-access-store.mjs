import fs from "node:fs";
import path from "node:path";

export function hostAccessFilePath(lawMindRoot) {
  return path.join(lawMindRoot, "host-access.json");
}

export function readHostAccessStore(lawMindRoot) {
  const file = hostAccessFilePath(lawMindRoot);
  try {
    if (!fs.existsSync(file)) {
      return { schemaVersion: 1, mounts: [], persistentGrants: [] };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || raw.schemaVersion !== 1) {
      return { schemaVersion: 1, mounts: [], persistentGrants: [] };
    }
    return {
      schemaVersion: 1,
      mounts: Array.isArray(raw.mounts) ? raw.mounts : [],
      persistentGrants: Array.isArray(raw.persistentGrants) ? raw.persistentGrants : [],
      fullDiskAccessNoted: raw.fullDiskAccessNoted === true,
    };
  } catch {
    return { schemaVersion: 1, mounts: [], persistentGrants: [] };
  }
}

export function writeHostAccessStore(lawMindRoot, state) {
  const file = hostAccessFilePath(lawMindRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function migrateProjectIntoStore(lawMindRoot, projectDir) {
  const state = readHostAccessStore(lawMindRoot);
  if (!projectDir || !String(projectDir).trim()) {
    return state;
  }
  const abs = path.resolve(projectDir);
  if (state.mounts.some((m) => path.resolve(m.absPath) === abs)) {
    return state;
  }
  state.mounts.unshift({
    id: "project",
    absPath: abs,
    label: path.basename(abs),
    addedAt: new Date().toISOString(),
  });
  writeHostAccessStore(lawMindRoot, state);
  return state;
}

export function rootsFromStore(workspaceDir, projectDir, lawMindRoot) {
  const state = migrateProjectIntoStore(lawMindRoot, projectDir);
  const roots = { workspace: workspaceDir };
  if (state.mounts[0]?.absPath) {
    roots.project = path.resolve(state.mounts[0].absPath);
  } else if (projectDir) {
    roots.project = path.resolve(projectDir);
  }
  for (const mount of state.mounts) {
    if (mount?.id && mount.absPath) {
      roots[`mount:${mount.id}`] = path.resolve(mount.absPath);
    }
  }
  return roots;
}

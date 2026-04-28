# LawMind 包清单与 SHA-256 校验

用于**所内模板包 / 技能文档包**的本地校验：在运行或导入前验证文件未被篡改。不提供远程市场下载；清单由运维或构建流水线生成。

## 清单格式（`LawMindBundleManifest`）

- `schemaVersion`: 固定为 `1`
- `bundleId`、`version`、`generatedAt`：元数据字符串
- `entries[]`：每项包含
  - `path`：相对 **workspace 根** 的路径，禁止 `..` 与绝对路径
  - `sha256`：小写十六进制
  - `role`：`template` | `skill` | `doc`

示例（节选）：

```json
{
  "schemaVersion": 1,
  "bundleId": "firm-templates-2026Q1",
  "version": "1.0.0",
  "generatedAt": "2026-03-29T12:00:00.000Z",
  "entries": [
    {
      "path": "lawmind/templates/index.json",
      "sha256": "…",
      "role": "template"
    }
  ]
}
```

## API 与代码

- 解析：`parseLawMindBundleManifest(JSON.parse(...))`
- 校验：`verifyLawMindBundleManifest(workspaceDir, manifest)` → `{ ok, errors[] }`

单元测试见 `src/lawmind/skills/bundle-manifest.test.ts`。

## 与审计导出的关系

合规向审计导出（`GET /api/audit/export?compliance=true`）描述系统内事件统计；**包校验**描述静态文件完整性。二者可一并纳入律所内控材料。

---

- https://docs.lawmind.ai/LAWMIND-BUNDLES
- https://docs.lawmind.ai/LAWMIND-PRIVATE-DEPLOY

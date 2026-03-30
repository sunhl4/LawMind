import Foundation

struct AgentWorkbenchTemplateEntry: Identifiable {
    let id: String
    let label: String
    let format: String
    let source: String
    let enabled: Bool
    let version: Int?
    let sourcePath: String?
    let placeholderMap: [String: String]
}

struct AgentWorkbenchActivityEntry: Identifiable {
    let id: String
    let timestamp: String
    let action: String
    let detail: String
}

struct AgentWorkbenchInstructionTemplate: Identifiable {
    let id: String
    let title: String
    let instruction: String
    let suggestedTemplateID: String
}

struct AgentWorkbenchSnapshot {
    var defaultWorkspace: String
    var caseWorkspaceOverride: String
    var sessionWorkspaceOverride: String
    var recentWorkspaces: [String]
    var favoriteWorkspaces: [String]
    var recentFiles: [String]
    var projectRoot: String
    var templates: [AgentWorkbenchTemplateEntry]
    var activityLog: [AgentWorkbenchActivityEntry]
    var instructionTemplates: [AgentWorkbenchInstructionTemplate]

    var effectiveWorkspace: String {
        let session = self.sessionWorkspaceOverride.trimmingCharacters(in: .whitespacesAndNewlines)
        if !session.isEmpty { return session }
        let caseOverride = self.caseWorkspaceOverride.trimmingCharacters(in: .whitespacesAndNewlines)
        if !caseOverride.isEmpty { return caseOverride }
        return self.defaultWorkspace
    }
}

enum AgentWorkbenchPreferences {
    private static let lawmindKey = "lawmind"
    private static let workbenchKey = "workbench"
    private static let caseOverrideKey = "caseWorkspaceOverride"
    private static let sessionOverrideKey = "sessionWorkspaceOverride"
    private static let recentWorkspacesKey = "recentWorkspaces"
    private static let favoriteWorkspacesKey = "favoriteWorkspaces"
    private static let recentFilesKey = "recentFiles"
    private static let activityLogKey = "activityLog"
    private static let maxRecentItems = 12
    private static let maxActivityItems = 40
    private static let builtInTemplates = [
        ("word/legal-memo-default", "Legal Memo", "docx"),
        ("word/contract-default", "Contract Review", "docx"),
        ("word/demand-letter-default", "Demand Letter", "docx"),
        ("ppt/client-brief-default", "Client Brief", "pptx"),
        ("ppt/evidence-timeline-default", "Evidence Timeline", "pptx"),
        ("ppt/hearing-strategy-default", "Hearing Strategy", "pptx"),
    ]
    private static let templateIdRegex = try? NSRegularExpression(pattern: "^upload/[a-z0-9][a-z0-9._-]{1,63}$")
    private static let defaultInstructionTemplates = [
        AgentWorkbenchInstructionTemplate(
            id: "playbook-contract-review",
            title: "合同审查意见",
            instruction: "请审查这份合同并输出关键风险、可协商条款、建议修改文本，按律师审阅结构整理。",
            suggestedTemplateID: "word/contract-default"),
        AgentWorkbenchInstructionTemplate(
            id: "playbook-demand-letter",
            title: "律师函草稿",
            instruction: "请根据已知事实起草律师函，明确事实依据、法律依据、履行期限和后续保留权利。",
            suggestedTemplateID: "word/demand-letter-default"),
        AgentWorkbenchInstructionTemplate(
            id: "playbook-client-brief",
            title: "客户汇报简报",
            instruction: "请整理案件进展、证据状态、风险分级和下一步行动建议，生成适合客户汇报的结构化内容。",
            suggestedTemplateID: "ppt/client-brief-default"),
    ]

    static func load() -> AgentWorkbenchSnapshot {
        let root = OpenClawConfigFile.loadDict()
        let workbench = self.workbench(from: root)
        let defaultWorkspace = AgentWorkspace.displayPath(
            for: AgentWorkspace.resolveWorkspaceURL(from: OpenClawConfigFile.agentWorkspace()))
        let caseWorkspace = workbench[self.caseOverrideKey] as? String ?? ""
        let sessionWorkspace = workbench[self.sessionOverrideKey] as? String ?? ""
        let effectiveWorkspace = self.resolveEffectiveWorkspace(
            defaultWorkspace: defaultWorkspace,
            caseWorkspaceOverride: caseWorkspace,
            sessionWorkspaceOverride: sessionWorkspace)
        let templates = self.builtInTemplateEntries() + self.loadUploadedTemplateEntries(workspacePath: effectiveWorkspace)
        return AgentWorkbenchSnapshot(
            defaultWorkspace: defaultWorkspace,
            caseWorkspaceOverride: caseWorkspace,
            sessionWorkspaceOverride: sessionWorkspace,
            recentWorkspaces: self.stringList(workbench[self.recentWorkspacesKey]),
            favoriteWorkspaces: self.stringList(workbench[self.favoriteWorkspacesKey]),
            recentFiles: self.stringList(workbench[self.recentFilesKey]),
            projectRoot: CommandResolver.projectRootPath(),
            templates: templates,
            activityLog: self.loadActivityEntries(workbench: workbench),
            instructionTemplates: self.defaultInstructionTemplates)
    }

    static func setDefaultWorkspace(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        OpenClawConfigFile.setAgentWorkspace(trimmed.isEmpty ? nil : trimmed)
        if !trimmed.isEmpty {
            self.rememberWorkspace(trimmed)
        }
        self.appendActivity(action: "set_default_workspace", detail: trimmed.isEmpty ? "cleared" : trimmed)
    }

    static func setCaseWorkspaceOverride(_ value: String) {
        self.updateWorkbench { workbench in
            self.updateStringField(workbench: &workbench, key: self.caseOverrideKey, value: value)
            self.appendActivity(
                to: &workbench,
                action: "set_case_override",
                detail: value.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    static func setSessionWorkspaceOverride(_ value: String) {
        self.updateWorkbench { workbench in
            self.updateStringField(workbench: &workbench, key: self.sessionOverrideKey, value: value)
            self.appendActivity(
                to: &workbench,
                action: "set_session_override",
                detail: value.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    static func rememberWorkspace(_ workspace: String) {
        let trimmed = workspace.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.updateWorkbench { workbench in
            var list = self.stringList(workbench[self.recentWorkspacesKey])
            self.pushValue(trimmed, into: &list, maxCount: self.maxRecentItems)
            workbench[self.recentWorkspacesKey] = list
            self.appendActivity(to: &workbench, action: "remember_workspace", detail: trimmed)
        }
    }

    static func toggleFavoriteWorkspace(_ workspace: String) {
        let trimmed = workspace.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.updateWorkbench { workbench in
            var favorites = self.stringList(workbench[self.favoriteWorkspacesKey])
            if let idx = favorites.firstIndex(of: trimmed) {
                favorites.remove(at: idx)
                self.appendActivity(to: &workbench, action: "unfavorite_workspace", detail: trimmed)
            } else {
                self.pushValue(trimmed, into: &favorites, maxCount: self.maxRecentItems)
                self.appendActivity(to: &workbench, action: "favorite_workspace", detail: trimmed)
            }
            workbench[self.favoriteWorkspacesKey] = favorites
        }
    }

    static func rememberFile(_ filePath: String) {
        let trimmed = filePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.updateWorkbench { workbench in
            var files = self.stringList(workbench[self.recentFilesKey])
            self.pushValue(trimmed, into: &files, maxCount: self.maxRecentItems)
            workbench[self.recentFilesKey] = files
            self.appendActivity(to: &workbench, action: "remember_file", detail: trimmed)
        }
    }

    static func setProjectRoot(_ path: String) {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        CommandResolver.setProjectRoot(trimmed)
        self.updateWorkbench { workbench in
            self.appendActivity(to: &workbench, action: "set_project_root", detail: trimmed)
        }
    }

    static func removeWorkspaceShortcut(_ workspace: String) {
        let trimmed = workspace.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.updateWorkbench { workbench in
            var recents = self.stringList(workbench[self.recentWorkspacesKey])
            recents.removeAll { $0 == trimmed }
            if recents.isEmpty {
                workbench.removeValue(forKey: self.recentWorkspacesKey)
            } else {
                workbench[self.recentWorkspacesKey] = recents
            }
            var favorites = self.stringList(workbench[self.favoriteWorkspacesKey])
            favorites.removeAll { $0 == trimmed }
            if favorites.isEmpty {
                workbench.removeValue(forKey: self.favoriteWorkspacesKey)
            } else {
                workbench[self.favoriteWorkspacesKey] = favorites
            }
            self.appendActivity(to: &workbench, action: "remove_workspace_shortcut", detail: trimmed)
        }
    }

    static func removeRecentFile(_ filePath: String) {
        let trimmed = filePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.updateWorkbench { workbench in
            var files = self.stringList(workbench[self.recentFilesKey])
            files.removeAll { $0 == trimmed }
            if files.isEmpty {
                workbench.removeValue(forKey: self.recentFilesKey)
            } else {
                workbench[self.recentFilesKey] = files
            }
            self.appendActivity(to: &workbench, action: "remove_recent_file", detail: trimmed)
        }
    }

    static func clearOverrides() {
        self.updateWorkbench { workbench in
            workbench.removeValue(forKey: self.caseOverrideKey)
            workbench.removeValue(forKey: self.sessionOverrideKey)
            self.appendActivity(to: &workbench, action: "clear_overrides", detail: "case+session")
        }
    }

    private static func workbench(from root: [String: Any]) -> [String: Any] {
        let lawmind = root[self.lawmindKey] as? [String: Any]
        return lawmind?[self.workbenchKey] as? [String: Any] ?? [:]
    }

    private static func updateWorkbench(_ mutate: (inout [String: Any]) -> Void) {
        var root = OpenClawConfigFile.loadDict()
        var lawmind = root[self.lawmindKey] as? [String: Any] ?? [:]
        var workbench = lawmind[self.workbenchKey] as? [String: Any] ?? [:]
        mutate(&workbench)
        if workbench.isEmpty {
            lawmind.removeValue(forKey: self.workbenchKey)
        } else {
            lawmind[self.workbenchKey] = workbench
        }
        if lawmind.isEmpty {
            root.removeValue(forKey: self.lawmindKey)
        } else {
            root[self.lawmindKey] = lawmind
        }
        OpenClawConfigFile.saveDict(root)
    }

    private static func updateStringField(workbench: inout [String: Any], key: String, value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            workbench.removeValue(forKey: key)
        } else {
            workbench[key] = trimmed
        }
    }

    private static func stringList(_ value: Any?) -> [String] {
        guard let array = value as? [String] else { return [] }
        return array
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private static func pushValue(_ value: String, into list: inout [String], maxCount: Int) {
        list.removeAll { $0 == value }
        list.insert(value, at: 0)
        if list.count > maxCount {
            list = Array(list.prefix(maxCount))
        }
    }

    private static func resolveEffectiveWorkspace(
        defaultWorkspace: String,
        caseWorkspaceOverride: String,
        sessionWorkspaceOverride: String) -> String
    {
        let session = sessionWorkspaceOverride.trimmingCharacters(in: .whitespacesAndNewlines)
        if !session.isEmpty { return session }
        let caseOverride = caseWorkspaceOverride.trimmingCharacters(in: .whitespacesAndNewlines)
        if !caseOverride.isEmpty { return caseOverride }
        return defaultWorkspace
    }

    private static func builtInTemplateEntries() -> [AgentWorkbenchTemplateEntry] {
        self.builtInTemplates.map { id, label, format in
            AgentWorkbenchTemplateEntry(
                id: id,
                label: label,
                format: format,
                source: "built-in",
                enabled: true,
                version: nil,
                sourcePath: nil,
                placeholderMap: self.defaultPlaceholderMap(forTemplateID: id))
        }
    }

    private static func loadUploadedTemplateEntries(workspacePath: String) -> [AgentWorkbenchTemplateEntry] {
        let workspaceURL = AgentWorkspace.resolveWorkspaceURL(from: workspacePath)
        let fileURL = workspaceURL
            .appendingPathComponent("lawmind", isDirectory: true)
            .appendingPathComponent("templates", isDirectory: true)
            .appendingPathComponent("index.json", isDirectory: false)
        guard let data = try? Data(contentsOf: fileURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = object["templates"] as? [[String: Any]]
        else {
            return []
        }
        return list.compactMap { row in
            guard let id = row["id"] as? String,
                  let label = row["label"] as? String,
                  let format = row["format"] as? String
            else {
                return nil
            }
            let enabled = row["enabled"] as? Bool ?? true
            let sourcePath = row["sourcePath"] as? String
            let version = row["version"] as? Int
            let placeholderMap = row["placeholderMap"] as? [String: String] ?? [:]
            return AgentWorkbenchTemplateEntry(
                id: id,
                label: label,
                format: format,
                source: "uploaded",
                enabled: enabled,
                version: version,
                sourcePath: sourcePath,
                placeholderMap: placeholderMap)
        }
    }

    static func registerUploadedTemplate(
        workspacePath: String,
        id: String,
        label: String,
        format: String,
        sourcePath: String) throws
    {
        let trimmedId = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedFormat = format.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let trimmedSourcePath = sourcePath.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedId.isEmpty,
              let regex = self.templateIdRegex,
              regex.firstMatch(
                  in: trimmedId,
                  range: NSRange(location: 0, length: trimmedId.utf16.count)) != nil
        else {
            throw NSError(
                domain: "AgentWorkbenchPreferences",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Template ID must match upload/<name>."])
        }
        guard !trimmedLabel.isEmpty else {
            throw NSError(
                domain: "AgentWorkbenchPreferences",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Template label is required."])
        }
        guard trimmedFormat == "docx" || trimmedFormat == "pptx" else {
            throw NSError(
                domain: "AgentWorkbenchPreferences",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Template format must be docx or pptx."])
        }
        guard !trimmedSourcePath.isEmpty else {
            throw NSError(
                domain: "AgentWorkbenchPreferences",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Template source path is required."])
        }
        if trimmedFormat == "docx", !trimmedSourcePath.lowercased().hasSuffix(".docx") {
            throw NSError(
                domain: "AgentWorkbenchPreferences",
                code: 5,
                userInfo: [NSLocalizedDescriptionKey: "Template file must end with .docx"])
        }
        if trimmedFormat == "pptx", !trimmedSourcePath.lowercased().hasSuffix(".pptx") {
            throw NSError(
                domain: "AgentWorkbenchPreferences",
                code: 6,
                userInfo: [NSLocalizedDescriptionKey: "Template file must end with .pptx"])
        }

        let workspaceURL = AgentWorkspace.resolveWorkspaceURL(from: workspacePath)
        let registryURL = workspaceURL
            .appendingPathComponent("lawmind", isDirectory: true)
            .appendingPathComponent("templates", isDirectory: true)
            .appendingPathComponent("index.json", isDirectory: false)
        try FileManager().createDirectory(
            at: registryURL.deletingLastPathComponent(),
            withIntermediateDirectories: true)

        var templates = self.loadUploadedRows(fileURL: registryURL)
        let existing = templates.first(where: { ($0["id"] as? String) == trimmedId })
        let existingVersion = existing?["version"] as? Int ?? 0
        let nextVersion = existingVersion + 1
        let now = ISO8601DateFormatter().string(from: Date())

        templates.removeAll { ($0["id"] as? String) == trimmedId }
        templates.append([
            "id": trimmedId,
            "label": trimmedLabel,
            "format": trimmedFormat,
            "sourcePath": trimmedSourcePath,
            "version": nextVersion,
            "enabled": true,
            "placeholderMap": [:] as [String: String],
            "uploadedAt": now,
        ])

        let output: [String: Any] = ["templates": templates]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: registryURL, options: [.atomic])
        self.updateWorkbench { workbench in
            self.appendActivity(
                to: &workbench,
                action: "register_uploaded_template",
                detail: "\(trimmedId) (\(trimmedFormat))")
        }
    }

    static func setUploadedTemplateEnabled(
        workspacePath: String,
        id: String,
        enabled: Bool) throws
    {
        let trimmedId = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedId.isEmpty else { return }
        let workspaceURL = AgentWorkspace.resolveWorkspaceURL(from: workspacePath)
        let registryURL = workspaceURL
            .appendingPathComponent("lawmind", isDirectory: true)
            .appendingPathComponent("templates", isDirectory: true)
            .appendingPathComponent("index.json", isDirectory: false)
        var templates = self.loadUploadedRows(fileURL: registryURL)
        var updated = false
        for index in templates.indices {
            if (templates[index]["id"] as? String) == trimmedId {
                templates[index]["enabled"] = enabled
                updated = true
            }
        }
        guard updated else { return }
        let output: [String: Any] = ["templates": templates]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: registryURL, options: [.atomic])
        self.updateWorkbench { workbench in
            self.appendActivity(
                to: &workbench,
                action: enabled ? "enable_uploaded_template" : "disable_uploaded_template",
                detail: trimmedId)
        }
    }

    private static func loadUploadedRows(fileURL: URL) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: fileURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = object["templates"] as? [[String: Any]]
        else {
            return []
        }
        return list
    }

    private static func loadActivityEntries(workbench: [String: Any]) -> [AgentWorkbenchActivityEntry] {
        guard let rows = workbench[self.activityLogKey] as? [[String: Any]] else {
            return []
        }
        return rows.compactMap { row in
            guard let id = row["id"] as? String,
                  let timestamp = row["timestamp"] as? String,
                  let action = row["action"] as? String,
                  let detail = row["detail"] as? String
            else {
                return nil
            }
            return AgentWorkbenchActivityEntry(id: id, timestamp: timestamp, action: action, detail: detail)
        }
    }

    private static func appendActivity(action: String, detail: String) {
        self.updateWorkbench { workbench in
            self.appendActivity(to: &workbench, action: action, detail: detail)
        }
    }

    private static func appendActivity(to workbench: inout [String: Any], action: String, detail: String) {
        let trimmedDetail = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        let detailText = trimmedDetail.isEmpty ? "-" : trimmedDetail
        var rows = workbench[self.activityLogKey] as? [[String: Any]] ?? []
        rows.insert([
            "id": UUID().uuidString,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "action": action,
            "detail": detailText,
        ], at: 0)
        if rows.count > self.maxActivityItems {
            rows = Array(rows.prefix(self.maxActivityItems))
        }
        workbench[self.activityLogKey] = rows
    }

    private static func defaultPlaceholderMap(forTemplateID templateID: String) -> [String: String] {
        if templateID.hasPrefix("word/") {
            return [
                "case_title": "title",
                "summary": "summary",
                "primary_findings": "sections[0]",
            ]
        }
        return [
            "deck_title": "title",
            "deck_summary": "summary",
            "key_points": "sections",
        ]
    }
}

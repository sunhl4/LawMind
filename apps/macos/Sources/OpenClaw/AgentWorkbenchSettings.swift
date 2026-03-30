import AppKit
import OpenClawKit
import OpenClawProtocol
import SwiftUI

private enum AgentWorkbenchPane: String, CaseIterable, Identifiable {
    case workspace
    case files
    case templates
    case playbooks
    case activity

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .workspace: "Workspace"
        case .files: "Files"
        case .templates: "Templates"
        case .playbooks: "Playbooks"
        case .activity: "Activity"
        }
    }

    var symbol: String {
        switch self {
        case .workspace: "folder"
        case .files: "doc"
        case .templates: "rectangle.on.rectangle.angled"
        case .playbooks: "wand.and.stars"
        case .activity: "clock.arrow.circlepath"
        }
    }
}

struct AgentWorkbenchSettings: View {
    /// Live state for a single playbook execution.
    struct PlaybookRunState {
        var runId: String?
        var sessionKey: String
        var status: String          // queued | submitted | running | rendered | timeout | submit_failed
        var outputPath: String?
        var lastUpdated: Date
        var timedOut: Bool = false
    }

    // Timeout after which a non-terminal playbook is marked as timed out.
    private static let playbookTimeoutSeconds: TimeInterval = 120

    @State private var snapshot = AgentWorkbenchPreferences.load()
    @State private var selectedPane: AgentWorkbenchPane? = .workspace
    @State private var searchQuery = ""
    @State private var defaultWorkspaceInput = ""
    @State private var caseWorkspaceInput = ""
    @State private var sessionWorkspaceInput = ""
    @State private var projectRootInput = ""
    @State private var fileInput = ""
    @State private var statusMessage = ""
    @State private var previewTemplate: AgentWorkbenchTemplateEntry?
    @State private var uploadTemplateID = "upload/"
    @State private var uploadTemplateLabel = ""
    @State private var uploadTemplateFormat = "docx"
    @State private var uploadTemplateSourcePath = ""
    @State private var runningPlaybookID: String?
    @State private var playbookResultMessage = ""
    @State private var playbookStates: [String: PlaybookRunState] = [:]
    @State private var pushTask: Task<Void, Never>?
    /// Per-playbook timeout cancellation tasks keyed by playbook ID.
    @State private var playbookTimeoutTasks: [String: Task<Void, Never>] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            self.headerSection
            NavigationSplitView {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("Search settings, files, templates", text: self.$searchQuery)
                        .textFieldStyle(.roundedBorder)
                    List(selection: self.$selectedPane) {
                        ForEach(AgentWorkbenchPane.allCases) { pane in
                            Label(pane.title, systemImage: pane.symbol)
                                .tag(Optional(pane))
                        }
                    }
                    .listStyle(.sidebar)
                }
                .padding(.trailing, 4)
            } detail: {
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 14) {
                        switch self.selectedPane ?? .workspace {
                        case .workspace:
                            self.workspaceSection
                            self.projectRootSection
                        case .files:
                            self.recentWorkspaceSection
                            self.recentFilesSection
                        case .templates:
                            self.templateSection
                        case .playbooks:
                            self.playbookSection
                        case .activity:
                            self.activitySection
                        }

                        if !self.statusMessage.isEmpty {
                            Text(self.statusMessage)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.leading, 8)
            }
        }
        .sheet(item: self.$previewTemplate) { template in
            AgentWorkbenchTemplatePreview(template: template)
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 16)
        .onAppear {
            self.reloadSnapshot()
            self.startPushTracking()
        }
        .onDisappear {
            self.pushTask?.cancel()
            self.pushTask = nil
            for (_, t) in self.playbookTimeoutTasks { t.cancel() }
            self.playbookTimeoutTasks.removeAll()
        }
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Agent Workbench")
                .font(.title3.weight(.semibold))
            Text("Commercial-grade control panel for agent configuration, workspace switching, and template-based delivery.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                self.infoChip(label: "Effective Workspace", value: self.snapshot.effectiveWorkspace)
                self.infoChip(label: "Project Root", value: self.snapshot.projectRoot)
            }
        }
    }

    private func infoChip(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.gray.opacity(0.10))
        .cornerRadius(8)
    }

    private var workspaceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Workspace Scope")
                .font(.headline)

            LabeledContent("Default workspace") {
                HStack(spacing: 8) {
                    TextField("~/.openclaw/workspace", text: self.$defaultWorkspaceInput)
                        .textFieldStyle(.roundedBorder)
                    Button("Choose…") { self.pickDefaultWorkspacePath() }
                    Button("Save") {
                        AgentWorkbenchPreferences.setDefaultWorkspace(self.defaultWorkspaceInput)
                        self.reloadSnapshot(status: "Saved default workspace.")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            LabeledContent("Case override") {
                HStack(spacing: 8) {
                    TextField("Workspace used for current case", text: self.$caseWorkspaceInput)
                        .textFieldStyle(.roundedBorder)
                    Button("Save") {
                        AgentWorkbenchPreferences.setCaseWorkspaceOverride(self.caseWorkspaceInput)
                        self.reloadSnapshot(status: "Saved case workspace override.")
                    }
                    Button("Clear") {
                        self.caseWorkspaceInput = ""
                        AgentWorkbenchPreferences.setCaseWorkspaceOverride("")
                        self.reloadSnapshot(status: "Cleared case workspace override.")
                    }
                }
            }

            LabeledContent("Session override") {
                HStack(spacing: 8) {
                    TextField("Workspace used for current session", text: self.$sessionWorkspaceInput)
                        .textFieldStyle(.roundedBorder)
                    Button("Save") {
                        AgentWorkbenchPreferences.setSessionWorkspaceOverride(self.sessionWorkspaceInput)
                        self.reloadSnapshot(status: "Saved session workspace override.")
                    }
                    Button("Clear") {
                        self.sessionWorkspaceInput = ""
                        AgentWorkbenchPreferences.setSessionWorkspaceOverride("")
                        self.reloadSnapshot(status: "Cleared session workspace override.")
                    }
                }
            }

            Text("Effective workspace: \(self.snapshot.effectiveWorkspace)")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Button("Use effective as default") {
                    AgentWorkbenchPreferences.setDefaultWorkspace(self.snapshot.effectiveWorkspace)
                    self.reloadSnapshot(status: "Applied effective workspace as default.")
                }
                .buttonStyle(.bordered)

                Button("Clear all overrides") {
                    AgentWorkbenchPreferences.clearOverrides()
                    self.reloadSnapshot(status: "Cleared case/session workspace overrides.")
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    private var projectRootSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Platform Working Directory")
                .font(.headline)
            Text(
                "This path controls local CLI runtime resolution for tools that run through the desktop app.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                TextField("~/Projects/openclaw", text: self.$projectRootInput)
                    .textFieldStyle(.roundedBorder)
                Button("Save") {
                    AgentWorkbenchPreferences.setProjectRoot(self.projectRootInput)
                    self.reloadSnapshot(status: "Saved platform working directory.")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    private var recentWorkspaceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent and Favorites")
                .font(.headline)
            if !self.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Filtered by: \(self.searchQuery)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if self.filteredFavoriteWorkspaces.isEmpty, self.filteredRecentNonFavoriteWorkspaces.isEmpty {
                Text("No saved workspace shortcuts yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(self.filteredFavoriteWorkspaces, id: \.self) { workspace in
                self.workspaceRow(workspace: workspace, isFavorite: true)
            }
            ForEach(self.filteredRecentNonFavoriteWorkspaces, id: \.self) { workspace in
                self.workspaceRow(workspace: workspace, isFavorite: self.snapshot.favoriteWorkspaces.contains(workspace))
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    private var recentFilesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent Files for Context")
                .font(.headline)

            HStack(spacing: 8) {
                TextField("/path/to/file.md", text: self.$fileInput)
                    .textFieldStyle(.roundedBorder)
                Button("Choose…") { self.pickFilePath() }
                Button("Add") {
                    AgentWorkbenchPreferences.rememberFile(self.fileInput)
                    self.fileInput = ""
                    self.reloadSnapshot(status: "Added file to recent context list.")
                }
                .buttonStyle(.borderedProminent)
            }

            if self.filteredRecentFiles.isEmpty {
                Text("No recent context files yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(self.filteredRecentFiles, id: \.self) { file in
                    HStack(spacing: 8) {
                        Text(file)
                            .font(.caption.monospaced())
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 8)
                        Button("Use as input") {
                            self.fileInput = file
                            self.statusMessage = "Selected recent file."
                        }
                        .buttonStyle(.bordered)
                        Button("Remove") {
                            AgentWorkbenchPreferences.removeRecentFile(file)
                            self.reloadSnapshot(status: "Removed file from recent context list.")
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    private var templateSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Template Catalog")
                .font(.headline)
            Text(
                "Built-in templates are available immediately. Uploaded templates are managed via LawMind tools (`register_template`, `list_templates`).")
                .font(.caption)
                .foregroundStyle(.secondary)

            self.templateUploadCard

            if !self.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Filtered by: \(self.searchQuery)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if self.filteredTemplates.isEmpty {
                Text("No templates match current filter.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(self.filteredTemplates) { template in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(template.label)
                            .font(.callout.weight(.semibold))
                        Text(template.format.uppercased())
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.gray.opacity(0.15))
                            .cornerRadius(4)
                        Text(template.source)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        if template.source == "uploaded" {
                            Text(template.enabled ? "enabled" : "disabled")
                                .font(.caption2)
                                .foregroundStyle(template.enabled ? .green : .orange)
                        }
                        Spacer(minLength: 8)
                        Button("Preview") {
                            self.previewTemplate = template
                        }
                        .buttonStyle(.borderedProminent)
                        Button("Copy ID") {
                            self.copyText(template.id)
                            self.statusMessage = "Copied template ID."
                        }
                        .buttonStyle(.bordered)
                        if template.source == "uploaded" {
                            Button(template.enabled ? "Disable" : "Enable") {
                                self.toggleUploadedTemplate(template)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    Text(template.id)
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let sourcePath = template.sourcePath, !sourcePath.isEmpty {
                        Text(sourcePath)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    if let version = template.version {
                        Text("Version \(version)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(10)
                .background(Color.gray.opacity(0.06))
                .cornerRadius(8)
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    private var templateUploadCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Upload Template")
                .font(.callout.weight(.semibold))
            Text("Register a local .docx or .pptx template for legal output dispatch.")
                .font(.caption)
                .foregroundStyle(.secondary)

            LabeledContent("Template ID") {
                TextField("upload/firm-brief", text: self.$uploadTemplateID)
                    .textFieldStyle(.roundedBorder)
            }
            LabeledContent("Label") {
                TextField("Firm Brief", text: self.$uploadTemplateLabel)
                    .textFieldStyle(.roundedBorder)
            }
            HStack(spacing: 8) {
                Picker("Format", selection: self.$uploadTemplateFormat) {
                    Text("docx").tag("docx")
                    Text("pptx").tag("pptx")
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)

                TextField("/path/to/template.docx", text: self.$uploadTemplateSourcePath)
                    .textFieldStyle(.roundedBorder)
                Button("Choose…") { self.pickTemplatePath() }
            }

            HStack(spacing: 8) {
                Button("Register Uploaded Template") {
                    self.registerUploadedTemplate()
                }
                .buttonStyle(.borderedProminent)
                Button("Reset") {
                    self.uploadTemplateID = "upload/"
                    self.uploadTemplateLabel = ""
                    self.uploadTemplateFormat = "docx"
                    self.uploadTemplateSourcePath = ""
                    self.statusMessage = "Reset upload form."
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(10)
        .background(Color.gray.opacity(0.06))
        .cornerRadius(8)
    }

    private var playbookSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Lawyer One-click Playbooks")
                .font(.headline)
            Text("Run common legal workflows directly from the workbench.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if !self.playbookResultMessage.isEmpty {
                Text(self.playbookResultMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(self.filteredInstructionTemplates) { item in
                self.playbookCard(for: item)
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    @ViewBuilder
    private func playbookCard(for item: AgentWorkbenchInstructionTemplate) -> some View {
        let state = self.playbookStates[item.id]
        let isRunning = self.runningPlaybookID == item.id
        let isTerminal = state.map { Self.isTerminalStatus($0.status) } ?? false
        let timedOut = state?.timedOut ?? false

        VStack(alignment: .leading, spacing: 6) {
            // Title row
            HStack(spacing: 8) {
                Text(item.title)
                    .font(.callout.weight(.semibold))
                Text(item.suggestedTemplateID)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)

                // Run / Retry button
                Button {
                    Task { await self.runPlaybook(item) }
                } label: {
                    if isRunning {
                        ProgressView().controlSize(.small)
                    } else if timedOut || state?.status == "submit_failed" {
                        Label("Retry", systemImage: "arrow.clockwise")
                    } else if isTerminal {
                        Label("Re-run", systemImage: "play.fill")
                    } else {
                        Label("Run", systemImage: "play.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRunning)

                Button("Copy Instruction") {
                    self.copyText(item.instruction)
                    self.statusMessage = "Copied instruction template."
                }
                .buttonStyle(.bordered)
            }

            // Status / runId row
            if let s = state {
                HStack(spacing: 8) {
                    self.statusBadge(for: s.status, timedOut: s.timedOut)
                    if let runId = s.runId, !runId.isEmpty {
                        Text(runId.prefix(12))
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Text(Self.relativeTime(s.lastUpdated))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            // Output path row
            if let output = state?.outputPath, !output.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "doc.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Text(output)
                        .font(.caption2.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundStyle(.secondary)
                    Button {
                        NSWorkspace.shared.selectFile(output, inFileViewerRootedAtPath: "")
                    } label: {
                        Label("Show in Finder", systemImage: "folder")
                            .font(.caption2)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }
            }

            // Instruction preview
            Text(item.instruction)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(self.playbookCardBackground(for: state))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(timedOut ? Color.orange.opacity(0.45) : Color.clear, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func statusBadge(for status: String, timedOut: Bool) -> some View {
        let (label, color): (String, Color) = {
            if timedOut { return ("timed out", .orange) }
            switch status {
            case "queued":       return ("queued",       .gray)
            case "submitted":    return ("submitted",    .blue)
            case "running",
                 "streaming":    return ("running",      .blue)
            case "rendered":     return ("rendered",     .green)
            case "submit_failed": return ("failed",      .red)
            default:             return (status,         .secondary)
            }
        }()
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .cornerRadius(4)
    }

    private func playbookCardBackground(for state: PlaybookRunState?) -> Color {
        guard let s = state else { return Color.gray.opacity(0.06) }
        if s.timedOut { return Color.orange.opacity(0.04) }
        switch s.status {
        case "rendered": return Color.green.opacity(0.04)
        case "submit_failed": return Color.red.opacity(0.04)
        default: return Color.gray.opacity(0.06)
        }
    }

    private static func isTerminalStatus(_ status: String) -> Bool {
        ["rendered", "done", "complete", "error", "submit_failed"].contains(status)
    }

    private static func relativeTime(_ date: Date) -> String {
        let diff = Int(Date().timeIntervalSince(date))
        if diff < 60 { return "\(diff)s ago" }
        if diff < 3600 { return "\(diff / 60)m ago" }
        return "\(diff / 3600)h ago"
    }

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Workbench Activity")
                .font(.headline)
            Text("Recent configuration and template operations.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if self.filteredActivityEntries.isEmpty {
                Text("No activity entries yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(self.filteredActivityEntries) { entry in
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.action)
                            .font(.caption.weight(.semibold))
                        Text(entry.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    Text(entry.timestamp)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(.vertical, 3)
                Divider()
            }
        }
        .padding(12)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    private func workspaceRow(workspace: String, isFavorite: Bool) -> some View {
        HStack(spacing: 8) {
            Text(workspace)
                .font(.caption.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            Button("Use") {
                self.defaultWorkspaceInput = workspace
                AgentWorkbenchPreferences.setDefaultWorkspace(workspace)
                self.reloadSnapshot(status: "Switched default workspace.")
            }
            .buttonStyle(.bordered)
            Button(isFavorite ? "Unfavorite" : "Favorite") {
                AgentWorkbenchPreferences.toggleFavoriteWorkspace(workspace)
                self.reloadSnapshot(status: isFavorite ? "Removed workspace from favorites." : "Added workspace to favorites.")
            }
            .buttonStyle(.bordered)
            Button("Remove") {
                AgentWorkbenchPreferences.removeWorkspaceShortcut(workspace)
                self.reloadSnapshot(status: "Removed workspace shortcut.")
            }
            .buttonStyle(.bordered)
        }
    }

    private func pickDefaultWorkspacePath() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            self.defaultWorkspaceInput = url.path
            AgentWorkbenchPreferences.rememberWorkspace(url.path)
            self.reloadSnapshot(status: "Selected workspace path.")
        }
    }

    private func pickFilePath() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            self.fileInput = url.path
        }
    }

    private func pickTemplatePath() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedFileTypes = ["docx", "pptx"]
        if panel.runModal() == .OK, let url = panel.url {
            self.uploadTemplateSourcePath = url.path
            let ext = url.pathExtension.lowercased()
            if ext == "docx" || ext == "pptx" {
                self.uploadTemplateFormat = ext
            }
            if self.uploadTemplateLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                self.uploadTemplateLabel = url.deletingPathExtension().lastPathComponent
            }
        }
    }

    private func registerUploadedTemplate() {
        do {
            try AgentWorkbenchPreferences.registerUploadedTemplate(
                workspacePath: self.snapshot.effectiveWorkspace,
                id: self.uploadTemplateID,
                label: self.uploadTemplateLabel,
                format: self.uploadTemplateFormat,
                sourcePath: self.uploadTemplateSourcePath)
            self.reloadSnapshot(status: "Uploaded template registered.")
        } catch {
            self.statusMessage = "Template upload failed: \(error.localizedDescription)"
        }
    }

    private func startPushTracking() {
        GatewayPushSubscription.restartTask(task: &self.pushTask, bufferingNewest: 300) { push in
            self.consumePush(push)
        }
    }

    private func consumePush(_ push: GatewayPush) {
        guard case let .event(evt) = push, evt.event == "agent",
              let payload = evt.payload,
              let agent = try? GatewayPayloadDecoding.decode(payload, as: ControlAgentEvent.self)
        else {
            return
        }

        for (playbookID, var state) in self.playbookStates {
            if let runId = state.runId, runId != agent.runId {
                continue
            }

            if let eventState = agent.data["state"]?.value as? String, !eventState.isEmpty {
                state.status = eventState
                state.lastUpdated = Date()
            } else if state.runId == nil {
                // If no runId ack was returned, tentatively bind first matching push.
                state.runId = agent.runId
                state.status = "running"
                state.lastUpdated = Date()
            }

            if let path = Self.extractOutputPath(from: agent.data), !path.isEmpty {
                state.outputPath = path
                if state.status == "running" || state.status == "streaming" {
                    state.status = "rendered"
                }
            }

            // Cancel timeout task when a terminal state is received.
            if Self.isTerminalStatus(state.status) {
                self.playbookTimeoutTasks[playbookID]?.cancel()
                self.playbookTimeoutTasks.removeValue(forKey: playbookID)
                state.timedOut = false
            }

            self.playbookStates[playbookID] = state
        }
    }

    /// Schedules a timeout task that marks the playbook run as timed out unless
    /// it reaches a terminal state first.
    private func schedulePlaybookTimeout(for playbookID: String) {
        self.playbookTimeoutTasks[playbookID]?.cancel()
        let timeout = Self.playbookTimeoutSeconds
        self.playbookTimeoutTasks[playbookID] = Task {
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            guard !Task.isCancelled else { return }
            if var state = self.playbookStates[playbookID],
               !Self.isTerminalStatus(state.status) {
                state.status = "timeout"
                state.timedOut = true
                state.lastUpdated = Date()
                self.playbookStates[playbookID] = state
            }
            self.playbookTimeoutTasks.removeValue(forKey: playbookID)
        }
    }

    private static func extractOutputPath(from data: [String: OpenClawProtocol.AnyCodable]) -> String? {
        let candidateKeys = ["outputPath", "path", "artifactPath", "output_path", "artifact_path", "filePath"]
        for key in candidateKeys {
            if let value = data[key]?.value as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.lowercased().hasSuffix(".docx") || trimmed.lowercased().hasSuffix(".pptx") {
                    return trimmed
                }
            }
        }
        return nil
    }

    private func runPlaybook(_ playbook: AgentWorkbenchInstructionTemplate) async {
        self.runningPlaybookID = playbook.id
        defer { self.runningPlaybookID = nil }

        // Cancel any lingering timeout from a previous run.
        self.playbookTimeoutTasks[playbook.id]?.cancel()
        self.playbookTimeoutTasks.removeValue(forKey: playbook.id)

        let effectiveWorkspace = self.snapshot.effectiveWorkspace.trimmingCharacters(in: .whitespacesAndNewlines)
        let idempotencyKey = UUID().uuidString
        let instruction = """
        [LawMind Workflow Request]
        task: execute_workflow
        template_id: \(playbook.suggestedTemplateID)
        workspace: \(effectiveWorkspace)
        instruction: \(playbook.instruction)
        """

        if AppStateStore.shared.connectionMode == .local {
            GatewayProcessManager.shared.setActive(true)
        }
        let sessionKey = await GatewayConnection.shared.mainSessionKey()
        self.playbookStates[playbook.id] = PlaybookRunState(
            runId: nil,
            sessionKey: sessionKey,
            status: "queued",
            outputPath: nil,
            lastUpdated: Date())

        let ack = await GatewayConnection.shared.sendAgentWithAck(
            GatewayAgentInvocation(
                message: instruction,
                sessionKey: sessionKey,
                thinking: "default",
                deliver: false,
                to: nil,
                channel: .last,
                timeoutSeconds: 90,
                idempotencyKey: idempotencyKey))
        if ack.ok {
            self.playbookStates[playbook.id] = PlaybookRunState(
                runId: ack.runId,
                sessionKey: sessionKey,
                status: ack.status ?? "submitted",
                outputPath: nil,
                lastUpdated: Date())
            // Start a watchdog timer so stalled runs are surfaced to the user.
            self.schedulePlaybookTimeout(for: playbook.id)
            self.playbookResultMessage = "Playbook submitted. Check session \(sessionKey) for execution output."
            self.statusMessage = "Playbook started: \(playbook.title)"
        } else {
            self.playbookStates[playbook.id] = PlaybookRunState(
                runId: nil,
                sessionKey: sessionKey,
                status: "submit_failed",
                outputPath: nil,
                lastUpdated: Date())
            self.playbookResultMessage = "Playbook failed to submit: \(ack.error ?? "unknown error")"
        }
    }

    private func toggleUploadedTemplate(_ template: AgentWorkbenchTemplateEntry) {
        do {
            try AgentWorkbenchPreferences.setUploadedTemplateEnabled(
                workspacePath: self.snapshot.effectiveWorkspace,
                id: template.id,
                enabled: !template.enabled)
            self.reloadSnapshot(
                status: !template.enabled ? "Template enabled." : "Template disabled.")
        } catch {
            self.statusMessage = "Failed to update template state: \(error.localizedDescription)"
        }
    }

    private func copyText(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func reloadSnapshot(status: String = "") {
        let next = AgentWorkbenchPreferences.load()
        self.snapshot = next
        self.defaultWorkspaceInput = next.defaultWorkspace
        self.caseWorkspaceInput = next.caseWorkspaceOverride
        self.sessionWorkspaceInput = next.sessionWorkspaceOverride
        self.projectRootInput = next.projectRoot
        self.statusMessage = status
    }

    private var recentNonFavoriteWorkspaces: [String] {
        self.snapshot.recentWorkspaces.filter { !self.snapshot.favoriteWorkspaces.contains($0) }
    }

    private var filteredFavoriteWorkspaces: [String] {
        self.filterBySearch(self.snapshot.favoriteWorkspaces)
    }

    private var filteredRecentNonFavoriteWorkspaces: [String] {
        self.filterBySearch(self.recentNonFavoriteWorkspaces)
    }

    private var filteredRecentFiles: [String] {
        self.filterBySearch(self.snapshot.recentFiles)
    }

    private var filteredTemplates: [AgentWorkbenchTemplateEntry] {
        let query = self.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return self.snapshot.templates }
        return self.snapshot.templates.filter { item in
            item.id.lowercased().contains(query) ||
                item.label.lowercased().contains(query) ||
                item.format.lowercased().contains(query) ||
                item.source.lowercased().contains(query)
        }
    }

    private var filteredInstructionTemplates: [AgentWorkbenchInstructionTemplate] {
        let query = self.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return self.snapshot.instructionTemplates }
        return self.snapshot.instructionTemplates.filter { item in
            item.title.lowercased().contains(query) ||
                item.instruction.lowercased().contains(query) ||
                item.suggestedTemplateID.lowercased().contains(query)
        }
    }

    private var filteredActivityEntries: [AgentWorkbenchActivityEntry] {
        let query = self.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return self.snapshot.activityLog }
        return self.snapshot.activityLog.filter { item in
            item.action.lowercased().contains(query) || item.detail.lowercased().contains(query)
        }
    }

    private func filterBySearch(_ items: [String]) -> [String] {
        let query = self.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return items }
        return items.filter { $0.lowercased().contains(query) }
    }
}

private struct AgentWorkbenchTemplatePreview: View {
    let template: AgentWorkbenchTemplateEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Template Preview")
                .font(.title3.weight(.semibold))
            Text(template.label)
                .font(.headline)
            Text(template.id)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Label(template.format.uppercased(), systemImage: "doc.text")
                Label(template.source.capitalized, systemImage: "shippingbox")
                if let version = template.version {
                    Label("v\(version)", systemImage: "number")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            Text("Sample Output Structure")
                .font(.headline)
            Text(self.previewBody)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            if !template.placeholderMap.isEmpty {
                Text("Placeholder Mapping")
                    .font(.headline)
                Text(self.placeholderRenderingPreview)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(minWidth: 560, minHeight: 340, alignment: .topLeading)
    }

    private var previewBody: String {
        if template.format == "docx" {
            return """
            1) Title and Summary
            2) Findings and Legal Analysis
            3) Risk Notes and Action Items
            4) Citation references per section
            """
        }
        return """
        1) Title slide with audience and summary
        2) Core findings slides
        3) Evidence or risk timeline slide
        4) Review notes slide when needed
        """
    }

    private var placeholderRenderingPreview: String {
        let sampleContext: [String: String] = [
            "title": "某公司合同争议案件",
            "summary": "检索后认为争议焦点集中于违约责任条款和证据链完整性。",
            "sections": "要点1: 违约责任；要点2: 证据时序；要点3: 行动建议",
            "sections[0]": "要点1: 违约责任及法律依据",
        ]
        let lines = template.placeholderMap.sorted { $0.key < $1.key }.map { key, source in
            let rendered = sampleContext[source] ?? source
            return "{{\(key)}} -> \(rendered)"
        }
        return lines.joined(separator: "\n")
    }
}

#if DEBUG
struct AgentWorkbenchSettings_Previews: PreviewProvider {
    static var previews: some View {
        AgentWorkbenchSettings()
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}
#endif

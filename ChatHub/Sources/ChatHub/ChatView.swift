import SwiftUI
import AVFoundation

struct ChatView: View {
    let destination: ConversationDestination
    @EnvironmentObject var state: AppState
    @State private var messages: [any IdentifiableMessage] = []
    @State private var input = ""
    @State private var loading = false
    @State private var title = ""
    @State private var subtitle = ""
    // 编辑/上传/附件
    @State private var editingMessageId: String?
    @State private var editingText = ""
    @State private var editingAttachments: [Attachment] = []
    @State private var showEditSheet = false
    @State private var pendingAttachment: Attachment?     // 选完图先暂存
    @State private var showImagePicker = false
    @State private var showMentionList = false
    @State private var mentionQuery = ""
    @State private var mentionUsers: [SimpleUser] = []

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { msg in
                            MessageBubble(
                                message: msg, me: state.currentUser?.id,
                                onAddReaction: { emoji in Task { await addReaction(msgId: msg.id, emoji: emoji) } },
                                onToggleReaction: { emoji in Task { await removeReaction(msgId: msg.id, emoji: emoji) } },
                                onEdit: msg.authorId == state.currentUser?.id ? { startEdit(msg) } : nil
                            )
                            .id(msg.uiId)
                        }
                        if loading { ProgressView().padding() }
                    }
                    .padding(12)
                }
                .onChange(of: messages.count) { _ in
                    if let last = messages.last { withAnimation { proxy.scrollTo(last.uiId, anchor: .bottom) } }
                }
                .onReceive(NotificationCenter.default.publisher(for: .channelMessage)) { note in
                    if case .channelMessage(let cid, let m) = note.object as? WSEvent,
                       case .channel(let myId) = destination, cid == myId {
                        appendIfNew(m)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .dmMessage)) { note in
                    if case .dmMessage(let m, let withId) = note.object as? WSEvent,
                       case .dm(let myId) = destination {
                        // 我发的或对方发的，且对方就是当前会话
                        if m.senderId == myId || m.recipientId == myId || withId == myId {
                            appendIfNew(m)
                        }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .messageDeleted)) { note in
                    if case .messageDeleted(let cid, let mid) = note.object as? WSEvent,
                       case .channel(let myId) = destination, cid == myId {
                        messages.removeAll { $0.uiId == "m:" + mid }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .messageUpdatedChannel)) { note in
                    if case .messageUpdatedChannel(let cid, let m) = note.object as? WSEvent,
                       case .channel(let myId) = destination, cid == myId {
                        replaceMessage(m)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .messageUpdatedDM)) { note in
                    if case .messageUpdatedDM(let m, let withId) = note.object as? WSEvent,
                       case .dm(let myId) = destination {
                        if m.senderId == myId || m.recipientId == myId || withId == myId {
                            replaceMessage(m)
                        }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .reaction)) { note in
                    if case .reaction(let mid, let reactions, _) = note.object as? WSEvent {
                        updateReactions(messageId: mid, reactions: reactions)
                    }
                }
            }
            Divider()
            inputBar
        }
        .task { await loadHistory() }
    }

    var header: some View {
        HStack {
            switch destination {
            case .channel(let id):
                if let ch = state.channels.first(where: { $0.id == id }) {
                    Image(systemName: "number")
                    VStack(alignment: .leading, spacing: 1) {
                        Text(ch.name).font(.headline)
                        Text(ch.topic).font(.caption).foregroundStyle(.secondary)
                    }
                }
            case .dm(let uid):
                if let u = state.users.first(where: { $0.id == uid }) {
                    AvatarCircle(initials: u.displayName.initials, color: u.avatarColor.toColor(), size: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(u.displayName).font(.headline)
                        Text(state.onlineUserIds.contains(u.id) ? "在线" : "离线")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    var inputBar: some View {
        VStack(spacing: 6) {
            if let att = pendingAttachment {
                HStack(spacing: 8) {
                    AsyncImage(url: state.api.imageURL(att.key)) { img in img.resizable().scaledToFill() }
                        placeholder: { ProgressView() }
                        .frame(width: 56, height: 42)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    Text("图片附件").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button { pendingAttachment = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }.buttonStyle(.borderless)
                }
                .padding(.horizontal, 12)
            }
            // @提及浮层
            if showMentionList && !mentionUsers.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(mentionUsers.prefix(5), id: \.id) { u in
                        Button {
                            // 把 @query 替换成 @username + 空格
                            if let r = input.range(of: "@\(mentionQuery)", options: .backwards) {
                                input.replaceSubrange(r, with: "@\(u.username) ")
                            }
                            showMentionList = false
                        } label: {
                            HStack(spacing: 6) {
                                AvatarCircle(initials: u.displayName.initials, color: u.avatarColor.toColor(), size: 22)
                                Text(u.displayName).font(.subheadline)
                                Text("@\(u.username)").font(.caption2).foregroundStyle(.secondary)
                                if state.onlineUserIds.contains(u.id) {
                                    Circle().fill(.green).frame(width: 6, height: 6)
                                }
                            }
                            .padding(.horizontal, 10).padding(.vertical, 4)
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal, 12)
            }
            HStack(spacing: 8) {
                Button { showImagePicker = true } label: {
                    Image(systemName: "photo.on.rectangle").font(.title3)
                }
                .buttonStyle(.borderless)
                .help("发送图片")
                TextEditor(text: $input)
                    .font(.body)
                    .frame(minHeight: 30, maxHeight: 120)
                    .padding(6)
                    .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
                    .onChange(of: input) { newInput in
                        detectMention(in: newInput)
                    }
                Button { Task { await send() } } label: {
                    Image(systemName: "paperplane.fill").font(.title3)
                }
                .buttonStyle(.borderedProminent)
                .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && pendingAttachment == nil)
                .keyboardShortcut(.return, modifiers: [.command])
            }
        }
        .padding(12)
        .fileImporter(isPresented: $showImagePicker, allowedContentTypes: [.png, .jpeg, .image]) { result in
            guard case .success(let url) = result else { return }
            Task { await pickAndUpload(url: url) }
        }
        .sheet(isPresented: $showEditSheet) {
            EditMessageSheet(
                text: $editingText,
                attachments: $editingAttachments,
                onSave: { Task { await commitEdit() } },
                onCancel: { showEditSheet = false }
            )
        }
    }

    func detectMention(in text: String) {
        guard let at = text.lastIndex(of: "@") else { showMentionList = false; return }
        let after = text[at...].dropFirst()
        if after.contains(" ") || after.contains("\n") || after.count > 24 {
            showMentionList = false
            return
        }
        mentionQuery = String(after)
        let lower = mentionQuery.lowercased()
        mentionUsers = state.users.filter { $0.username.lowercased().hasPrefix(lower) && !$0.username.isEmpty }
        showMentionList = !mentionUsers.isEmpty
    }

    @MainActor func pickAndUpload(url: URL) async {
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let data = try Data(contentsOf: url)
            let mime = url.pathExtension.lowercased() == "jpg" || url.pathExtension.lowercased() == "jpeg" ? "image/jpeg" : "image/png"
            let r = try await state.api.uploadImage(data, mime: mime)
            // 用图片实际尺寸（简化：用 0，后端宽容）
            pendingAttachment = Attachment(type: "image", key: r.key, width: 0, height: 0)
        } catch { state.error = "图片上传失败：\(error.localizedDescription)" }
    }

    @MainActor func addReaction(msgId: String, emoji: String) async {
        do { let _ = try await state.api.addReaction(msgId, emoji: emoji) } catch {}
    }
    @MainActor func removeReaction(msgId: String, emoji: String) async {
        do { let _ = try await state.api.removeReaction(msgId, emoji: emoji) } catch {}
    }

    func startEdit(_ msg: any IdentifiableMessage) {
        editingMessageId = msg.id
        editingText = msg.content
        editingAttachments = msg.attachments
        showEditSheet = true
    }
    @MainActor func commitEdit() async {
        guard let id = editingMessageId else { return }
        let content = editingText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        showEditSheet = false
        do {
            switch destination {
            case .channel:
                let m = try await state.api.editChannelMessage(id, content: content, attachments: editingAttachments)
                replaceMessage(m)
            case .dm:
                let m = try await state.api.editDM(id, content: content, attachments: editingAttachments)
                replaceMessage(m)
            }
        } catch { state.error = "编辑失败：\(error.localizedDescription)" }
        editingMessageId = nil
    }

    @MainActor func replaceMessage(_ m: ChannelMessage) {
        if let i = messages.firstIndex(where: { $0.uiId == "m:" + m.id }) {
            messages[i] = .channel(m)
        }
    }
    @MainActor func replaceMessage(_ m: DMMessage) {
        if let i = messages.firstIndex(where: { $0.uiId == "m:" + m.id }) {
            messages[i] = .dm(m)
        }
    }
    @MainActor func updateReactions(messageId: String, reactions: [Reaction]) {
        guard let i = messages.firstIndex(where: { $0.uiId == "m:" + messageId }) else { return }
        // 因为 protocol 暴露的是 get-only，这里通过类型转换原地替换
        if var m = messages[i] as? ChannelMessage {
            m.reactions = reactions
            messages[i] = .channel(m)
        } else if var m = messages[i] as? DMMessage {
            m.reactions = reactions
            messages[i] = .dm(m)
        }
    }

    @MainActor func loadHistory() async {
        loading = true; defer { loading = false }
        if state.users.isEmpty { await state.loadUsers() }
        do {
            switch destination {
            case .channel(let id):
                let list = try await state.api.channelMessages(id)
                messages = list.map { .channel($0) }
                title = state.channels.first(where: { $0.id == id })?.name ?? ""
            case .dm(let uid):
                let list = try await state.api.dmMessages(uid)
                messages = list.map { .dm($0) }
            }
        } catch { state.error = error.localizedDescription }
    }

    @MainActor func send() async {
        let content = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let att = pendingAttachment
        guard !content.isEmpty || att != nil else { return }
        input = ""
        pendingAttachment = nil
        do {
            let attachments = att.map { [$0] } ?? []
            switch destination {
            case .channel(let id):
                let m = try await state.api.sendChannelMessage(id, content: content, attachments: attachments)
                appendIfNew(m)
            case .dm(let uid):
                let m = try await state.api.sendDM(uid, content: content, attachments: attachments)
                appendIfNew(m)
            }
        } catch let e as APIError {
            state.error = e.errorDescription
        } catch { state.error = error.localizedDescription }
    }

    @MainActor func appendIfNew(_ m: ChannelMessage) {
        if !messages.contains(where: { $0.uiId == "m:" + m.id }) {
            messages.append(.channel(m))
            if state.currentUser?.notifySound == true { ding() }
        }
    }
    @MainActor func appendIfNew(_ m: DMMessage) {
        if !messages.contains(where: { $0.uiId == "m:" + m.id }) {
            messages.append(.dm(m))
            if state.currentUser?.notifySound == true { ding() }
        }
    }
    func ding() {
        guard state.currentUser?.notifySound == true else { return }
        NSSound.beep()
    }
}

// 编辑消息弹窗
struct EditMessageSheet: View {
    @Binding var text: String
    @Binding var attachments: [Attachment]
    var onSave: () -> Void
    var onCancel: () -> Void
    @EnvironmentObject var state: AppState

    var body: some View {
        VStack(spacing: 12) {
            Text("编辑消息").font(.headline)
            TextEditor(text: $text)
                .font(.body)
                .frame(minHeight: 80, maxHeight: 200)
                .padding(6)
                .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
            // 既有图片附件预览
            if !attachments.isEmpty {
                HStack(spacing: 6) {
                    ForEach(attachments.filter(\.isImage)) { att in
                        AsyncImage(url: state.api.imageURL(att.key)) { img in img.resizable().scaledToFill() }
                            placeholder: { ProgressView() }
                            .frame(width: 56, height: 42)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                    Spacer()
                }
            }
            HStack(spacing: 12) {
                Button("取消") { onCancel() }
                    .keyboardShortcut(.cancelAction)
                Button("保存") { onSave() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}

protocol IdentifiableMessage: Identifiable {
    var uiId: String { get }
    var content: String { get }
    var createdAt: Double { get }
    var author: Author { get }
    var authorId: String { get }
    var isOutgoing: Bool { get }
    var attachments: [Attachment] { get }
    var reactions: [Reaction] { get }
    var updateTime: Double? { get }
}

extension ChannelMessage: IdentifiableMessage {
    var uiId: String { "m:" + id }
    var authorId: String { authorId }
    var isOutgoing: Bool { false }
}
extension DMMessage: IdentifiableMessage {
    var uiId: String { "m:" + id }
    var authorId: String { senderId }
    var isOutgoing: Bool { isOutgoing }
}

extension Array where Element == any IdentifiableMessage {
    static func == (lhs: Array<Element>, rhs: ChannelMessage) -> Bool { false }
}

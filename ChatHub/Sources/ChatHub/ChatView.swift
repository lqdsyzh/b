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

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { msg in
                            MessageBubble(message: msg, me: state.currentUser?.id)
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
        HStack(spacing: 8) {
            TextEditor(text: $input)
                .font(.body)
                .frame(minHeight: 30, maxHeight: 120)
                .padding(6)
                .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
            Button { Task { await send() } } label: {
                Image(systemName: "paperplane.fill")
                    .font(.title3)
            }
            .buttonStyle(.borderedProminent)
            .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .keyboardShortcut(.return, modifiers: [.command])
        }
        .padding(12)
    }

    @MainActor func loadHistory() async {
        loading = true; defer { loading = false }
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
        guard !content.isEmpty else { return }
        input = ""
        do {
            switch destination {
            case .channel(let id):
                let m = try await state.api.sendChannelMessage(id, content: content)
                appendIfNew(m)
            case .dm(let uid):
                let m = try await state.api.sendDM(uid, content: content)
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

protocol IdentifiableMessage: Identifiable {
    var uiId: String { get }
    var content: String { get }
    var createdAt: Double { get }
    var author: Author { get }
    var isOutgoing: Bool { get }
}

extension ChannelMessage: IdentifiableMessage {
    var uiId: String { "m:" + id }
    var isOutgoing: Bool { false }
}
extension DMMessage: IdentifiableMessage {
    var uiId: String { "m:" + id }
    var isOutgoing: Bool { isOutgoing }
}

extension Array where Element == any IdentifiableMessage {
    static func == (lhs: Array<Element>, rhs: ChannelMessage) -> Bool { false }
}

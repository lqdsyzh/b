import SwiftUI

struct MessageBubble: View {
    let message: any IdentifiableMessage
    let me: String?
    var onAddReaction: ((String) -> Void)? = nil
    var onToggleReaction: ((String) -> Void)? = nil
    var onEdit: (() -> Void)? = nil
    @EnvironmentObject var state: AppState

    @State private var largeImageKey: String?

    private var outgoing: Bool {
        if let m = message as? DMMessage { return m.isOutgoing }
        return message.author.id == me
    }
    private var canEdit: Bool {
        guard let me = me, let onEdit = onEdit else { return false }
        return message.authorId == me && message.updateTime == nil && onEdit != nil
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if outgoing { Spacer(minLength: 60) }
            AvatarCircle(initials: message.author.displayName.initials,
                         color: message.author.avatarColor.toColor(), size: 30)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(message.author.displayName).font(.subheadline.bold())
                    Text(AppDate.time(message.createdAt)).font(.caption2).foregroundStyle(.secondary)
                    if message.updateTime != nil {
                        Text("已编辑").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                contentBlockView
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(outgoing ? Color.accentColor.opacity(0.15) : Color.gray.opacity(0.12),
                                in: RoundedRectangle(cornerRadius: 10))
                // 附件图片
                if !message.attachments.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(message.attachments.filter(\.isImage)) { att in
                            AsyncImage(url: state.api.imageURL(att.key)) { img in
                                img.resizable().scaledToFill()
                            } placeholder: {
                                RoundedRectangle(cornerRadius: 6).fill(.quaternary).frame(width: 120, height: 90)
                            }
                            .frame(width: 120, height: 90)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            .onTapGesture { largeImageKey = att.key }
                            .popover(isPresented: Binding(
                                get: { largeImageKey == att.key },
                                set: { if !$0 { largeImageKey = nil } }
                            )) {
                                AsyncImage(url: state.api.imageURL(att.key)) { img in
                                    img.resizable().scaledToFit()
                                } placeholder: { ProgressView() }
                                .padding(12)
                                .frame(maxWidth: 600, maxHeight: 500)
                            }
                        }
                    }
                }
                // 表情回复行
                if !message.reactions.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(message.reactions) { r in
                            Button {
                                if r.contains(me ?? "") { onToggleReaction?(r.emoji) }
                                else { onAddReaction?(r.emoji) }
                            } label: {
                                HStack(spacing: 3) {
                                    Text(r.emoji)
                                    Text("\(r.count)").font(.caption2.bold())
                                }
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(
                                    r.contains(me ?? "") ? Color.accentColor.opacity(0.25) : Color.gray.opacity(0.15),
                                    in: Capsule()
                                )
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
            if !outgoing { Spacer(minLength: 60) }
        }
        // 右键菜单：添加表情、编辑
        .contextMenu {
            Menu("添加表情") {
                ForEach(["👍", "❤️", "🎉", "😂", "🚀", "👀", "✅"], id: \.self) { e in
                    Button(e) { onAddReaction?(e) }
                }
            }
            if canEdit {
                Divider()
                Button("编辑消息") { onEdit?() }
            }
        }
    }

    @ViewBuilder var contentBlockView: some View {
        let blocks = MiniMarkdown.split(message.content)
        VStack(alignment: .leading, spacing: 6) {
            ForEach(blocks) { b in
                switch b {
                case .text(let t): Text(t).textSelection(.enabled).font(.body).fixedSize(horizontal: false, vertical: true)
                case .code(let c, let lang):
                    CodeBlockView(code: c, lang: lang)
                }
            }
        }
    }
}

struct CodeBlockView: View {
    let code: String
    let lang: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(lang.isEmpty ? "代码" : lang).font(.caption2.monospaced()).foregroundStyle(.secondary)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    withAnimation { copied = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { withAnimation { copied = false } }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.caption2)
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.quaternary.opacity(0.5))

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
            }
            .background(Color.black.opacity(0.6))
            .cornerRadius(0)
        }
        .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var state: AppState
    @State private var section: SidebarSection = .chat
    @State private var chatDest: ConversationDestination?

    var body: some View {
        NavigationSplitView {
            SidebarView(section: $section, chatDest: $chatDest)
                .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        } detail: {
            switch section {
            case .chat:
                if let dest = chatDest { ChatView(destination: dest) }
                else { placeholder("选择一个频道或好友开始聊天", icon: "bubble.left.and.bubble.right") }
            case .qna:
                QnAView()
            case .admin:
                AdminView()
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { state.settingsOpen = true } label: {
                    Image(systemName: "gearshape")
                }.help("设置")
            }
            ToolbarItem {
                if let me = state.currentUser {
                    HStack(spacing: 8) {
                        AvatarCircle(initials: me.displayName.initials, color: me.avatarColor.toColor(), size: 22)
                        Text(me.displayName).font(.callout)
                        if me.isAdmin {
                            Text("管理员").font(.caption2)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.accentColor.opacity(0.2), in: Capsule())
                                .foregroundStyle(.tint)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $state.settingsOpen) { SettingsView() }
    }

    func placeholder(_ text: String, icon: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 44)).foregroundStyle(.secondary)
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct SidebarView: View {
    @EnvironmentObject var state: AppState
    @Binding var section: SidebarSection
    @Binding var chatDest: ConversationDestination?

    var body: some View {
        List(selection: $section) {
            Section {
                Label("聊天", systemImage: "bubble.left.fill").tag(SidebarSection.chat)
            } header: { Text("社区") }

            if section == .chat {
                channelsSection
                dmSection
            }

            Section {
                Label("问答区", systemImage: "questionmark.bubble.fill").tag(SidebarSection.qna)
            }
            if state.currentUser?.isAdmin == true {
                Section {
                    Label("管理后台", systemImage: "shield.lefthalf.filled").tag(SidebarSection.admin)
                }
            }
        }
        .listStyle(.sidebar)
    }

    var channelsSection: some View {
        Section("频道（按爱好分类）") {
            let grouped = Dictionary(grouping: state.channels, by: { $0.category })
            ForEach(grouped.keys.sorted(), id: \.self) { cat in
                DisclosureGroup {
                    ForEach(grouped[cat] ?? []) { ch in
                        Button {
                            chatDest = .channel(ch.id)
                        } label: {
                            HStack {
                                Image(systemName: "number")
                                Text(ch.name)
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(chatDest == .channel(ch.id) ? Color.accentColor.opacity(0.15) : Color.clear)
                    }
                } label: {
                    Label(categoryName(cat), systemImage: categoryIcon(cat))
                        .font(.subheadline.bold())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    var dmSection: some View {
        Section("成员（点人私聊）") {
            ForEach(state.users.filter { $0.id != state.currentUser?.id }) { u in
                Button {
                    chatDest = .dm(u.id)
                } label: {
                    HStack(spacing: 8) {
                        AvatarCircle(initials: u.displayName.initials, color: u.avatarColor.toColor(), size: 22)
                        Text(u.displayName).lineLimit(1)
                        Spacer()
                        if state.onlineUserIds.contains(u.id) {
                            Circle().fill(.green).frame(width: 8, height: 8)
                        } else {
                            Circle().fill(.secondary).frame(width: 8, height: 8)
                        }
                    }
                }
                .buttonStyle(.plain)
                .listRowBackground(chatDest == .dm(u.id) ? Color.accentColor.opacity(0.15) : Color.clear)
            }
        }
    }

    func categoryName(_ cat: String) -> String {
        switch cat {
        case "programming": return "编程"
        case "design": return "设计"
        case "life": return "生活"
        default: return "社区"
        }
    }
    func categoryIcon(_ cat: String) -> String {
        switch cat {
        case "programming": return "chevron.left.forwardslash.chevron.right"
        case "design": return "paintbrush"
        case "life": return "cup.and.saucer"
        default: return "globe"
        }
    }
}

// MARK: - 头像圆
struct AvatarCircle: View {
    let initials: String; let color: Color; let size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(color)
            Text(initials).font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

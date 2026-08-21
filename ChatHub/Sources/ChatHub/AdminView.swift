import SwiftUI

struct AdminView: View {
    @EnvironmentObject var state: AppState
    @State private var stats: AdminStats?
    @State private var users: [SimpleUser] = []
    @State private var loading = false
    @State private var banReason = ""
    @State private var banningUser: SimpleUser?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("管理后台", systemImage: "shield.lefthalf.filled").font(.title.bold())
                Spacer()
                Button { Task { await reload() } } label: { Label("刷新", systemImage: "arrow.clockwise") }
            }
            .padding()
            Divider()

            if loading { ProgressView().padding(40) }
            else if let stats = stats {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // 统计卡片
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 12)], spacing: 12) {
                            StatCard("注册用户", value: stats.users, icon: "person.2.fill", color: .blue)
                            StatCard("当前在线", value: stats.online, icon: "antenna.radiowaves.left.and.right", color: .green)
                            StatCard("频道", value: stats.channels, icon: "number", color: .purple)
                            StatCard("频道消息", value: stats.channelMessages, icon: "bubble.left.fill", color: .orange)
                            StatCard("私信", value: stats.dmMessages, icon: "envelope.fill", color: .pink)
                            StatCard("问题", value: stats.questions, icon: "questionmark.bubble.fill", color: .teal)
                            StatCard("回答", value: stats.answers, icon: "text.bubble.fill", color: .indigo)
                            StatCard("封禁用户", value: stats.banned, icon: "person.crop.circle.badge.exclamationmark", color: .red)
                        }

                        // 最近登录用户
                        VStack(alignment: .leading, spacing: 8) {
                            Text("最近登录").font(.headline)
                            if stats.recentLogins.isEmpty {
                                Text("暂无登录记录").foregroundStyle(.secondary).font(.callout)
                            } else {
                                ForEach(stats.recentLogins) { u in
                                    HStack {
                                        AvatarCircle(initials: u.displayName.initials, color: u.avatarColor.toColor(), size: 26)
                                        Text(u.displayName).font(.subheadline)
                                        Spacer()
                                        Text("上次登录 " + AppDate.relative(u.lastLoginAt))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    .padding(.vertical, 4)
                                }
                            }
                        }

                        // 用户管理
                        VStack(alignment: .leading, spacing: 8) {
                            Text("用户管理（共 \(users.count) 人）").font(.headline)
                            ForEach(users) { u in
                                UserAdminRow(u: u, onBan: { banningUser = u })
                            }
                        }
                    }
                    .padding()
                }
            } else {
                Text("加载中…").foregroundStyle(.secondary).padding(40)
            }
        }
        .task { await reload() }
        .sheet(item: $banningUser) { u in
            BanSheet(user: u) { reason in Task { await ban(u.id, reason: reason) } }
        }
    }

    @MainActor func reload() async {
        loading = true; defer { loading = false }
        do { stats = try await state.api.adminStats(); users = try await state.api.adminUsers() }
        catch { state.error = error.localizedDescription }
    }
    @MainActor func ban(_ id: String, reason: String) async {
        do { try await state.api.banUser(id, reason: reason); await reload() }
        catch { state.error = error.localizedDescription }
    }
}

struct StatCard: View {
    let title: String; let value: Int; let icon: String; let color: Color
    init(_ title: String, value: Int, icon: String, color: Color) {
        self.title = title; self.value = value; self.icon = icon; self.color = color
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).foregroundStyle(color).font(.title3)
            Text("\(value)").font(.title.bold())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.background, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
    }
}

struct UserAdminRow: View {
    let u: SimpleUser
    let onBan: () -> Void
    var body: some View {
        HStack(spacing: 10) {
            AvatarCircle(initials: u.displayName.initials, color: u.avatarColor.toColor(), size: 28)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(u.displayName).font(.subheadline.bold())
                    if u.isAdmin {
                        Text("管理员").font(.caption2)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color.accentColor.opacity(0.2), in: Capsule())
                            .foregroundStyle(.tint)
                    }
                }
                Text("@\(u.username) · 注册于 " + AppDate.relative(u.createdAt))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if u.online { Text("在线").font(.caption).foregroundStyle(.green) }
            if !u.isAdmin {
                Button(role: .destructive, action: onBan) {
                    Label("封禁", systemImage: "hand.raised.fill")
                }
                .buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}

struct BanSheet: View {
    let user: SimpleUser
    let onSubmit: (String) -> Void
    @Environment(\.dismiss) var dismiss
    @State private var reason = ""
    var body: some View {
        VStack(spacing: 16) {
            Text("封禁用户").font(.headline)
            Text("将封禁 @\(user.username)，对方立即下线且无法登录、无法发言。")
                .font(.callout).foregroundStyle(.secondary)
            TextField("封禁理由（可选）", text: $reason).textFieldStyle(.roundedBorder)
            HStack {
                Button("取消") { dismiss() }
                Spacer()
                Button(role: .destructive) { onSubmit(reason); dismiss() } label: {
                    Label("确认封禁", systemImage: "hand.raised.fill")
                }
            }
        }
        .padding()
        .frame(width: 420)
    }
}

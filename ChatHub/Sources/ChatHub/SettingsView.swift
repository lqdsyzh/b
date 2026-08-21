import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) var dismiss
    @State private var displayName = ""
    @State private var avatarColor = "#1E88E5"
    @State private var theme = "system"
    @State private var showOnline = true
    @State private var notifySound = true
    @State private var curPwd = ""; @State private var newPwd = ""
    @State private var busy = false
    @State private var error: String?
    @State private var showDeleteConfirm = false

    let colors = ["#E53935","#D81B60","#8E24AA","#5E35B1","#3949AB","#1E88E5","#039BE5","#00ACC1","#00897B","#43A047","#7CB342","#FB8C00","#F4511E","#6D4C41"]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("设置").font(.title.bold())
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless).foregroundStyle(.secondary)
            }
            .padding()
            Divider()

            Form {
                Section("资料") {
                    TextField("昵称", text: $displayName)
                    HStack {
                        ForEach(colors, id: \.self) { c in
                            Circle().fill(c.toColor()).frame(width: 24, height: 24)
                                .overlay(avatarColor == c ? Circle().stroke(.white, lineWidth: 2) : nil)
                                .onTapGesture { avatarColor = c }
                        }
                    }
                    Button {
                        Task { await saveProfile() }
                    } label: { if busy { ProgressView() } else { Label("保存资料", systemImage: "checkmark.circle") } }
                        .buttonStyle(.borderedProminent)
                }
                Section("外观与通知") {
                    Picker("主题", selection: $theme) {
                        Text("跟随系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark")
                    }
                    Toggle("对他人显示我在线", isOn: $showOnline)
                    Toggle("新消息提示音", isOn: $notifySound)
                    Button {
                        Task { await saveSettings() }
                    } label: { Label("保存设置", systemImage: "checkmark.circle") }
                        .buttonStyle(.borderedProminent)
                }
                Section("修改密码") {
                    SecureField("当前密码", text: $curPwd)
                    SecureField("新密码（≥6 位）", text: $newPwd)
                    Button {
                        Task { await changePwd() }
                    } label: { Label("修改密码", systemImage: "key.fill") }
                        .buttonStyle(.bordered)
                        .disabled(curPwd.isEmpty || newPwd.count < 6)
                }
                Section {
                    Button(role: .destructive) {
                        Task { await logout() }
                    } label: { Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right") }
                    Button(role: .destructive) { showDeleteConfirm = true } label: {
                        Label("注销账号（永久删除）", systemImage: "trash.fill")
                    }
                }
            }
            .formStyle(.grouped)
        }
        .frame(width: 520, height: 640)
        .onAppear { loadFromUser() }
        .alert("确认注销账号？", isPresented: $showDeleteConfirm) {
            Button("取消", role: .cancel) {}
            Button("永久删除", role: .destructive) { Task { await deleteAccount() } }
        } message: { Text("此操作不可恢复，你所有消息、提问、回答都将保留（脱去作者归属后留存历史）。") }
        .alert("出错了", isPresented: Binding(get: { error != nil }, set: { _ in error = nil })) {
            Button("好") { error = nil }
        } message: { Text(error ?? "") }
    }

    func loadFromUser() {
        guard let u = state.currentUser else { return }
        displayName = u.displayName
        avatarColor = u.avatarColor
        theme = u.theme
        showOnline = u.showOnline
        notifySound = u.notifySound
    }
    @MainActor func saveProfile() async {
        busy = true; defer { busy = false }
        do { let u = try await state.api.updateProfile(displayName: displayName, avatarColor: avatarColor); state.currentUser = u }
        catch let e as APIError { error = e.errorDescription }
    }
    @MainActor func saveSettings() async {
        busy = true; defer { busy = false }
        do { let u = try await state.api.updateSettings(theme: theme, showOnline: showOnline, notifySound: notifySound)
            state.currentUser = u; state.theme = theme; await state.loadUsers() }
        catch let e as APIError { error = e.errorDescription }
    }
    @MainActor func changePwd() async {
        busy = true; defer { busy = false }
        do { let r = try await state.api.changePassword(current: curPwd, new: newPwd)
            state.api.token = r.token; UserDefaults.standard.set(r.token, forKey: "token")
            state.currentUser = r.user; curPwd = ""; newPwd = ""; error = "密码已修改" }
        catch let e as APIError { error = e.errorDescription }
    }
    @MainActor func logout() async { state.logout(); dismiss() }
    @MainActor func deleteAccount() async {
        busy = true; defer { busy = false }
        do { try await state.api.deleteAccount(confirm: true); state.logoutLocally(); dismiss() }
        catch let e as APIError { error = e.errorDescription }
    }
}

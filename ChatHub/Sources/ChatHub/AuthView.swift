import SwiftUI

struct AuthView: View {
    @EnvironmentObject var state: AppState
    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var busy = false
    @State private var error: String?

    enum Mode { case login, register
        var title: String { self == .login ? "登录" : "注册" }
        var toggle: String { self == .login ? "没有账号？去注册" : "已有账号？去登录" }
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 18) {
                // Logo
                VStack(spacing: 8) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(.tint)
                    Text("ChatHub").font(.largeTitle.bold())
                    Text("为聊天而建的编程社区")
                        .font(.subheadline).foregroundStyle(.secondary)
                }

                VStack(spacing: 12) {
                    if mode == .register {
                        FieldRow(icon: "person.text.square", placeholder: "昵称（可留空）", text: $displayName)
                    }
                    FieldRow(icon: "at", placeholder: "用户名", text: $username)
                        .autocorrectionDisabled()
                    SecureFieldRow(icon: "lock", placeholder: "密码（至少 6 位）", text: $password)

                    if let error = error {
                        Text(error).font(.caption).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        submit()
                    } label: {
                        if busy { ProgressView().tint(.white) }
                        else { Text(mode.title).bold() }
                        Spacer().frame(width: 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(busy || username.isEmpty || password.isEmpty)
                    .keyboardShortcut(.return, modifiers: [])
                }
                .padding(20)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))

                Button(mode.toggle) { withAnimation { mode = (mode == .login ? .register : .login); error = nil } }
                    .buttonStyle(.link)
            }
            .padding(40)
            .frame(maxWidth: 460)
            Spacer()
            VStack(spacing: 4) {
                Text("首任管理员：用户名注册为 `admin` 即自动成为管理员")
                Text("第三方登录（GitHub OAuth）暂未接入，留有接口").foregroundStyle(.secondary)
            }
            .font(.caption2).foregroundStyle(.secondary).padding()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func submit() {
        busy = true; error = nil
        Task {
            do {
                let r: APIClient.AuthResponse
                if mode == .register {
                    r = try await state.api.register(username: username, password: password, displayName: displayName.isEmpty ? nil : displayName)
                } else {
                    r = try await state.api.login(username: username, password: password)
                }
                await MainActor.run { state.login(token: r.token, user: r.user) }
            } catch let e as APIError {
                await MainActor.run { error = e.errorDescription; busy = false }
            } catch {
                await MainActor.run { self.error = error.localizedDescription; busy = false }
            }
        }
    }
}

struct FieldRow: View {
    let icon: String; let placeholder: String; @Binding var text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(.secondary).frame(width: 18)
            TextField(placeholder, text: $text).textFieldStyle(.plain)
        }
        .padding(10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }
}
struct SecureFieldRow: View {
    let icon: String; let placeholder: String; @Binding var text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(.secondary).frame(width: 18)
            SecureField(placeholder, text: $text).textFieldStyle(.plain)
        }
        .padding(10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }
}

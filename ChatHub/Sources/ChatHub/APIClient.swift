import Foundation
import SwiftUI

// MARK: - API 客户端
enum APIError: LocalizedError {
    case http(Int, String)
    case network(Error)
    case decode(Error)
    var errorDescription: String? {
        switch self {
        case .http(let c, let m): return "\(m) (\(c))"
        case .network(let e): return e.localizedDescription
        case .decode(let e): return "数据解析失败: \(e.localizedDescription)"
        }
    }
}

final class APIClient {
    let baseURL: URL
    var token: String?

    init(baseURL: URL = URL(string: "http://localhost:8787")!) {
        self.baseURL = baseURL
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Any? = nil) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let t = token { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        if let body = body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError.http(0, "无响应") }
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            if !(200..<300).contains(http.statusCode) {
                let msg = (try? decoder.decode([String: String].self, from: data))?["error"] ?? "未知错误"
                throw APIError.http(http.statusCode, msg)
            }
            return try decoder.decode(T.self, from: data)
        } catch let e as APIError { throw e }
        catch let e as DecodingError { throw APIError.decode(e) }
        catch { throw APIError.network(error) }
    }

    // —— 鉴权 ——
    struct AuthResponse: Codable { let token: String; let user: User }
    func register(username: String, password: String, displayName: String?) async throws -> AuthResponse {
        var body: [String: Any] = ["username": username, "password": password]
        if let dn = displayName { body["display_name"] = dn }
        return try await request("/api/register", method: "POST", body: body)
    }
    func login(username: String, password: String) async throws -> AuthResponse {
        try await request("/api/login", method: "POST", body: ["username": username, "password": password])
    }
    func logout() async { try? await request("/api/me/logout", method: "POST", body: [:]) as EmptyResponse }

    // —— me ——
    struct UserResponse: Codable { let user: User }
    func me() async throws -> User { try await request("/api/me").user }
    func updateProfile(displayName: String, avatarColor: String) async throws -> User {
        try await request("/api/me/profile", method: "PUT", body: ["display_name": displayName, "avatar_color": avatarColor]).user
    }
    func updateSettings(theme: String, showOnline: Bool, notifySound: Bool) async throws -> User {
        try await request("/api/me/settings", method: "PUT", body: ["theme": theme, "show_online": showOnline, "notify_sound": notifySound]).user
    }
    func changePassword(current: String, new: String) async throws -> AuthResponse {
        try await request("/api/me/password", method: "PUT", body: ["current_password": current, "new_password": new])
    }
    func deleteAccount(confirm: Bool) async throws { try await request("/api/me", method: "DELETE", body: ["confirm": confirm]) as EmptyResponse }

    // —— 频道/用户 ——
    struct ChannelsResponse: Codable { let channels: [Channel] }
    func channels() async throws -> [Channel] { try await request("/api/channels").channels }
    struct UsersResponse: Codable { let users: [SimpleUser] }
    func users() async throws -> [SimpleUser] { try await request("/api/users").users }

    // —— 频道消息 ——
    struct MessagesResponse: Codable { let messages: [ChannelMessage] }
    func channelMessages(_ channelId: String, before: Double? = nil) async throws -> [ChannelMessage] {
        var path = "/api/channels/\(channelId)/messages?limit=50"
        if let b = before { path += "&before=\(Int(b))" }
        return try await request(path).messages
    }
    struct MessageResponse: Codable { let message: ChannelMessage }
    func sendChannelMessage(_ channelId: String, content: String) async throws -> ChannelMessage {
        try await request("/api/channels/\(channelId)/messages", method: "POST", body: ["content": content]).message
    }

    // —— DM ——
    struct DMMessagesResponse: Codable { let messages: [DMMessage] }
    func dmMessages(_ userId: String, before: Double? = nil) async throws -> [DMMessage] {
        var path = "/api/dms/\(userId)/messages?limit=50"
        if let b = before { path += "&before=\(Int(b))" }
        return try await request(path).messages
    }
    struct DMResponse: Codable { let message: DMMessage }
    func sendDM(_ userId: String, content: String) async throws -> DMMessage {
        try await request("/api/dms/\(userId)/messages", method: "POST", body: ["content": content]).message
    }

    // —— 问答 ——
    struct QuestionsResponse: Codable { let questions: [Question] }
    func questions(tag: String? = nil, page: Int = 0) async throws -> [Question] {
        var path = "/api/questions?page=\(page)&limit=30"
        if let t = tag { path += "&tag=\(t)" }
        return try await request(path).questions
    }
    struct QuestionResponse: Codable { let question: Question; let answers: [Answer] }
    func questionDetail(_ id: String) async throws -> (Question, [Answer]) {
        let r = try await request("/api/questions/\(id)"); return (r.question, r.answers)
    }
    struct CreatedQuestion: Codable { let question: Question }
    func askQuestion(title: String, body: String, tags: [String]) async throws -> Question {
        try await request("/api/questions", method: "POST", body: ["title": title, "body": body, "tags": tags]).question
    }
    struct CreatedAnswer: Codable { let answer: Answer }
    func answerQuestion(_ qid: String, body: String) async throws -> Answer {
        try await request("/api/questions/\(qid)/answers", method: "POST", body: ["body": body]).answer
    }
    struct AcceptedAnswer: Codable { let answer: Answer }
    func acceptAnswer(_ aid: String) async throws -> Answer {
        try await request("/api/answers/\(aid)/accept", method: "POST", body: [:]).answer
    }

    // —— 管理后台 ——
    struct StatsResponse: Codable { let stats: AdminStats }
    func adminStats() async throws -> AdminStats { try await request("/api/admin/stats").stats }
    struct AdminUsers: Codable { let users: [SimpleUser] }
    func adminUsers() async throws -> [SimpleUser] { try await request("/api/admin/users").users }
    func banUser(_ id: String, reason: String) async throws {
        try await request("/api/admin/users/\(id)/ban", method: "POST", body: ["reason": reason]) as EmptyResponse
    }
    func unbanUser(_ id: String) async throws {
        try await request("/api/admin/users/\(id)/unban", method: "POST", body: [:]) as EmptyResponse
    }
    func deleteMessage(_ id: String) async throws {
        try await request("/api/admin/messages/\(id)", method: "DELETE") as EmptyResponse
    }
    func deleteQuestion(_ id: String) async throws {
        try await request("/api/admin/questions/\(id)", method: "DELETE") as EmptyResponse
    }
    func deleteAnswer(_ id: String) async throws {
        try await request("/api/admin/answers/\(id)", method: "DELETE") as EmptyResponse
    }
}

struct EmptyResponse: Codable {}

// MARK: - WebSocket 客户端
enum WSEvent {
    case hello(User, [String])
    case channelMessage(String, ChannelMessage)
    case dmMessage(DMMessage, String)   // message, withUserId
    case presence([String])
    case question(Question)
    case answer(String, Answer)         // questionId, answer
    case answerAccepted(String, String, Answer)
    case messageDeleted(String, String) // channelId, messageId
}

final class WSClient: NSObject {
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    var onEvent: ((WSEvent) -> Void)?
    var onConnect: (() -> Void)?
    var onDisconnect: (() -> Void)?

    func connect(baseURL: URL, token: String) {
        task?.cancel()
        var comps = URLComponents(url: baseURL.appendingPathComponent("/ws"), resolvingAgainstBaseURL: false)!
        comps.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let wsURL = comps.url else { return }
        let t = session.webSocketTask(with: wsURL)
        self.task = t
        t.resume()
        listen()
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self = self, let task = self.task else { return }
            switch result {
            case .success(let msg):
                switch msg {
                case .data(let d): self.handle(d)
                case .string(let s): self.handle(Data(s.utf8))
                @unknown default: break
                }
                self.listen()
            case .failure:
                self.onDisconnect?()
                DispatchQueue.global().asyncAfter(deadline: .now() + 2) { self.connectIfNeeded() }
            }
            _ = task
        }
    }
    private func connectIfNeeded() { if let t = tokenStorage { connect(baseURL: apiBase, token: t) } }
    var tokenStorage: String? = nil
    var apiBase: URL = URL(string: "http://localhost:8787")!

    func reconnect() {
        if let t = tokenStorage { connect(baseURL: apiBase, token: t) }
    }
    private func handle(_ data: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }
        do {
            let dec = JSONDecoder(); dec.keyDecodingStrategy = .convertFromSnakeCase
            switch type {
            case "hello":
                let r = try dec.decode(HelloPayload.self, from: data)
                onEvent?(.hello(r.user, r.onlineUserIds))
            case "message":
                if obj["scope"] as? String == "channel" {
                    let r = try dec.decode(ChannelMsgPayload.self, from: data)
                    onEvent?(.channelMessage(r.channelId!, r.message))
                } else {
                    let r = try dec.decode(DMPayload.self, from: data)
                    onEvent?(.dmMessage(r.message, r.withUserId ?? ""))
                }
            case "presence":
                let r = try dec.decode(PresencePayload.self, from: data)
                onEvent?(.presence(r.onlineUserIds))
            case "question":
                let r = try dec.decode(QPayload.self, from: data)
                onEvent?(.question(r.question))
            case "answer":
                let r = try dec.decode(APayload.self, from: data)
                onEvent?(.answer(r.questionId!, r.answer))
            case "answer_accepted":
                let r = try dec.decode(AcceptedPayload.self, from: data)
                onEvent?(.answerAccepted(r.questionId!, r.answerId!, r.answer))
            case "message_deleted":
                let r = try dec.decode(DeletedPayload.self, from: data)
                onEvent?(.messageDeleted(r.channelId!, r.messageId!))
            default: break
            }
        } catch { /* ignore */ }
        _ = onConnect
    }
    private struct HelloPayload: Codable { let user: User; let onlineUserIds: [String] }
    private struct ChannelMsgPayload: Codable { let channelId: String?; let message: ChannelMessage }
    private struct DMPayload: Codable { let message: DMMessage; let withUserId: String? }
    private struct PresencePayload: Codable { let onlineUserIds: [String] }
    private struct QPayload: Codable { let question: Question }
    private struct APayload: Codable { let questionId: String?; let answer: Answer }
    private struct AcceptedPayload: Codable { let questionId: String?; let answerId: String?; let answer: Answer }
    private struct DeletedPayload: Codable { let channelId: String?; let messageId: String? }
}

// MARK: - App 状态
final class AppState: ObservableObject {
    @Published var api = APIClient()
    let ws = WSClient()

    @Published var isBooting = true
    @Published var currentUser: User?
    @Published var channels: [Channel] = []
    @Published var users: [SimpleUser] = []
    @Published var onlineUserIds: Set<String> = []
    @Published var settingsOpen = false
    @Published var error: String?

    // 主题：用 UserDefaults 持久
    @AppStorage("theme") var theme: String = "system"

    func boot() {
        // 读 token
        if let token = UserDefaults.standard.string(forKey: "token") {
            api.token = token
            Task {
                do {
                    let me = try await api.me()
                    await MainActor.run { self.currentUser = me; self.startWS(); self.afterLogin() }
                } catch { await MainActor.run { self.logoutLocally() } }
                await MainActor.run { self.isBooting = false }
            }
        } else {
            DispatchQueue.main.async { self.isBooting = false }
        }
    }

    func afterLogin() {
        Task {
            await loadChannels()
            await loadUsers()
        }
    }

    @MainActor func loadChannels() async {
        do { channels = try await api.channels() } catch { self.error = error.localizedDescription }
    }
    @MainActor func loadUsers() async {
        do { users = try await api.users() } catch { self.error = error.localizedDescription }
    }

    @MainActor func login(token: String, user: User) {
        api.token = token
        UserDefaults.standard.set(token, forKey: "token")
        currentUser = user
        startWS()
        afterLogin()
    }

    func startWS() {
        guard let u = currentUser, let t = api.token else { return }
        ws.apiBase = api.baseURL
        ws.tokenStorage = t
        ws.onEvent = { [weak self] ev in DispatchQueue.main.async { self?.handle(ev) } }
        ws.connect(baseURL: api.baseURL, token: t)
    }

    @MainActor func logoutLocally() {
        api.token = nil
        UserDefaults.standard.removeObject(forKey: "token")
        currentUser = nil
        channels = []
        users = []
        onlineUserIds = []
    }
    func logout() {
        Task { await api.logout() }
        logoutLocally()
    }

    private func handle(_ ev: WSEvent) {
        switch ev {
        case .hello(_, let ids): onlineUserIds = Set(ids)
        case .presence(let ids): onlineUserIds = Set(ids)
        case .channelMessage: NotificationCenter.default.post(name: .channelMessage, object: ev)
        case .dmMessage: NotificationCenter.default.post(name: .dmMessage, object: ev)
        case .question: NotificationCenter.default.post(name: .newQuestion, object: ev)
        case .answer: NotificationCenter.default.post(name: .newAnswer, object: ev)
        case .answerAccepted: NotificationCenter.default.post(name: .answerAccepted, object: ev)
        case .messageDeleted: NotificationCenter.default.post(name: .messageDeleted, object: ev)
        }
    }
}

extension Notification.Name {
    static let channelMessage = Notification.Name("channelMessage")
    static let dmMessage = Notification.Name("dmMessage")
    static let newQuestion = Notification.Name("newQuestion")
    static let newAnswer = Notification.Name("newAnswer")
    static let answerAccepted = Notification.Name("answerAccepted")
    static let messageDeleted = Notification.Name("messageDeleted")
}

// MARK: - 主题解析
extension AppState {
    var colorScheme: ColorScheme? {
        switch theme {
        case "dark": return .dark
        case "light": return .light
        default: return nil
        }
    }
}

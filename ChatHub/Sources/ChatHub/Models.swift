import Foundation
import SwiftUI

// MARK: - 数据模型（后端 snake_case，统一用 .convertFromSnakeCase 解码）

struct User: Codable, Identifiable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let avatarColor: String
    var isAdmin: Bool = false
    var showOnline: Bool = true
    var theme: String = "system"
    var notifySound: Bool = true
    let createdAt: Double
    var lastLoginAt: Double?
}

struct SimpleUser: Codable, Identifiable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let avatarColor: String
    var online: Bool = false
    var isAdmin: Bool = false
    var lastLoginAt: Double?
    let createdAt: Double
}

struct Channel: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let topic: String
    let category: String
    let createdAt: Double
}

struct Author: Codable, Identifiable, Hashable {
    let id: String
    let username: String
    let displayName: String
    let avatarColor: String
}

struct ChannelMessage: Codable, Identifiable, Hashable {
    let id: String
    let channelId: String
    let authorId: String
    let content: String
    let createdAt: Double
    let author: Author
}

struct DMMessage: Codable, Identifiable, Hashable {
    let id: String
    let senderId: String
    let recipientId: String
    let content: String
    let createdAt: Double
    let isOutgoing: Bool
    let author: Author
}

// —— 问答 ——
struct Question: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let body: String
    let authorId: String
    let answerCount: Int
    var acceptedAnswerId: String?
    let views: Int
    let createdAt: Double
    let author: Author
    var tags: [String] = []
}
struct Answer: Codable, Identifiable, Hashable {
    let id: String
    let questionId: String
    let authorId: String
    let body: String
    let accepted: Bool
    let createdAt: Double
    let author: Author
}

// —— 管理后台 ——
struct AdminStats: Codable {
    let users: Int
    let online: Int
    let channels: Int
    let channelMessages: Int
    let dmMessages: Int
    let questions: Int
    let answers: Int
    let banned: Int
    let recentLogins: [SimpleUser]
}

// MARK: - 会话目标
enum ConversationDestination: Hashable {
    case channel(String)
    case dm(String)
}

enum SidebarSection: Hashable {
    case chat
    case qna
    case admin
}

// MARK: - 工具
enum AppDate {
    static func time(_ ts: Double) -> String {
        let date = Date(timeIntervalSince1970: ts / 1000)
        let f = DateFormatter(); f.locale = Locale.current
        f.dateFormat = Calendar.current.isDateInToday(date) ? "HH:mm" : "MM-dd HH:mm"
        return f.string(from: date)
    }
    static func relative(_ ts: Double?) -> String {
        guard let ts = ts else { return "从未" }
        let date = Date(timeIntervalSince1970: ts / 1000)
        let f = RelativeDateTimeFormatter(); f.locale = Locale.current
        return f.localizedString(for: date, relativeTo: Date())
    }
}

extension String {
    var initials: String {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "?" : String(t.first!).uppercased()
    }
    /// 把 #RRGGBB 转 SwiftUI Color
    func toColor() -> Color {
        var hex = self
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6, let v = UInt64(hex, radix: 16) else { return .gray }
        let r = Double((v & 0xFF0000) >> 16) / 255
        let g = Double((v & 0x00FF00) >> 8) / 255
        let b = Double(v & 0x0000FF) / 255
        return Color(red: r, green: g, blue: b)
    }
}

// MARK: - 简易 Markdown 分段（含代码块）
/// 把消息切成 段落 / 代码块 两类，便于 SwiftUI 分别渲染
enum MDBlock: Identifiable {
    case text(String)
    case code(String, lang: String)
    var id: String { switch self { case .text(let s): return "t:"+s; case .code(let s, _): return "c:"+s } }
}
enum MiniMarkdown {
    static func split(_ raw: String) -> [MDBlock] {
        var blocks: [MDBlock] = []
        // 匹配 ```lang ... ``` 围栏代码块
        let pattern = "```([a-zA-Z0-9]*)\\n([\\s\\S]*?)```"
        guard let re = try? NSRegularExpression(pattern: pattern) else {
            return [.text(raw)]
        }
        let ns = raw as NSString
        var last = 0
        for m in re.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > last {
                let text = ns.substring(with: NSRange(location: last, length: m.range.location - last))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { blocks.append(.text(text)) }
            }
            let lang = m.numberOfRanges > 1 ? ns.substring(with: m.range(at: 1)) : ""
            let code = m.numberOfRanges > 2 ? ns.substring(with: m.range(at: 2)) : ""
            blocks.append(.code(code, lang: lang))
            last = m.range.location + m.range.length
        }
        if last < ns.length {
            let rest = ns.substring(from: last).trimmingCharacters(in: .whitespacesAndNewlines)
            if !rest.isEmpty { blocks.append(.text(rest)) }
        }
        return blocks
    }
}

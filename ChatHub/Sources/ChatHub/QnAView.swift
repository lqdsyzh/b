import SwiftUI

struct QnAView: View {
    @EnvironmentObject var state: AppState
    @State private var questions: [Question] = []
    @State private var selectedQ: Question?
    @State private var showAsk = false
    @State private var loading = false

    var body: some View {
        NavigationStack(path: Binding(get: { path }, set: { path = $0 })) {
            VStack(spacing: 0) {
                HStack {
                    Text("问答区").font(.title.bold())
                    Spacer()
                    Button { showAsk = true } label: { Label("提问", systemImage: "plus.circle.fill") }
                        .buttonStyle(.borderedProminent)
                }
                .padding()
                Divider()
                if loading { ProgressView().padding(40) }
                else if questions.isEmpty {
                    placeholder("还没有问题，来提第一个吧！", icon: "questionmark.bubble")
                } else {
                    List(questions) { q in
                        Button { path = [.detail(q)] } label: { QuestionRow(q: q) }
                            .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationDestination(for: NavPath.self) { p in
                switch p {
                case .detail(let q): QuestionDetailView(question: q, onChange: { reload() })
                }
            }
            .toolbar {
                ToolbarItem {
                    Button { Task { await reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
        }
        .task { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .newQuestion)) { _ in reload() }
        .sheet(isPresented: $showAsk) { AskQuestionSheet { Task { await reload() } } }
    }

    @State private var path: [NavPath] = []
    @MainActor func reload() {
        guard !loading else { return }
        loading = true; defer { loading = false }
        Task {
            do { questions = try await state.api.questions() } catch { state.error = error.localizedDescription }
        }
    }

    func placeholder(_ t: String, icon: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 44)).foregroundStyle(.secondary)
            Text(t).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

enum NavPath: Hashable { case detail(Question) }

struct QuestionRow: View {
    let q: Question
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 2) {
                Text("\(q.answerCount)").font(.title3.bold())
                    .frame(width: 36, height: 36)
                    .background(q.acceptedAnswerId != nil ? Color.green.opacity(0.2) : Color.gray.opacity(0.12),
                                in: RoundedRectangle(cornerRadius: 8))
                Text(q.answerCount == 1 ? "回答" : "回答").font(.caption2).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(q.title).font(.headline).lineLimit(2)
                if !q.tags.isEmpty {
                    HStack {
                        ForEach(q.tags, id: \.self) { t in
                            Text(t).font(.caption2)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.accentColor.opacity(0.15), in: Capsule())
                                .foregroundStyle(.tint)
                        }
                    }
                }
                HStack(spacing: 4) {
                    Text(q.author.displayName).foregroundStyle(.secondary)
                    Text("·").foregroundStyle(.secondary)
                    Text(AppDate.relative(q.createdAt)).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(q.views) 浏览").font(.caption2).foregroundStyle(.secondary)
                }.font(.caption)
            }
        }
        .padding(.vertical, 6)
    }
}

struct AskQuestionSheet: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) var dismiss
    @State private var title = ""
    @State private var bodyMd = ""
    @State private var tagsRaw = ""
    @State private var busy = false
    @State private var error: String?
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Text("提一个问题").font(.headline).padding()
            Divider()
            Form {
                TextField("标题（简明扼要，≥5 字）", text: $title)
                VStack(alignment: .leading) {
                    Text("描述（支持 ``` 代码块）").font(.caption)
                    TextEditor(text: $bodyMd).frame(minHeight: 140, maxHeight: 260)
                        .font(.body.monospaced())
                }
                TextField("标签（逗号分隔，最多 5 个）", text: $tagsRaw)
                if let error = error { Text(error).foregroundStyle(.red).font(.caption) }
            }
            .formStyle(.grouped)
            HStack {
                Button("取消") { dismiss() }
                Spacer()
                Button {
                    Task { await submit() }
                } label: {
                    if busy { ProgressView() } else { Text("发布") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.count < 5 || busy)
            }
            .padding()
        }
    }

    @MainActor func submit() async {
        busy = true; error = nil
        let tags = tagsRaw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        do {
            _ = try await state.api.askQuestion(title: title, body: bodyMd, tags: tags)
            onDone(); dismiss()
        } catch let e as APIError { error = e.errorDescription }
        catch { error = error.localizedDescription }
        busy = false
    }
}

struct QuestionDetailView: View {
    let question: Question
    let onChange: () -> Void
    @EnvironmentObject var state: AppState
    @State private var q: Question
    @State private var answers: [Answer] = []
    @State private var answerBody = ""
    @State private var busy = false

    init(question: Question, onChange: @escaping () -> Void) {
        self.question = question; self.onChange = onChange
        _q = State(initialValue: question)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 问题
                VStack(alignment: .leading, spacing: 8) {
                    Text(q.title).font(.title2.bold())
                    HStack {
                        Text(q.author.displayName).foregroundStyle(.secondary)
                        Text("·").foregroundStyle(.secondary)
                        Text(AppDate.relative(q.createdAt)).foregroundStyle(.secondary)
                    }.font(.caption)
                    ForEach(MiniMarkdown.split(q.body)) { b in
                        switch b {
                        case .text(let t): Text(t)
                        case .code(let c, let l): CodeBlockView(code: c, lang: l)
                        }
                    }
                    if !q.tags.isEmpty {
                        HStack {
                            ForEach(q.tags, id: \.self) { t in
                                Text(t).font(.caption2)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.accentColor.opacity(0.15), in: Capsule())
                                    .foregroundStyle(.tint)
                            }
                        }
                    }
                }
                .padding().background(.background, in: RoundedRectangle(cornerRadius: 12))

                Text("\(answers.count) 个回答").font(.headline)

                ForEach(answers) { a in
                    AnswerRow(a: a, isAuthor: q.authorId == state.currentUser?.id, onAccept: { accept(a) })
                }

                VStack(alignment: .leading) {
                    TextEditor(text: $answerBody).frame(minHeight: 90, maxHeight: 200).font(.body.monospaced())
                        .padding(6).background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
                    HStack { Spacer(); Button { Task { await post() } } label: { Label("回答", systemImage: "paperplane.fill") } }
                        .buttonStyle(.borderedProminent).disabled(answerBody.isEmpty || busy)
                }
            }
            .padding()
        }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .newAnswer)) { note in
            if case .answer(let qid, let a) = note.object as? WSEvent, qid == q.id {
                if !answers.contains(where: { $0.id == a.id }) { answers.append(a) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .answerAccepted)) { note in
            if case .answerAccepted(let qid, let aid, _) = note.object as? WSEvent, qid == q.id {
                for i in answers.indices { answers[i].accepted = (answers[i].id == aid) }
                q.acceptedAnswerId = aid
            }
        }
    }

    @MainActor func load() async {
        do { let (loaded, list) = try await state.api.questionDetail(q.id); q = loaded; answers = list }
        catch { state.error = error.localizedDescription }
    }
    @MainActor func post() async {
        busy = true; defer { busy = false }
        let b = answerBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !b.isEmpty else { return }
        do { let a = try await state.api.answerQuestion(q.id, body: b); if !answers.contains(where: { $0.id == a.id }) { answers.append(a) }; answerBody = "" }
        catch { state.error = error.localizedDescription }
    }
    @MainActor func accept(_ a: Answer) {
        Task { do { let updated = try await state.api.acceptAnswer(a.id)
            for i in answers.indices { answers[i].accepted = (answers[i].id == updated.id) }
            q.acceptedAnswerId = updated.id
        } catch { state.error = error.localizedDescription } }
    }
}

struct AnswerRow: View {
    let a: Answer
    let isAuthor: Bool
    let onAccept: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if a.accepted { Label("已采纳", systemImage: "checkmark.seal.fill").foregroundStyle(.green).font(.caption.bold()) }
                Spacer()
                Text(a.author.displayName).foregroundStyle(.secondary)
                Text("·").foregroundStyle(.secondary)
                Text(AppDate.relative(a.createdAt)).foregroundStyle(.secondary)
            }.font(.caption)
            ForEach(MiniMarkdown.split(a.body)) { b in
                switch b {
                case .text(let t): Text(t)
                case .code(let c, let l): CodeBlockView(code: c, lang: l)
                }
            }
            if isAuthor && !a.accepted {
                Button(action: onAccept) { Label("采纳", systemImage: "checkmark.circle") }
                    .buttonStyle(.bordered).controlSize(.small)
            }
        }
        .padding().background(a.accepted ? Color.green.opacity(0.08) : Color.gray.opacity(0.06),
                              in: RoundedRectangle(cornerRadius: 12))
        .overlay(a.accepted ? RoundedRectangle(cornerRadius: 12).stroke(.green, lineWidth: 1) : nil)
    }
}

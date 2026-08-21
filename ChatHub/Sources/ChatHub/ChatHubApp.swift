import SwiftUI

@main
struct ChatHubApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .frame(minWidth: 1000, minHeight: 620)
                .preferredColorScheme(state.colorScheme)
                .onAppear { state.boot() }
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1280, height: 800)
    }
}

struct RootView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ZStack {
            if state.isBooting {
                ProgressView("正在连接社区…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if state.currentUser == nil {
                AuthView()
            } else {
                ContentView()
            }
        }
        .background(.regularMaterial)
    }
}

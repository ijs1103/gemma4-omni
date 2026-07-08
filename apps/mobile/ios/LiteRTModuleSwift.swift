// LiteRTModuleSwift.swift
// iOS 네이티브 모듈: LiteRT-LM Swift API를 사용한 온디바이스 Gemma 추론
//
// 빌드 조건:
//   - LiteRTLM SPM 패키지가 Xcode 프로젝트에 추가된 경우 → 실제 추론
//   - SPM 패키지가 아직 없는 경우               → 명확한 에러 메시지 반환
//
// SPM 추가 방법:
//   Xcode → File → Add Package Dependencies
//   URL: https://github.com/google-ai-edge/LiteRT-LM  (Branch: main)
//   Target: mobile

import Foundation

#if canImport(LiteRTLM)
import LiteRTLM

// ──────────────────────────────────────────────────────────────────────────────
// 실제 구현: LiteRT-LM SPM 패키지가 링크된 경우
// ──────────────────────────────────────────────────────────────────────────────

@objc(LiteRTSwiftEngine)
class LiteRTSwiftEngine: NSObject {

    // MARK: - Singleton
    @objc static let shared = LiteRTSwiftEngine()
    private override init() { super.init() }

    // MARK: - Properties
    private var engine: Engine?
    private var conversation: Conversation?
    private var isInitialized = false
    private var activeBackend = "unknown"

    // MARK: - Batching Properties (Thread-Safe GCD Queue)
    private let serialQueue = DispatchQueue(label: "com.mobile.LiteRTBatchQueue")
    private var tokenBuffer = ""
    private var isBatchScheduled = false
    private let batchInterval: TimeInterval = 0.120 // 120ms 배칭 대기 시간

    /**
     * 토큰을 스레드 세이프 디스패치 큐에서 버퍼에 축적하고, 120ms 후 flush하여 JS로 전송
     */
    private func handleToken(_ text: String, onToken: @escaping (String) -> Void) {
        serialQueue.async {
            self.tokenBuffer.append(text)
            if !self.isBatchScheduled {
                self.isBatchScheduled = true
                self.serialQueue.asyncAfter(deadline: .now() + self.batchInterval) {
                    let chunk = self.tokenBuffer
                    self.tokenBuffer = ""
                    self.isBatchScheduled = false
                    if !chunk.isEmpty {
                        onToken(chunk)
                    }
                }
            }
        }
    }

    /**
     * 스트리밍 종료 시점에 버퍼에 남은 잔여 토큰을 즉시 비워서 전송
     */
    private func flushBuffer(onToken: @escaping (String) -> Void) {
        serialQueue.sync {
            let chunk = self.tokenBuffer
            self.tokenBuffer = ""
            if !chunk.isEmpty {
                onToken(chunk)
            }
        }
    }

    // MARK: - Load Model (Simulator vs Device 분기 + 캐싱 + 프로파일링)
    @objc func loadModel(_ modelPath: String, completion: @escaping (NSError?) -> Void) {
        Task {
            do {
                // 기존 엔진 자원 해제
                self.conversation = nil
                self.engine = nil
                self.isInitialized = false
                self.activeBackend = "unknown"

                // persistent cache 디렉토리 설정 (두 번째 로딩부터 1~3초로 단축)
                let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
                    .first!.appendingPathComponent("litertlm_cache")
                try FileManager.default.createDirectory(
                    at: cacheDir, withIntermediateDirectories: true)

                var eng: Engine
                let loadStart = Date()

                #if targetEnvironment(simulator)
                // 1. iOS 시뮬레이터(Mac) 환경: GPU 오버헤드를 막고 Mac CPU 가속 4스레드 설정
                print("[LiteRTSwiftEngine] Running in Simulator. Forcing CPU backend (4 threads) for Mac host performance.")
                let config = try EngineConfig(
                    modelPath: modelPath,
                    backend: .cpu(threadCount: 4),
                    maxNumTokens: 4096, // Android/TS 설정과 정합성 유지
                    cacheDir: cacheDir.path
                )
                eng = Engine(engineConfig: config)
                try await eng.initialize()
                self.activeBackend = "CPU (Simulator)"
                #else
                // 2. iOS 실기기 환경: Metal GPU 우선 시도 → 실패 시 CPU Fallback
                do {
                    print("[LiteRTSwiftEngine] Running on Device. Attempting Metal GPU backend.")
                    let config = try EngineConfig(
                        modelPath: modelPath,
                        backend: .gpu,
                        maxNumTokens: 4096,
                        cacheDir: cacheDir.path
                    )
                    eng = Engine(engineConfig: config)
                    try await eng.initialize()
                    self.activeBackend = "GPU"
                    print("[LiteRTSwiftEngine] Engine initialized with Metal GPU backend")
                } catch {
                    print("[LiteRTSwiftEngine] GPU failed (\(error.localizedDescription)), falling back to CPU")
                    let config = try EngineConfig(
                        modelPath: modelPath,
                        backend: .cpu(),
                        maxNumTokens: 4096,
                        cacheDir: cacheDir.path
                    )
                    eng = Engine(engineConfig: config)
                    try await eng.initialize()
                    self.activeBackend = "CPU (GPU fallback)"
                    print("[LiteRTSwiftEngine] Engine initialized with CPU backend (fallback)")
                }
                #endif

                self.conversation = try await eng.createConversation()
                self.engine = eng
                self.isInitialized = true

                // 로드 시간 프로파일링 로그 출력
                let loadTimeMs = Date().timeIntervalSince(loadStart) * 1000
                print("""
                [LiteRTPerf] ══════════════════════════════════════════════
                [LiteRTPerf] iOS Model Loaded Successfully
                [LiteRTPerf]    Backend       : \(self.activeBackend)
                [LiteRTPerf]    Load Time     : \(Int(loadTimeMs))ms
                [LiteRTPerf]    Max Tokens    : 4096
                [LiteRTPerf] ══════════════════════════════════════════════
                """)

                completion(nil)
            } catch {
                print("[LiteRTSwiftEngine] Failed to load model: \(error)")
                completion(NSError(
                    domain: "LiteRTSwiftEngine",
                    code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Failed to load model: \(error.localizedDescription)"]
                ))
            }
        }
    }

    // MARK: - Generate Stream (배칭 + TTFT/TPS 프로파일링)
    @objc func generateStream(
        _ prompt: String,
        onToken: @escaping (String) -> Void,
        onFinish: @escaping () -> Void,
        onError: @escaping (String) -> Void
    ) {
        guard isInitialized, let conversation = self.conversation else {
            onError("Model is not loaded yet")
            return
        }

        Task {
            let startTime = Date()
            var firstTokenTime: Date? = nil
            var tokenCount = 0
            var eventCount = 0

            // Bridge 이벤트 횟수 계측용 래퍼
            let trackingOnToken: (String) -> Void = { chunk in
                eventCount += 1
                onToken(chunk)
            }

            do {
                let message = Message(prompt)

                for try await chunk in conversation.sendMessageStream(message) {
                    tokenCount += 1
                    let text = chunk.toString
                    if !text.isEmpty {
                        // TTFT (첫 토큰 소요 시간) 측정
                        if firstTokenTime == nil {
                            firstTokenTime = Date()
                            let ttft = firstTokenTime!.timeIntervalSince(startTime) * 1000
                            print("[LiteRTPerf] TTFT: \(Int(ttft))ms")
                        }
                        // 스레드 세이프 디스패치 큐를 통한 120ms 배칭
                        self.handleToken(text, onToken: trackingOnToken)
                    }
                }
                
                // 잔여 버퍼 비우기
                self.flushBuffer(onToken: trackingOnToken)

                // ── iOS 프로파일링 요약 출력 ──
                let totalTime = Date().timeIntervalSince(startTime)
                let tps = totalTime > 0 ? Double(tokenCount) / totalTime : 0
                let avgLatency = tokenCount > 0 ? (totalTime / Double(tokenCount)) * 1000 : 0
                let ttftString = firstTokenTime != nil ? "\(Int(firstTokenTime!.timeIntervalSince(startTime) * 1000))ms" : "N/A"

                print("""
                [LiteRTPerf] ──────────────────────────────────────────────
                [LiteRTPerf] 📊 iOS Inference Complete
                [LiteRTPerf]    TTFT              : \(ttftString)
                [LiteRTPerf]    Total Tokens      : \(tokenCount)
                [LiteRTPerf]    Total Time        : \(Int(totalTime * 1000))ms
                [LiteRTPerf]    TPS               : \(String(format: "%.1f", tps)) tokens/sec
                [LiteRTPerf]    Avg Token Latency : \(String(format: "%.1f", avgLatency))ms/token
                [LiteRTPerf]    Bridge Events Sent: \(eventCount) (batched from \(tokenCount) tokens)
                [LiteRTPerf]    Backend           : \(self.activeBackend)
                [LiteRTPerf] ──────────────────────────────────────────────
                """)

                onFinish()
            } catch {
                print("[LiteRTSwiftEngine] Generation error: \(error)")
                onError(error.localizedDescription)
            }
        }
    }

    // MARK: - Generate Stream With Media (멀티모달 배칭 + 프로파일링)
    @objc func generateStreamWithMedia(
        _ prompt: String,
        imagePaths: [String],
        onToken: @escaping (String) -> Void,
        onFinish: @escaping () -> Void,
        onError: @escaping (String) -> Void
    ) {
        guard isInitialized, let conversation = self.conversation else {
            onError("Model is not loaded yet")
            return
        }

        Task {
            let startTime = Date()
            var firstTokenTime: Date? = nil
            var tokenCount = 0
            var eventCount = 0

            let trackingOnToken: (String) -> Void = { chunk in
                eventCount += 1
                onToken(chunk)
            }

            do {
                var contents: [Content] = []
                for path in imagePaths {
                    contents.append(.imageFile(path))
                }
                contents.append(.text(prompt))

                let message = Message(contents: contents)

                for try await chunk in conversation.sendMessageStream(message) {
                    tokenCount += 1
                    let text = chunk.toString
                    if !text.isEmpty {
                        if firstTokenTime == nil {
                            firstTokenTime = Date()
                            let ttft = firstTokenTime!.timeIntervalSince(startTime) * 1000
                            print("[LiteRTPerf] TTFT: \(Int(ttft))ms")
                        }
                        self.handleToken(text, onToken: trackingOnToken)
                    }
                }
                
                self.flushBuffer(onToken: trackingOnToken)

                let totalTime = Date().timeIntervalSince(startTime)
                let tps = totalTime > 0 ? Double(tokenCount) / totalTime : 0
                let avgLatency = tokenCount > 0 ? (totalTime / Double(tokenCount)) * 1000 : 0
                let ttftString = firstTokenTime != nil ? "\(Int(firstTokenTime!.timeIntervalSince(startTime) * 1000))ms" : "N/A"

                print("""
                [LiteRTPerf] ──────────────────────────────────────────────
                [LiteRTPerf] 📊 iOS Multimodal Inference Complete
                [LiteRTPerf]    TTFT              : \(ttftString)
                [LiteRTPerf]    Total Tokens      : \(tokenCount)
                [LiteRTPerf]    Total Time        : \(Int(totalTime * 1000))ms
                [LiteRTPerf]    TPS               : \(String(format: "%.1f", tps)) tokens/sec
                [LiteRTPerf]    Avg Token Latency : \(String(format: "%.1f", avgLatency))ms/token
                [LiteRTPerf]    Bridge Events Sent: \(eventCount) (batched from \(tokenCount) tokens)
                [LiteRTPerf]    Backend           : \(self.activeBackend)
                [LiteRTPerf] ──────────────────────────────────────────────
                """)

                onFinish()
            } catch {
                print("[LiteRTSwiftEngine] Multimodal generation error: \(error)")
                onError(error.localizedDescription)
            }
        }
    }

    // MARK: - Unload Model
    @objc func unloadModel() {
        conversation = nil
        engine = nil
        isInitialized = false
        activeBackend = "unknown"
        print("[LiteRTSwiftEngine] Resources released")
    }
}

#else

// ──────────────────────────────────────────────────────────────────────────────
// 스텁 구현: LiteRTLM SPM 패키지가 아직 추가되지 않은 경우
// ──────────────────────────────────────────────────────────────────────────────

@objc(LiteRTSwiftEngine)
class LiteRTSwiftEngine: NSObject {

    @objc static let shared = LiteRTSwiftEngine()
    private override init() { super.init() }

    @objc func loadModel(_ modelPath: String, completion: @escaping (NSError?) -> Void) {
        let error = NSError(
            domain: "LiteRTSwiftEngine",
            code: -99,
            userInfo: [NSLocalizedDescriptionKey:
                "[LiteRTLM 미연결] Xcode → File → Add Package Dependencies에서 " +
                "https://github.com/google-ai-edge/LiteRT-LM 패키지를 추가해주세요."]
        )
        print("[LiteRTSwiftEngine] ⚠️ LiteRTLM not linked")
        completion(error)
    }

    @objc func generateStream(
        _ prompt: String,
        onToken: @escaping (String) -> Void,
        onFinish: @escaping () -> Void,
        onError: @escaping (String) -> Void
    ) {
        onError("[LiteRTLM 미연결] SPM 패키지를 추가해주세요.")
    }

    @objc func generateStreamWithMedia(
        _ prompt: String,
        imagePaths: [String],
        onToken: @escaping (String) -> Void,
        onFinish: @escaping () -> Void,
        onError: @escaping (String) -> Void
    ) {
        onError("[LiteRTLM 미연결] SPM 패키지를 추가해주세요.")
    }

    @objc func unloadModel() {
        print("[LiteRTSwiftEngine] unloadModel called (stub)")
    }
}

#endif

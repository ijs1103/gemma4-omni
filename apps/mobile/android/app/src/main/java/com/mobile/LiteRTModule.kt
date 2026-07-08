package com.mobile

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.ReadableArray
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Message
import kotlinx.coroutines.*

class LiteRTModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "LiteRTPerf"
        private const val BATCH_INTERVAL_MS = 120L    // 토큰 배칭 간격 (ms)
        private const val MAX_NUM_TOKENS = 4096       // 모델 빌드 기준 최대 토큰 수
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var engine: Engine? = null
    private var currentConversation: com.google.ai.edge.litertlm.Conversation? = null
    private var activeBackend: String = "unknown"

    // ── 토큰 배칭 상태 ──
    private val tokenBuffer = StringBuilder()
    private var batchJob: Job? = null
    private val lock = Any()

    // ── 생성 상태 ──
    private var generationJob: Job? = null
    private var generationStartTime: Long = 0L
    private var generatedTokenCount: Int = 0
    private var interruptRequestedAt: Long = 0L

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [전략 A: Soft Stop]
    //
    // 배경: LiteRT-LM 엔진은 세션(Conversation)을 동시에 하나만 허용하며,
    //   실행 슬롯은 세션 "소멸자"에서만 해제된다. 즉 스트리밍 도중 cancel()이나 close()를
    //   호출해도 네이티브 GPU 실행 자체는 멈추지 않고, 오히려 소멸자 호출(close)이
    //   그 실행이 끝날 때까지 동기 블로킹된다 (최대 90초 관찰).
    //   이는 앱 코드 버그가 아니라 SDK 자체의 알려진 한계다.
    //   - github.com/google-ai-edge/LiteRT-LM/issues/2422
    //     ("Mid-stream CancelProcess() wedges the single-session executor")
    //   - github.com/google-ai-edge/LiteRT-LM/issues/1638
    //     ("SDK does not currently expose an API to cancel in-progress generation")
    //   - Google 공식 데모 앱(AI Edge Gallery)에서도 동일 증상 확인됨
    //     (github.com/google-ai-edge/gallery/issues/272 "Stop button doesn't actually stop generation")
    //
    // 따라서 이 모듈은 "네이티브 생성을 실제로 멈추는 것"을 포기하고,
    // 대신 "화면에 더 이상 토큰을 표시하지 않는 것(Soft Stop)"으로 전략을 바꾼다.
    //   - 세션은 loadModel() 시점에 단 1회만 생성하고, 이후 절대 close/cancel하지 않는다.
    //   - 정지 버튼을 누르면 isGenerationSuppressed만 true로 바꾼다.
    //   - 그 이후 들어오는 토큰은 collect는 계속하되(네이티브 호출이 정상 종료되도록),
    //     브릿지로 전송하지 않고 조용히 버린다.
    //   - 백그라운드 생성이 자연 종료되면 onGenerationSettled 이벤트로
    //     "이제 새 질문을 보내도 안전하다"는 신호를 JS에 보낸다.
    //   - 만약 백그라운드 생성이 아직 안 끝났는데 사용자가 또 질문을 보내면,
    //     조용히 대기시키지 않고 즉시 BUSY 에러로 알려 무한 로딩처럼 보이지 않게 한다.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @Volatile
    private var isGenerationSuppressed: Boolean = false

    override fun getName(): String {
        return "LiteRT"
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Bridge Event 유틸리티
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 토큰 배칭 (Bridge 호출 최소화)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private fun bufferAndSendToken(text: String) {
        synchronized(tokenBuffer) {
            tokenBuffer.append(text)
        }
        if (batchJob?.isActive != true) {
            batchJob = scope.launch {
                delay(BATCH_INTERVAL_MS)
                flushTokenBuffer()
            }
        }
    }

    private fun flushTokenBuffer() {
        val chunk: String
        synchronized(tokenBuffer) {
            chunk = tokenBuffer.toString()
            tokenBuffer.clear()
        }
        if (chunk.isNotEmpty()) {
            val params = Arguments.createMap()
            params.putString("text", chunk)
            sendEvent("onTokenGenerated", params)
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 세션은 모델 로드 시 단 1회만 생성해서 계속 재사용한다. (전략 A의 전제조건)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private fun ensureConversation(eng: Engine): com.google.ai.edge.litertlm.Conversation {
        val existing = currentConversation
        if (existing != null) return existing

        val fresh = eng.createConversation()
        currentConversation = fresh
        Log.d(TAG, "Conversation created: hashCode=${fresh.hashCode()}")
        return fresh
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 모델 로드 (GPU → CPU 계단식 폴백 + 프로파일링)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        Log.i(TAG, "══════════════════════════════════════════════")
        Log.i(TAG, "loadModel() called: $modelPath")

        val loadStartMs = System.currentTimeMillis()

        scope.launch {
            try {
                Log.i(TAG, "Attempting Backend.GPU()...")
                val config = EngineConfig(
                    modelPath = modelPath,
                    maxNumTokens = MAX_NUM_TOKENS,
                    backend = Backend.GPU(),
                    visionBackend = Backend.GPU(),
                    cacheDir = reactContext.cacheDir.absolutePath
                )
                val eng = Engine(config)
                eng.initialize()
                engine = eng
                activeBackend = "GPU"

                ensureConversation(eng)

                val loadTimeMs = System.currentTimeMillis() - loadStartMs
                Log.i(TAG, "✅ Model loaded successfully")
                Log.i(TAG, "   Backend       : GPU")
                Log.i(TAG, "   Load Time     : ${loadTimeMs}ms")
                Log.i(TAG, "   Max Tokens    : $MAX_NUM_TOKENS")
                Log.i(TAG, "══════════════════════════════════════════════")

                promise.resolve(true)
                return@launch
            } catch (gpuError: Exception) {
                Log.w(TAG, "⚠️ GPU backend failed: ${gpuError.message}")
                Log.w(TAG, "   Falling back to CPU...")
            }

            try {
                val cpuStartMs = System.currentTimeMillis()
                val fallbackConfig = EngineConfig(
                    modelPath = modelPath,
                    maxNumTokens = MAX_NUM_TOKENS,
                    backend = Backend.CPU(),
                    visionBackend = Backend.CPU(),
                    cacheDir = reactContext.cacheDir.absolutePath
                )
                val eng = Engine(fallbackConfig)
                eng.initialize()
                engine = eng
                activeBackend = "CPU (GPU fallback)"

                ensureConversation(eng)

                val loadTimeMs = System.currentTimeMillis() - loadStartMs
                val cpuOnlyMs = System.currentTimeMillis() - cpuStartMs
                Log.i(TAG, "✅ Model loaded (CPU fallback)")
                Log.i(TAG, "   Backend       : CPU (GPU failed)")
                Log.i(TAG, "   Load Time     : ${loadTimeMs}ms (GPU attempt + CPU: ${cpuOnlyMs}ms)")
                Log.i(TAG, "   Max Tokens    : $MAX_NUM_TOKENS")
                Log.i(TAG, "══════════════════════════════════════════════")

                promise.resolve(true)
            } catch (cpuError: Exception) {
                val loadTimeMs = System.currentTimeMillis() - loadStartMs
                Log.e(TAG, "❌ Model load FAILED (both GPU and CPU)")
                Log.e(TAG, "   Error        : ${cpuError.message}")
                Log.e(TAG, "   Total Time   : ${loadTimeMs}ms")
                Log.e(TAG, "══════════════════════════════════════════════")

                cpuError.printStackTrace()
                promise.reject("LOAD_ERROR", "Failed to load model: ${cpuError.message}")
            }
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 스트리밍 추론 (텍스트 전용) + 프로파일링 + 배칭
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @ReactMethod
    fun generateStream(prompt: String, promise: Promise) {
        val eng = engine
        if (eng == null) {
            promise.reject("NOT_LOADED", "Model is not loaded yet")
            return
        }

        // [전략 A] 이전 생성이 아직 네이티브에서 백그라운드로 흘러가는 중이라면
        // (억제 상태든 아니든) 새 요청을 받지 않고 즉시 BUSY로 알린다.
        // 세션이 하나뿐이라 실제로 동시에 두 요청을 처리할 수 없기 때문에,
        // 조용히 큐에 쌓아 무한 로딩처럼 보이게 하는 대신 명확하게 실패시킨다.
        if (generationJob?.isActive == true) {
            Log.w(TAG, "⚠️ generateStream rejected: previous generation still finishing in background")
            promise.reject("BUSY", "Previous generation is still finishing in the background")
            return
        }

        Log.i(TAG, "──────────────────────────────────────────────")
        Log.i(TAG, "generateStream() started")
        Log.i(TAG, "   Prompt Length : ${prompt.length} chars")
        Log.i(TAG, "   Backend       : $activeBackend")

        isGenerationSuppressed = false
        generationStartTime = System.currentTimeMillis()
        generatedTokenCount = 0

        generationJob = scope.launch {
            val inferenceStartMs = generationStartTime
            var firstTokenMs: Long? = null
            var tokenCount = 0
            var bridgeEventCount = 0

            try {
                val conversation = ensureConversation(eng)
                val responseFlow = conversation.sendMessageAsync(prompt)

                responseFlow.collect { message ->
                    // [전략 A] ensureActive()로 코루틴을 취소하지 않는다.
                    // 억제 상태여도 collect는 끝까지 계속해서 네이티브 요청이
                    // 스스로 자연 종료되도록 흐름을 유지한다.

                    val text = message.contents.contents
                        .filterIsInstance<com.google.ai.edge.litertlm.Content.Text>()
                        .joinToString("") { it.text }

                    if (text.isNotEmpty()) {
                        tokenCount++
                        generatedTokenCount = tokenCount

                        // [전략 A] 억제 상태면 토큰을 화면으로 보내지 않고 조용히 버린다.
                        if (isGenerationSuppressed) {
                            return@collect
                        }

                        if (firstTokenMs == null) {
                            firstTokenMs = System.currentTimeMillis()
                            val ttft = firstTokenMs!! - inferenceStartMs
                            Log.i(TAG, "   ⏱ TTFT       : ${ttft}ms")
                        }

                        synchronized(tokenBuffer) {
                            tokenBuffer.append(text)
                        }

                        synchronized(lock) {
                            if (batchJob?.isActive != true) {
                                batchJob = scope.launch {
                                    delay(BATCH_INTERVAL_MS)
                                    val chunk: String
                                    synchronized(tokenBuffer) {
                                        chunk = tokenBuffer.toString()
                                        tokenBuffer.clear()
                                    }
                                    if (chunk.isNotEmpty()) {
                                        bridgeEventCount++
                                        val params = Arguments.createMap()
                                        params.putString("text", chunk)
                                        sendEvent("onTokenGenerated", params)
                                    }
                                    synchronized(lock) {
                                        batchJob = null
                                    }
                                }
                            }
                        }
                    }
                }

                val totalMs = System.currentTimeMillis() - inferenceStartMs

                if (isGenerationSuppressed) {
                    // 정지 버튼을 눌러 억제된 채로 네이티브 생성이 자연 종료된 경우.
                    // 화면에는 이미 onGenerationInterrupted가 발송되었으므로 여기서는
                    // 통계 로그만 남기고, JS에는 "이제 안전하다"는 신호만 보낸다.
                    Log.i(TAG, "──────────────────────────────────────────────")
                    Log.i(TAG, "🔇 Suppressed generation finished naturally in background")
                    Log.i(TAG, "   Total Tokens (discarded) : $tokenCount")
                    Log.i(TAG, "   Total Time                : ${totalMs}ms")
                    Log.i(TAG, "──────────────────────────────────────────────")
                } else {
                    val finalChunk: String
                    synchronized(tokenBuffer) {
                        finalChunk = tokenBuffer.toString()
                        tokenBuffer.clear()
                    }
                    if (finalChunk.isNotEmpty()) {
                        bridgeEventCount++
                        val params = Arguments.createMap()
                        params.putString("text", finalChunk)
                        sendEvent("onTokenGenerated", params)
                    }

                    val tps = if (totalMs > 0) tokenCount.toDouble() / (totalMs.toDouble() / 1000.0) else 0.0
                    val avgLatency = if (tokenCount > 0) totalMs.toDouble() / tokenCount.toDouble() else 0.0
                    val ttftVal = if (firstTokenMs != null) "${firstTokenMs!! - inferenceStartMs}ms" else "N/A"

                    Log.i(TAG, "──────────────────────────────────────────────")
                    Log.i(TAG, "📊 Inference Complete")
                    Log.i(TAG, "   TTFT              : $ttftVal")
                    Log.i(TAG, "   Total Tokens      : $tokenCount")
                    Log.i(TAG, "   Total Time        : ${totalMs}ms")
                    Log.i(TAG, "   TPS               : ${"%.1f".format(tps)} tokens/sec")
                    Log.i(TAG, "   Avg Token Latency : ${"%.1f".format(avgLatency)}ms/token")
                    Log.i(TAG, "   Bridge Events Sent: $bridgeEventCount (batched from $tokenCount tokens)")
                    Log.i(TAG, "   Backend           : $activeBackend")
                    Log.i(TAG, "──────────────────────────────────────────────")

                    sendEvent("onGenerationFinished", Arguments.createMap())
                    Log.i(TAG, "📤 onGenerationFinished sent")
                }
            } catch (e: Exception) {
                val totalMs = System.currentTimeMillis() - inferenceStartMs
                if (!isGenerationSuppressed) {
                    Log.e(TAG, "❌ generateStream FAILED after ${totalMs}ms: ${e.message}")
                    e.printStackTrace()

                    val params = Arguments.createMap()
                    params.putString("error", e.message)
                    sendEvent("onGenerationError", params)
                } else {
                    Log.w(TAG, "   Suppressed generation ended with exception: ${e.message}")
                }
            } finally {
                generationJob = null
                // [전략 A] 억제 상태였든 아니든, 네이티브 요청이 완전히 끝난 이 시점에서
                // JS에게 "이제 다음 질문을 보내도 안전하다"는 신호를 보낸다.
                sendEvent("onGenerationSettled", Arguments.createMap())
                Log.i(TAG, "📤 onGenerationSettled sent")   
            }
        }

        promise.resolve(null)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 스트리밍 추론 (멀티모달: 텍스트 + 이미지) + 프로파일링 + 배칭
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @ReactMethod
    fun generateStreamWithMedia(prompt: String, imagePaths: ReadableArray, promise: Promise) {
        val eng = engine
        if (eng == null) {
            promise.reject("NOT_LOADED", "Model is not loaded yet")
            return
        }

        if (generationJob?.isActive == true) {
            Log.w(TAG, "⚠️ generateStreamWithMedia rejected: previous generation still finishing in background")
            promise.reject("BUSY", "Previous generation is still finishing in the background")
            return
        }

        Log.i(TAG, "──────────────────────────────────────────────")
        Log.i(TAG, "generateStreamWithMedia() started")
        Log.i(TAG, "   Prompt Length : ${prompt.length} chars")
        Log.i(TAG, "   Images        : ${imagePaths.size()}")
        Log.i(TAG, "   Backend       : $activeBackend")

        isGenerationSuppressed = false
        generationStartTime = System.currentTimeMillis()
        generatedTokenCount = 0

        generationJob = scope.launch {
            val inferenceStartMs = generationStartTime
            var firstTokenMs: Long? = null
            var tokenCount = 0
            var bridgeEventCount = 0

            try {
                val conversation = ensureConversation(eng)

                val contentParts = mutableListOf<Content>()
                for (i in 0 until imagePaths.size()) {
                    val uri = imagePaths.getString(i)
                    if (uri != null) {
                        contentParts.add(Content.ImageFile(uri))
                    }
                }
                contentParts.add(Content.Text(prompt))

                val message = Message.of(*contentParts.toTypedArray())
                val responseFlow = conversation.sendMessageAsync(message)

                responseFlow.collect { msg ->
                    val text = msg.contents.contents
                        .filterIsInstance<Content.Text>()
                        .joinToString("") { it.text }

                    if (text.isNotEmpty()) {
                        tokenCount++
                        generatedTokenCount = tokenCount

                        if (isGenerationSuppressed) {
                            return@collect
                        }

                        if (firstTokenMs == null) {
                            firstTokenMs = System.currentTimeMillis()
                            val ttft = firstTokenMs!! - inferenceStartMs
                            Log.i(TAG, "   ⏱ TTFT       : ${ttft}ms")
                        }

                        synchronized(tokenBuffer) {
                            tokenBuffer.append(text)
                        }

                        synchronized(lock) {
                            if (batchJob?.isActive != true) {
                                batchJob = scope.launch {
                                    delay(BATCH_INTERVAL_MS)
                                    val chunk: String
                                    synchronized(tokenBuffer) {
                                        chunk = tokenBuffer.toString()
                                        tokenBuffer.clear()
                                    }
                                    if (chunk.isNotEmpty()) {
                                        bridgeEventCount++
                                        val params = Arguments.createMap()
                                        params.putString("text", chunk)
                                        sendEvent("onTokenGenerated", params)
                                    }
                                    synchronized(lock) {
                                        batchJob = null
                                    }
                                }
                            }
                        }
                    }
                }

                val totalMs = System.currentTimeMillis() - inferenceStartMs

                if (isGenerationSuppressed) {
                    Log.i(TAG, "──────────────────────────────────────────────")
                    Log.i(TAG, "🔇 Suppressed multimodal generation finished naturally in background")
                    Log.i(TAG, "   Total Tokens (discarded) : $tokenCount")
                    Log.i(TAG, "   Total Time                : ${totalMs}ms")
                    Log.i(TAG, "──────────────────────────────────────────────")
                } else {
                    val finalChunk: String
                    synchronized(tokenBuffer) {
                        finalChunk = tokenBuffer.toString()
                        tokenBuffer.clear()
                    }
                    if (finalChunk.isNotEmpty()) {
                        bridgeEventCount++
                        val params = Arguments.createMap()
                        params.putString("text", finalChunk)
                        sendEvent("onTokenGenerated", params)
                    }

                    val tps = if (totalMs > 0) tokenCount.toDouble() / (totalMs.toDouble() / 1000.0) else 0.0
                    val avgLatency = if (tokenCount > 0) totalMs.toDouble() / tokenCount.toDouble() else 0.0
                    val ttftVal = if (firstTokenMs != null) "${firstTokenMs!! - inferenceStartMs}ms" else "N/A"

                    Log.i(TAG, "──────────────────────────────────────────────")
                    Log.i(TAG, "📊 Multimodal Inference Complete")
                    Log.i(TAG, "   TTFT              : $ttftVal")
                    Log.i(TAG, "   Total Tokens      : $tokenCount")
                    Log.i(TAG, "   Total Time        : ${totalMs}ms")
                    Log.i(TAG, "   TPS               : ${"%.1f".format(tps)} tokens/sec")
                    Log.i(TAG, "   Avg Token Latency : ${"%.1f".format(avgLatency)}ms/token")
                    Log.i(TAG, "   Bridge Events Sent: $bridgeEventCount (batched from $tokenCount tokens)")
                    Log.i(TAG, "   Backend           : $activeBackend")
                    Log.i(TAG, "──────────────────────────────────────────────")

                    sendEvent("onGenerationFinished", Arguments.createMap())
                }
            } catch (e: Exception) {
                val totalMs = System.currentTimeMillis() - inferenceStartMs
                if (!isGenerationSuppressed) {
                    Log.e(TAG, "❌ generateStreamWithMedia FAILED after ${totalMs}ms: ${e.message}")
                    e.printStackTrace()

                    val params = Arguments.createMap()
                    params.putString("error", e.message)
                    sendEvent("onGenerationError", params)
                } else {
                    Log.w(TAG, "   Suppressed generation ended with exception: ${e.message}")
                }
            } finally {
                generationJob = null
                sendEvent("onGenerationSettled", Arguments.createMap())
            }
        }

        promise.resolve(null)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 생성 중단 (Interrupt) — [전략 A: Soft Stop]
    //
    // 코루틴 취소도, 세션 close도 하지 않는다. isGenerationSuppressed 플래그만 세워서
    // "화면 표시를 멈춘다"는 의미만 부여하고, 네이티브 생성은 백그라운드에서
    // 자연스럽게 끝나도록 내버려 둔다. 이렇게 하면:
    //   - GPU 실행 슬롯을 강제로 뺏으려는 시도 자체가 없으므로 wedge/블로킹이 발생하지 않는다.
    //   - "A session already exists" 에러가 구조적으로 발생할 수 없다.
    //   - 다만 GPU 자원은 백그라운드 생성이 끝날 때까지 계속 소모된다는 트레이드오프가 있다.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @ReactMethod
    fun interruptGeneration(promise: Promise) {
        if (isGenerationSuppressed) {
            Log.i(TAG, "⏹ interruptGeneration() ignored — already suppressed")
            promise.resolve(false)
            return
        }

        val job = generationJob
        if (job == null || !job.isActive) {
            Log.i(TAG, "   No active generation to interrupt")
            promise.resolve(false)
            return
        }

        Log.i(TAG, "──────────────────────────────────────────────")
        Log.i(TAG, "⏹ interruptGeneration() called (soft stop — native generation continues in background)")

        interruptRequestedAt = System.currentTimeMillis()
        Log.d(TAG, "⏹ Interrupt requested at $interruptRequestedAt")

        // 화면 표시만 즉시 멈춘다. job.cancel()도, conversation.close()도 호출하지 않는다.
        isGenerationSuppressed = true

        val finalChunkOnStop: String
        synchronized(tokenBuffer) {
            finalChunkOnStop = tokenBuffer.toString()
            tokenBuffer.clear()
        }
        if (finalChunkOnStop.isNotEmpty()) {
            val p = Arguments.createMap()
            p.putString("text", finalChunkOnStop)
            sendEvent("onTokenGenerated", p)
        }

        batchJob?.cancel()
        batchJob = null

        val elapsed = System.currentTimeMillis() - generationStartTime
        val tapToStopMs = System.currentTimeMillis() - interruptRequestedAt
        Log.i(TAG, "⏹ Display suppressed at token #$generatedTokenCount (elapsed: ${elapsed}ms)")
        Log.i(TAG, "⏹ Tap-to-stop latency: ${tapToStopMs}ms")
        Log.i(TAG, "──────────────────────────────────────────────")

        val params = Arguments.createMap()
        params.putInt("tokenCount", generatedTokenCount)
        params.putDouble("elapsedMs", elapsed.toDouble())
        sendEvent("onGenerationInterrupted", params)

        // 백그라운드 생성이 실제로 끝나면 generateStream()의 finally 블록에서
        // onGenerationSettled 이벤트가 자동으로 발송된다. JS는 그 이벤트를 받은 후에
        // 다음 질문 입력을 다시 활성화해야 한다.
        promise.resolve(true)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 모델 해제
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @ReactMethod
    fun unloadModel(promise: Promise) {
        Log.i(TAG, "unloadModel() called")
        scope.launch {
            try {
                // 앱을 완전히 내리는 시점이므로, 백그라운드 생성이 아직 남아있어도
                // 여기서는 예외적으로 강제 정리를 시도한다 (블로킹 허용).
                if (generationJob?.isActive == true) {
                    Log.w(TAG, "   unloadModel: a background generation is still running, forcing cleanup")
                }
                generationJob = null
                batchJob?.cancel()
                batchJob = null
                synchronized(tokenBuffer) { tokenBuffer.clear() }
                isGenerationSuppressed = false

                try {
                    currentConversation?.close()
                } catch (e: Exception) {
                    Log.w(TAG, "close during unload failed: ${e.message}")
                }
                currentConversation = null

                engine?.close()
                engine = null
                activeBackend = "unknown"

                Log.i(TAG, "✅ Model unloaded successfully")
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "❌ unloadModel FAILED: ${e.message}")
                promise.reject("UNLOAD_ERROR", e.message)
            }
        }
    }
}
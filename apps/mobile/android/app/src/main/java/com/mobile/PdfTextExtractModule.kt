package com.mobile

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.File
import kotlinx.coroutines.*

class PdfTextExtractModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    init {
        try {
            // PDFBoxResourceLoader must be initialized once
            PDFBoxResourceLoader.init(reactContext.applicationContext)
            println("[PdfTextExtractModule] PDFBox Resource Loader initialized successfully")
        } catch (e: Exception) {
            e.printStackTrace()
            println("[PdfTextExtractModule] Failed to initialize PDFBox: ${e.message}")
        }
    }

    override fun getName(): String {
        return "PdfTextExtract"
    }

    @ReactMethod
    fun extractText(filePath: String, promise: Promise) {
        scope.launch {
            var document: PDDocument? = null
            try {
                val file = File(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "File does not exist: $filePath")
                    return@launch
                }

                println("[PdfTextExtractModule] Loading PDF from path: $filePath")
                document = PDDocument.load(file)
                val pdfStripper = PDFTextStripper()
                val text = pdfStripper.getText(document) ?: ""
                val pageCount = document.numberOfPages

                println("[PdfTextExtractModule] Extracted ${text.length} chars from $pageCount pages")

                val result = Arguments.createMap().apply {
                    putString("text", text)
                    putInt("pageCount", pageCount)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                e.printStackTrace()
                promise.reject("EXTRACT_ERROR", "Failed to extract text from PDF: ${e.message}", e)
            } finally {
                try {
                    document?.close()
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }
}

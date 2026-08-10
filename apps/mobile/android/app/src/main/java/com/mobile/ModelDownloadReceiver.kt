package com.mobile

import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File

class ModelDownloadReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "ModelDownloadReceiver"
        private const val CHANNEL_ID = "model_download_complete"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return

        val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        if (downloadId == -1L) return

        val prefs = context.getSharedPreferences("model_downloads", Context.MODE_PRIVATE)
        val savedPath = prefs.getString("download_$downloadId", null) ?: return

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val query = DownloadManager.Query().setFilterById(downloadId)
        val cursor = dm.query(query)

        if (cursor?.moveToFirst() == true) {
            val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                Log.i(TAG, "Download $downloadId completed successfully for path: $savedPath")
                
                // 1. .done 마커 파일 생성 (syncStartupState에서 인식용)
                try {
                    File("$savedPath.done").writeText("ok")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to write .done marker file", e)
                }

                // 2. 로컬 푸시 알림 발송 (탭 시 ModelGalleryScreen 이동)
                val modelName = prefs.getString("download_name_$downloadId", "모델") ?: "모델"
                showCompletionNotification(context, modelName)
            }
        }
        cursor?.close()

        // 사용한 다운로드 정보 정리
        prefs.edit()
            .remove("download_$downloadId")
            .remove("download_name_$downloadId")
            .apply()
    }

    private fun showCompletionNotification(context: Context, modelName: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "모델 다운로드 알림",
                NotificationManager.IMPORTANCE_HIGH
            )
            channel.description = "모델 다운로드 완료 알림을 표시합니다."
            nm.createNotificationChannel(channel)
        }

        val launchIntent = Intent(Intent.ACTION_VIEW, Uri.parse("com.mobile://modelgallery")).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            downloadIdToNotificationId(modelName),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("다운로드 완료!")
            .setContentText("$modelName 모델 다운로드가 완료되었습니다. 탭하여 사용해 보세요.")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .build()

        nm.notify(downloadIdToNotificationId(modelName), notification)
    }

    private fun downloadIdToNotificationId(modelName: String): Int {
        return modelName.hashCode()
    }
}

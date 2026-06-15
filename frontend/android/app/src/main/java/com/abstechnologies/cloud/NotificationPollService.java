package com.abstechnologies.cloud;

import android.app.*;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.*;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.HashSet;
import java.util.Set;

public class NotificationPollService extends Service {
    private static final String TAG = "NotifPoll";
    private static final String CHANNEL_ID = "abs-service";
    private static final String FG_CHANNEL_ID = "abs-foreground";
    private static final int FG_NOTIFICATION_ID = 9999;
    private Handler handler;
    private Runnable pollRunnable;
    private Set<Integer> shownIds = new HashSet<>();
    private boolean isFirstPoll = true;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        handler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification fg = new NotificationCompat.Builder(this, FG_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("ABS Cloud")
            .setContentText("Monitoring for new assignments")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build();
        startForeground(FG_NOTIFICATION_ID, fg);

        if (pollRunnable == null) {
            pollRunnable = new Runnable() {
                @Override
                public void run() {
                    pollNotifications();
                    handler.postDelayed(this, 10000);
                }
            };
            handler.post(pollRunnable);
        }

        return START_STICKY;
    }

    private void pollNotifications() {
        new Thread(() -> {
            try {
                SharedPreferences prefs = getSharedPreferences("abs_cloud", MODE_PRIVATE);
                String token = prefs.getString("auth_token", null);
                String apiUrl = prefs.getString("api_url", "http://localhost:5000/api");

                if (token == null || token.isEmpty()) return;

                URL url = new URL(apiUrl + "/notifications/unread");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                if (conn.getResponseCode() == 200) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                    reader.close();

                    JSONObject json = new JSONObject(sb.toString());
                    if (json.optBoolean("success")) {
                        JSONArray notifs = json.optJSONArray("notifications");
                        if (notifs != null) {
                            for (int i = 0; i < notifs.length(); i++) {
                                JSONObject n = notifs.getJSONObject(i);
                                int id = n.getInt("id");
                                if (!shownIds.contains(id) && !isFirstPoll) {
                                    showNotification(id, n.getString("title"), n.optString("body", ""), n.optString("url", "/service/pending"));
                                }
                                shownIds.add(id);
                            }
                        }
                    }
                    isFirstPoll = false;
                }
                conn.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "Poll failed: " + e.getMessage());
            }
        }).start();
    }

    private void showNotification(int id, String title, String body, String notifUrl) {
        // Tap notification → open app
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra("notification_url", notifUrl);
        PendingIntent openPending = PendingIntent.getActivity(this, id, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Accept button → open app + mark as accepted
        Intent acceptIntent = new Intent(this, NotificationReceiver.class);
        acceptIntent.setAction("ACCEPT_SERVICE");
        acceptIntent.putExtra("notification_id", id);
        acceptIntent.putExtra("notification_url", notifUrl);
        PendingIntent acceptPending = PendingIntent.getBroadcast(this, id + 10000, acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openPending)
            .setDefaults(NotificationCompat.DEFAULT_VIBRATE)
            .addAction(0, "Accept", acceptPending);

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(id, builder.build());
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

            NotificationChannel serviceChannel = new NotificationChannel(
                CHANNEL_ID, "Service Notifications", NotificationManager.IMPORTANCE_HIGH);
            serviceChannel.setDescription("Service call and lead notifications");
            serviceChannel.enableVibration(true);
            nm.createNotificationChannel(serviceChannel);

            NotificationChannel fgChannel = new NotificationChannel(
                FG_CHANNEL_ID, "Background Service", NotificationManager.IMPORTANCE_LOW);
            fgChannel.setDescription("Keeps monitoring for new assignments");
            nm.createNotificationChannel(fgChannel);
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        if (handler != null && pollRunnable != null) handler.removeCallbacks(pollRunnable);
        super.onDestroy();
    }
}

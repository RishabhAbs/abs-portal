package com.abstechnologies.cloud;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class NotificationReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if ("ACCEPT_SERVICE".equals(intent.getAction())) {
            int notifId = intent.getIntExtra("notification_id", 0);
            String url = intent.getStringExtra("notification_url");

            // Dismiss the notification
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.cancel(notifId);

            // Open the app at the correct page
            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            openIntent.putExtra("notification_url", url);
            context.startActivity(openIntent);
        }
    }
}

package com.abstechnologies.cloud;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotificationBridge")
public class NotificationBridgePlugin extends Plugin {

    @PluginMethod
    public void startService(PluginCall call) {
        String token = call.getString("token");
        String apiUrl = call.getString("apiUrl", "http://localhost:5000/api");

        if (token == null || token.isEmpty()) {
            call.reject("Token is required");
            return;
        }

        SharedPreferences prefs = getContext().getSharedPreferences("abs_cloud", Context.MODE_PRIVATE);
        prefs.edit()
            .putString("auth_token", token)
            .putString("api_url", apiUrl)
            .apply();

        Intent intent = new Intent(getContext(), NotificationPollService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        getContext().stopService(new Intent(getContext(), NotificationPollService.class));

        SharedPreferences prefs = getContext().getSharedPreferences("abs_cloud", Context.MODE_PRIVATE);
        prefs.edit().remove("auth_token").apply();

        call.resolve();
    }
}

package com.fightcraft.game;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Головна активність додатка, яка ініціалізує Capacitor Bridge.
 * 
 * Примітка щодо проблем з інтернетом на емуляторі:
 * 1. Переконайтеся, що в AndroidManifest.xml є дозвіл INTERNET.
 * 2. Якщо ви використовуєте HTTP (не HTTPS), додайте android:usesCleartextTraffic="true" 
 *    у тег <application> в AndroidManifest.xml.
 * 3. Перевірте налаштування DNS в емуляторі або спробуйте перезапустити його з параметром "Cold Boot".
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}

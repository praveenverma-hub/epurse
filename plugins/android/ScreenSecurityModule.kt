package com.epurse.app

import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// Sets FLAG_SECURE on the current window so the OS blanks this app out of the
// recent-apps (task switcher) thumbnail and blocks screenshots/screen
// recording, regardless of JS-side AppState timing. Deliberately a plain
// bridge module (not an Expo module): FLAG_SECURE needs no manifest
// permission, and NativeModules lookups return undefined on platforms where
// this isn't registered (iOS) instead of throwing.
class ScreenSecurityModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "ScreenSecurity"

  @ReactMethod
  fun setSecure(secure: Boolean, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.resolve(null)
      return
    }
    activity.runOnUiThread {
      if (secure) {
        activity.window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
    promise.resolve(null)
  }
}

package com.epurse.app

import android.view.WindowManager
import com.facebook.react.bridge.LifecycleEventListener
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
//
// `currentActivity` can be null at the moment JS calls setSecure() (e.g. the
// very first call, racing Activity attachment during cold start) — silently
// giving up there meant the flag could permanently never get applied with no
// visible symptom. LifecycleEventListener makes this self-healing: whatever
// was last requested gets re-applied on every resume, so it can't get stuck
// unset by a one-time race.
class ScreenSecurityModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  @Volatile private var desiredSecure: Boolean? = null

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName() = "ScreenSecurity"

  @ReactMethod
  fun setSecure(secure: Boolean, promise: Promise) {
    desiredSecure = secure
    applyIfPossible()
    promise.resolve(null)
  }

  private fun applyIfPossible() {
    // RN 0.80+ removed the synthetic `currentActivity` property on the module;
    // it lives on the context now.
    val activity = reactContext.currentActivity ?: return
    val secure = desiredSecure ?: return
    activity.runOnUiThread {
      if (secure) {
        activity.window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
  }

  override fun onHostResume() = applyIfPossible()
  override fun onHostPause() {}
  override fun onHostDestroy() {}
}

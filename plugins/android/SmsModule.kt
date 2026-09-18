package com.epurse.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// Reads bank SMS: a bulk inbox query for backfill, plus a live feed of arriving
// messages. Vendored (MIT) from react-native-get-sms-android and
// react-native-android-sms-listener, both unmaintained since 2022 and neither
// declaring the `namespace` that AGP 8 requires — which is what made them
// unbuildable rather than merely stale.
//
// Only what `smsService.js` actually calls survives the port: the originals also
// sent and deleted SMS, and carried a pre-KitKat PDU path that is dead at
// minSdk 24. `receiveMultipart` below is kept faithful to the original, because
// a long bank SMS arrives as several PDUs and a botched reassembly TRUNCATES the
// body — which does not fail loudly, it parses into a subtly wrong transaction.
//
// Deliberately a plain bridge module, matching ScreenSecurityModule: the New
// Architecture still supports these through the interop layer, and a
// NativeModules lookup returns undefined on iOS instead of throwing.
class SmsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  private var receiver: BroadcastReceiver? = null

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName() = NAME

  // ---------------------------------------------------------------------------
  // Bulk inbox read
  // ---------------------------------------------------------------------------

  /**
   * Inbox messages with `date >= minDate`, oldest first, capped at [maxCount].
   *
   * The date filter is a real SQL WHERE clause so SQLite discards rows before
   * they ever reach us — reading every message and filtering in Kotlin is what
   * used to blow the caller's timeout on a busy inbox.
   */
  @ReactMethod
  fun listInbox(minDate: Double, maxCount: Int, promise: Promise) {
    try {
      val out = Arguments.createArray()
      val projection = arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
      )
      val cursor = reactContext.contentResolver.query(
        INBOX_URI,
        projection,
        "${Telephony.Sms.DATE} >= ?",
        arrayOf(minDate.toLong().toString()),
        "${Telephony.Sms.DATE} ASC",
      )

      // A null cursor is what a ROM returns when it keeps SMS somewhere
      // non-standard, or when the read is blocked. Not an error: an empty
      // inbox and an unreadable one look the same to the caller, which already
      // treats 0 messages as a diagnosable state rather than a failure.
      cursor?.use { c ->
        val idIdx = c.getColumnIndex(Telephony.Sms._ID)
        val addrIdx = c.getColumnIndex(Telephony.Sms.ADDRESS)
        val bodyIdx = c.getColumnIndex(Telephony.Sms.BODY)
        val dateIdx = c.getColumnIndex(Telephony.Sms.DATE)
        var n = 0
        while (c.moveToNext() && n < maxCount) {
          val row = Arguments.createMap()
          // `_id` is the dedupe key on the JS side — without it the same
          // message re-ingests on every sweep.
          row.putString("_id", if (idIdx >= 0) c.getString(idIdx) else "")
          row.putString("address", if (addrIdx >= 0) c.getString(addrIdx) ?: "" else "")
          row.putString("body", if (bodyIdx >= 0) c.getString(bodyIdx) ?: "" else "")
          row.putDouble("date", if (dateIdx >= 0) c.getLong(dateIdx).toDouble() else 0.0)
          out.pushMap(row)
          n++
        }
      }

      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("SMS_READ_FAILED", e.message, e)
    }
  }

  // ---------------------------------------------------------------------------
  // Live feed
  // ---------------------------------------------------------------------------

  private fun registerReceiver() {
    if (receiver != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
          receiveMultipart(intent)
        }
      }
    }
    val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
    // Registered against the application context, not the Activity: the original
    // used currentActivity, which is why it had to re-register on every resume
    // and silently listened to nothing whenever that was null.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      reactContext.registerReceiver(r, filter)
    }
    receiver = r
  }

  private fun unregisterReceiver() {
    val r = receiver ?: return
    try {
      reactContext.unregisterReceiver(r)
    } catch (_: IllegalArgumentException) {
      // Already gone — unregistering twice is not worth crashing over.
    }
    receiver = null
  }

  /** Reassemble a (possibly multipart) message and hand it to JS. */
  private fun receiveMultipart(intent: Intent) {
    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    if (messages.isEmpty()) return
    val first = messages[0] ?: return

    val body = if (messages.size == 1 || first.isReplace) {
      first.displayMessageBody ?: first.messageBody ?: ""
    } else {
      buildString { for (m in messages) append(m?.messageBody ?: "") }
    }

    if (!reactContext.hasActiveReactInstance()) return

    val payload = Arguments.createMap().apply {
      putString("originatingAddress", first.originatingAddress ?: "")
      putString("body", body)
      putDouble("timestamp", first.timestampMillis.toDouble())
    }
    reactContext.emitDeviceEvent(EVENT_SMS_RECEIVED, payload)
  }

  // Listening only while the app is foregrounded is deliberate: anything missed
  // is picked up by the inbox sweep on the next foreground, so a background
  // receiver would buy nothing and cost battery.
  override fun onHostResume() = registerReceiver()
  override fun onHostPause() = unregisterReceiver()
  override fun onHostDestroy() = unregisterReceiver()

  // Present so a JS-side NativeEventEmitter does not warn; the app listens via
  // DeviceEventEmitter, so neither needs to do anything.
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Int) = Unit

  companion object {
    const val NAME = "EPurseSms"
    const val EVENT_SMS_RECEIVED = "ePurse:smsReceived"
    private val INBOX_URI: Uri = Uri.parse("content://sms/inbox")
  }
}

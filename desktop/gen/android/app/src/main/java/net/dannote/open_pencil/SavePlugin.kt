package net.dannote.open_pencil

import android.app.Activity
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class CopyToUriArgs {
  var uri: String = ""
  var sourcePath: String = ""
}

/**
 * Writes a file the webview produced into a document the user picked with the system
 * "save as" sheet.
 *
 * The directory picker (ACTION_CREATE_DOCUMENT) hands back a `content://` URI, which
 * `std::fs` cannot open — the desktop save path works on paths. Only the platform can
 * resolve that URI, so the copy happens here through the ContentResolver.
 */
class SavePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun copyToUri(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(CopyToUriArgs::class.java)
      val source = File(args.sourcePath)
      if (!source.isFile) {
        invoke.reject("source file not found: ${args.sourcePath}", null, null, null)
        return
      }

      val resolver = activity.contentResolver
      val uri = Uri.parse(args.uri)
      // "wt" truncates, which matters when the user picked a file that already exists.
      // Not every provider implements it, so fall back to the plain write mode.
      val target = try {
        resolver.openOutputStream(uri, "wt")
      } catch (_: Exception) {
        resolver.openOutputStream(uri)
      }
      if (target == null) {
        invoke.reject("cannot open for writing: ${args.uri}", null, null, null)
        return
      }

      target.use { out -> source.inputStream().use { it.copyTo(out, 64 * 1024) } }
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "save failed", null, null, null)
    }
  }
}

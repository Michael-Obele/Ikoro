package com.michaelobele.ikoro.dynamiccolors

import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * WHY THIS FILE EXISTS
 *
 * Android 12 (API 31) derives a Material You palette from the user's wallpaper
 * and publishes it as ordinary framework colour resources:
 *
 *   android.R.color.system_accent1_0 .. system_accent1_1000
 *   android.R.color.system_accent2_0 .. system_accent2_1000
 *   android.R.color.system_accent3_0 .. system_accent3_1000
 *   android.R.color.system_neutral1_0 .. system_neutral1_1000
 *   android.R.color.system_neutral2_0 .. system_neutral2_1000
 *
 * A WebView cannot read those. This plugin can, and that is the whole of its job:
 * resolve the resources and hand the raw tones to JavaScript. It deliberately does
 * NOT compute the M3 scheme — that mapping lives in
 * `apps/app/src/lib/theme/monet.ts`, in TypeScript, where it is unit tested
 * without a device. Keeping the split here means the native side has no logic
 * that can be wrong in a way no test would catch.
 *
 * THE TONES ARE THE M3 TONE NUMBERS, not array indices: 0, 10, 50, 100, 200, 300,
 * 400, 500, 600, 700, 800, 900, 1000. They are returned as string keys so a tone
 * that is missing is a missing key rather than a shifted array.
 *
 * IMPORTANT: this class must stay public. MainActivity.java calls
 * registerPlugin(IkoroDynamicColorsPlugin.class), and a Kotlin `internal` class
 * mangles its name and cannot be referenced from Java at all.
 */
@CapacitorPlugin(name = "IkoroDynamicColors")
class IkoroDynamicColorsPlugin : Plugin() {

    /**
     * Read the five palettes.
     *
     *   in  {}
     *   out { available: boolean, sdkInt: number, palettes: { accent1: {...}, ... } }
     *
     * Below API 31 this RESOLVES with `available: false` and an empty `palettes`
     * map rather than rejecting. "This phone has no wallpaper palette" is an
     * answer, not an error, and a rejection would force every caller to wrap a
     * normal condition in a try/catch.
     */
    @PluginMethod
    fun getPalettes(call: PluginCall) {
        val result = JSObject()
        result.put("sdkInt", Build.VERSION.SDK_INT)

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            result.put("available", false)
            result.put("palettes", JSObject())
            call.resolve(result)
            return
        }

        val palettes = JSObject()
        for ((name, tones) in PALETTES) {
            palettes.put(name, readPalette(tones))
        }

        result.put("available", true)
        result.put("palettes", palettes)
        call.resolve(result)
    }

    /**
     * Cheap capability probe, for deciding whether to offer the option at all.
     *
     *   in  {}
     *   out { available: boolean, sdkInt: number }
     */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        result.put("sdkInt", Build.VERSION.SDK_INT)
        call.resolve(result)
    }

    /**
     * Resolve one palette's tones to `#rrggbb`.
     *
     * `context.getColor()` is the API-23+ form and handles the theme attribute
     * resolution for us; `resources.getColor(id, theme)` would do the same but
     * needs the theme passed by hand. A tone that fails to resolve is SKIPPED
     * rather than written as black: a missing key lets the JS side fall back to
     * the static palette for that one role, while a black would be a colour the
     * user never chose.
     */
    private fun readPalette(tones: Map<String, Int>): JSObject {
        val palette = JSObject()
        for ((tone, resId) in tones) {
            try {
                palette.put(tone, toHex(context.getColor(resId)))
            } catch (e: Exception) {
                // A resource that does not exist on this OEM's build. Skipping is
                // the honest answer; the JS side treats the tone as absent.
            }
        }
        return palette
    }

    /** `#rrggbb`, lower case, alpha dropped — the palettes are always opaque. */
    private fun toHex(color: Int): String = String.format("#%06x", 0xFFFFFF and color)

    private companion object {
        /**
         * The tone -> resource id table.
         *
         * Written out rather than built with reflection over `R.color` names:
         * reflection would break silently under R8 and would turn a typo into a
         * runtime miss instead of a compile error. Thirteen lines per palette is
         * the cheaper trade.
         */
        val PALETTES: Map<String, Map<String, Int>> = mapOf(
            "accent1" to mapOf(
                "0" to android.R.color.system_accent1_0,
                "10" to android.R.color.system_accent1_10,
                "50" to android.R.color.system_accent1_50,
                "100" to android.R.color.system_accent1_100,
                "200" to android.R.color.system_accent1_200,
                "300" to android.R.color.system_accent1_300,
                "400" to android.R.color.system_accent1_400,
                "500" to android.R.color.system_accent1_500,
                "600" to android.R.color.system_accent1_600,
                "700" to android.R.color.system_accent1_700,
                "800" to android.R.color.system_accent1_800,
                "900" to android.R.color.system_accent1_900,
                "1000" to android.R.color.system_accent1_1000
            ),
            "accent2" to mapOf(
                "0" to android.R.color.system_accent2_0,
                "10" to android.R.color.system_accent2_10,
                "50" to android.R.color.system_accent2_50,
                "100" to android.R.color.system_accent2_100,
                "200" to android.R.color.system_accent2_200,
                "300" to android.R.color.system_accent2_300,
                "400" to android.R.color.system_accent2_400,
                "500" to android.R.color.system_accent2_500,
                "600" to android.R.color.system_accent2_600,
                "700" to android.R.color.system_accent2_700,
                "800" to android.R.color.system_accent2_800,
                "900" to android.R.color.system_accent2_900,
                "1000" to android.R.color.system_accent2_1000
            ),
            "accent3" to mapOf(
                "0" to android.R.color.system_accent3_0,
                "10" to android.R.color.system_accent3_10,
                "50" to android.R.color.system_accent3_50,
                "100" to android.R.color.system_accent3_100,
                "200" to android.R.color.system_accent3_200,
                "300" to android.R.color.system_accent3_300,
                "400" to android.R.color.system_accent3_400,
                "500" to android.R.color.system_accent3_500,
                "600" to android.R.color.system_accent3_600,
                "700" to android.R.color.system_accent3_700,
                "800" to android.R.color.system_accent3_800,
                "900" to android.R.color.system_accent3_900,
                "1000" to android.R.color.system_accent3_1000
            ),
            "neutral1" to mapOf(
                "0" to android.R.color.system_neutral1_0,
                "10" to android.R.color.system_neutral1_10,
                "50" to android.R.color.system_neutral1_50,
                "100" to android.R.color.system_neutral1_100,
                "200" to android.R.color.system_neutral1_200,
                "300" to android.R.color.system_neutral1_300,
                "400" to android.R.color.system_neutral1_400,
                "500" to android.R.color.system_neutral1_500,
                "600" to android.R.color.system_neutral1_600,
                "700" to android.R.color.system_neutral1_700,
                "800" to android.R.color.system_neutral1_800,
                "900" to android.R.color.system_neutral1_900,
                "1000" to android.R.color.system_neutral1_1000
            ),
            "neutral2" to mapOf(
                "0" to android.R.color.system_neutral2_0,
                "10" to android.R.color.system_neutral2_10,
                "50" to android.R.color.system_neutral2_50,
                "100" to android.R.color.system_neutral2_100,
                "200" to android.R.color.system_neutral2_200,
                "300" to android.R.color.system_neutral2_300,
                "400" to android.R.color.system_neutral2_400,
                "500" to android.R.color.system_neutral2_500,
                "600" to android.R.color.system_neutral2_600,
                "700" to android.R.color.system_neutral2_700,
                "800" to android.R.color.system_neutral2_800,
                "900" to android.R.color.system_neutral2_900,
                "1000" to android.R.color.system_neutral2_1000
            )
        )
    }
}

import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadRobotoMono } from "@remotion/google-fonts/RobotoMono";

/**
 * Archivo carries the heavy grotesque weight for the kinetic hook.
 * German umlauts and the „ " quotes live in the latin subset.
 */
const archivo = loadArchivo("normal", {
  weights: ["400", "500", "700", "900"],
  subsets: ["latin"],
});

/** Roboto Mono keeps the countdown clock digits from jittering as they change. */
const robotoMono = loadRobotoMono("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

export const displayFont = archivo.fontFamily;
export const monoFont = robotoMono.fontFamily;
export const waitForFonts = [archivo, robotoMono];

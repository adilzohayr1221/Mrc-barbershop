// Haptics utility — uses Capacitor native haptics when running in the iOS app,
// falls back to navigator.vibrate on Android web, silent otherwise.
// This gives tactile feedback on key actions (booking confirmed, payment done),
// making the app feel native rather than a website.
export async function haptic(style: 'light' | 'medium' | 'heavy' = 'medium'): Promise<void> {
  try {
    // Capacitor native (iOS app)
    const cap = (window as any)?.Capacitor;
    if (cap?.isNativePlatform?.()) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
      await Haptics.impact({ style: map[style] });
      return;
    }
    // Web fallback (Android Chrome)
    if (navigator.vibrate) {
      navigator.vibrate(style === 'heavy' ? 40 : style === 'medium' ? 25 : 12);
    }
  } catch {
    // Never break the app for haptics
  }
}

export async function hapticSuccess(): Promise<void> {
  try {
    const cap = (window as any)?.Capacitor;
    if (cap?.isNativePlatform?.()) {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Success });
      return;
    }
    if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  } catch {
    // silent
  }
}

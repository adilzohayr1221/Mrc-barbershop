/**
 * native-branch-map.ts — JS bridge for the native Apple Maps branch map.
 *
 * STATUS: Wired (phase 2). The BranchMap dispatcher (src/components/
 * BranchMap.tsx) loads this module lazily — and only inside a native
 * shell — to run the availability check below; src/components/
 * BranchMapNative.tsx owns the controller. Do not import it from a
 * server component — it is client-only.
 *
 * WHAT IT DOES
 * Inside the iOS App Store app, the customer branch map should be the
 * exact native Apple Maps (a real MKMapView), not a web map. The local
 * Capacitor plugin `capacitor-branch-map` (plugins/capacitor-branch-map)
 * renders that native map, floated over the WebView at the exact rect
 * of the framed `.modern-map` placeholder the page renders. This module
 * is the typed client for that plugin plus the rect-sync controller.
 *
 * THE CONTRACT
 * - The web owns the page: branch data, selection state, branch cards.
 *   The native side is a slave view: data + selection flow DOWN through
 *   method calls; user intent flows UP through events.
 * - Coordinates are CSS pixels in DOCUMENT space: the placeholder's
 *   getBoundingClientRect() plus the window scroll offsets. The
 *   plugin embeds the map inside the WebView's scroll view at
 *   exactly that document rect, so web and native agree by
 *   construction — safe-area insets included.
 * - Detection uses the app's established native signal (same as
 *   src/lib/haptics.ts): window.Capacitor?.isNativePlatform(), PLUS
 *   platform 'ios', PLUS Capacitor.isPluginAvailable('BranchMap').
 *   All three are required. The isPluginAvailable check is the version
 *   contract: the native binary and the website deploy independently
 *   (the shell loads the live site), and the v1.0 app in App Store
 *   review does NOT contain the plugin. When the check fails, the web
 *   map (MapKit JS + Leaflet fallback) renders exactly as today.
 *
 * PHASE-2 WIRING (customer page / BranchMap dispatcher)
 *   if (isNativeBranchMapAvailable()) {
 *     // render the .modern-map placeholder WITHOUT a web engine inside:
 *     // same outer element + heights (340 / 480) so layout is identical,
 *     // but with its inner content visibility:hidden — the native side
 *     // draws frame + map; a visible web frame underneath would double it.
 *     const controller = new NativeBranchMapController({
 *       onBranchTap: (id) => setSelectedId(id),              // = onSelect
 *       onSalonTap: (slug) => { window.location.href = `/customer?salon=${encodeURIComponent(slug)}` },
 *       onUserLocated: ({ lat, lng }) => setUserLoc({ lat, lng }), // existing page state (distance chips)
 *       onLocateError: (message) => showMapToast(message),   // same toast the web engines use
 *       onReady: () => hidePlaceholderShimmer(),
 *     });
 *     controller.attach(placeholderEl, { branches, salons, selectedId });
 *     // on prop changes: controller.setData(...) / controller.setSelected(id)
 *     // on unmount or route change: controller.detach()
 *   }
 *
 * BEHAVIOR PARITY NOTES
 * - Pin tap: native applies the selected look instantly, then emits
 *   pinTapped; the page sets state and the resulting setSelected echo
 *   is idempotent (native skips the fly-to when already centered, so
 *   there is no map shake).
 * - Card tap: page calls setSelected({ id, flyTo: true }) — native
 *   restyles pins and flies, same as the web engines.
 * - Locate: the button is native (inside the map, where the web fab
 *   sits). A successful locate emits userLocated so the page can fill
 *   the same state the web locate fills; failures emit locateError with
 *   the web's exact message string.
 * - Scroll: none needed, by construction. The plugin embeds the
 *   native map INSIDE the WebView's scroll view, so the map is part
 *   of the page: it scrolls with the content exactly (no lag, no
 *   drift, no floating overlay), and a drag that starts on the map
 *   scrolls the page — the native side passes those touches through
 *   and keeps only pin taps and its own buttons. Frames are re-sent
 *   only when the layout itself changes (resize / data), never on
 *   scroll.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { Branch } from './types';

// ---------------------------------------------------------------------------
// Wire types (must stay in sync with BranchMapPlugin.swift)
// ---------------------------------------------------------------------------

export interface NativeBranchInput {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** 1-based badge number shown on the pin (branch order on the page). */
  number: number;
}

export interface NativeSalonInput {
  id: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
}

export interface NativeMapFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PinTappedEvent {
  kind: 'branch' | 'salon';
  id: string;
  slug?: string;
}

export interface UserLocatedEvent {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface LocateErrorEvent {
  message: string;
}

interface BranchMapPlugin {
  show(options: {
    frame: NativeMapFrame;
    branches?: NativeBranchInput[];
    salons?: NativeSalonInput[];
    selectedId?: string | null;
  }): Promise<void>;
  hide(): Promise<void>;
  updateFrame(options: { frame: NativeMapFrame; visible: boolean }): Promise<void>;
  setData(options: { branches: NativeBranchInput[]; salons: NativeSalonInput[] }): Promise<void>;
  setSelected(options: { id: string | null; flyTo?: boolean }): Promise<void>;
  locateMe(): Promise<void>;
  addListener(
    eventName: 'pinTapped',
    listenerFunc: (event: PinTappedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'userLocated',
    listenerFunc: (event: UserLocatedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'locateError',
    listenerFunc: (event: LocateErrorEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'mapReady',
    listenerFunc: () => void
  ): Promise<PluginListenerHandle>;
}

const BranchMapNative = registerPlugin<BranchMapPlugin>('BranchMap');

/** True only inside an iOS app build that contains the BranchMap plugin. */
export function isNativeBranchMapAvailable(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'ios' &&
      Capacitor.isPluginAvailable('BranchMap')
    );
  } catch {
    return false;
  }
}

/** Maps the page's Branch objects to the native payload (adds the badge number). */
export function toNativeBranches(branches: Branch[]): NativeBranchInput[] {
  return branches.map((b, i) => ({
    id: b.id,
    name: b.name,
    lat: b.lat,
    lng: b.lng,
    number: i + 1,
  }));
}

/** Maps SalonPin-shaped objects (src/components/BranchMapLeaflet) to the native payload. */
export function toNativeSalons(
  salons: { id: string; name: string; slug: string; lat: number; lng: number }[]
): NativeSalonInput[] {
  return salons.map((s) => ({ id: s.id, name: s.name, slug: s.slug, lat: s.lat, lng: s.lng }));
}

// ---------------------------------------------------------------------------
// Controller: owns one placeholder element ↔ one native map
// ---------------------------------------------------------------------------

export interface NativeBranchMapCallbacks {
  onBranchTap: (id: string) => void;
  onSalonTap: (slug: string) => void;
  onUserLocated?: (event: UserLocatedEvent) => void;
  onLocateError?: (message: string) => void;
  onReady?: () => void;
}

export class NativeBranchMapController {
  private el: HTMLElement | null = null;
  private callbacks: NativeBranchMapCallbacks;
  private listeners: PluginListenerHandle[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private rafId = 0;
  private shown = false;
  private destroyed = false;

  constructor(callbacks: NativeBranchMapCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Shows the native map over `el` and keeps it glued to el's rect.
   * Call once the placeholder is mounted and laid out.
   */
  async attach(
    el: HTMLElement,
    initial: {
      branches: NativeBranchInput[];
      salons: NativeSalonInput[];
      selectedId: string | null;
    }
  ): Promise<void> {
    this.el = el;
    this.listeners = await Promise.all([
      BranchMapNative.addListener('pinTapped', (event) => {
        if (event.kind === 'salon') {
          if (event.slug) this.callbacks.onSalonTap(event.slug);
        } else {
          this.callbacks.onBranchTap(event.id);
        }
      }),
      BranchMapNative.addListener('userLocated', (event) => {
        this.callbacks.onUserLocated?.(event);
      }),
      BranchMapNative.addListener('locateError', (event) => {
        this.callbacks.onLocateError?.(event.message);
      }),
      BranchMapNative.addListener('mapReady', () => {
        this.callbacks.onReady?.();
      }),
    ]);
    if (this.destroyed) return;

    await BranchMapNative.show({
      frame: this.currentFrame(),
      branches: initial.branches,
      salons: initial.salons,
      selectedId: initial.selectedId,
    });
    this.shown = true;

    // Frame sync: layout changes only — the map scrolls with the
    // page natively, so there is deliberately no scroll listener.
    this.resizeObserver = new ResizeObserver(this.scheduleSync);
    this.resizeObserver.observe(el);
    window.addEventListener('resize', this.scheduleSync, { passive: true });
    window.visualViewport?.addEventListener('resize', this.scheduleSync, { passive: true });
    this.sync();
  }

  /** Pushes new pin data down (call when branches/salonPins props change). */
  async setData(branches: NativeBranchInput[], salons: NativeSalonInput[]): Promise<void> {
    if (!this.shown || this.destroyed) return;
    await BranchMapNative.setData({ branches, salons });
    this.sync();
  }

  /** Echoes the page's selection state down (call when selectedId changes). */
  async setSelected(id: string | null, flyTo = true): Promise<void> {
    if (!this.shown || this.destroyed) return;
    await BranchMapNative.setSelected({ id, flyTo });
  }

  /** Programmatic locate (the on-map button is native; this is for page-level triggers). */
  async locateMe(): Promise<void> {
    if (!this.shown || this.destroyed) return;
    await BranchMapNative.locateMe();
  }

  /** Hides the native map and releases every listener/observer. */
  async detach(): Promise<void> {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.scheduleSync);
    window.visualViewport?.removeEventListener('resize', this.scheduleSync);
    await Promise.all(this.listeners.map((l) => l.remove().catch(() => undefined)));
    this.listeners = [];
    if (this.shown) {
      this.shown = false;
      await BranchMapNative.hide().catch(() => undefined);
    }
    this.el = null;
  }

  private currentFrame(): NativeMapFrame {
    const rect = this.el?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, width: 0, height: 0 };
    // Document space: client rect + scroll offsets. The native side
    // places the map in the scroll view's content at this rect.
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }

  private scheduleSync = (): void => {
    if (this.rafId || this.destroyed) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.sync();
    });
  };

  private sync(): void {
    if (!this.el || !this.shown || this.destroyed) return;
    const rect = this.el.getBoundingClientRect();
    // Fully off-screen → park the native map (hidden) instead of
    // letting it float over unrelated content.
    const visible = rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
    void BranchMapNative.updateFrame({
      frame: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
      visible,
    }).catch(() => undefined);
  }
}

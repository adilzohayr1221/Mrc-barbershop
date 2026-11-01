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
 * - Scroll: the frame itself never needs chasing, by construction.
 *   The plugin embeds the native map INSIDE the WebView's scroll
 *   view, so the map is part of the page: its card scrolls with the
 *   content exactly (no lag, no drift, no floating overlay). Inside
 *   the map, gestures are NORMAL Apple Maps (owner's restored spec,
 *   2026-11-01): a drag pans the map and a pinch zooms it, clipped
 *   inside its frame. Frames are re-sent when the layout changes
 *   (resize / data).
 * - Header clip (owner's order, 2026-11-01): as a scroll-view
 *   subview the native map paints ABOVE web content, so scrolling
 *   slid it over the app's sticky header — the MRC logo and the
 *   "MRC Barbershops" name disappeared behind it. The map must stay
 *   UNDER everything, strictly inside its card slot. So sync() also
 *   runs on scroll (rAF-throttled, deduplicated — it costs nothing
 *   while the map is clear of the header) and sends `clipTop`: the
 *   document-space Y of the sticky header's bottom edge. The native
 *   side masks the map at that line, so it slides UNDER the header
 *   like ordinary page content, and hides it when the header band
 *   covers it completely.
 * - AI button cutout (owner's order, 2026-11-01): the floating AI
 *   assistant button ([data-ai-fab] in AiAssistant.tsx — position:
 *   fixed, gold star circle, draggable anywhere) is web content that
 *   can sit right over the map, and the native map painted straight
 *   over it, hiding it (the owner: "the AI icon must ALWAYS be above
 *   the map"). So sync() also measures the button on the same
 *   scroll/resize cadence — plus a MutationObserver, because dragging
 *   the button fires neither scroll nor resize — and sends `cutout`:
 *   the button's document-space rect as [x, y, width, height], or []
 *   when it does not overlap the map. The native side cuts a circular
 *   hole for it in the map's mask and passes its touches through, so
 *   the button always shows and stays tappable/draggable.
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

/**
 * Document-space rect of the floating AI button, in wire form:
 * [x, y, width, height]. An empty array clears the cutout — the
 * bridge cannot distinguish an explicit null from an absent key,
 * and an absent key must keep the previous value (older deploys
 * never send one), so null is never put on the wire.
 */
export type NativeMapCutout = [number, number, number, number];

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
    clipTop?: number;
    cutout?: NativeMapCutout | [];
  }): Promise<void>;
  hide(): Promise<void>;
  updateFrame(options: {
    frame: NativeMapFrame;
    visible: boolean;
    clipTop: number;
    cutout: NativeMapCutout | [];
  }): Promise<void>;
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
  private fabObserver: MutationObserver | null = null;
  private rafId = 0;
  private shown = false;
  private destroyed = false;
  /** Quantized key of the last updateFrame payload (scroll dedupe). */
  private lastSyncKey: string | null = null;

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

    const frame = this.currentFrame();
    await BranchMapNative.show({
      frame,
      branches: initial.branches,
      salons: initial.salons,
      selectedId: initial.selectedId,
      clipTop: this.currentClipTop(),
      cutout: this.currentCutout(frame),
    });
    this.shown = true;

    // Frame sync on layout changes (the map scrolls with the page
    // natively, so the frame itself never moves) — plus a scroll
    // listener for the header clip only: clipTop is a function of
    // the scroll position. sync() deduplicates, so scrolling while
    // the map is nowhere near the header sends nothing.
    this.resizeObserver = new ResizeObserver(this.scheduleSync);
    this.resizeObserver.observe(el);
    window.addEventListener('resize', this.scheduleSync, { passive: true });
    window.visualViewport?.addEventListener('resize', this.scheduleSync, { passive: true });
    window.addEventListener('scroll', this.scheduleSync, { passive: true });
    // The AI button also moves WITHOUT scroll/resize: the user drags
    // it (React re-renders it with a new inline style) and it unmounts
    // while the chat panel is open (DOM removal). Watch for both so
    // the cutout tracks it. sync() deduplicates, so unrelated DOM
    // churn costs at most one measurement pass per animation frame.
    this.fabObserver = new MutationObserver(this.scheduleSync);
    this.fabObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });
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
    this.fabObserver?.disconnect();
    this.fabObserver = null;
    window.removeEventListener('resize', this.scheduleSync);
    window.visualViewport?.removeEventListener('resize', this.scheduleSync);
    window.removeEventListener('scroll', this.scheduleSync);
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

  /** Viewport-space Y of the sticky SiteHeader's bottom edge (0 if absent). */
  private headerBottomViewport(): number {
    const header =
      document.querySelector('header.glass-header') ?? document.querySelector('header');
    if (!header) return 0;
    return Math.max(0, header.getBoundingClientRect().bottom);
  }

  /**
   * Document-space Y of the sticky header's bottom edge. The native
   * map must never paint above this line — the header (logo + name)
   * stays on top of it at every scroll position.
   */
  private currentClipTop(): number {
    return window.scrollY + this.headerBottomViewport();
  }

  /**
   * Document-space rect of the floating AI assistant button, or null
   * when it is not on screen (chat panel open / not mounted).
   */
  private aiFabRect(): NativeMapFrame | null {
    const fab = document.querySelector('[data-ai-fab]');
    if (!fab) return null;
    const rect = fab.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * The AI-button cutout for the native side, in wire form: the
   * button's document-space rect clipped to the map frame EXPANDED
   * by the drop shadow's reach (the mask also paints the shadow, and
   * the button must stay above that too), or [] when the button is
   * clear of the map — which also clears a stale cutout natively.
   */
  private currentCutout(frame: NativeMapFrame): NativeMapCutout | [] {
    const fab = this.aiFabRect();
    if (!fab) return [];
    const expand = 56; // shadow radius 24 + offset 24, rounded up
    const x = Math.max(fab.x, frame.x - expand);
    const y = Math.max(fab.y, frame.y - expand);
    const right = Math.min(fab.x + fab.width, frame.x + frame.width + expand);
    const bottom = Math.min(fab.y + fab.height, frame.y + frame.height + expand);
    if (right <= x || bottom <= y) return [];
    return [x, y, right - x, bottom - y];
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
    const headerBottom = this.headerBottomViewport();
    const clipTop = window.scrollY + headerBottom;
    // Visible = some part of the placeholder is inside the viewport
    // AND below the sticky header band. Fully off-screen or fully
    // covered by the header → park the native map (hidden) instead
    // of letting it paint over unrelated content.
    const visibleTop = Math.max(rect.top, headerBottom);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const visible = visibleBottom > visibleTop && rect.width > 0;
    const frame = {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
    // Dedupe (half-point quantization): the native side only cares
    // about the frame, the EFFECTIVE clip — how much of the
    // placeholder's top the header band covers — and the effective
    // AI-button cutout. While the map is clear of the header and the
    // button (or fully covered), scrolling changes none of them, so
    // nothing is sent.
    const q = (n: number) => Math.round(n * 2) / 2;
    const effectiveClip = Math.min(Math.max(clipTop - frame.y, 0), frame.height);
    const cutout = this.currentCutout(frame);
    const cutKey = cutout.length === 4 ? cutout.map(q).join(',') : '-';
    const key = [
      q(frame.x), q(frame.y), q(frame.width), q(frame.height), q(effectiveClip), visible, cutKey,
    ].join('|');
    if (key === this.lastSyncKey) return;
    this.lastSyncKey = key;
    void BranchMapNative.updateFrame({
      frame: { x: q(frame.x), y: q(frame.y), width: q(frame.width), height: q(frame.height) },
      visible,
      clipTop: q(clipTop),
      cutout: cutout.length === 4 ? (cutout.map(q) as NativeMapCutout) : [],
    }).catch(() => undefined);
  }
}

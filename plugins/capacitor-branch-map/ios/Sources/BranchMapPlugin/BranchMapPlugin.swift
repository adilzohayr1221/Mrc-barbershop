import Foundation
import Capacitor
import CoreLocation
import UIKit

/// Capacitor bridge for the native branch map.
///
/// The web layer (see src/lib/native-branch-map.ts) keeps owning the
/// page: branch data, selection state, and the framed placeholder's
/// on-screen rect. This plugin owns exactly one thing — a real
/// MKMapView (BranchMapView) embedded in the WebView's scroll view
/// at that rect, so the map is part of the page and scrolls with it.
///
/// JS API (all coordinates are CSS pixels == UIKit points in the
/// document's coordinate space):
///   show({ frame, branches?, salons?, selectedId?, clipTop?, cutout? })
///                                                     create + reveal
///   hide()                                            conceal (kept alive)
///   updateFrame({ frame, visible, clipTop?, cutout? }) scroll/resize sync
/// clipTop is the document-space Y of the sticky header's bottom
/// edge: the map is a scroll-view subview and would otherwise paint
/// OVER the header (logo + name) when the page scrolls it up into
/// the header band. The plugin clips the map at that line so it
/// always stays under the header, inside its own card slot.
/// cutout is the floating AI button's rect as [x, y, width, height]
/// in document space (an empty array clears it; an absent key keeps
/// the previous value, for older web deploys): the view cuts a
/// circular hole in the map's mask there, so the button — web
/// content that must ALWAYS stay above the map (owner's order,
/// 2026-11-01) — shows through and keeps its touches.
///
/// Scroll-synchronous clipping: the JS bridge re-sends clipTop /
/// cutout on scroll, but that round trip (scroll event → rAF →
/// measure → bridge → here) trails a flick or momentum scroll by
/// many frames, and the owner's recording showed the map painting
/// over the header mid-scroll with the clip line stranded behind.
/// Both values are document-space positions of viewport-anchored
/// elements (sticky header, position:fixed button), so between JS
/// updates they shift EXACTLY 1:1 with the scroll view's
/// contentOffset. The plugin therefore anchors each value to the
/// contentOffset at the moment it arrives and re-applies it
/// natively on every contentOffset KVO — synchronous with the
/// scroll itself, before the frame composites. JS syncs keep
/// re-anchoring (scroll end, resize, button drags), so at rest the
/// values are exactly the JS-measured ones.
///   setData({ branches, salons })                     replace pins
///   setSelected({ id, flyTo? })                       selection echo
///   locateMe()                                        center on the user
/// Events:
///   pinTapped   { kind: "branch"|"salon", id, slug? }
///   mapReady    {}                                    first full render
///   userLocated { lat, lng, accuracy }
///   locateError { message }
@objc(BranchMapPlugin)
public class BranchMapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BranchMapPlugin"
    public let jsName = "BranchMap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateFrame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSelected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "locateMe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeListener", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise)
    ]

    private var mapView: BranchMapView?
    private var isShown = false
    private var lastHostFrame: CGRect = .zero
    private var lastClipTop: Double?
    private var lastCutout: CGRect?
    private var storedData: (branches: [BranchPinData], salons: [BranchPinData])?
    private var storedSelectedId: String?
    /// The last `visible` the JS bridge sent (updateFrame). The
    /// native scroll sync below may hide the map earlier (fully
    /// covered by the header) but never overrides a JS park.
    private var jsVisible = true
    // Scroll-sync anchors: the JS-measured clip/cutout paired with
    // the scroll view's contentOffset at arrival. See the class doc.
    private var clipAnchor: (docY: Double, offsetY: CGFloat)?
    private var cutoutAnchor: (docRect: CGRect, offset: CGPoint)?
    private var scrollViewObservation: NSKeyValueObservation?
    private weak var observedScrollView: UIScrollView?

    deinit {
        scrollViewObservation?.invalidate()
    }

    // MARK: - Public bridge methods

    @objc func show(_ call: CAPPluginCall) {
        if let frame = parseFrame(call) { lastHostFrame = frame }
        if let clipTop = call.getDouble("clipTop") { lastClipTop = clipTop }
        updateCutout(from: call)
        let dataProvided = call.getArray("branches") != nil || call.getArray("salons") != nil
        if dataProvided {
            storedData = (branches: parsePins(call.getArray("branches")),
                          salons: parsePins(call.getArray("salons")))
        }
        let selectedProvided = call.getObject("selectedId") != nil || call.getString("selectedId") != nil
        if selectedProvided { storedSelectedId = call.getString("selectedId") }
        isShown = true
        DispatchQueue.main.async { [weak self] in
            guard let self, let view = self.ensureMapView() else {
                call.reject("Native map host view is unavailable")
                return
            }
            self.attachToScrollView(view)
            if self.lastHostFrame != .zero { view.frame = self.lastHostFrame }
            self.applyClip(view)
            self.recordAnchors()
            if dataProvided, let data = self.storedData {
                view.setData(branches: data.branches, salons: data.salons)
            }
            view.isHidden = false
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        isShown = false
        DispatchQueue.main.async { [weak self] in
            self?.mapView?.isHidden = true
            call.resolve()
        }
    }

    @objc func updateFrame(_ call: CAPPluginCall) {
        if let frame = parseFrame(call) { lastHostFrame = frame }
        if let clipTop = call.getDouble("clipTop") { lastClipTop = clipTop }
        updateCutout(from: call)
        let visible = call.getBool("visible") ?? true
        jsVisible = visible
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            if let view = self.mapView {
                self.attachToScrollView(view)
                if self.lastHostFrame != .zero { view.frame = self.lastHostFrame }
                self.applyClip(view)
                self.recordAnchors()
                view.isHidden = !(self.isShown && visible)
            }
            call.resolve()
        }
    }

    /// Parses the AI-button cutout: [x, y, width, height] in document
    /// space sets it, an empty array clears it, and an absent key
    /// keeps the previous value (older web deploys never send it, so
    /// they keep the pre-cutout behavior exactly).
    private func updateCutout(from call: CAPPluginCall) {
        guard let raw = call.getArray("cutout") else { return }
        if raw.count == 4,
           let x = (raw[0] as? NSNumber)?.doubleValue,
           let y = (raw[1] as? NSNumber)?.doubleValue,
           let width = (raw[2] as? NSNumber)?.doubleValue,
           let height = (raw[3] as? NSNumber)?.doubleValue,
           width > 0, height > 0 {
            lastCutout = CGRect(x: x, y: y, width: width, height: height)
        } else {
            lastCutout = nil
        }
    }

    /// Keeps the map under the sticky header AND the floating AI
    /// button: converts the stored document-space clip line and
    /// cutout rect into view-local values and hands them to the view
    /// (which masks + hit-tests accordingly). Runs on every show /
    /// updateFrame, right after the frame is (re)applied, so the
    /// conversion always uses the current frame. The clip half is a
    /// no-op when the web layer never sent a clipTop (older deploys).
    private func applyClip(_ view: BranchMapView) {
        applyClip(view, docClipY: lastClipTop, docCutout: lastCutout)
    }

    private func applyClip(_ view: BranchMapView, docClipY: Double?, docCutout: CGRect?) {
        if let docClipY {
            view.setTopClip(CGFloat(docClipY) - view.frame.minY)
        }
        if let docCutout {
            view.setCutout(docCutout.offsetBy(dx: -view.frame.minX, dy: -view.frame.minY))
        } else {
            view.setCutout(nil)
        }
    }

    /// Anchors the just-applied JS clip/cutout values to the scroll
    /// view's CURRENT contentOffset, so syncClipToScrollOffset can
    /// track them natively between JS updates (see the class doc).
    private func recordAnchors() {
        guard let offset = bridge?.webView?.scrollView.contentOffset else { return }
        if let lastClipTop {
            clipAnchor = (docY: lastClipTop, offsetY: offset.y)
        }
        if let lastCutout {
            cutoutAnchor = (docRect: lastCutout, offset: offset)
        } else {
            cutoutAnchor = nil
        }
    }

    /// Observes the WebView scroll view's contentOffset (once per
    /// scroll-view instance; re-registered if the WebView is ever
    /// recreated). The callback lands on the main thread, in step
    /// with the scroll itself — unlike the JS bridge round trip.
    private func observeScrollViewIfNeeded() {
        guard let scrollView = bridge?.webView?.scrollView else { return }
        if observedScrollView === scrollView { return }
        scrollViewObservation?.invalidate()
        observedScrollView = scrollView
        scrollViewObservation = scrollView.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
            self?.syncClipToScrollOffset()
        }
    }

    /// Re-applies the clip/cutout for the scroll view's current
    /// offset: the anchored document-space values shifted by the
    /// offset delta since they were anchored. Also hides the map
    /// the moment the header band covers it completely — in step
    /// with the scroll, not when the next JS `visible` lands.
    private func syncClipToScrollOffset() {
        guard isShown, let view = mapView,
              let offset = bridge?.webView?.scrollView.contentOffset else { return }
        var docClipY = lastClipTop
        if let clipAnchor {
            docClipY = clipAnchor.docY + Double(offset.y - clipAnchor.offsetY)
        }
        var docCutout = lastCutout
        if let cutoutAnchor {
            docCutout = cutoutAnchor.docRect.offsetBy(
                dx: offset.x - cutoutAnchor.offset.x,
                dy: offset.y - cutoutAnchor.offset.y)
        }
        applyClip(view, docClipY: docClipY, docCutout: docCutout)
        if let docClipY {
            let cut = CGFloat(docClipY) - view.frame.minY
            view.isHidden = !jsVisible || cut >= view.frame.height
        }
    }

    @objc func setData(_ call: CAPPluginCall) {
        storedData = (branches: parsePins(call.getArray("branches")),
                      salons: parsePins(call.getArray("salons")))
        DispatchQueue.main.async { [weak self] in
            guard let self, let data = self.storedData else { call.resolve(); return }
            self.mapView?.setData(branches: data.branches, salons: data.salons)
            call.resolve()
        }
    }

    @objc func setSelected(_ call: CAPPluginCall) {
        // An explicit null clears the selection; a missing key does too
        // (the web always sends the current value).
        storedSelectedId = call.getString("id")
        let flyTo = call.getBool("flyTo") ?? true
        let selected = storedSelectedId
        DispatchQueue.main.async { [weak self] in
            self?.mapView?.setSelected(id: selected, flyTo: flyTo)
            call.resolve()
        }
    }

    @objc func locateMe(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.ensureMapView()?.locateMe()
            call.resolve()
        }
    }

    // MARK: - Host view management

    /// Creates the map view on first use and embeds it in the
    /// WebView's scroll view (see attachToScrollView).
    private func ensureMapView() -> BranchMapView? {
        if let mapView { return mapView }
        guard let bridge else { return nil }

        let view = BranchMapView(frame: lastHostFrame == .zero
            ? CGRect(x: 0, y: 0, width: 320, height: 352)
            : lastHostFrame)
        view.isHidden = !isShown
        view.onPinTapped = { [weak self] kind, id, slug in
            var data: [String: Any] = ["kind": kind, "id": id]
            if let slug { data["slug"] = slug }
            self?.notifyListeners("pinTapped", data: data)
        }
        view.onReady = { [weak self] in
            self?.notifyListeners("mapReady", data: [:])
        }
        view.onUserLocated = { [weak self] lat, lng, accuracy in
            self?.notifyListeners("userLocated", data: ["lat": lat, "lng": lng, "accuracy": accuracy])
        }
        view.onLocateError = { [weak self] message in
            self?.notifyListeners("locateError", data: ["message": message])
        }
        attachToScrollView(view)
        mapView = view
        applyClip(view)
        recordAnchors()
        if let storedData {
            view.setData(branches: storedData.branches, salons: storedData.salons)
        }
        if let storedSelectedId {
            view.setSelected(id: storedSelectedId, flyTo: false)
        }
        return view
    }

    /// Embeds the map in the WebView's scroll view so it scrolls with
    /// the page exactly — part of the content, positioned in document
    /// coordinates — instead of floating above the WebView and being
    /// chased across the screen by JS rect updates on every scroll
    /// event (the old design visibly slid and drifted out of its
    /// slot, and swallowed drags that should have scrolled the page).
    /// Re-called on show/updateFrame in case the WebView was
    /// recreated. Falls back to floating above the WebView only if
    /// the scroll view is unavailable.
    private func attachToScrollView(_ view: BranchMapView) {
        if let scrollView = bridge?.webView?.scrollView {
            if view.superview !== scrollView {
                view.removeFromSuperview()
                scrollView.addSubview(view)
            }
            observeScrollViewIfNeeded()
        } else if let bridge, let hostView = bridge.viewController?.view,
                  let webView = bridge.webView {
            if view.superview !== hostView {
                view.removeFromSuperview()
                hostView.insertSubview(view, aboveSubview: webView)
            }
        }
    }

    // MARK: - Payload parsing

    /// Parses a JS rect ({x, y, width, height} in document-space
    /// points — the same coordinate space as the WebView scroll
    /// view's content, where the map is embedded).
    private func parseFrame(_ call: CAPPluginCall) -> CGRect? {
        guard let rect = call.getObject("frame"),
              let x = (rect["x"] as? NSNumber)?.doubleValue,
              let y = (rect["y"] as? NSNumber)?.doubleValue,
              let width = (rect["width"] as? NSNumber)?.doubleValue,
              let height = (rect["height"] as? NSNumber)?.doubleValue,
              width > 0, height > 0
        else { return nil }
        // The rect arrives in document coordinates; the map lives in
        // the WebView's scroll view, whose content space IS the
        // document — there is no origin conversion to get wrong (the
        // old viewport-space assumption misplaced the map, so it
        // covered the card above its slot and left a gold strip of
        // the placeholder showing below it).
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private func parsePins(_ raw: [Any]?) -> [BranchPinData] {
        guard let raw else { return [] }
        return raw.compactMap { item in
            guard let dict = item as? [String: Any],
                  let id = dict["id"] as? String,
                  let lat = (dict["lat"] as? NSNumber)?.doubleValue,
                  let lng = (dict["lng"] as? NSNumber)?.doubleValue
            else { return nil }
            return BranchPinData(
                id: id,
                name: (dict["name"] as? String) ?? "",
                slug: dict["slug"] as? String,
                number: (dict["number"] as? NSNumber)?.intValue,
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)
            )
        }
    }
}

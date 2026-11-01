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
///   show({ frame, branches?, salons?, selectedId? })  create + reveal
///   hide()                                            conceal (kept alive)
///   updateFrame({ frame, visible })                   scroll/resize sync
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
    private var storedData: (branches: [BranchPinData], salons: [BranchPinData])?
    private var storedSelectedId: String?

    // MARK: - Public bridge methods

    @objc func show(_ call: CAPPluginCall) {
        if let frame = parseFrame(call) { lastHostFrame = frame }
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
        let visible = call.getBool("visible") ?? true
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            if let view = self.mapView {
                self.attachToScrollView(view)
                if self.lastHostFrame != .zero { view.frame = self.lastHostFrame }
                view.isHidden = !(self.isShown && visible)
            }
            call.resolve()
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

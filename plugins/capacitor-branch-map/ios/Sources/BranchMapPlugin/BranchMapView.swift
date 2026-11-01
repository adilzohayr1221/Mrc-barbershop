import UIKit
import MapKit
import CoreLocation

/// The native branch map: a real MKMapView (Apple Maps) wearing the same
/// gold frame as the web `.modern-map` container, with the same controls
/// in the same places — a frosted locate-me button top-left and a frosted
/// +/− zoom stack at the right-center — and the same behaviors:
/// fit-all-pins on open, fly-to on selection, locate-me centering.
///
/// Frame fidelity vs globals.css `.modern-map`:
///   • 6 pt band showing a metallic gold gradient
///     (150deg, #f0d98c → #d4af37 28% → #b08a24 52% → #e9ce7a 76% → #c39a2b)
///   • outer corner radius 26, map surface radius 20
///   • outer drop shadow (0 24px 48px rgba(60,50,20,.18)) — CALayer
///     supports one shadow, so the dominant of the CSS pair is used
///   • inner hairline ring rgba(122,95,20,.35) at the frame's inner edge
/// The web's two inset highlights are approximated by the gradient itself.
final class BranchMapView: UIView, MKMapViewDelegate, CLLocationManagerDelegate {

    // MARK: Callbacks (wired by BranchMapPlugin)

    /// kind is "branch" or "salon"; slug is set for salons only.
    var onPinTapped: ((_ kind: String, _ id: String, _ slug: String?) -> Void)?
    var onReady: (() -> Void)?
    var onUserLocated: ((_ lat: Double, _ lng: Double, _ accuracy: Double) -> Void)?
    var onLocateError: ((_ message: String) -> Void)?

    // MARK: Subviews

    private let frameView = UIView()
    private let gradientLayer = CAGradientLayer()
    private let ringLayer = CAShapeLayer()
    private let mapView = MKMapView(frame: .zero)
    private let locateButton = UIButton(type: .custom)
    private let zoomStack = UIView()
    private let zoomInButton = UIButton(type: .custom)
    private let zoomOutButton = UIButton(type: .custom)

    // MARK: State

    private let locationManager = CLLocationManager()
    private var branchAnnotations: [ShopAnnotation] = []
    private var salonAnnotations: [ShopAnnotation] = []
    private var selectedId: String?
    private var didFitInitial = false
    private var readyFired = false
    private var pendingLocate = false

    private static let gold = UIColor(red: 212.0 / 255, green: 175.0 / 255, blue: 55.0 / 255, alpha: 1)
    private static let goldDeep = UIColor(red: 122.0 / 255, green: 95.0 / 255, blue: 20.0 / 255, alpha: 1)
    private static let frostFill = UIColor(red: 1, green: 253.0 / 255, blue: 246.0 / 255, alpha: 0.85)
    private static let locateErrorText = "Could not get your location. Check permission and try again."

    override init(frame: CGRect) {
        super.init(frame: frame)
        setup()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("BranchMapView is created in code only")
    }

    // MARK: Setup

    private func setup() {
        backgroundColor = .clear
        // Outer drop shadow (the one shadow CALayer gives us).
        layer.shadowColor = UIColor(red: 60.0 / 255, green: 50.0 / 255, blue: 20.0 / 255, alpha: 1).cgColor
        layer.shadowOpacity = 0.18
        layer.shadowRadius = 24
        layer.shadowOffset = CGSize(width: 0, height: 24)

        // Gold frame band.
        frameView.layer.cornerRadius = 26
        frameView.clipsToBounds = true
        gradientLayer.colors = [
            UIColor(red: 240.0 / 255, green: 217.0 / 255, blue: 140.0 / 255, alpha: 1).cgColor, // #f0d98c
            UIColor(red: 212.0 / 255, green: 175.0 / 255, blue: 55.0 / 255, alpha: 1).cgColor,  // #d4af37
            UIColor(red: 176.0 / 255, green: 138.0 / 255, blue: 36.0 / 255, alpha: 1).cgColor,  // #b08a24
            UIColor(red: 233.0 / 255, green: 206.0 / 255, blue: 122.0 / 255, alpha: 1).cgColor, // #e9ce7a
            UIColor(red: 195.0 / 255, green: 154.0 / 255, blue: 43.0 / 255, alpha: 1).cgColor   // #c39a2b
        ]
        gradientLayer.locations = [0, 0.28, 0.52, 0.76, 1]
        // CSS gradient angle 150deg ≈ diagonal sweep down-right.
        gradientLayer.startPoint = CGPoint(x: 0.25, y: 0.05)
        gradientLayer.endPoint = CGPoint(x: 0.75, y: 0.95)
        frameView.layer.insertSublayer(gradientLayer, at: 0)
        addSubview(frameView)

        // The map surface itself.
        mapView.delegate = self
        mapView.mapType = .standard
        mapView.pointOfInterestFilter = .includingAll
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.isPitchEnabled = false
        mapView.isRotateEnabled = false
        mapView.showsUserLocation = false
        mapView.layer.cornerRadius = 20
        mapView.clipsToBounds = true
        frameView.addSubview(mapView)

        // Inner hairline ring at the frame's inner edge (above the map).
        ringLayer.fillColor = UIColor.clear.cgColor
        ringLayer.strokeColor = UIColor(red: 122.0 / 255, green: 95.0 / 255, blue: 20.0 / 255, alpha: 0.35).cgColor
        ringLayer.lineWidth = 1
        frameView.layer.addSublayer(ringLayer)

        setupLocateButton()
        setupZoomStack()

        locationManager.delegate = self
    }

    private func setupLocateButton() {
        // Web .map-fab: 44×44 frosted circle at top-left (12, 12 of the
        // framed unit), crosshair glyph in deep gold; spins blue while
        // locating. SF Symbol "scope" is the same crosshair drawing.
        locateButton.frame = CGRect(x: 12, y: 12, width: 44, height: 44)
        locateButton.backgroundColor = Self.frostFill
        locateButton.layer.cornerRadius = 22
        locateButton.layer.borderWidth = 1
        locateButton.layer.borderColor = Self.gold.withAlphaComponent(0.35).cgColor
        locateButton.layer.shadowColor = UIColor(red: 60.0 / 255, green: 50.0 / 255, blue: 20.0 / 255, alpha: 1).cgColor
        locateButton.layer.shadowOpacity = 0.14
        locateButton.layer.shadowRadius = 11
        locateButton.layer.shadowOffset = CGSize(width: 0, height: 8)
        let config = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
        locateButton.setImage(UIImage(systemName: "scope", withConfiguration: config), for: .normal)
        locateButton.tintColor = Self.goldDeep
        locateButton.accessibilityLabel = "Locate me"
        locateButton.addTarget(self, action: #selector(locateTapped), for: .touchUpInside)
        addSubview(locateButton)
    }

    private func setupZoomStack() {
        // Web .map-zoom-stack: 40-wide frosted pill, right edge, vertically
        // centered, "+" over "−" with a hairline divider.
        zoomStack.backgroundColor = Self.frostFill
        zoomStack.layer.cornerRadius = 14
        zoomStack.layer.borderWidth = 1
        zoomStack.layer.borderColor = Self.gold.withAlphaComponent(0.35).cgColor
        zoomStack.layer.shadowColor = UIColor(red: 60.0 / 255, green: 50.0 / 255, blue: 20.0 / 255, alpha: 1).cgColor
        zoomStack.layer.shadowOpacity = 0.14
        zoomStack.layer.shadowRadius = 11
        zoomStack.layer.shadowOffset = CGSize(width: 0, height: 8)
        zoomStack.clipsToBounds = true

        for (button, title, action) in [
            (zoomInButton, "+", #selector(zoomInTapped)),
            (zoomOutButton, "\u{2212}", #selector(zoomOutTapped))
        ] {
            button.setTitle(title, for: .normal)
            button.setTitleColor(Self.goldDeep, for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 20, weight: .bold)
            button.addTarget(self, action: action, for: .touchUpInside)
            zoomStack.addSubview(button)
        }
        let divider = UIView()
        divider.backgroundColor = UIColor(red: 156.0 / 255, green: 124.0 / 255, blue: 30.0 / 255, alpha: 0.25)
        divider.tag = 9001
        zoomStack.addSubview(divider)
        addSubview(zoomStack)
    }

    // MARK: Layout

    override func layoutSubviews() {
        super.layoutSubviews()
        frameView.frame = bounds
        gradientLayer.frame = frameView.bounds
        // The map fills the frame's inner box (6 pt band on every side).
        mapView.frame = frameView.bounds.insetBy(dx: 6, dy: 6)
        ringLayer.frame = frameView.bounds
        ringLayer.path = UIBezierPath(
            roundedRect: frameView.bounds.insetBy(dx: 6, dy: 6),
            cornerRadius: 20
        ).cgPath
        // Zoom stack: right edge (16 in from the framed unit), centered.
        let stackSize = CGSize(width: 40, height: 81)
        zoomStack.frame = CGRect(
            x: bounds.width - 16 - stackSize.width,
            y: (bounds.height - stackSize.height) / 2,
            width: stackSize.width,
            height: stackSize.height
        )
        zoomInButton.frame = CGRect(x: 0, y: 0, width: 40, height: 40)
        zoomOutButton.frame = CGRect(x: 0, y: 41, width: 40, height: 40)
        zoomStack.viewWithTag(9001)?.frame = CGRect(x: 0, y: 40, width: 40, height: 1)
    }

    // MARK: Data & selection (called by the plugin)

    func setData(branches: [BranchPinData], salons: [BranchPinData]) {
        mapView.removeAnnotations(branchAnnotations + salonAnnotations)
        branchAnnotations = branches.map { ShopAnnotation(data: $0, kind: .branch) }
        salonAnnotations = salons.map { ShopAnnotation(data: $0, kind: .salon) }
        mapView.addAnnotations(branchAnnotations + salonAnnotations)
        applySelectionStyles()
        // Fit on first data only — the web engines fit on mount and never
        // refit when data/selection changes afterwards.
        if !didFitInitial, !branchAnnotations.isEmpty || !salonAnnotations.isEmpty {
            didFitInitial = true
            fitAllPins(animated: false)
        }
    }

    func setSelected(id: String?, flyTo: Bool) {
        selectedId = id
        applySelectionStyles()
        if flyTo, let id,
           let annotation = branchAnnotations.first(where: { $0.pinId == id }) {
            flyToAnnotation(annotation)
        }
    }

    private func applySelectionStyles() {
        for annotation in branchAnnotations + salonAnnotations {
            guard let view = mapView.view(for: annotation) as? ShopPinAnnotationView else { continue }
            style(view, for: annotation)
        }
    }

    private func style(_ view: ShopPinAnnotationView, for annotation: ShopAnnotation) {
        let isSelected = annotation.kind == .branch && annotation.pinId == selectedId
        let dimmed = annotation.kind == .branch && selectedId != nil && !isSelected
        view.applyState(selected: isSelected, dimmed: dimmed)
    }

    private func fitAllPins(animated: Bool) {
        let annotations = branchAnnotations + salonAnnotations
        guard let first = annotations.first else { return }
        if annotations.count == 1 {
            // Web: a lone pin opens at zoom 14 (≈ 0.022° span).
            mapView.setRegion(
                MKCoordinateRegion(center: first.coordinate,
                                   span: MKCoordinateSpan(latitudeDelta: 0.022, longitudeDelta: 0.022)),
                animated: animated)
            return
        }
        var rect = MKMapRect.null
        for annotation in annotations {
            let point = MKMapPoint(annotation.coordinate)
            rect = rect.union(MKMapRect(x: point.x, y: point.y, width: 0.1, height: 0.1))
        }
        // Web fitBounds padding is [52, 52].
        mapView.setVisibleMapRect(rect,
                                  edgePadding: UIEdgeInsets(top: 52, left: 52, bottom: 52, right: 52),
                                  animated: animated)
    }

    private func flyToAnnotation(_ annotation: ShopAnnotation) {
        // Web FlyToSelected: skip when already centered there at street
        // zoom — re-flying to the same spot makes the map shake.
        let target = annotation.coordinate
        let center = mapView.region.center
        let distance = CLLocation(latitude: center.latitude, longitude: center.longitude)
            .distance(from: CLLocation(latitude: target.latitude, longitude: target.longitude))
        if distance < 30, mapView.region.span.latitudeDelta <= 0.012 { return }
        // Web flies to zoom 15 (≈ 0.01° span).
        mapView.setRegion(
            MKCoordinateRegion(center: target,
                               span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)),
            animated: true)
    }

    // MARK: Zoom controls

    @objc private func zoomInTapped() { adjustZoom(factor: 0.5) }
    @objc private func zoomOutTapped() { adjustZoom(factor: 2.0) }

    private func adjustZoom(factor: Double) {
        var region = mapView.region
        region.span.latitudeDelta = min(max(region.span.latitudeDelta * factor, 0.0005), 120)
        region.span.longitudeDelta = min(max(region.span.longitudeDelta * factor, 0.0005), 120)
        mapView.setRegion(region, animated: true)
    }

    // MARK: Locate me

    @objc private func locateTapped() { locateMe() }

    func locateMe() {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            pendingLocate = true
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            startLocating()
        default:
            onLocateError?(Self.locateErrorText)
        }
    }

    private func startLocating() {
        mapView.showsUserLocation = true
        if let location = locationManager.location {
            centerOn(location)
        } else {
            setLocating(true)
            locationManager.requestLocation()
        }
    }

    private func centerOn(_ location: CLLocation) {
        setLocating(false)
        onUserLocated?(location.coordinate.latitude,
                       location.coordinate.longitude,
                       max(location.horizontalAccuracy, 0))
        mapView.setRegion(
            MKCoordinateRegion(center: location.coordinate,
                               span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)),
            animated: true)
    }

    private func setLocating(_ locating: Bool) {
        locateButton.tintColor = locating
            ? UIColor(red: 26.0 / 255, green: 115.0 / 255, blue: 232.0 / 255, alpha: 1)
            : Self.goldDeep
        if locating {
            let spin = CABasicAnimation(keyPath: "transform.rotation")
            spin.fromValue = 0
            spin.toValue = Double.pi * 2
            spin.duration = 1.1
            spin.repeatCount = .infinity
            spin.isRemovedOnCompletion = false
            locateButton.imageView?.layer.add(spin, forKey: "fab-spin")
        } else {
            locateButton.imageView?.layer.removeAnimation(forKey: "fab-spin")
        }
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard pendingLocate else { return }
        pendingLocate = false
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            startLocating()
        case .notDetermined:
            pendingLocate = true
        default:
            onLocateError?(Self.locateErrorText)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        centerOn(location)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        setLocating(false)
        onLocateError?(Self.locateErrorText)
    }

    // MARK: MKMapViewDelegate

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        if annotation is MKUserLocation { return nil } // Apple's blue dot
        guard let shop = annotation as? ShopAnnotation else { return nil }
        let reuseId = shop.kind == .branch
            ? ShopPinAnnotationView.branchReuseId
            : ShopPinAnnotationView.salonReuseId
        let view = mapView.dequeueReusableAnnotationView(withIdentifier: reuseId) as? ShopPinAnnotationView
            ?? ShopPinAnnotationView(annotation: shop, reuseIdentifier: reuseId)
        view.annotation = shop
        view.configure(with: shop)
        style(view, for: shop)
        return view
    }

    func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
        guard let shop = view.annotation as? ShopAnnotation else { return }
        // Instant local feedback; the web stays the source of truth and
        // echoes setSelected back (idempotent — the fly-to is skipped
        // when the map is already centered on the pin).
        if shop.kind == .branch {
            selectedId = shop.pinId
            applySelectionStyles()
        }
        onPinTapped?(shop.kind == .branch ? "branch" : "salon", shop.pinId, shop.slug)
        // No callouts: deselect immediately so the same pin can be
        // tapped again (MapKit would otherwise swallow the next tap).
        mapView.deselectAnnotation(shop, animated: false)
    }

    func mapViewDidFinishRenderingMap(_ mapView: MKMapView, fullyRendered: Bool) {
        guard fullyRendered, !readyFired else { return }
        readyFired = true
        onReady?()
    }
}

import UIKit
import MapKit

/// One pin's worth of data, decoded from the JS bridge payload.
/// Mirrors the web map's inputs: branches carry a 1-based `number`
/// (the badge), salons carry a `slug` instead.
struct BranchPinData {
    let id: String
    let name: String
    let slug: String?
    let number: Int?
    let coordinate: CLLocationCoordinate2D
}

/// MapKit annotation for a shop pin. Identity lives here (not in the view)
/// so selection styling survives view recycling.
final class ShopAnnotation: NSObject, MKAnnotation {
    enum Kind {
        case branch
        case salon
    }

    let pinId: String
    let kind: Kind
    let number: Int?
    let slug: String?
    let name: String

    @objc dynamic var coordinate: CLLocationCoordinate2D

    init(data: BranchPinData, kind: Kind) {
        self.pinId = data.id
        self.kind = kind
        self.number = data.number
        self.slug = data.slug
        self.name = data.name
        self.coordinate = data.coordinate
        super.init()
    }
}

/// The ORIGINAL shop pin, reproduced at native fidelity.
///
/// Geometry is copied 1:1 from the web pin (src/components/mapPins.ts +
/// .shop-pin in globals.css): a 34×47 box whose tip sits at (17, 41).
/// The artwork itself is the same SVG, rasterized to PNG at build-prep
/// time (Resources/pin-branch, pin-salon) — identical drawing, no redraw.
/// The number is NOT baked into the image: it is a UILabel laid exactly
/// over the badge circle (center 27.5, 7 · radius 6.5 in pin coordinates)
/// so it stays crisp at every display scale.
///
/// Selected treatment mirrors the web CSS: the pin scales ×1.22 about
/// its tip (transform-origin: 17px 41px), gains a gold glow, and a gold
/// ring pulses around the medallion (scale 0.75 → 1.3, fade out, 2.2 s,
/// matching @keyframes pin-pulse). Unselected pins dim to 55 % while a
/// selection exists, exactly like the Leaflet/MapKit-JS engines.
final class ShopPinAnnotationView: MKAnnotationView {
    static let branchReuseId = "shop-pin-branch"
    static let salonReuseId = "shop-pin-salon"

    /// Pin box size in points (matches the web .shop-pin box).
    static let pinSize = CGSize(width: 34, height: 47)
    /// Where the tip sits inside the box (matches the SVG anchor 17,41).
    private static let tipPoint = CGPoint(x: 17, y: 41)

    private let contentView = UIView()
    private let imageView = UIImageView()
    private let badgeLabel = UILabel()
    private let pulseRing = UIView()

    private static let gold = UIColor(red: 212.0 / 255, green: 175.0 / 255, blue: 55.0 / 255, alpha: 1)
    private static let ink = UIColor(red: 28.0 / 255, green: 26.0 / 255, blue: 21.0 / 255, alpha: 1)

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)

        frame = CGRect(origin: .zero, size: Self.pinSize)
        // The tip (17, 41) — not the view center — must land on the
        // coordinate: the center sits (41 − 23.5) = 17.5 pt ABOVE the
        // coordinate, hence the negative y (same convention as the
        // classic pin centerOffset of (0, −height/2) for a bottom tip).
        centerOffset = CGPoint(x: Self.pinSize.width / 2 - Self.tipPoint.x,
                               y: Self.pinSize.height / 2 - Self.tipPoint.y)
        canShowCallout = false
        isDraggable = false
        displayPriority = .required

        // Scale about the tip, like the web CSS transform-origin.
        contentView.frame = bounds
        contentView.layer.anchorPoint = CGPoint(x: Self.tipPoint.x / Self.pinSize.width,
                                                y: Self.tipPoint.y / Self.pinSize.height)
        contentView.layer.position = Self.tipPoint
        addSubview(contentView)

        // Pulse ring sits behind the pin body, centered on the medallion
        // (17, 17) with the SVG ring's 28 pt diameter.
        pulseRing.frame = CGRect(x: 17 - 14, y: 17 - 14, width: 28, height: 28)
        pulseRing.layer.cornerRadius = 14
        pulseRing.layer.borderWidth = 2
        pulseRing.layer.borderColor = Self.gold.cgColor
        pulseRing.isHidden = true
        pulseRing.isUserInteractionEnabled = false
        contentView.addSubview(pulseRing)

        imageView.frame = contentView.bounds
        imageView.contentMode = .scaleToFill
        // Web: drop-shadow(0 3px 4px rgba(0,0,0,.35)) under every pin.
        imageView.layer.shadowColor = UIColor.black.cgColor
        imageView.layer.shadowOpacity = 0.35
        imageView.layer.shadowRadius = 4
        imageView.layer.shadowOffset = CGSize(width: 0, height: 3)
        contentView.addSubview(imageView)

        // Badge number, exactly over the badge circle (27.5, 7) r 6.5.
        // Web draws it as SVG text: Arial 9.5, weight 800, #1C1A15.
        badgeLabel.frame = CGRect(x: 27.5 - 6.5, y: 7 - 6.5, width: 13, height: 13)
        badgeLabel.font = .systemFont(ofSize: 9.5, weight: .heavy)
        badgeLabel.textColor = Self.ink
        badgeLabel.textAlignment = .center
        contentView.addSubview(badgeLabel)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("ShopPinAnnotationView is created in code only")
    }

    func configure(with annotation: ShopAnnotation) {
        let imageName = annotation.kind == .branch ? "pin-branch" : "pin-salon"
        imageView.image = UIImage(named: imageName, in: Bundle.module, compatibleWith: nil)
        if annotation.kind == .branch, let number = annotation.number {
            badgeLabel.text = String(number)
            badgeLabel.isHidden = false
        } else {
            badgeLabel.text = nil
            badgeLabel.isHidden = true
        }
        accessibilityLabel = annotation.name
    }

    /// Applies the web selection contract: selected → ×1.22 scale about
    /// the tip + gold glow + pulse; dimmed → 55 % opacity (used for the
    /// non-selected branch pins while a selection exists).
    func applyState(selected: Bool, dimmed: Bool) {
        alpha = dimmed ? 0.55 : 1.0
        if selected {
            UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
                self.contentView.transform = CGAffineTransform(scaleX: 1.22, y: 1.22)
            }
            // Web: drop-shadow(0 0 12px rgba(212,175,55,.85)) on top of the base shadow.
            imageView.layer.shadowColor = Self.gold.cgColor
            imageView.layer.shadowRadius = 12
            imageView.layer.shadowOpacity = 0.85
            startPulse()
        } else {
            UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
                self.contentView.transform = .identity
            }
            imageView.layer.shadowColor = UIColor.black.cgColor
            imageView.layer.shadowRadius = 4
            imageView.layer.shadowOpacity = 0.35
            stopPulse()
        }
    }

    private func startPulse() {
        pulseRing.isHidden = false
        guard pulseRing.layer.animation(forKey: "pin-pulse") == nil else { return }
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.75
        scale.toValue = 1.3
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1.0
        fade.toValue = 0.0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = 2.2
        group.repeatCount = .infinity
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        pulseRing.layer.add(group, forKey: "pin-pulse")
    }

    private func stopPulse() {
        pulseRing.layer.removeAnimation(forKey: "pin-pulse")
        pulseRing.isHidden = true
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        stopPulse()
        contentView.transform = .identity
        alpha = 1.0
        badgeLabel.text = nil
        imageView.image = nil
    }
}
